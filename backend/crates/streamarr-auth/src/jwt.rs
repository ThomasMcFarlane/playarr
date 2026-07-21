//! JWT issuance and verification for access tokens. Session-level refresh
//! tokens (the long-lived, revocable side of auth — see
//! `streamarr_model::Session::refresh_token`) are opaque, DB-backed
//! secrets, not JWTs; only the short-lived access token handed to a client
//! after login/refresh is a JWT.
//!
//! **Cross-node JWT trust** (`docs/architecture/peer-groups.md` §5.4): a
//! standalone, ungrouped node always issues and verifies HS256 tokens
//! against a single shared secret, unchanged from before this existed.
//! Once a node is grouped (`node_identity.group_id.is_some()`), calling
//! [`JwtIssuer::with_group_identity`] switches *issuance* to EdDSA, signed
//! with this node's own Ed25519 `node_identity` keypair — the same key
//! already used for peer-to-peer request signing (§3.3), not a second key
//! to manage — with `iss` set to this node's own `peer_id`. A shared
//! secret across a group would let any compromised peer forge tokens for
//! any user against any peer; per-peer asymmetric signing means a
//! compromised peer can only forge tokens claiming to be *itself*.
//! *Verification* always tries both: [`JwtIssuer::verify_access_token`]
//! peeks at the token's `iss` claim (without trusting it yet) and, if it
//! parses as a `Uuid`, treats the token as EdDSA-signed by that peer and
//! looks up its `public_key` in this node's own (synced) `peer_nodes`
//! table via `PeerNodeRepo` — never falling back to the HS256 secret for
//! that token, so an unknown or since-left peer's `iss` is rejected
//! outright rather than silently retried under the wrong algorithm. If
//! `iss` does not parse as a `Uuid` it must be this node's own configured
//! HS256 issuer string, verified exactly as before. This is how a client's
//! existing access token, once minted by any peer, is already verifiable
//! by every other member — `Redirect` delivery (§5.3) needs no token
//! exchange at all.

use std::sync::{Arc, RwLock};

