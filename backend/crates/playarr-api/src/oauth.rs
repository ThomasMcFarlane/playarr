//! RFC 8628 (OAuth 2.0 Device Authorization Grant) endpoints:
//! `POST /api/v1/oauth/device/code` and `POST /api/v1/oauth/token` -- thin
//! Axum handlers over [`playarr_auth::DeviceFlowHandler`].

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::Engine;
use playarr_auth::device_flow::{DeviceCodeResponse, TokenError, TokenResponse};
use playarr_model::ClientPlatform;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::admin_peer::{peer_address_bundle, PeerAddressEntry};
use crate::auth_extractor::AnytimeStreamingUser;
use crate::AppState;

pub const DEVICE_CODE_GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";

#[derive(Debug, Deserialize, ToSchema)]
pub struct DeviceCodeRequest {
    pub client_platform: ClientPlatform,
}

/// Doc-only mirror of [`DeviceCodeResponse`] (that type has no `ToSchema`;
/// handlers still return it directly, serialized for real).
#[derive(Serialize, ToSchema)]
#[allow(dead_code)]
pub struct DeviceCodeResponseSchema {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: i64,
    pub interval: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct DeviceTokenRequest {
    /// Must be [`DEVICE_CODE_GRANT_TYPE`] -- any other value is rejected
    /// with `unsupported_grant_type` before the device code is even looked
    /// up, per RFC 6749 §5.2.
    pub grant_type: String,
    pub device_code: String,
}

/// The short code displayed by a TV and entered (or supplied by a QR-code
/// link) on an already-authenticated browser or mobile device.
#[derive(Debug, Deserialize, ToSchema)]
pub struct DeviceAuthorizationRequest {
    pub user_code: String,
}

/// Doc-only mirror of [`TokenResponse`]; see [`DeviceCodeResponseSchema`].
#[derive(Serialize, ToSchema)]
#[allow(dead_code)]
pub struct TokenResponseSchema {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: i64,
    pub refresh_token: String,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct OAuthErrorBody {
    /// One of RFC 8628 §3.5's four device-flow error codes, or RFC 6749
    /// §5.2's `unsupported_grant_type`.
    pub error: String,
}

fn token_error_response(err: TokenError) -> Response {
    let code = match err {
        TokenError::AuthorizationPending => "authorization_pending",
        TokenError::SlowDown => "slow_down",
        TokenError::ExpiredToken => "expired_token",
        TokenError::AccessDenied => "access_denied",
    };
    (
        StatusCode::BAD_REQUEST,
        Json(OAuthErrorBody {
            error: code.to_string(),
        }),
    )
        .into_response()
}

#[utoipa::path(
    post,
    path = "/api/v1/oauth/device/code",
    tag = "oauth",
    request_body(content = DeviceCodeRequest, example = json!({
        "client_platform": "tv-webos"
    })),
    responses(
        (status = 200, description = "Device/user code pair issued", body = DeviceCodeResponseSchema, example = json!({
            "device_code": "3c8f1e2a-9b7d-4e21-8a6f-5d0c1b2e4f3a",
            "user_code": "ABCD-2345",
            "verification_uri": "https://playarr.example/link",
            "verification_uri_complete": "https://playarr.example/link?user_code=ABCD-2345",
            "expires_in": 300,
            "interval": 5
        }))
    )
)]
pub async fn device_code_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<DeviceCodeRequest>,
) -> Result<Json<DeviceCodeResponse>, crate::error::ApiError> {
    let mut response = state
        .device_flow
        .start_device_authorization(body.client_platform)
        .await?;
    if response.verification_uri.starts_with('/') {
        let verification_uri = request_verification_uri(&headers, &response.verification_uri);
        // `verification_uri` (the short form, meant for on-screen display
        // or manual typing) stays a plain URL, unchanged -- only the
        // QR-encoded `_complete` form below carries the address bundle.
        // `docs/architecture/peer-groups.md` §6.3, mirroring §6.1's
        // `server=`-vs-`servers=` split exactly.
        let bundle = peer_address_bundle(&state).await?;
        response.verification_uri_complete = format!(
            "{verification_uri}?user_code={}&servers={}",
            response.user_code,
            encode_servers_param(&bundle.addresses)
        );
        response.verification_uri = verification_uri;
    }
    Ok(Json(response))
}

pub(crate) fn request_verification_uri(headers: &HeaderMap, path: &str) -> String {
    let forwarded_value = |name: &str| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(',').next())
            .map(str::trim)
            .filter(|value| !value.is_empty())
    };
    let scheme = forwarded_value("x-forwarded-proto")
        .filter(|value| matches!(*value, "http" | "https"))
        .unwrap_or("http");
    let host = forwarded_value("x-forwarded-host")
        .or_else(|| forwarded_value("host"))
        .unwrap_or("localhost");
    format!("{scheme}://{host}{path}")
}

