//! `POST /api/v1/auth/login` -- session login for browser/mobile/desktop
//! clients: resolves one inbound login attempt against the operator's
//! configured `streamarr_auth::AuthMode` (trusted-network auto-login,
//! managed-profile PIN, or full username+password -- see that enum's doc
//! comment for what each tier requires) via
//! `streamarr_auth::login::evaluate_login`, and on success issues a real
//! access + refresh token pair through the same `JwtIssuer`/
//! `RefreshTokenService` the RFC 8628 device flow (`oauth.rs`) already
//! issues tokens through -- this is a second entry point into the same
//! token-issuance machinery, not a parallel implementation of it.
//!
//! Unlike the device flow (which has no source IP to reason about -- the
//! polling device and the approving human are different connections), this
//! endpoint reads the caller's source IP straight off the TCP connection
//! via Axum's [`ConnectInfo`] extractor, which is what
//! `AuthMode::TrustedNetwork` needs to auto-login without credentials.

use std::net::SocketAddr;

use axum::extract::{ConnectInfo, State};
use axum::Json;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use streamarr_auth::{
    evaluate_login, Argon2PasswordVerifier, Credentials, LoginContext, PinAttempt,
};
use streamarr_model::{ClientPlatform, Device};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::error::ApiError;
use crate::AppState;

#[derive(Debug, Deserialize, ToSchema)]
pub struct LoginRequest {
    /// `AuthMode::FullAccount` only; ignored by every other tier.
    pub username: Option<String>,
    pub password: Option<String>,
    /// `AuthMode::ManagedProfiles` only; ignored by every other tier.
    pub profile_user_id: Option<Uuid>,
    pub pin: Option<String>,
    /// Client-generated, stable-per-install device id -- the same id the
    /// caller should resend on every subsequent login/refresh from this
    /// install, so `Policy::device_allow`/`max_concurrent_sessions` reason
    /// about one `Device`, not a fresh one per login.
    pub device_id: Uuid,
    pub device_name: String,
    pub client_platform: ClientPlatform,
    pub client_version: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct LoginResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: String,
    pub expires_in: i64,
    pub user_id: Uuid,
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/login",
    tag = "auth",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "Access + refresh token pair", body = LoginResponse),
        (status = 400, description = "credentials_required | pin_required"),
        (status = 401, description = "untrusted_network | invalid_credentials | invalid_pin | account_disabled")
    )
)]
pub async fn login_handler(
    State(state): State<AppState>,
    ConnectInfo(remote_addr): ConnectInfo<SocketAddr>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, ApiError> {
    let device = Device {
        id: body.device_id,
        user_id: Uuid::nil(),
        name: body.device_name.clone(),
        platform: body.client_platform,
        client_version: body.client_version.clone(),
        last_seen_at: None,
        trusted: false,
    };

    let credentials = match (body.username.as_deref(), body.password.as_deref()) {
        (Some(username), Some(password)) => Some(Credentials { username, password }),
        _ => None,
    };
    let pin = match (body.profile_user_id, body.pin.as_deref()) {
        (Some(profile_user_id), Some(pin)) => Some(PinAttempt {
            profile_user_id,
            pin,
        }),
        _ => None,
    };

    let ctx = LoginContext {
        source_ip: remote_addr.ip(),
        credentials,
        pin,
        device,
        now: Utc::now(),
    };

    let verifier = Argon2PasswordVerifier;
    let outcome = evaluate_login(
        &state.auth_mode,
        ctx,
        state.user_directory.as_ref(),
        &verifier,
        &state.sessions,
        state.refresh_ttl,
    )
    .await?;

    Ok(Json(LoginResponse {
        access_token: outcome.access_token,
        refresh_token: outcome.session.refresh_token.expose_secret().clone(),
        token_type: "Bearer".to_string(),
        expires_in: state.jwt.access_ttl().num_seconds(),
        user_id: outcome.user.id,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::test_state;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    fn request_from(addr: SocketAddr, body: serde_json::Value) -> Request<Body> {
        let mut request = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/login")
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap();
        request.extensions_mut().insert(ConnectInfo(addr));
        request
    }

    #[tokio::test]
    async fn trusted_network_login_issues_real_tokens_for_the_default_user() {
        let (router, state) = test_state().await;
        let body = serde_json::json!({
            "device_id": Uuid::new_v4(),
            "device_name": "test browser",
            "client_platform": "web",
            "client_version": "1.0.0",
        });
        let response = router
            .oneshot(request_from(
                SocketAddr::from(([127, 0, 0, 1], 51234)),
                body,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let login: LoginResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(login.user_id, state.default_user_id);
        assert!(!login.access_token.is_empty());
        assert!(!login.refresh_token.is_empty());
        assert_eq!(login.token_type, "Bearer");

        // The issued access token is real -- it verifies and carries the
        // same user id straight through `AppState::jwt`.
        let claims = state
            .app
            .jwt
            .verify_access_token(&login.access_token)
            .unwrap();
        assert_eq!(claims.sub, state.default_user_id);
    }

    #[tokio::test]
    async fn login_without_connect_info_is_rejected() {
        // No `ConnectInfo` extension inserted -- mirrors what would happen
        // if this endpoint were ever served without
        // `into_make_service_with_connect_info`, which would be a real bug.
        let (router, _state) = test_state().await;
        let body = serde_json::json!({
            "device_id": Uuid::new_v4(),
            "device_name": "test browser",
            "client_platform": "web",
            "client_version": "1.0.0",
        });
        let request = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/login")
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap();
        let response = router.oneshot(request).await.unwrap();
        assert!(!response.status().is_success());
    }
}
