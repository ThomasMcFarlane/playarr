//! Peer-to-peer request authentication -- `docs/architecture/peer-groups.md`
//! §3.3. Every inbound `/api/v1/peer/*` sync endpoint (Phase 2 onward --
//! see `crate::peer`'s own module doc comment for which ones exist today)
//! is gated by [`PeerSignedRequest`] instead of a bearer JWT: the caller
//! signs `method|path|sha256(body)|timestamp|nonce` with its own
//! `node_identity.private_key` (Ed25519), and names itself via the
//! `X-Streamarr-Peer-Id` header. This extractor looks that id up in
//! `AppState::peer_node_repo`, verifies the signature against the stored
//! `public_key`, and rejects with 401 -- before the handler body ever runs
//! -- on any failure: missing/malformed headers, an unknown peer id, a
//! peer whose `status` is `Left` (see §3.3's revocation model: no secret
//! rotation needed group-wide, just flipping this one row), or a signature
//! that doesn't verify.
//!
//! Structurally parallel to `auth_extractor.rs`'s bearer-JWT extractors,
//! but implemented via `FromRequest` (not `FromRequestParts`): the
//! signature covers the request body, so this extractor has to consume and
//! hash it, then hand the already-read [`Bytes`] back to the handler via
//! [`PeerSignedRequest::body`] rather than let a second extractor try to
//! read the body again (Axum request bodies are single-consume).
//!
//! **Replay protection, stated honestly:** the signed string includes a
//! `nonce`, matching the design doc's exact wire format, and a request is
//! rejected if its `X-Streamarr-Timestamp` is outside
//! [`TIMESTAMP_TOLERANCE_SECS`] of this node's own clock. Neither this
//! module nor any Phase 1 migration persists a table of already-seen
//! nonces (`docs/architecture/peer-groups.md`'s §2.1 schema has none), so
//! within that tolerance window a captured, validly-signed request could
//! technically be replayed. Closing that gap needs a real nonce-dedup
//! store, which is out of scope for Phase 1 -- worth calling out plainly
//! rather than silently relying on the unchecked `nonce` field to look
//! like more protection than it currently is. No route is wired to this
//! extractor yet in Phase 1 (see `crate::peer`'s doc comment for why), so
//! nothing today is exposed to this gap in practice.

use axum::body::{to_bytes, Bytes};
use axum::extract::{FromRequest, Request};
use axum::http::{HeaderMap, StatusCode};
use base64::Engine;
use chrono::Utc;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};
use streamarr_model::{PeerNode, PeerNodeStatus};
use uuid::Uuid;

use crate::error::ApiError;
use crate::AppState;

pub const PEER_ID_HEADER: &str = "x-streamarr-peer-id";
pub const SIGNATURE_HEADER: &str = "x-streamarr-signature";
pub const TIMESTAMP_HEADER: &str = "x-streamarr-timestamp";
pub const NONCE_HEADER: &str = "x-streamarr-nonce";

/// Signed timestamps must be within this many seconds of the receiver's
/// own clock -- bounds how long a captured, validly-signed request stays
/// replayable (see the module doc comment's "Replay protection" note).
const TIMESTAMP_TOLERANCE_SECS: i64 = 300;

/// Initial peer convergence can carry a complete availability page containing
/// thousands of media rows. Axum's `Bytes` extractor inherits its 2 MiB
/// default body limit, which is too small for that signed aggregate payload.
/// Keep a finite, peer-specific ceiling so a known peer still cannot force an
/// unbounded allocation while allowing realistic first-sync requests.
const MAX_SIGNED_PEER_BODY_BYTES: usize = 64 * 1024 * 1024;

fn unauthorized(message: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::UNAUTHORIZED, "unauthorized", message)
}

fn required_header<'a>(headers: &'a HeaderMap, name: &str) -> Result<&'a str, ApiError> {
    headers
        .get(name)
        .ok_or_else(|| unauthorized(format!("missing {name} header")))?
        .to_str()
        .map_err(|_| unauthorized(format!("{name} header is not valid UTF-8")))
}