/// Encodes a [`crate::admin_peer::PeerAddressBundle`]'s `addresses` for the
/// `servers=` query param embedded in `verification_uri_complete` --
/// `docs/architecture/peer-groups.md` §6.3, reusing the identical
/// `servers=` convention §6.1's invite links already use (`signupInvite.ts`'s
/// own doc comment: `base64url(JSON string[])`) -- now carrying
/// `{peer_node_id, url}` objects instead of bare strings, so a client can
/// tell which node each address belongs to (see [`PeerAddressEntry`]'s own
/// doc comment for why that attribution matters). Exact wire format: the
/// entry list is JSON-array-encoded, then base64url-encoded with
/// `URL_SAFE_NO_PAD` -- unpadded, so the value never contains a `=` that
/// would need percent-encoding inside a query string, the same convention
/// `playarr_auth::jwt::encode_eddsa` already uses for the identical
/// reason. The client-side decoder (this same phase's `device-auth`
/// client changes, and §6.1's `signupInvite.ts`) must decode with the
/// exact inverse: base64url-decode (`URL_SAFE_NO_PAD`), then `JSON.parse`
/// the resulting UTF-8 bytes as an array of `{peer_node_id, url}` objects.
/// For a standalone node `bundle.addresses` is a one-element (or, before
/// any address has ever been configured, empty) list -- still encoded the
/// same way: one code path, never a grouped/ungrouped branch here either
/// (§6.1's own invariant). A client that doesn't yet understand `servers=`
/// simply ignores the extra query param and keeps working off
/// `verification_uri_complete` exactly as before -- zero behavior change
/// for it.
fn encode_servers_param(addresses: &[PeerAddressEntry]) -> String {
    let json =
        serde_json::to_string(addresses).expect("Vec<PeerAddressEntry> always serializes to JSON");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(json)
}