use base64::Engine;
use chrono::{Duration, Utc};
use ed25519_dalek::{Signer, SigningKey};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use streamarr_db::PeerNodeRepo;
use streamarr_model::{NodeIdentity, PeerNodeStatus};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum JwtError {
    #[error(transparent)]
    Token(#[from] jsonwebtoken::errors::Error),
    #[error(transparent)]
    Serialization(#[from] serde_json::Error),
    /// The token's `iss` names a peer this node either doesn't know about,
    /// or knows about but has recorded as having left the group (§3.3's
    /// revocation model). Deliberately its own variant rather than falling
    /// through to an HS256 attempt that would also fail: fails closed
    /// explicitly instead of accidentally-correctly, and matches
    /// `peer_extractor.rs`'s "an unknown peer id, a real lookup error, and
    /// an explicit `Left` status all reject the same way" convention.
    #[error("issuing peer is unknown to this node, or has left the group")]
    UnknownIssuer,
    #[error("stored Ed25519 key material is invalid: {0}")]
    InvalidKeyMaterial(String),
}

/// Claims embedded in every access token. `sub` is the user id (the JWT
/// spec's own name for the subject claim); `device_id`/`session_id` are
/// carried so downstream handlers can enforce
/// `Policy::max_concurrent_sessions` and per-device revocation without a
/// second lookup. `iss` is either this node's own configured HS256 issuer
/// string (a standalone node, or a grouped node's tokens verified by
/// itself before it ever joined) or, once grouped, the issuing peer's
/// `peer_id` — see this module's doc comment.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AccessTokenClaims {
    pub sub: Uuid,
    pub device_id: Uuid,
    pub session_id: Uuid,
    pub iss: String,
    /// Issued-at, seconds since the epoch (standard `iat` claim).
    pub iat: i64,
    /// Expiry, seconds since the epoch (standard `exp` claim) —
    /// `jsonwebtoken` validates this automatically on decode.
    pub exp: i64,
    /// Set only on a token minted via [`JwtIssuer::issue_access_token_for`]
    /// with a caller-supplied admin id -- i.e. an admin-impersonation
    /// token, not a normal login/refresh-issued one. Carries the
    /// impersonating admin's user id so a handler acting on `sub` (the
    /// *impersonated* user) can still tell, and audit-log, who is actually
    /// behind the request. `#[serde(default)]` so tokens issued (or test
    /// fixtures constructed) before this field existed still decode/build
    /// fine with `impersonated_by: None`.
    #[serde(default)]
    pub impersonated_by: Option<Uuid>,
}

/// This node's own Ed25519 issuance identity for a grouped node (§5.4) --
/// reuses `node_identity`'s existing keypair, not a second key. `peer_id`
/// (stringified) becomes the `iss` claim on every token minted once this
/// is set.
struct EddsaIdentity {
    signing_key: SigningKey,
    peer_id: String,
}

/// Issues and verifies access tokens. HS256 (a single shared secret,
/// `encoding_key`/`decoding_key` are the same secret since it's a
/// symmetric algorithm) is the unconditional default -- byte-for-byte
/// today's behavior for a standalone, ungrouped node. [`Self::
/// with_group_identity`] additively layers in EdDSA issuance/verification
/// for a grouped node; see this module's doc comment for the full
/// precedence.
pub struct JwtIssuer {
    encoding_key: EncodingKey,
    decoding_key: DecodingKey,
    algorithm: Algorithm,
    issuer: String,
    access_ttl: Duration,
    /// `Some` only once `with_group_identity` has been called for a
    /// grouped node -- switches issuance to EdDSA. `None` (the default)
    /// keeps issuance on HS256 unconditionally.
    eddsa: RwLock<Option<EddsaIdentity>>,
    /// This installation's own identity remains available for verifying
    /// access tokens it issued immediately before leaving a group. Remote
    /// peers revoke those tokens through their `Left` row; the issuing
    /// node should not invalidate its own active admin session mid-action.
    own_eddsa: RwLock<Option<EddsaIdentity>>,
    /// Wired by `with_group_identity` (regardless of whether *this* node
    /// is grouped) so `verify_access_token` can resolve *other* peers'
    /// public keys for tokens minted elsewhere in the group. Looked up
    /// fresh on every verification, never cached -- a peer that leaves or
    /// rotates its key is honored immediately, the same freshness
    /// `peer_extractor.rs`'s inbound request-signature check already gives
    /// `/api/v1/peer/*` calls.
    peer_node_repo: Option<Arc<dyn PeerNodeRepo>>,
}

impl JwtIssuer {
    pub fn new(hmac_secret: &[u8], issuer: impl Into<String>, access_ttl: Duration) -> Self {
        Self {
            encoding_key: EncodingKey::from_secret(hmac_secret),
            decoding_key: DecodingKey::from_secret(hmac_secret),
            algorithm: Algorithm::HS256,
            issuer: issuer.into(),
            access_ttl,
            eddsa: RwLock::new(None),
            own_eddsa: RwLock::new(None),
            peer_node_repo: None,
        }
    }

    /// Enables cross-node JWT trust (§5.4). Always wires `peer_node_repo`
    /// (used by [`Self::verify_access_token`] to resolve other peers'
    /// public keys), and additionally switches *this* node's own issuance
    /// to EdDSA when `node_identity.group_id.is_some()`, signing with the
    /// same Ed25519 keypair `node_identity.private_key` already holds for
    /// peer-to-peer request signing (§3.3). Called once at boot
    /// (`backend/src/main.rs`) right after `node_identity` is loaded/
    /// minted, so ordering relative to founding/joining a group is never
    /// load-bearing for the common "ungrouped node calls this too" case:
    /// with `group_id: None` this is a no-op for issuance (HS256 stays the
    /// default) and only pre-wires `peer_node_repo` for a group this node
    /// might join later.
    ///
    /// If the stored key material is invalid (should be unreachable --
    /// `node_identity.private_key` is only ever written by
    /// `admin_peer::ensure_node_identity`/`generate_ed25519_seed`, both of
    /// which always produce a valid 32-byte seed), issuance is left on
    /// HS256 and the failure is logged loudly rather than panicking at
    /// boot: a corrupted key should degrade cross-node trust, not take the
    /// whole node down.
    pub fn with_group_identity(
        mut self,
        node_identity: &NodeIdentity,
        peer_node_repo: Arc<dyn PeerNodeRepo>,
    ) -> Self {
        if node_identity.group_id.is_some() {
            match decode_ed25519_seed(node_identity.private_key.expose_secret()) {
                Ok(signing_key) => {
                    *self.eddsa.get_mut().unwrap() = Some(EddsaIdentity {
                        signing_key: signing_key.clone(),
                        peer_id: node_identity.peer_id.to_string(),
                    });
                    *self.own_eddsa.get_mut().unwrap() = Some(EddsaIdentity {
                        signing_key,
                        peer_id: node_identity.peer_id.to_string(),
                    });
                }
                Err(err) => {
                    tracing::error!(
                        peer_id = %node_identity.peer_id,
                        error = %err,
                        "grouped node's own Ed25519 node_identity key is invalid; \
                         falling back to HS256 access tokens -- cross-node JWT trust \
                         (docs/architecture/peer-groups.md §5.4) will not work until \
                         this is fixed"
                    );
                }
            }
        } else if let Ok(signing_key) =
            decode_ed25519_seed(node_identity.private_key.expose_secret())
        {
            *self.own_eddsa.get_mut().unwrap() = Some(EddsaIdentity {
                signing_key,
                peer_id: node_identity.peer_id.to_string(),
            });
        }
        self.peer_node_repo = Some(peer_node_repo);
        self
    }

    /// Switches token issuance to this grouped node's EdDSA identity at
    /// runtime. Founding and joining happen after boot, so this cannot be
    /// a boot-only builder concern.
    pub fn activate_group_identity(&self, node_identity: &NodeIdentity) -> Result<(), JwtError> {
        let signing_key = decode_ed25519_seed(node_identity.private_key.expose_secret())?;
        *self.eddsa.write().unwrap() = Some(EddsaIdentity {
            signing_key: signing_key.clone(),
            peer_id: node_identity.peer_id.to_string(),
        });
        *self.own_eddsa.write().unwrap() = Some(EddsaIdentity {
            signing_key,
            peer_id: node_identity.peer_id.to_string(),
        });
        Ok(())
    }

    /// Returns token issuance to standalone HS256 immediately after this
    /// node leaves its peer group.
    pub fn deactivate_group_identity(&self) {
        *self.eddsa.write().unwrap() = None;
    }

    /// The configured access-token TTL, e.g. so a token-response builder
    /// elsewhere in this crate can populate `expires_in` without
    /// duplicating the value this issuer was constructed with.
    pub fn access_ttl(&self) -> Duration {
        self.access_ttl
    }

    pub fn issue_access_token(
        &self,
        user_id: Uuid,
        device_id: Uuid,
        session_id: Uuid,
    ) -> Result<String, JwtError> {
        self.issue_access_token_for(user_id, device_id, session_id, None)
    }

    /// The real token-minting logic behind [`Self::issue_access_token`]
    /// (a thin wrapper calling this with `impersonated_by: None`) --
    /// also used directly by admin impersonation (`streamarr-api`'s
    /// `admin::impersonate_user_handler`) to mint a token for a *different*
    /// user than the caller, with `impersonated_by` set to the
    /// impersonating admin's own user id. Signs with EdDSA (`iss` = this
    /// node's own `peer_id`) once [`Self::with_group_identity`] has
    /// activated it for a grouped node; HS256 (`iss` = the configured
    /// issuer string) otherwise.
    pub fn issue_access_token_for(
        &self,
        user_id: Uuid,
        device_id: Uuid,
        session_id: Uuid,
        impersonated_by: Option<Uuid>,
    ) -> Result<String, JwtError> {
        let now = Utc::now();
        let eddsa = self.eddsa.read().unwrap();
        let iss = match eddsa.as_ref() {
            Some(eddsa) => eddsa.peer_id.clone(),
            None => self.issuer.clone(),
        };
        let claims = AccessTokenClaims {
            sub: user_id,
            device_id,
            session_id,
            iss,
            iat: now.timestamp(),
            exp: (now + self.access_ttl).timestamp(),
            impersonated_by,
        };

        match eddsa.as_ref() {
            Some(eddsa) => encode_eddsa(&claims, &eddsa.signing_key),
            None => {
                let header = Header::new(self.algorithm);
                Ok(jsonwebtoken::encode(&header, &claims, &self.encoding_key)?)
            }
        }
    }

    /// Verifies `token`, trying EdDSA-via-`peer_nodes` when its (not yet
    /// trusted) `iss` claim looks like a peer id, HS256 otherwise -- see
    /// this module's doc comment for the full precedence and rationale.
    pub async fn verify_access_token(&self, token: &str) -> Result<AccessTokenClaims, JwtError> {
        let peeked = Self::peek_claims(token)?;

        if let Ok(peer_id) = Uuid::parse_str(&peeked.iss) {
            return self.verify_eddsa_token(token, peer_id).await;
        }

        self.verify_hs256_token(token)
    }

    /// Reads `token`'s claims (in particular `iss`) *without* verifying
    /// its signature -- deliberately untrusted, used only to decide which
    /// real verification path below to run. `insecure_disable_
    /// signature_validation` also skips the decoding key's algorithm-
    /// family check, so the dummy key below never has to match the
    /// token's actual algorithm.
    fn peek_claims(token: &str) -> Result<AccessTokenClaims, JwtError> {
        let header = jsonwebtoken::decode_header(token)?;
        let mut validation = Validation::new(header.alg);
        validation.insecure_disable_signature_validation();
        validation.validate_exp = false;
        let dummy_key = DecodingKey::from_secret(&[]);
        let data = jsonwebtoken::decode::<AccessTokenClaims>(token, &dummy_key, &validation)?;
        Ok(data.claims)
    }

    /// The pre-§5.4 verification path, unchanged: HS256 against the
    /// shared secret, requiring `iss` to equal the configured issuer
    /// string exactly.
    fn verify_hs256_token(&self, token: &str) -> Result<AccessTokenClaims, JwtError> {
        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_issuer(&[self.issuer.as_str()]);
        let data =
            jsonwebtoken::decode::<AccessTokenClaims>(token, &self.decoding_key, &validation)?;
        Ok(data.claims)
    }

    /// Looks `peer_id` up in this node's own (synced) `peer_nodes` table
    /// and, if it's a known, non-`Left` member, verifies `token` was
    /// EdDSA-signed by that peer's stored `public_key`. Fails closed
    /// (`JwtError::UnknownIssuer`) for an unwired repo (an ungrouped node
    /// that never called `with_group_identity`), an unknown peer id, a
    /// real lookup error, or a peer whose `status` is `Left` -- never
    /// falls back to HS256, since a token that made it this far already
    /// claimed a peer identity, not this node's own issuer string.
    async fn verify_eddsa_token(
        &self,
        token: &str,
        peer_id: Uuid,
    ) -> Result<AccessTokenClaims, JwtError> {
        if let Some(own) = self
            .own_eddsa
            .read()
            .unwrap()
            .as_ref()
            .filter(|own| own.peer_id == peer_id.to_string())
        {
            let public_key = own.signing_key.verifying_key().to_bytes();
            let decoding_key = DecodingKey::from_ed_der(&public_key);
            let mut validation = Validation::new(Algorithm::EdDSA);
            validation.set_issuer(&[peer_id.to_string().as_str()]);
            let data =
                jsonwebtoken::decode::<AccessTokenClaims>(token, &decoding_key, &validation)?;
            return Ok(data.claims);
        }

        let repo = self
            .peer_node_repo
            .as_ref()
            .ok_or(JwtError::UnknownIssuer)?;
        let peer = repo
            .get(peer_id)
            .await
            .map_err(|err| {
                tracing::warn!(
                    %peer_id,
                    error = %err,
                    "JWT verification: peer lookup failed; denying"
                );
                JwtError::UnknownIssuer
            })?
            .ok_or(JwtError::UnknownIssuer)?;
        if peer.status == PeerNodeStatus::Left {
            return Err(JwtError::UnknownIssuer);
        }

        let public_key_bytes = base64::engine::general_purpose::STANDARD
            .decode(&peer.public_key)
            .map_err(|_| {
                JwtError::InvalidKeyMaterial("stored public key is not valid base64".to_string())
            })?;
        let decoding_key = DecodingKey::from_ed_der(&public_key_bytes);
        let mut validation = Validation::new(Algorithm::EdDSA);
        validation.set_issuer(&[peer_id.to_string().as_str()]);
        let data = jsonwebtoken::decode::<AccessTokenClaims>(token, &decoding_key, &validation)?;
        Ok(data.claims)
    }
}

/// Decodes a base64-encoded 32-byte Ed25519 seed (`NodeIdentity::
/// private_key`, as minted by `streamarr-api::admin_peer::
/// generate_ed25519_seed`) into a signing key. This crate cannot depend on
/// `streamarr-api` (wrong dependency direction) or `streamarr-peer-sync`
/// (which already depends on `streamarr-auth`), so this is a deliberate,
/// small duplicate of `streamarr-peer-sync::signing::PeerIdentity::
/// from_seed_b64` -- same reasoning that module's own doc comment gives
/// for not sharing `canonical_string` with `streamarr-api::peer_extractor`.
fn decode_ed25519_seed(seed_b64: &str) -> Result<SigningKey, JwtError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(seed_b64)
        .map_err(|_| JwtError::InvalidKeyMaterial("not valid base64".to_string()))?;
    let seed: [u8; 32] = bytes
        .try_into()
        .map_err(|_| JwtError::InvalidKeyMaterial("wrong length".to_string()))?;
    Ok(SigningKey::from_bytes(&seed))
}