/// The exact string signed by the caller -- `method|path|sha256(body)|
/// timestamp|nonce`, per §3.3. `body_hash` is the lowercase hex SHA-256
/// digest of the raw request body (`""` hashes the same as any other empty
/// input, matching a bodyless `GET`).
fn canonical_string(
    method: &str,
    path: &str,
    body_hash: &str,
    timestamp: &str,
    nonce: &str,
) -> String {
    format!("{method}|{path}|{body_hash}|{timestamp}|{nonce}")
}

/// A request whose `X-Streamarr-Peer-Id`/`X-Streamarr-Signature`/
/// `X-Streamarr-Timestamp`/`X-Streamarr-Nonce` headers verified
/// successfully against a known, non-`Left` [`PeerNode`]'s `public_key`.
/// `body` is the already-consumed raw request body -- a handler that needs
/// a typed body parses `body` itself (e.g. via `serde_json::from_slice`)
/// rather than taking a second `Json<T>` extractor, which would try to
/// read an already-drained body and fail.
#[derive(Debug, Clone)]
pub struct PeerSignedRequest {
    pub peer: PeerNode,
    pub body: Bytes,
}

impl FromRequest<AppState> for PeerSignedRequest {
    type Rejection = ApiError;

    async fn from_request(req: Request, state: &AppState) -> Result<Self, Self::Rejection> {
        let method = req.method().to_string();
        // `path_and_query()`, not bare `path()`: `streamarr_peer_sync::
        // peer_client::PeerClient::signed_request` signs over exactly the
        // `path` string its caller passed it, and every `?since=`-cursored
        // sync module (`account_sync`/`availability_sync`) passes a path
        // that already carries the `?since=<cursor>` query string once a
        // cursor exists (e.g. `format!("/api/v1/peer/accounts?since=
        // {cursor}")`). Verifying against the query-stripped `path()` alone
        // would make every such request fail signature verification the
        // moment a peer's cursor becomes non-empty -- i.e. every sync pass
        // after the first successful one. Falls back to `path()` alone in
        // the (never-actually-reachable, `Uri` always has at least a path)
        // case `path_and_query()` returns `None`.
        let path = req
            .uri()
            .path_and_query()
            .map(|pq| pq.as_str().to_string())
            .unwrap_or_else(|| req.uri().path().to_string());

        let peer_id_raw = required_header(req.headers(), PEER_ID_HEADER)?.to_string();
        let signature_b64 = required_header(req.headers(), SIGNATURE_HEADER)?.to_string();
        let timestamp_raw = required_header(req.headers(), TIMESTAMP_HEADER)?.to_string();
        let nonce = required_header(req.headers(), NONCE_HEADER)?.to_string();

        let peer_id = Uuid::parse_str(&peer_id_raw)
            .map_err(|_| unauthorized("X-Streamarr-Peer-Id header is not a valid UUID"))?;
        let timestamp: i64 = timestamp_raw.parse().map_err(|_| {
            unauthorized("X-Streamarr-Timestamp header is not a valid unix timestamp")
        })?;
        if (Utc::now().timestamp() - timestamp).abs() > TIMESTAMP_TOLERANCE_SECS {
            return Err(unauthorized(
                "X-Streamarr-Timestamp is outside the accepted window",
            ));
        }

        // Fails closed the same way `auth_extractor::resolve_policy` does:
        // an unknown peer id, a real lookup error, and an explicit `Left`
        // status all reject with the same 401 rather than leaking which
        // case applied.
        let peer = state
            .peer_node_repo
            .get(peer_id)
            .await
            .map_err(|err| {
                tracing::warn!(
                    %peer_id,
                    error = %err,
                    "peer signature check: peer lookup failed; denying"
                );
                unauthorized("unknown peer")
            })?
            .ok_or_else(|| unauthorized("unknown peer"))?;
        if peer.status == PeerNodeStatus::Left {
            return Err(unauthorized("peer has left the group"));
        }

        let public_key_bytes = base64::engine::general_purpose::STANDARD
            .decode(&peer.public_key)
            .map_err(|_| unauthorized("stored public key is not valid base64"))?;
        let public_key_bytes: [u8; 32] = public_key_bytes
            .try_into()
            .map_err(|_| unauthorized("stored public key has the wrong length"))?;
        let verifying_key = VerifyingKey::from_bytes(&public_key_bytes)
            .map_err(|_| unauthorized("stored public key is invalid"))?;

        let signature_bytes = base64::engine::general_purpose::STANDARD
            .decode(&signature_b64)
            .map_err(|_| unauthorized("X-Streamarr-Signature is not valid base64"))?;
        let signature_bytes: [u8; 64] = signature_bytes
            .try_into()
            .map_err(|_| unauthorized("X-Streamarr-Signature has the wrong length"))?;
        let signature = Signature::from_bytes(&signature_bytes);

        // The body has to be consumed to hash it -- do this last, so every
        // header-shaped failure above rejects without touching the body at
        // all.
        let body = to_bytes(req.into_body(), MAX_SIGNED_PEER_BODY_BYTES)
            .await
            .map_err(|_| unauthorized("failed to read request body"))?;
        let body_hash = hex::encode(Sha256::digest(&body));
        let signed = canonical_string(&method, &path, &body_hash, &timestamp_raw, &nonce);

        verifying_key
            .verify(signed.as_bytes(), &signature)
            .map_err(|_| unauthorized("signature verification failed"))?;

        Ok(PeerSignedRequest { peer, body })
    }
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::Request as HttpRequest;
    use base64::Engine;
    use chrono::Utc;
    use ed25519_dalek::{Signer, SigningKey};
    use streamarr_model::{PeerAddress, PeerNode, PeerNodeStatus};
    use tower::ServiceExt;
    use uuid::Uuid;

