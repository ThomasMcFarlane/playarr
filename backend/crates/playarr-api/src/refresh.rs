//! `POST /api/v1/auth/refresh` -- redeems a still-valid refresh token for a
//! fresh access token, without re-presenting credentials. Closes a real
//! gap: `POST /api/v1/auth/login` (`login.rs`) already mints and persists a
//! rotating refresh token via `playarr_auth::RefreshTokenService`, and
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

use crate::admin_peer::{peer_addresses_for_response, PeerAddressBundle};
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
    /// `docs/architecture/peer-groups.md` §7.1's self-healing address
    /// book -- see `LoginResponse::peer_addresses`'s identical doc comment
    /// (`login.rs`) and `admin_peer::peer_addresses_for_response` for why
    /// this is `null`/absent for a standalone (never grouped) node.
    #[serde(default)]
    pub peer_addresses: Option<PeerAddressBundle>,
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
            "user_id": "5f3cf96a-1f24-48e4-9bd4-3e897eeb64a8",
            "peer_addresses": null
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
    ensure_account_exists(&state, session.user_id).await?;

    let peer_addresses = peer_addresses_for_response(&state).await?;

    Ok(Json(RefreshResponse {
        access_token: token_response.access_token,
        refresh_token: token_response.refresh_token,
        token_type: token_response.token_type,
        expires_in: token_response.expires_in,
        user_id: session.user_id,
        peer_addresses,
    }))
}

/// A refresh token outlives the account it was issued to (nothing revokes it when an administrator
/// deletes the user), so redeeming one for a deleted account answers 401 like any dead session
/// rather than minting an access token that every request then refuses.
async fn ensure_account_exists(state: &AppState, user_id: Uuid) -> Result<(), ApiError> {
    match state.user_repo.find_by_id(user_id).await {
        Ok(Some(_)) => Ok(()),
        Ok(None) => Err(ApiError::new(
            axum::http::StatusCode::UNAUTHORIZED,
            "unauthorized",
            "refresh token is invalid or expired",
        )),
        Err(err) => Err(ApiError::internal(format!(
            "failed to look up user {user_id}: {err}"
        ))),
    }
}

