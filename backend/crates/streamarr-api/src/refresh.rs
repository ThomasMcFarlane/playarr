//! `POST /api/v1/auth/refresh` -- redeems a still-valid refresh token for a
//! fresh access token, without re-presenting credentials. Closes a real
//! gap: `POST /api/v1/auth/login` (`login.rs`) already mints and persists a
//! rotating refresh token via `streamarr_auth::RefreshTokenService`, and
//! that service's `rotate` method already implements the full RFC
//! 6749-style redemption (with reuse detection -- see its doc comment),
//! but nothing ever exposed it over HTTP. Every client's access token is
//! short-lived (`JwtIssuer::access_ttl`, minutes not hours), so without
//! this endpoint a session silently stops working the moment that TTL
//! elapses -- the client has a perfectly good refresh token and no way to
//! use it, and its next protected request just fails as if the user were
//! never logged in.
//!
//! Unauthenticated by design (like `login_handler`): the refresh token
//! itself, not a bearer access token, is the credential here -- a caller
//! presenting one has nothing else to prove.
//!
//! Deliberately does **not** re-run `login_handler`'s `can_stream` gate --
//! `RefreshRequest` carries no `client_platform` (unlike `LoginRequest`),
//! so there's nothing to gate on even if it wanted to. This is safe, not
//! just expedient: `can_stream` is still unconditionally enforced by
//! `crate::auth_extractor::StreamingUser` on every catalog/playback
//! request regardless of how the presented access token was obtained, so
//! a revoked account can refresh a token but still can't use it for
//! anything. The only thing this leaves on the table is the fail-fast UX
//! `login_handler`'s gate provides -- a mid-session revocation surfaces on
//! the next catalog/playback call instead of at refresh time.

use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::error::ApiError;
use crate::AppState;

#[derive(Debug, Deserialize, ToSchema)]
pub struct RefreshRequest {
    /// Same `device_id` the original `POST /api/v1/auth/login` (or RFC
    /// 8628 device-flow) call used -- `RefreshTokenService` keys its store
    /// by device, not by the opaque token value alone.
    pub device_id: Uuid,
    pub refresh_token: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RefreshResponse {
    pub access_token: String,
    /// Rotated -- a new refresh token, not the one presented. The caller
    /// must persist this and discard the old one; presenting the old one
    /// again is treated as reuse (see `RefreshTokenService::rotate`'s doc
    /// comment) and revokes the whole token family.
    pub refresh_token: String,
    pub token_type: String,
    pub expires_in: i64,
    pub user_id: Uuid,
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/refresh",
    tag = "auth",
    request_body(
        content = RefreshRequest,
        example = json!({
            "device_id": "8f14e45f-ceea-467e-adde-3fb5c8f88e4b",
            "refresh_token": "rt_9f8c2e1a4b3d4c5e8f9a0b1c2d3e4f5a"
        })
    ),
    responses(
        (status = 200, description = "Fresh access + rotated refresh token pair", body = RefreshResponse, example = json!({
            "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1ZjNjZjk2YS0xZjI0LTQ4ZTQtOWJkNC0zZTg5N2VlYjY0YTgiLCJkZXZpY2VfaWQiOiI4ZjE0ZTQ1Zi1jZWVhLTQ2N2UtYWRkZS0zZmI1YzhmODhlNGIiLCJzZXNzaW9uX2lkIjoiZDJiOWYwYTQtNzY1Yy00ZjNlLWFjOTQtN2NmMDQ1YjBkOTFlIiwiaXNzIjoic3RyZWFtYXJyIiwiaWF0IjoxNzE4ODAwMDAwLCJleHAiOjE3MTg4MDA5MDB9.dGhpc19pc19hX2Zha2Vfc2lnbmF0dXJl",
            "refresh_token": "rt_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
            "token_type": "Bearer",
            "expires_in": 900,
            "user_id": "5f3cf96a-1f24-48e4-9bd4-3e897eeb64a8"
        })),
        (status = 401, description = "refresh token is invalid, expired, revoked, or reused")
    )
)]
pub async fn refresh_handler(
    State(state): State<AppState>,
    Json(body): Json<RefreshRequest>,
) -> Result<Json<RefreshResponse>, ApiError> {
    let (session, token_response) = state
        .sessions
        .rotate(body.device_id, &body.refresh_token)
        .await?;

    Ok(Json(RefreshResponse {
        access_token: token_response.access_token,
        refresh_token: token_response.refresh_token,
        token_type: token_response.token_type,
        expires_in: token_response.expires_in,
        user_id: session.user_id,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{seed_streaming_user, test_state};
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    #[tokio::test]
    async fn refresh_issues_a_new_access_token_and_rotates_the_refresh_token() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let device_id = Uuid::new_v4();

        // Real login first, exactly like a client would, via the
        // trusted-network default this harness seeds -- see `test_state`'s
        // doc comment. We only need a real (session, refresh_token) pair;
        // which auth tier produced it doesn't matter to `refresh_handler`.
        let device = streamarr_model::Device {
            id: device_id,
            user_id: Uuid::nil(),
            name: "test device".to_string(),
            platform: streamarr_model::ClientPlatform::Web,
            client_version: "1.0.0".to_string(),
            last_seen_at: None,
            trusted: false,
        };
        let (_session, issued) = state
            .app
            .sessions
            .issue(device, state.app.refresh_ttl)
            .await
            .expect("issue a real session");

        let body = serde_json::json!({
            "device_id": device_id,
            "refresh_token": issued.refresh_token,
        });
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/auth/refresh")
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let refreshed: RefreshResponse = serde_json::from_slice(&bytes).unwrap();
        assert!(!refreshed.access_token.is_empty());
        // Rotated -- must not just echo the presented token back.
        assert_ne!(refreshed.refresh_token, issued.refresh_token);

        let claims = state
            .app
            .jwt
            .verify_access_token(&refreshed.access_token)
            .expect("refreshed access token must verify");
        assert_eq!(claims.sub, Uuid::nil()); // `issue`'s `device.user_id` above
    }

    #[tokio::test]
    async fn refresh_with_unknown_token_is_rejected() {
        let (router, _state) = test_state().await;
        let body = serde_json::json!({
            "device_id": Uuid::new_v4(),
            "refresh_token": "this-was-never-issued",
        });
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/auth/refresh")
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn presenting_an_already_rotated_token_again_is_rejected_as_reuse() {
        let (router, state) = test_state().await;
        let device_id = Uuid::new_v4();
        let device = streamarr_model::Device {
            id: device_id,
            user_id: Uuid::nil(),
            name: "test device".to_string(),
            platform: streamarr_model::ClientPlatform::Web,
            client_version: "1.0.0".to_string(),
            last_seen_at: None,
            trusted: false,
        };
        let (_session, issued) = state
            .app
            .sessions
            .issue(device, state.app.refresh_ttl)
            .await
            .expect("issue a real session");

        // First redemption succeeds and rotates the token...
        let first_body = serde_json::json!({
            "device_id": device_id,
            "refresh_token": issued.refresh_token,
        });
        let first = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/auth/refresh")
                    .header("content-type", "application/json")
                    .body(Body::from(first_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(first.status(), StatusCode::OK);

        // ...presenting the now-retired original token again is reuse.
        let second_body = serde_json::json!({
            "device_id": device_id,
            "refresh_token": issued.refresh_token,
        });
        let second = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/auth/refresh")
                    .header("content-type", "application/json")
                    .body(Body::from(second_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(second.status(), StatusCode::UNAUTHORIZED);
    }
}
