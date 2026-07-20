//! RFC 8628 (OAuth 2.0 Device Authorization Grant) endpoints:
//! `POST /api/v1/oauth/device/code` and `POST /api/v1/oauth/token` -- thin
//! Axum handlers over [`streamarr_auth::DeviceFlowHandler`].

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use streamarr_auth::device_flow::{DeviceCodeResponse, TokenError, TokenResponse};
use streamarr_model::ClientPlatform;
use utoipa::ToSchema;

use crate::auth_extractor::StreamingUser;
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
            "expires_in": 600,
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
        response.verification_uri_complete =
            format!("{verification_uri}?user_code={}", response.user_code);
        response.verification_uri = verification_uri;
    }
    Ok(Json(response))
}

fn request_verification_uri(headers: &HeaderMap, path: &str) -> String {
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
    user: StreamingUser,
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
    use super::*;
    use crate::test_support::{bearer_header, mint_access_token, seed_streaming_user, test_state};
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

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
}