/// Body of `POST /api/v1/auth/unlock`: the stored refresh credential of a
/// PIN-locked profile plus its PIN.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UnlockRequest {
    pub device_id: Uuid,
    pub refresh_token: String,
    pub pin: String,
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/unlock",
    tag = "auth",
    request_body(
        content = UnlockRequest,
        example = json!({
            "device_id": "8f14e45f-ceea-467e-adde-3fb5c8f88e4b",
            "refresh_token": "rt_9f8c2e1a4b3d4c5e8f9a0b1c2d3e4f5a",
            "pin": "4821"
        })
    ),
    responses(
        (status = 200, description = "PIN accepted: the device holds an unlock lease and a fresh token pair is issued", body = RefreshResponse),
        (status = 401, description = "refresh token invalid, or PIN wrong (`invalid_pin`)"),
        (status = 429, description = "Too many incorrect PIN attempts (`pin_locked`, with `retry_after_seconds`)")
    )
)]
pub async fn unlock_handler(
    State(state): State<AppState>,
    Json(body): Json<UnlockRequest>,
) -> Result<Json<RefreshResponse>, ApiError> {
    // The refresh token proves which profile is being unlocked; without a
    // valid one there is no PIN oracle at all.
    let user_id = state
        .sessions
        .peek_user(body.device_id, &body.refresh_token)
        .await?;
    state
        .household
        .ensure_pin_not_locked(user_id, user_id)
        .await?;
    let pin_hash = state
        .profile_pin_repo
        .find_hash(user_id)
        .await
        .map_err(|error| ApiError::internal(format!("failed to load profile PIN: {error}")))?;
    // A profile with no PIN has nothing to unlock; treat it as a plain
    // refresh so a client can call this unconditionally.
    if let Some(pin_hash) = pin_hash {
        let verifier = playarr_auth::Argon2PasswordVerifier;
        if !playarr_auth::PasswordVerifier::verify(&verifier, &body.pin, &pin_hash) {
            state.household.record_pin_failure(user_id, user_id).await;
            return Err(ApiError::new(
                axum::http::StatusCode::UNAUTHORIZED,
                "invalid_pin",
                "the PIN is incorrect",
            ));
        }
        state.household.reset_pin_failures(user_id, user_id).await;
    }
    let (session, token_response) = state
        .sessions
        .unlock(body.device_id, &body.refresh_token)
        .await?;
    ensure_account_exists(&state, session.user_id).await?;
    let peer_addresses = peer_addresses_for_response(&state).await?;
    Ok(Json(RefreshResponse {
        access_token: token_response.access_token,
        refresh_token: token_response.refresh_token,
        token_type: token_response.token_type,
        expires_in: token_response.expires_in,
        user_id: session.user_id,
        peer_addresses,
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/lock",
    tag = "auth",
    responses(
        (status = 204, description = "This device's unlock lease is cleared: the next refresh needs the profile PIN"),
        (status = 401, description = "Missing or invalid bearer token")
    )
)]
pub async fn lock_handler(
    State(state): State<AppState>,
    auth: crate::auth_extractor::AuthUser,
) -> Result<axum::http::StatusCode, ApiError> {
    state
        .sessions
        .set_unlock_lease(auth.claims.device_id, None)
        .await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
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
        seed_streaming_user(&state, Uuid::nil()).await;
        let device_id = Uuid::new_v4();

        // Real login first, exactly like a client would, via the
        // trusted-network default this harness seeds -- see `test_state`'s
        // doc comment. We only need a real (session, refresh_token) pair;
        // which auth tier produced it doesn't matter to `refresh_handler`.
        let device = playarr_model::Device {
            id: device_id,
            user_id: Uuid::nil(),
            name: "test device".to_string(),
            platform: playarr_model::ClientPlatform::Web,
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
        // A standalone (never grouped) node's refresh response carries no
        // address bundle -- see `peer_addresses_for_response`'s doc
        // comment for why.
        assert!(refreshed.peer_addresses.is_none());

        let claims = state
            .app
            .jwt
            .verify_access_token(&refreshed.access_token)
            .await
            .expect("refreshed access token must verify");
        assert_eq!(claims.sub, Uuid::nil()); // `issue`'s `device.user_id` above
    }

    /// `docs/architecture/peer-groups.md` §7.1's self-healing: once this
    /// node has founded/joined a group, every refresh response carries the
    /// current [`crate::admin_peer::PeerAddressBundle`] too, mirroring
    /// `login.rs`'s identical test.
    #[tokio::test]
    async fn refresh_response_carries_the_address_bundle_once_grouped() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        seed_streaming_user(&state, Uuid::nil()).await;
        let device_id = Uuid::new_v4();

        let group_id = Uuid::new_v4();
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
        let peer_id = Uuid::new_v4();
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

        let device = playarr_model::Device {
            id: device_id,
            user_id: Uuid::nil(),
            name: "test device".to_string(),
            platform: playarr_model::ClientPlatform::Web,
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
        let bundle = refreshed
            .peer_addresses
            .expect("grouped node must carry a bundle");
        assert_eq!(bundle.group_id, Some(group_id));
        assert_eq!(
            bundle.addresses,
            vec![crate::admin_peer::PeerAddressEntry {
                peer_node_id: peer_id,
                url: "https://home.example.com".to_string(),
            }]
        );
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
        seed_streaming_user(&state, Uuid::nil()).await;
        let device_id = Uuid::new_v4();
        let device = playarr_model::Device {
            id: device_id,
            user_id: Uuid::nil(),
            name: "test device".to_string(),
            platform: playarr_model::ClientPlatform::Web,
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

    async fn post_json(
        router: &axum::Router,
        uri: &str,
        bearer: Option<&str>,
        body: serde_json::Value,
    ) -> (StatusCode, serde_json::Value) {
        let mut builder = Request::builder()
            .method("POST")
            .uri(uri)
            .header("content-type", "application/json");
        if let Some(token) = bearer {
            builder = builder.header("authorization", format!("Bearer {token}"));
        }
        let response = router
            .clone()
            .oneshot(builder.body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        (status, json)
    }

    async fn issue_for(state: &crate::test_support::TestState, user_id: Uuid) -> (Uuid, String) {
        let device_id = Uuid::new_v4();
        let device = playarr_model::Device {
            id: device_id,
            user_id,
            name: "test device".to_string(),
            platform: playarr_model::ClientPlatform::Web,
            client_version: "1.0.0".to_string(),
            last_seen_at: None,
            trusted: false,
        };
        let (_session, issued) = state
            .app
            .sessions
            .issue(device, state.app.refresh_ttl)
            .await
            .expect("issue session");
        (device_id, issued.refresh_token)
    }

    /// TASKS 115: a stored refresh token for a PIN-locked profile cannot be
    /// redeemed without the PIN once the device's unlock lease is gone, so a
    /// modified client that never calls the PIN check gets nowhere.
    #[tokio::test]
    async fn pin_locked_profile_refresh_needs_an_unlock_lease() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        state
            .app
            .profile_pin_repo
            .upsert_hash(user_id, &playarr_auth::login::hash_password("4821"))
            .await
            .unwrap();
        let (device_id, token) = issue_for(&state, user_id).await;

        // A fresh login holds a lease, so the active profile refreshes.
        let (status, json) = post_json(
            &router,
            "/api/v1/auth/refresh",
            None,
            serde_json::json!({ "device_id": device_id, "refresh_token": token }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let token = json["refresh_token"].as_str().unwrap().to_string();
        let access = json["access_token"].as_str().unwrap().to_string();

        // Switching away locks the device's lease.
        let (status, _) = post_json(
            &router,
            "/api/v1/auth/lock",
            Some(&access),
            serde_json::json!({}),
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT);

        // Bypass attempt: redeem the stored token directly.
        let (status, json) = post_json(
            &router,
            "/api/v1/auth/refresh",
            None,
            serde_json::json!({ "device_id": device_id, "refresh_token": token }),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(json["error"], "pin_required");

        // The refusal did not burn the token: the right PIN still unlocks it.
        let (status, json) = post_json(
            &router,
            "/api/v1/auth/unlock",
            None,
            serde_json::json!({ "device_id": device_id, "refresh_token": token, "pin": "0000" }),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(json["error"], "invalid_pin");
        let (status, json) = post_json(
            &router,
            "/api/v1/auth/unlock",
            None,
            serde_json::json!({ "device_id": device_id, "refresh_token": token, "pin": "4821" }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let token = json["refresh_token"].as_str().unwrap().to_string();

        // The lease now lets the profile refresh again.
        let (status, _) = post_json(
            &router,
            "/api/v1/auth/refresh",
            None,
            serde_json::json!({ "device_id": device_id, "refresh_token": token }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }

    #[tokio::test]
    async fn expired_lease_and_pinless_profiles() {
        let (router, state) = test_state().await;
        let locked_user = Uuid::new_v4();
        seed_streaming_user(&state, locked_user).await;
        state
            .app
            .profile_pin_repo
            .upsert_hash(locked_user, &playarr_auth::login::hash_password("4821"))
            .await
            .unwrap();
        let (device_id, token) = issue_for(&state, locked_user).await;
        state
            .app
            .sessions
            .set_unlock_lease(
                device_id,
                Some(chrono::Utc::now() - chrono::Duration::seconds(1)),
            )
            .await
            .unwrap();
        let (status, json) = post_json(
            &router,
            "/api/v1/auth/refresh",
            None,
            serde_json::json!({ "device_id": device_id, "refresh_token": token }),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(json["error"], "pin_required");

        // A profile without a PIN is never gated, even with no lease.
        let open_user = Uuid::new_v4();
        seed_streaming_user(&state, open_user).await;
        let (open_device, open_token) = issue_for(&state, open_user).await;
        state
            .app
            .sessions
            .set_unlock_lease(open_device, None)
            .await
            .unwrap();
        let (status, _) = post_json(
            &router,
            "/api/v1/auth/refresh",
            None,
            serde_json::json!({ "device_id": open_device, "refresh_token": open_token }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }

    #[tokio::test]
    async fn unlock_pin_guesses_lock_out_and_need_a_valid_token() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        state
            .app
            .profile_pin_repo
            .upsert_hash(user_id, &playarr_auth::login::hash_password("4821"))
            .await
            .unwrap();
        let (device_id, token) = issue_for(&state, user_id).await;
        state
            .app
            .sessions
            .set_unlock_lease(device_id, None)
            .await
            .unwrap();

        // No valid refresh token: no PIN oracle, no failure counted.
        let (status, _) = post_json(
            &router,
            "/api/v1/auth/unlock",
            None,
            serde_json::json!({ "device_id": device_id, "refresh_token": "rt_nope", "pin": "4821" }),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);

        let mut last = StatusCode::OK;
        let mut last_json = serde_json::Value::Null;
        for _ in 0..8 {
            (last, last_json) = post_json(
                &router,
                "/api/v1/auth/unlock",
                None,
                serde_json::json!({ "device_id": device_id, "refresh_token": token, "pin": "1111" }),
            )
            .await;
        }
        assert_eq!(last, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(last_json["error"], "pin_locked");
        // Even the correct PIN is refused while locked out.
        let (status, _) = post_json(
            &router,
            "/api/v1/auth/unlock",
            None,
            serde_json::json!({ "device_id": device_id, "refresh_token": token, "pin": "4821" }),
        )
        .await;
        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    }

    /// An administrator deleting a user does not revoke the user's refresh tokens, so redeeming one must
    /// fail with 401 (not mint a token that every request refuses): a client then signs out cleanly.
    #[tokio::test]
    async fn refreshing_for_a_deleted_account_is_unauthorised() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let (device_id, token) = issue_for(&state, user_id).await;
        state.user_repo.delete(user_id).await.unwrap();

        let (status, json) = post_json(
            &router,
            "/api/v1/auth/refresh",
            None,
            serde_json::json!({ "device_id": device_id, "refresh_token": token }),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{json}");
    }

    /// A still-valid access token for a deleted account is a dead session (401), not a restriction (403).
    #[tokio::test]
    async fn a_live_access_token_for_a_deleted_account_is_unauthorised() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = crate::test_support::mint_access_token(&state, user_id);
        state.user_repo.delete(user_id).await.unwrap();

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/catalog")
                    .header("Authorization", crate::test_support::bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}
