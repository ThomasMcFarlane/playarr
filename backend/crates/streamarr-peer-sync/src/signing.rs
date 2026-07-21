//! Ed25519 sign/verify helpers -- pure, no I/O. Node-to-node authentication,
//! `docs/architecture/peer-groups.md` §3.3.
//!
//! Every request to another peer's `/api/v1/peer/*` endpoints is signed
//! over `method|path|sha256(body)|timestamp|nonce`: this module's
//! [`canonical_string`] must produce byte-for-byte the same string
//! `streamarr-api/src/peer_extractor.rs::canonical_string` builds on the
//! receiving side, or every signed request this crate sends would fail
//! verification there. Both sides were written against the same design-doc
//! wire format; the two `canonical_string` implementations are not shared
//! code (this crate must not depend on `streamarr-api`, see this crate's
//! own module doc comment in `lib.rs`), so this module's own tests assert
//! the exact format independently rather than relying on a shared helper to
//! keep them in sync.

use base64::Engine;
use chrono::Utc;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum SigningError {
    #[error("stored Ed25519 key material is not valid base64: {0}")]
    InvalidBase64(#[from] base64::DecodeError),
    #[error("stored Ed25519 key material has the wrong length")]
    InvalidLength,
    #[error("stored Ed25519 public key is invalid")]
    InvalidPublicKey,
    #[error("signature is not valid base64: {0}")]
    InvalidSignatureBase64(base64::DecodeError),
    #[error("signature has the wrong length")]
    InvalidSignatureLength,
    #[error("signature verification failed")]
    VerificationFailed,
}

/// This node's own signing identity: its durable `peer_id` plus the
/// Ed25519 keypair derived from `node_identity.private_key`. Constructed
/// once (from the already-loaded `NodeIdentity`) and reused across every
/// outbound signed request `peer_client.rs` makes.
#[derive(Clone)]
pub struct PeerIdentity {
    pub peer_id: Uuid,
    signing_key: SigningKey,
}

impl PeerIdentity {
    /// Decodes a base64-encoded 32-byte Ed25519 seed (`NodeIdentity::
    /// private_key`, as minted by `streamarr-api::admin_peer::
    /// generate_ed25519_seed`) into a signing identity.
    pub fn from_seed_b64(peer_id: Uuid, seed_b64: &str) -> Result<Self, SigningError> {
        let bytes = base64::engine::general_purpose::STANDARD.decode(seed_b64)?;
        let seed: [u8; 32] = bytes.try_into().map_err(|_| SigningError::InvalidLength)?;
        Ok(Self {
            peer_id,
            signing_key: SigningKey::from_bytes(&seed),
        })
    }

    /// This identity's Ed25519 public key, base64-encoded -- the exact
    /// value a `peer_nodes.public_key` column stores for this peer.
    pub fn public_key_b64(&self) -> String {
        base64::engine::general_purpose::STANDARD
            .encode(self.signing_key.verifying_key().to_bytes())
    }

    /// Signs `method|path|sha256(body)|timestamp|nonce` and returns the
    /// four header values a caller attaches to the outbound request:
    /// `(signature_b64, timestamp, nonce)`. `timestamp`/`nonce` are
    /// generated here (not passed in) so every call site produces a fresh,
    /// unique signature rather than accidentally reusing one.
    pub fn sign_request(&self, method: &str, path: &str, body: &[u8]) -> SignedRequestHeaders {
        let timestamp = Utc::now().timestamp();
        let nonce = Uuid::new_v4().simple().to_string();
        let signed = canonical_string(method, path, body, timestamp, &nonce);
        let signature = self.signing_key.sign(signed.as_bytes());
        SignedRequestHeaders {
            peer_id: self.peer_id,
            signature_b64: base64::engine::general_purpose::STANDARD.encode(signature.to_bytes()),
            timestamp,
            nonce,
        }
    }
}

/// The four values that become `X-Streamarr-Peer-Id`/`-Signature`/
/// `-Timestamp`/`-Nonce` on an outbound request -- see `peer_client.rs`.
#[derive(Debug, Clone)]
pub struct SignedRequestHeaders {
    pub peer_id: Uuid,
    pub signature_b64: String,
    pub timestamp: i64,
    pub nonce: String,
}

/// The exact string a caller signs -- `method|path|sha256(body)|timestamp|
/// nonce`, per §3.3. Must match `streamarr-api/src/peer_extractor.rs::
/// canonical_string` byte-for-byte; see this module's own doc comment.
pub fn canonical_string(
    method: &str,
    path: &str,
    body: &[u8],
    timestamp: i64,
    nonce: &str,
) -> String {
    let body_hash = hex::encode(Sha256::digest(body));
    format!("{method}|{path}|{body_hash}|{timestamp}|{nonce}")
}

/// Decodes a base64-encoded 32-byte Ed25519 public key (a `peer_nodes.
/// public_key` value) and verifies `signature_b64` was produced by the
/// matching private key over `method|path|sha256(body)|timestamp|nonce`.
/// The counterpart to [`PeerIdentity::sign_request`], used by tests in this
/// module to exercise a full sign/verify round trip; production
/// verification of an *inbound* request happens in `streamarr-api::
/// peer_extractor`, not here (this crate is the signing/calling side only).
pub fn verify(
    public_key_b64: &str,
    method: &str,
    path: &str,
    body: &[u8],
    timestamp: i64,
    nonce: &str,
    signature_b64: &str,
) -> Result<(), SigningError> {
    let public_key_bytes = base64::engine::general_purpose::STANDARD.decode(public_key_b64)?;
    let public_key_bytes: [u8; 32] = public_key_bytes
        .try_into()
        .map_err(|_| SigningError::InvalidLength)?;
    let verifying_key =
        VerifyingKey::from_bytes(&public_key_bytes).map_err(|_| SigningError::InvalidPublicKey)?;

    let signature_bytes = base64::engine::general_purpose::STANDARD
        .decode(signature_b64)
        .map_err(SigningError::InvalidSignatureBase64)?;
    let signature_bytes: [u8; 64] = signature_bytes
        .try_into()
        .map_err(|_| SigningError::InvalidSignatureLength)?;
    let signature = Signature::from_bytes(&signature_bytes);

    let signed = canonical_string(method, path, body, timestamp, nonce);
    verifying_key
        .verify(signed.as_bytes(), &signature)
        .map_err(|_| SigningError::VerificationFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> PeerIdentity {
        let seed = [7u8; 32];
        let seed_b64 = base64::engine::general_purpose::STANDARD.encode(seed);
        PeerIdentity::from_seed_b64(Uuid::new_v4(), &seed_b64).unwrap()
    }

    #[test]
    fn canonical_string_matches_the_exact_wire_format() {
        // Byte-for-byte the same format `streamarr-api::peer_extractor`
        // verifies against -- pinned here as a regression guard, since the
        // two implementations are deliberately not shared code (see this
        // module's own doc comment).
        let body_hash = hex::encode(Sha256::digest(b"{}"));
        let signed = canonical_string("POST", "/api/v1/peer/nodes", b"{}", 1_700_000_000, "abc123");
        assert_eq!(
            signed,
            format!("POST|/api/v1/peer/nodes|{body_hash}|1700000000|abc123")
        );
    }

    #[test]
    fn sign_then_verify_round_trips() {
        let identity = identity();
        let headers = identity.sign_request("GET", "/api/v1/peer/nodes", b"");

        verify(
            &identity.public_key_b64(),
            "GET",
            "/api/v1/peer/nodes",
            b"",
            headers.timestamp,
            &headers.nonce,
            &headers.signature_b64,
        )
        .expect("a correctly signed request must verify");
        assert_eq!(headers.peer_id, identity.peer_id);
    }

    #[test]
    fn verify_rejects_a_tampered_body() {
        let identity = identity();
        let headers = identity.sign_request("POST", "/api/v1/peer/accounts", b"{}");

        let result = verify(
            &identity.public_key_b64(),
            "POST",
            "/api/v1/peer/accounts",
            b"{\"tampered\":true}",
            headers.timestamp,
            &headers.nonce,
            &headers.signature_b64,
        );
        assert!(matches!(result, Err(SigningError::VerificationFailed)));
    }

    #[test]
    fn verify_rejects_a_tampered_path() {
        let identity = identity();
        let headers = identity.sign_request("GET", "/api/v1/peer/nodes", b"");

        let result = verify(
            &identity.public_key_b64(),
            "GET",
            "/api/v1/peer/accounts",
            b"",
            headers.timestamp,
            &headers.nonce,
            &headers.signature_b64,
        );
        assert!(matches!(result, Err(SigningError::VerificationFailed)));
    }

    #[test]
    fn verify_rejects_the_wrong_public_key() {
        let this_identity = identity();
        // A genuinely different seed -- `identity()` always returns the
        // same fixed `[7u8; 32]` keypair, so two calls to it would produce
        // the *same* public key and this test would pass for the wrong
        // reason (verification trivially succeeding, not failing).
        let other_seed_b64 = base64::engine::general_purpose::STANDARD.encode([8u8; 32]);
        let other = PeerIdentity::from_seed_b64(Uuid::new_v4(), &other_seed_b64).unwrap();
        let headers = this_identity.sign_request("GET", "/api/v1/peer/nodes", b"");

        let result = verify(
            &other.public_key_b64(),
            "GET",
            "/api/v1/peer/nodes",
            b"",
            headers.timestamp,
            &headers.nonce,
            &headers.signature_b64,
        );
        assert!(matches!(result, Err(SigningError::VerificationFailed)));
    }

    #[test]
    fn each_signed_request_gets_a_fresh_nonce_and_timestamp() {
        let identity = identity();
        let first = identity.sign_request("GET", "/api/v1/peer/nodes", b"");
        let second = identity.sign_request("GET", "/api/v1/peer/nodes", b"");
        assert_ne!(first.nonce, second.nonce);
        assert_ne!(first.signature_b64, second.signature_b64);
    }

    #[test]
    fn public_key_round_trips_through_from_seed_b64() {
        let identity = identity();
        // Same seed, reconstructed independently, must yield the same
        // public key -- a sanity check that `from_seed_b64` is
        // deterministic, which every peer relies on (the joining node
        // derives its public key from the same stored seed every boot).
        let seed_b64 = base64::engine::general_purpose::STANDARD.encode([7u8; 32]);
        let reconstructed = PeerIdentity::from_seed_b64(identity.peer_id, &seed_b64).unwrap();
        assert_eq!(identity.public_key_b64(), reconstructed.public_key_b64());
    }

    #[test]
    fn from_seed_b64_rejects_wrong_length_seed() {
        let short_seed_b64 = base64::engine::general_purpose::STANDARD.encode([1u8; 16]);
        let result = PeerIdentity::from_seed_b64(Uuid::new_v4(), &short_seed_b64);
        assert!(matches!(result, Err(SigningError::InvalidLength)));
    }
}