    use super::*;
    use crate::test_support::test_state;

    fn signing_key() -> SigningKey {
        SigningKey::from_bytes(&[7u8; 32])
    }

    async fn seed_peer(state: &crate::test_support::TestState, peer_id: Uuid, key: &SigningKey) {
        // `peer_nodes.group_id` is a real `REFERENCES peer_groups (id)`
        // foreign key -- needs a real parent row first, same as
        // `streamarr_db::repo::peer_node`'s own tests.
        let group = streamarr_model::PeerGroup {
            id: Uuid::new_v4(),
            name: "test group".to_string(),
            created_at: Utc::now(),
        };
        state.app.peer_group_repo.create(&group).await.unwrap();

        let now = Utc::now();
        let node = PeerNode {
            id: peer_id,
            group_id: group.id,
            name: "east".to_string(),
            addresses: vec![PeerAddress {
                url: "https://east.example.com".to_string(),
                priority: 0,
                label: "wan".to_string(),
                client_reachable: true,
            }],
            public_key: base64::engine::general_purpose::STANDARD
                .encode(key.verifying_key().to_bytes()),
            is_self: false,
            status: PeerNodeStatus::Active,
            last_seen_at: Some(now),
            last_sync_error: None,
            joined_at: now,
            updated_at: now,
        };
        state.app.peer_node_repo.upsert(&node).await.unwrap();
    }

    fn signed_request(
        method: &str,
        path: &str,
        body: &[u8],
        peer_id: Uuid,
        key: &SigningKey,
        timestamp: i64,
    ) -> HttpRequest<Body> {
        let body_hash = hex::encode(Sha256::digest(body));
        let nonce = "test-nonce";
        let signed = canonical_string(method, path, &body_hash, &timestamp.to_string(), nonce);
        let signature = key.sign(signed.as_bytes());

        HttpRequest::builder()
            .method(method)
            .uri(path)
            .header(PEER_ID_HEADER, peer_id.to_string())
            .header(
                SIGNATURE_HEADER,
                base64::engine::general_purpose::STANDARD.encode(signature.to_bytes()),
            )
            .header(TIMESTAMP_HEADER, timestamp.to_string())
            .header(NONCE_HEADER, nonce)
            .body(Body::from(body.to_vec()))
            .unwrap()
    }

    /// Minimal router exercising the real extractor end-to-end, mirroring
    /// how `auth_extractor.rs`'s own tests would if it needed a live
    /// `AppState` (most of that module tests pure functions instead --
    /// this one can't, since verification depends on `AppState::
    /// peer_node_repo`).
    fn test_router(state: AppState) -> axum::Router {
        async fn handler(_req: PeerSignedRequest) -> StatusCode {
            StatusCode::OK
        }
        axum::Router::new()
            .route("/probe", axum::routing::post(handler))
            .with_state(state)
    }