/// Hand-rolled EdDSA JWT encoding: `jsonwebtoken::encode` requires an
/// `EncodingKey` built from a PKCS8-DER-wrapped private key for EdDSA (see
/// that crate's `crypto::eddsa::sign`, which parses the key via `ring`'s
/// `Ed25519KeyPair::from_pkcs8_maybe_unchecked`), but `node_identity.
/// private_key` is a raw 32-byte seed, not PKCS8 -- the same raw-seed
/// format `ed25519-dalek::SigningKey::from_bytes` and `streamarr-peer-sync
/// ::signing::PeerIdentity` already use it as, and re-wrapping it in PKCS8
/// just to hand it to `jsonwebtoken` would be more code than signing it
/// directly. Verification has no equivalent problem -- `jsonwebtoken`'s
/// EdDSA *decode* path (`ring::signature::UnparsedPublicKey`) accepts the
/// raw 32-byte public key as-is (see `DecodingKey::from_ed_der`'s use in
/// `verify_eddsa_token` above) -- so only issuance needs this.
fn encode_eddsa<T: Serialize>(claims: &T, signing_key: &SigningKey) -> Result<String, JwtError> {
    let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let header = Header::new(Algorithm::EdDSA);
    let header_b64 = b64.encode(serde_json::to_vec(&header)?);
    let claims_b64 = b64.encode(serde_json::to_vec(claims)?);
    let signing_input = format!("{header_b64}.{claims_b64}");
    let signature = signing_key.sign(signing_input.as_bytes());
    let signature_b64 = b64.encode(signature.to_bytes());
    Ok(format!("{signing_input}.{signature_b64}"))
}

