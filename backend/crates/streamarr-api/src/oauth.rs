//! RFC 8628 (OAuth 2.0 Device Authorization Grant) endpoints:
//! `POST /api/v1/oauth/device/code` and `POST /api/v1/oauth/token` -- thin
//! Axum handlers over [`streamarr_auth::DeviceFlowHandler`].

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use streamarr_auth::device_flow::{DeviceCodeResponse, TokenError, TokenResponse};
use streamarr_model::ClientPlatform;
use utoipa::ToSchema;

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
    request_body = DeviceCodeRequest,
    responses(
        (status = 200, description = "Device/user code pair issued", body = DeviceCodeResponseSchema)
    )
)]
pub async fn device_code_handler(
    State(state): State<AppState>,
    Json(body): Json<DeviceCodeRequest>,
) -> Result<Json<DeviceCodeResponse>, crate::error::ApiError> {
    let response = state
        .device_flow
        .start_device_authorization(body.client_platform)
        .await?;
    Ok(Json(response))
}

#[utoipa::path(
    post,
    path = "/api/v1/oauth/token",
    tag = "oauth",
    request_body = DeviceTokenRequest,
    responses(
        (status = 200, description = "Access/refresh token pair", body = TokenResponseSchema),
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
    use crate::test_support::test_state;
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    #[tokio::test]
    async fn full_device_flow_start_approve_poll() {
        let (router, state) = test_state().await;

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

        state
            .device_flow
            .approve_user_code(&code.user_code, uuid::Uuid::new_v4())
            .await
            .unwrap();

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