    #[tokio::test]
    async fn accepts_a_correctly_signed_request() {
        let (_router, state) = test_state().await;
        let peer_id = Uuid::new_v4();
        let key = signing_key();
        seed_peer(&state, peer_id, &key).await;

        let app = test_router(state.app.clone());
        let response = app
            .oneshot(signed_request(
                "POST",
                "/probe",
                b"{}",
                peer_id,
                &key,
                Utc::now().timestamp(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn accepts_a_signed_body_larger_than_axums_default_limit() {
        let (_router, state) = test_state().await;
        let peer_id = Uuid::new_v4();
        let key = signing_key();
        seed_peer(&state, peer_id, &key).await;
        let body = vec![b'x'; 2 * 1024 * 1024 + 1];

        let app = test_router(state.app.clone());
        let response = app
            .oneshot(signed_request(
                "POST",
                "/probe",
                &body,
                peer_id,
                &key,
                Utc::now().timestamp(),
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    /// Regression test: `streamarr_peer_sync::peer_client::PeerClient`
    /// signs over the exact `path` string its caller passes it, and every
    /// `?since=`-cursored sync module includes the query string in that
    /// `path` once a cursor exists -- verification must cover the same
    /// request-target (path *and* query), not `Uri::path()` alone, or every
    /// such request would 401 the moment a peer's cursor becomes non-empty.
    #[tokio::test]
    async fn accepts_a_correctly_signed_request_whose_path_carries_a_query_string() {
        let (_router, state) = test_state().await;
        let peer_id = Uuid::new_v4();
        let key = signing_key();
        seed_peer(&state, peer_id, &key).await;

        let app = test_router(state.app.clone());
        let response = app
            .oneshot(signed_request(
                "POST",
                "/probe?since=1700000000000",
                b"{}",
                peer_id,
                &key,
                Utc::now().timestamp(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn rejects_an_unknown_peer_id() {
        let (_router, state) = test_state().await;
        let key = signing_key();

        let app = test_router(state.app.clone());
        let response = app
            .oneshot(signed_request(
                "POST",
                "/probe",
                b"{}",
                Uuid::new_v4(),
                &key,
                Utc::now().timestamp(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn rejects_a_peer_that_has_left() {
        let (_router, state) = test_state().await;
        let peer_id = Uuid::new_v4();
        let key = signing_key();
        seed_peer(&state, peer_id, &key).await;
        let mut node = state
            .app
            .peer_node_repo
            .get(peer_id)
            .await
            .unwrap()
            .unwrap();
        node.status = PeerNodeStatus::Left;
        state.app.peer_node_repo.upsert(&node).await.unwrap();

        let app = test_router(state.app.clone());
        let response = app
            .oneshot(signed_request(
                "POST",
                "/probe",
                b"{}",
                peer_id,
                &key,
                Utc::now().timestamp(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn rejects_a_tampered_body() {
        let (_router, state) = test_state().await;
        let peer_id = Uuid::new_v4();
        let key = signing_key();
        seed_peer(&state, peer_id, &key).await;

        let mut request = signed_request(
            "POST",
            "/probe",
            b"{}",
            peer_id,
            &key,
            Utc::now().timestamp(),
        );
        *request.body_mut() = Body::from(&b"{\"tampered\":true}"[..]);

        let app = test_router(state.app.clone());
        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn rejects_a_stale_timestamp() {
        let (_router, state) = test_state().await;
        let peer_id = Uuid::new_v4();
        let key = signing_key();
        seed_peer(&state, peer_id, &key).await;

        let app = test_router(state.app.clone());
        let response = app
            .oneshot(signed_request(
                "POST",
                "/probe",
                b"{}",
                peer_id,
                &key,
                Utc::now().timestamp() - 3600,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn rejects_a_wrong_signature() {
        let (_router, state) = test_state().await;
        let peer_id = Uuid::new_v4();
        let key = signing_key();
        seed_peer(&state, peer_id, &key).await;
        let wrong_key = SigningKey::from_bytes(&[9u8; 32]);

        let app = test_router(state.app.clone());
        let response = app
            .oneshot(signed_request(
                "POST",
                "/probe",
                b"{}",
                peer_id,
                &wrong_key,
                Utc::now().timestamp(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn rejects_missing_headers() {
        let (_router, state) = test_state().await;
        let app = test_router(state.app.clone());
        let response = app
            .oneshot(
                HttpRequest::builder()
                    .method("POST")
                    .uri("/probe")
                    .body(Body::from(&b"{}"[..]))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}