#[cfg(test)]
mod tests {
    use chrono::Utc as ChronoUtc;
    use streamarr_model::{PeerAddress, PeerNode, Sensitive};

    use super::*;
    use crate::test_support::FakePeerNodeRepo;

    fn node_identity(peer_id: Uuid, seed: [u8; 32], group_id: Option<Uuid>) -> NodeIdentity {
        NodeIdentity {
            peer_id,
            private_key: Sensitive::new(base64::engine::general_purpose::STANDARD.encode(seed)),
            group_id,
            created_at: ChronoUtc::now(),
        }
    }

    fn public_key_b64(seed: [u8; 32]) -> String {
        let signing_key = SigningKey::from_bytes(&seed);
        base64::engine::general_purpose::STANDARD.encode(signing_key.verifying_key().to_bytes())
    }

    fn peer_node(
        id: Uuid,
        public_key_b64: String,
        is_self: bool,
        status: PeerNodeStatus,
    ) -> PeerNode {
        let now = ChronoUtc::now();
        PeerNode {
            id,
            group_id: Uuid::new_v4(),
            name: "test-peer".to_string(),
            addresses: vec![PeerAddress {
                url: "https://peer.example.com".to_string(),
                priority: 0,
                label: "wan".to_string(),
                client_reachable: true,
            }],
            public_key: public_key_b64,
            is_self,
            status,
            last_seen_at: Some(now),
            last_sync_error: None,
            joined_at: now,
            updated_at: now,
        }
    }