/// Completes the human side of the device flow. The streaming-policy
/// extractor is deliberate: approving a TV signs that TV in as this user,
/// so an account that cannot use Playarr must not be able to mint a Playarr
/// session through pairing either.
#[utoipa::path(
    post,
    path = "/api/v1/oauth/device/authorize",
    tag = "oauth",
    request_body(content = DeviceAuthorizationRequest, example = json!({
        "user_code": "ABCD-2345"
    })),
    responses(
        (status = 204, description = "Device approved"),
        (status = 401, description = "Missing or invalid bearer token", body = crate::ErrorBody),
        (status = 403, description = "Account is not permitted to use Playarr", body = crate::ErrorBody),
        (status = 404, description = "Unknown or expired user code", body = crate::ErrorBody)
    )
)]
pub async fn authorize_device_handler(
    State(state): State<AppState>,
    user: AnytimeStreamingUser,
    Json(body): Json<DeviceAuthorizationRequest>,
) -> Result<StatusCode, crate::error::ApiError> {
    let user_code = normalise_user_code(&body.user_code);
    state
        .device_flow
        .approve_user_code(&user_code, user.user_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

fn normalise_user_code(value: &str) -> String {
    let compact: String = value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .map(|character| character.to_ascii_uppercase())
        .collect();
    match compact.len() {
        8 => format!("{}-{}", &compact[..4], &compact[4..]),
        _ => compact,
    }
}

#[utoipa::path(
    post,
    path = "/api/v1/oauth/token",
    tag = "oauth",
    request_body(content = DeviceTokenRequest, example = json!({
        "grant_type": DEVICE_CODE_GRANT_TYPE,
        "device_code": "3c8f1e2a-9b7d-4e21-8a6f-5d0c1b2e4f3a"
    })),
    responses(
        (status = 200, description = "Access/refresh token pair", body = TokenResponseSchema, example = json!({
            "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5ZjYyYzY3OS0wNGVhLTRhOTQtYjM5NS0yYjNjZWU4YjIzYzMifQ.signature",
            "token_type": "Bearer",
            "expires_in": 3600,
            "refresh_token": "8f0a5c1e-2b6d-4f3a-9e7c-1d4b5a6c7e8f"
        })),
        (status = 400, description = "authorization_pending | slow_down | expired_token | access_denied | unsupported_grant_type", body = OAuthErrorBody)
    )
)]
pub async fn device_token_handler(
    State(state): State<AppState>,
    Json(body): Json<DeviceTokenRequest>,
) -> Response {
    if body.grant_type != DEVICE_CODE_GRANT_TYPE {
        return (
            StatusCode::BAD_REQUEST,
            Json(OAuthErrorBody {
                error: "unsupported_grant_type".to_string(),
            }),
        )
            .into_response();
    }

    match state.device_flow.poll_token(&body.device_code).await {
        Ok(response) => (StatusCode::OK, Json::<TokenResponse>(response)).into_response(),
        Err(err) => token_error_response(err),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::body::Body;
    use axum::http::Request;
    use axum::Router;
    use playarr_auth::device_flow::{
        DashMapDeviceFlowHandler, DeviceFlowConfig, InMemoryDeviceAuthorizationStore,
    };
    use tower::ServiceExt;

    use super::*;
    use crate::test_support::{bearer_header, mint_access_token, seed_streaming_user, test_state};
    use crate::version_gate::{ClientCompatibilityTable, VersionGateLayer};

    /// Same minimal table `test_support::test_state`'s router is built
    /// with -- duplicated here (rather than made `pub(crate)` there),
    /// matching `login.rs`'s own identical duplication for the identical
    /// reason: this is the only test module that needs a *second*,
    /// differently-configured router built from a mutated clone of
    /// `TestState::app`.
    fn test_version_gate() -> VersionGateLayer {
        VersionGateLayer::new(
            ClientCompatibilityTable::from_toml_str(
                r#"
[server]
version = "0.1.0"
apiVersion = "1"
"#,
            )
            .unwrap(),
        )
    }

    /// Rebuilds a router from `state.app`, swapping in a
    /// [`DashMapDeviceFlowHandler`] whose `verification_base_uri` is
    /// relative (`"/link"`) -- `test_support::test_state`'s default config
    /// uses an already-absolute URL (`"https://playarr.test/link"`),
    /// which never exercises `device_code_handler`'s `starts_with('/')`
    /// branch (the one that builds `verification_uri`/
    /// `verification_uri_complete` off the request's forwarded-Host
    /// headers, and -- as of this phase -- appends `servers=`). A real
    /// deployment defaults to exactly this relative form
    /// (`backend/src/main.rs`'s `PLAYARR_DEVICE_VERIFICATION_URI`
    /// fallback), so this mirrors production, not a test-only shortcut.
    fn router_with_relative_verification_uri(app: AppState) -> Router {
        let mut app = app;
        app.device_flow = Arc::new(DashMapDeviceFlowHandler::new(
            Arc::new(InMemoryDeviceAuthorizationStore::new()),
            app.sessions.clone(),
            DeviceFlowConfig {
                code_ttl: chrono::Duration::minutes(10),
                polling_interval: chrono::Duration::zero(),
                verification_base_uri: "/link".to_string(),
                refresh_ttl: chrono::Duration::days(30),
            },
        ));
        let (router, _api) = crate::build_router(app, test_version_gate(), None);
        router
    }

    #[tokio::test]
    async fn full_device_flow_start_approve_poll() {
        let (router, state) = test_state().await;
        let user_id = uuid::Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let start_body = serde_json::json!({ "client_platform": "tv-webos" });
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/oauth/device/code")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&start_body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let code: DeviceCodeResponse = serde_json::from_slice(&bytes).unwrap();

        // Not yet approved: polling reports authorization_pending.
        let poll_body = serde_json::json!({
            "grant_type": DEVICE_CODE_GRANT_TYPE,
            "device_code": code.device_code,
        });
        let pending_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/oauth/token")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&poll_body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(pending_response.status(), StatusCode::BAD_REQUEST);

        let approve_body = serde_json::json!({
            "user_code": code.user_code.replace('-', "").to_ascii_lowercase(),
        });
        let approve_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/oauth/device/authorize")
                    .header("Authorization", bearer_header(&token))
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&approve_body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(approve_response.status(), StatusCode::NO_CONTENT);

        let final_response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/oauth/token")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&poll_body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(final_response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(final_response.into_body(), usize::MAX)
            .await
            .unwrap();
        let tokens: TokenResponse = serde_json::from_slice(&bytes).unwrap();
        assert!(!tokens.access_token.is_empty());
        let claims = state
            .app
            .jwt
            .verify_access_token(&tokens.access_token)
            .await
            .unwrap();
        assert_eq!(claims.sub, user_id);
    }

    #[tokio::test]
    async fn device_approval_requires_authentication() {
        let (router, _state) = test_state().await;
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/oauth/device/authorize")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"user_code":"ABCD-2345"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn user_codes_accept_case_spacing_and_missing_separator() {
        assert_eq!(normalise_user_code(" abcd 2345 "), "ABCD-2345");
        assert_eq!(normalise_user_code("abcd-2345"), "ABCD-2345");
    }

    #[test]
    fn relative_verification_uri_uses_forwarded_public_origin() {
        let mut headers = HeaderMap::new();
        headers.insert("host", "internal:8080".parse().unwrap());
        headers.insert("x-forwarded-host", "playarr.example".parse().unwrap());
        headers.insert("x-forwarded-proto", "https".parse().unwrap());
        assert_eq!(
            request_verification_uri(&headers, "/link"),
            "https://playarr.example/link"
        );
    }

    #[tokio::test]
    async fn unsupported_grant_type_is_rejected() {
        let (router, _state) = test_state().await;
        let body = serde_json::json!({
            "grant_type": "password",
            "device_code": "whatever",
        });
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/oauth/token")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let error: OAuthErrorBody = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(error.error, "unsupported_grant_type");
    }

    /// Decodes the exact inverse of [`encode_servers_param`] -- what a
    /// real client-side decoder must do too (see that function's own doc
    /// comment for the wire format this asserts on).
    fn decode_servers_param(value: &str) -> Vec<PeerAddressEntry> {
        let json = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(value)
            .expect("servers= must be valid base64url");
        serde_json::from_slice(&json)
            .expect("decoded servers= must be a JSON array of {peer_node_id, url} objects")
    }

    /// Plain `&`/`=` splitting, not a full query-string parser: sufficient
    /// because `URL_SAFE_NO_PAD` base64url never contains `&`, `=`, or any
    /// other character that would need percent-decoding (its alphabet is
    /// `[A-Za-z0-9\-_]`, deliberately -- see [`encode_servers_param`]'s own
    /// doc comment for why that encoding was chosen).
    fn servers_param(verification_uri_complete: &str) -> String {
        let (_, query) = verification_uri_complete
            .split_once('?')
            .expect("verification_uri_complete must have a query string");
        query
            .split('&')
            .find_map(|pair| pair.strip_prefix("servers="))
            .expect("verification_uri_complete must carry a servers= param")
            .to_string()
    }

    /// `docs/architecture/peer-groups.md` §6.3: `verification_uri` (the
    /// short form) never carries the bundle; only `verification_uri_complete`
    /// does. For a standalone node that has never configured any address,
    /// the embedded bundle is an empty list -- present, not absent, and
    /// never an error (§6.1's "one code path" invariant, exercised here
    /// through the real `POST /api/v1/oauth/device/code` route).
    #[tokio::test]
    async fn device_code_embeds_an_empty_bundle_in_verification_uri_complete_for_a_standalone_node()
    {
        let (_router, state) = test_state().await;
        let router = router_with_relative_verification_uri(state.app.clone());
        let start_body = serde_json::json!({ "client_platform": "tv-webos" });
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/oauth/device/code")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&start_body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let code: DeviceCodeResponse = serde_json::from_slice(&bytes).unwrap();

        assert!(
            !code.verification_uri.contains("servers="),
            "the short verification_uri must stay a plain URL"
        );
        let addresses = decode_servers_param(&servers_param(&code.verification_uri_complete));
        assert!(addresses.is_empty());
    }

    /// The grouped counterpart: `verification_uri_complete`'s `servers=`
    /// param decodes to this node's real, current address bundle.
    #[tokio::test]
    async fn device_code_embeds_the_real_address_bundle_once_grouped() {
        let (_router, state) = test_state().await;
        let router = router_with_relative_verification_uri(state.app.clone());

        let group_id = uuid::Uuid::new_v4();
        state
            .app
            .peer_group_repo
            .create(&playarr_model::PeerGroup {
                id: group_id,
                name: "Home Group".to_string(),
                created_at: chrono::Utc::now(),
            })
            .await
            .unwrap();
        let peer_id = uuid::Uuid::new_v4();
        state
            .app
            .node_identity_repo
            .put(&playarr_model::NodeIdentity {
                peer_id,
                private_key: playarr_model::Sensitive::new("unused-in-this-test".to_string()),
                group_id: Some(group_id),
                created_at: chrono::Utc::now(),
            })
            .await
            .unwrap();
        let now = chrono::Utc::now();
        state
            .app
            .peer_node_repo
            .upsert(&playarr_model::PeerNode {
                id: peer_id,
                group_id,
                name: "home".to_string(),
                addresses: vec![playarr_model::PeerAddress {
                    url: "https://home.example.com".to_string(),
                    priority: 0,
                    label: "wan".to_string(),
                    client_reachable: true,
                }],
                public_key: "home-pubkey".to_string(),
                is_self: true,
                status: playarr_model::PeerNodeStatus::Active,
                last_seen_at: Some(now),
                last_sync_error: None,
                joined_at: now,
                updated_at: now,
            })
            .await
            .unwrap();

        let start_body = serde_json::json!({ "client_platform": "tv-webos" });
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/oauth/device/code")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&start_body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let code: DeviceCodeResponse = serde_json::from_slice(&bytes).unwrap();

        assert!(!code.verification_uri.contains("servers="));
        let addresses = decode_servers_param(&servers_param(&code.verification_uri_complete));
        assert_eq!(
            addresses,
            vec![PeerAddressEntry {
                peer_node_id: peer_id,
                url: "https://home.example.com".to_string(),
            }]
        );
    }
}