    #[tokio::test]
    async fn issued_token_verifies_and_round_trips_claims() {
        let issuer = JwtIssuer::new(
            b"test-secret-key-at-least-32-bytes!!",
            "streamarr",
            Duration::minutes(15),
        );
        let user_id = Uuid::new_v4();
        let device_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();

        let token = issuer
            .issue_access_token(user_id, device_id, session_id)
            .unwrap();
        let claims = issuer.verify_access_token(&token).await.unwrap();

        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.device_id, device_id);
        assert_eq!(claims.session_id, session_id);
        assert_eq!(claims.iss, "streamarr");
    }

    #[tokio::test]
    async fn token_signed_with_different_secret_is_rejected() {
        let issuer_a = JwtIssuer::new(
            b"secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "streamarr",
            Duration::minutes(15),
        );
        let issuer_b = JwtIssuer::new(
            b"secret-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "streamarr",
            Duration::minutes(15),
        );

        let token = issuer_a
            .issue_access_token(Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4())
            .unwrap();

        assert!(issuer_b.verify_access_token(&token).await.is_err());
    }

    #[tokio::test]
    async fn expired_token_is_rejected() {
        // `jsonwebtoken`'s default `Validation` applies a 60s leeway on
        // `exp`, so the TTL here has to be comfortably past that to
        // actually exercise expiry rejection rather than the leeway window.
        let issuer = JwtIssuer::new(
            b"test-secret-key-at-least-32-bytes!!",
            "streamarr",
            Duration::seconds(-120),
        );
        let token = issuer
            .issue_access_token(Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4())
            .unwrap();
        assert!(issuer.verify_access_token(&token).await.is_err());
    }

    /// Scenario 1 (task): a standalone, ungrouped node -- `with_group_
    /// identity` never called at all -- still issues/verifies plain HS256
    /// with `iss` equal to the configured issuer string. Byte-for-byte
    /// today's behavior.
    #[tokio::test]
    async fn standalone_node_still_uses_hs256_unchanged() {
        let issuer = JwtIssuer::new(
            b"standalone-secret-at-least-32-bytes!!",
            "streamarr",
            Duration::minutes(15),
        );
        let user_id = Uuid::new_v4();

        let token = issuer
            .issue_access_token(user_id, Uuid::new_v4(), Uuid::new_v4())
            .unwrap();
        let claims = issuer.verify_access_token(&token).await.unwrap();

        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.iss, "streamarr");
    }

    /// Scenario 2 (task): a grouped node issues an EdDSA token (`iss` =
    /// its own `peer_id`) and verifies that exact token itself, resolving
    /// its own public key through the same `peer_nodes` lookup path used
    /// for any other peer (its own self row, per §2.1's "including a row
    /// for this node itself").
    #[tokio::test]
    async fn grouped_node_issues_and_self_verifies_eddsa() {
        let peer_id = Uuid::new_v4();
        let seed = [11u8; 32];
        let identity = node_identity(peer_id, seed, Some(Uuid::new_v4()));

        let repo = Arc::new(FakePeerNodeRepo::default());
        repo.insert(peer_node(
            peer_id,
            public_key_b64(seed),
            true,
            PeerNodeStatus::Active,
        ));

        let issuer = JwtIssuer::new(
            b"unused-hs256-secret-at-least-32b!!",
            "streamarr",
            Duration::minutes(15),
        )
        .with_group_identity(&identity, repo);

        let user_id = Uuid::new_v4();
        let token = issuer
            .issue_access_token(user_id, Uuid::new_v4(), Uuid::new_v4())
            .unwrap();
        let claims = issuer.verify_access_token(&token).await.unwrap();

        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.iss, peer_id.to_string());
    }

    #[tokio::test]
    async fn runtime_group_identity_can_be_activated_and_deactivated() {
        let peer_id = Uuid::new_v4();
        let seed = [12u8; 32];
        let identity = node_identity(peer_id, seed, Some(Uuid::new_v4()));
        let repo = Arc::new(FakePeerNodeRepo::default());
        repo.insert(peer_node(
            peer_id,
            public_key_b64(seed),
            true,
            PeerNodeStatus::Active,
        ));
        let issuer = JwtIssuer::new(
            b"runtime-secret-at-least-32-bytes!!",
            "streamarr",
            Duration::minutes(15),
        )
        .with_group_identity(&node_identity(peer_id, seed, None), repo);

        issuer.activate_group_identity(&identity).unwrap();
        let grouped = issuer
            .issue_access_token(Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4())
            .unwrap();
        assert_eq!(
            JwtIssuer::peek_claims(&grouped).unwrap().iss,
            peer_id.to_string()
        );

        issuer.deactivate_group_identity();
        issuer.verify_access_token(&grouped).await.unwrap();
        let standalone = issuer
            .issue_access_token(Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4())
            .unwrap();
        assert_eq!(
            JwtIssuer::peek_claims(&standalone).unwrap().iss,
            "streamarr"
        );
        issuer.verify_access_token(&standalone).await.unwrap();
    }

    /// Scenario 3 (task): a grouped node verifies a token minted by a
    /// *different*, already-known peer, using that peer's `public_key`
    /// from its own `peer_nodes` table -- no shared secret involved at
    /// all.
    #[tokio::test]
    async fn grouped_node_verifies_a_different_known_peers_token() {
        let group_id = Uuid::new_v4();

        // Peer A: issues the token.
        let peer_a_id = Uuid::new_v4();
        let peer_a_seed = [21u8; 32];
        let peer_a_identity = node_identity(peer_a_id, peer_a_seed, Some(group_id));
        let peer_a_repo = Arc::new(FakePeerNodeRepo::default());
        let issuer_a = JwtIssuer::new(
            b"unused-hs256-secret-at-least-32b!!",
            "streamarr",
            Duration::minutes(15),
        )
        .with_group_identity(&peer_a_identity, peer_a_repo);

        let user_id = Uuid::new_v4();
        let token = issuer_a
            .issue_access_token(user_id, Uuid::new_v4(), Uuid::new_v4())
            .unwrap();

        // Peer B: verifies it, via its own synced copy of peer A's row.
        let peer_b_id = Uuid::new_v4();
        let peer_b_seed = [22u8; 32];
        let peer_b_identity = node_identity(peer_b_id, peer_b_seed, Some(group_id));
        let peer_b_repo = Arc::new(FakePeerNodeRepo::default());
        peer_b_repo.insert(peer_node(
            peer_a_id,
            public_key_b64(peer_a_seed),
            false,
            PeerNodeStatus::Active,
        ));
        let issuer_b = JwtIssuer::new(
            b"unused-hs256-secret-at-least-32b!!",
            "streamarr",
            Duration::minutes(15),
        )
        .with_group_identity(&peer_b_identity, peer_b_repo);

        let claims = issuer_b.verify_access_token(&token).await.unwrap();
        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.iss, peer_a_id.to_string());
    }

    /// Scenario 4 (task): an unknown/unverifiable issuer is rejected, not
    /// silently accepted -- the verifying peer's `peer_nodes` table has no
    /// row at all for the id the token claims.
    #[tokio::test]
    async fn unknown_issuer_is_rejected_not_silently_accepted() {
        let issuer_a_id = Uuid::new_v4();
        let issuer_a_seed = [31u8; 32];
        let issuer_a_identity = node_identity(issuer_a_id, issuer_a_seed, Some(Uuid::new_v4()));
        let issuer_a = JwtIssuer::new(
            b"unused-hs256-secret-at-least-32b!!",
            "streamarr",
            Duration::minutes(15),
        )
        .with_group_identity(&issuer_a_identity, Arc::new(FakePeerNodeRepo::default()));
        let token = issuer_a
            .issue_access_token(Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4())
            .unwrap();

        // Verifier's `peer_nodes` table is empty -- it has never heard of
        // `issuer_a_id`.
        let verifier_identity = node_identity(Uuid::new_v4(), [32u8; 32], Some(Uuid::new_v4()));
        let verifier = JwtIssuer::new(
            b"unused-hs256-secret-at-least-32b!!",
            "streamarr",
            Duration::minutes(15),
        )
        .with_group_identity(&verifier_identity, Arc::new(FakePeerNodeRepo::default()));

        let result = verifier.verify_access_token(&token).await;
        assert!(matches!(result, Err(JwtError::UnknownIssuer)));
    }

    /// A peer that *was* known but has since left the group (`§3.3`'s
    /// revocation model) must not still verify -- mirrors `peer_extractor
    /// .rs`'s own `rejects_a_peer_that_has_left` test for the request-
    /// signing side of the same revocation story.
    #[tokio::test]
    async fn a_left_peers_token_is_rejected() {
        let peer_id = Uuid::new_v4();
        let seed = [41u8; 32];
        let identity = node_identity(peer_id, seed, Some(Uuid::new_v4()));
        let issuer_repo = Arc::new(FakePeerNodeRepo::default());
        let issuer = JwtIssuer::new(
            b"unused-hs256-secret-at-least-32b!!",
            "streamarr",
            Duration::minutes(15),
        )
        .with_group_identity(&identity, issuer_repo);
        let token = issuer
            .issue_access_token(Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4())
            .unwrap();

        let verifier_repo = Arc::new(FakePeerNodeRepo::default());
        verifier_repo.insert(peer_node(
            peer_id,
            public_key_b64(seed),
            false,
            PeerNodeStatus::Left,
        ));
        let verifier_identity = node_identity(Uuid::new_v4(), [42u8; 32], Some(Uuid::new_v4()));
        let verifier = JwtIssuer::new(
            b"unused-hs256-secret-at-least-32b!!",
            "streamarr",
            Duration::minutes(15),
        )
        .with_group_identity(&verifier_identity, verifier_repo);

        let result = verifier.verify_access_token(&token).await;
        assert!(matches!(result, Err(JwtError::UnknownIssuer)));
    }

    /// An EdDSA-signed token must not verify against the HS256 secret path
    /// even if the (irrelevant, since `iss` is a peer id) secret happens
    /// to be known -- guards against a precedence bug that tried HS256
    /// first, or fell back to it, for a token that named a peer issuer.
    #[tokio::test]
    async fn eddsa_token_does_not_verify_as_hs256() {
        let peer_id = Uuid::new_v4();
        let seed = [51u8; 32];
        let identity = node_identity(peer_id, seed, Some(Uuid::new_v4()));
        let repo = Arc::new(FakePeerNodeRepo::default());
        repo.insert(peer_node(
            peer_id,
            public_key_b64(seed),
            true,
            PeerNodeStatus::Active,
        ));
        let issuer = JwtIssuer::new(
            b"shared-secret-at-least-32-bytes!!!!",
            "streamarr",
            Duration::minutes(15),
        )
        .with_group_identity(&identity, repo);
        let token = issuer
            .issue_access_token(Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4())
            .unwrap();

        // A plain HS256-only issuer sharing the exact same secret must
        // still reject the token: its `iss` is a peer id, not "streamarr".
        let hs256_only = JwtIssuer::new(
            b"shared-secret-at-least-32-bytes!!!!",
            "streamarr",
            Duration::minutes(15),
        );
        assert!(hs256_only.verify_access_token(&token).await.is_err());
    }
}
