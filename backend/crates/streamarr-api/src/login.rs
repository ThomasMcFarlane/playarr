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
//!
//! **Streaming-access gate**: once `evaluate_login` resolves a real user,
//! and unless the request declares `client_platform: "streamarr-admin"`
//! (see [`ClientPlatform::StreamarrAdmin`]'s doc comment), this handler
//! additionally requires that user's `Policy::can_stream` before issuing a
//! token -- the same grant [`crate::auth_extractor::StreamingUser`]
//! enforces on every catalog/playback request. This used to be enforced
//! only downstream (login would succeed for any valid account, then the
//! first catalog/playback call would 403), which is a confusing dead end
//! for an operator-provisioned account with no streaming access: login
//! itself now fails fast with a real, specific 403 instead of a token that
//! can't actually do anything in Playarr. Deliberately skipped for
//! `client_platform: "streamarr-admin"` logins -- an admin-only account
//! (e.g. the bootstrap admin, which never has `can_stream`) must still be
//! able to sign in to Streamarr's own admin UI.

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

use crate::admin_peer::{peer_addresses_for_response, PeerAddressBundle};
use crate::auth_extractor::{forbidden, resolve_policy};
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
    /// `docs/architecture/peer-groups.md` §7.1's self-healing address
    /// book: this node's current [`PeerAddressBundle`], so the client can
    /// pick up newly added/removed peers without a separate round trip.
    /// `null`/absent for a standalone (never grouped) node -- see
    /// `admin_peer::peer_addresses_for_response`'s doc comment for why
    /// that lookup is skipped rather than always attached.
    #[serde(default)]
    pub peer_addresses: Option<PeerAddressBundle>,
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/login",
    tag = "auth",
    request_body(content = LoginRequest, example = json!({
        "username": "jsmith",
        "password": "correct-horse-battery-staple",
        "profile_user_id": null,
        "pin": null,
        "device_id": "b3f2c9a4-6e1d-4f8a-9c2b-1a7e5d3f6b90",
        "device_name": "Thomas's iPhone",
        "client_platform": "ios",
        "client_version": "1.4.2"
    })),
    responses(
        (status = 200, description = "Access + refresh token pair", body = LoginResponse, example = json!({
            "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5ZjhkN2E2Yi0xMjM0LTQ1NjctODlhYi1jZGVmMDEyMzQ1NjciLCJkZXZpY2VfaWQiOiJiM2YyYzlhNC02ZTFkLTRmOGEtOWMyYi0xYTdlNWQzZjZiOTAiLCJzZXNzaW9uX2lkIjoiN2E5ZDNlMWYtOGI0Yy00ZDJhLTliM2UtNWY2YTdiOGM5ZDBlIiwiaXNzIjoic3RyZWFtYXJyIiwiaWF0IjoxNzE2MjM5MDIyLCJleHAiOjE3MTYyNDI2MjJ9.dGhpcyBpcyBhIGZha2Ugc2lnbmF0dXJl",
            "refresh_token": "rt_9f8d7a6b1234456789abcdef01234567",
            "token_type": "Bearer",
            "expires_in": 3600,
            "user_id": "9f8d7a6b-1234-4567-89ab-cdef01234567",
            "peer_addresses": null
        })),
        (status = 400, description = "credentials_required | pin_required"),
        (status = 401, description = "untrusted_network | invalid_credentials | invalid_pin | account_disabled"),
        (status = 403, description = "authenticated, but this account has no Playarr streaming access")
    )
)]
pub async fn login_handler(
    State(state): State<AppState>,
    ConnectInfo(remote_addr): ConnectInfo<SocketAddr>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, ApiError> {
    let client_platform = body.client_platform;
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

    // See the module doc comment's "Streaming-access gate" section. Runs
    // after `evaluate_login` (which already minted a real session/refresh
    // token) rather than before it, since resolving a user is itself
    // auth-mode-specific logic `evaluate_login` owns -- duplicating it here
    // just to check first isn't worth it. A rejected attempt leaves one
    // unused session row behind; it expires with the rest via
    // `refresh_ttl`, same as any other refresh token nobody ever redeems.
    if client_platform != ClientPlatform::StreamarrAdmin {
        let policy = resolve_policy(
            &state,
            outcome.user.id,
            "streaming",
            forbidden("this account does not have Playarr streaming access"),
        )
        .await?;
        if !policy.can_stream {
            return Err(forbidden(
                "this account does not have Playarr streaming access",
            ));
        }
    }

    let peer_addresses = peer_addresses_for_response(&state).await?;

    Ok(Json(LoginResponse {
        access_token: outcome.access_token,
        refresh_token: outcome.session.refresh_token.expose_secret().clone(),
        token_type: "Bearer".to_string(),
        expires_in: state.jwt.access_ttl().num_seconds(),
        user_id: outcome.user.id,
        peer_addresses,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{seed_admin_user, seed_streaming_user, test_state};
    use crate::version_gate::{ClientCompatibilityTable, VersionGateLayer};
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    /// Same minimal table `test_support::test_state`'s router is built
    /// with -- duplicated here (rather than made `pub(crate)` there) since
    /// this is the only test module that needs a *second*, differently-
    /// configured router built from a mutated clone of `TestState::app`.
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
        // A standalone (never grouped) node's login response carries no
        // address bundle -- see `peer_addresses_for_response`'s doc
        // comment for why.
        assert!(login.peer_addresses.is_none());

        // The issued access token is real -- it verifies and carries the
        // same user id straight through `AppState::jwt`.
        let claims = state
            .app
            .jwt
            .verify_access_token(&login.access_token)
            .await
            .unwrap();
        assert_eq!(claims.sub, state.default_user_id);
    }

    /// `docs/architecture/peer-groups.md` §7.1's self-healing: once this
    /// node has founded/joined a group, every login response carries the
    /// current [`crate::admin_peer::PeerAddressBundle`].
    #[tokio::test]
    async fn login_response_carries_the_address_bundle_once_grouped() {
        let (router, state) = test_state().await;

        let group_id = Uuid::new_v4();
        state
            .app
            .peer_group_repo
            .create(&streamarr_model::PeerGroup {
                id: group_id,
                name: "Home Group".to_string(),
                created_at: Utc::now(),
            })
            .await
            .unwrap();
        let peer_id = Uuid::new_v4();
        state
            .app
            .node_identity_repo
            .put(&streamarr_model::NodeIdentity {
                peer_id,
                private_key: streamarr_model::Sensitive::new("unused-in-this-test".to_string()),
                group_id: Some(group_id),
                created_at: Utc::now(),
            })
            .await
            .unwrap();
        let now = Utc::now();
        state
            .app
            .peer_node_repo
            .upsert(&streamarr_model::PeerNode {
                id: peer_id,
                group_id,
                name: "home".to_string(),
                addresses: vec![streamarr_model::PeerAddress {
                    url: "https://home.example.com".to_string(),
                    priority: 0,
                    label: "wan".to_string(),
                    client_reachable: true,
                }],
                public_key: "home-pubkey".to_string(),
                is_self: true,
                status: streamarr_model::PeerNodeStatus::Active,
                last_seen_at: Some(now),
                last_sync_error: None,
                joined_at: now,
                updated_at: now,
            })
            .await
            .unwrap();

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
        let bundle = login
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

    /// The exact scenario this gate exists for: an admin account (which
    /// deliberately never carries `can_stream`, see `Policy::can_stream`'s
    /// doc comment and `main.rs`'s bootstrap policy) trying to log in to
    /// Playarr is rejected at login, not silently issued a token that
    /// would just 403 on the first catalog request -- but the exact same
    /// account logging in as `client_platform: "streamarr-admin"` still
    /// succeeds, since Streamarr's own admin UI doesn't need `can_stream`.
    #[tokio::test]
    async fn login_without_streaming_access_is_rejected_unless_admin_platform() {
        let (_router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;

        let mut app = state.app.clone();
        app.auth_mode = std::sync::Arc::new(streamarr_auth::AuthMode::TrustedNetwork {
            allowlist: vec![streamarr_auth::TrustedNetwork {
                network: "0.0.0.0/0".parse().unwrap(),
                auto_login_user_id: admin_id,
            }],
        });
        let (custom_router, _api) = crate::build_router(app, test_version_gate(), None);

        let playarr_body = serde_json::json!({
            "device_id": Uuid::new_v4(),
            "device_name": "test browser",
            "client_platform": "web",
            "client_version": "1.0.0",
        });
        let response = custom_router
            .clone()
            .oneshot(request_from(
                SocketAddr::from(([127, 0, 0, 1], 51234)),
                playarr_body,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);

        let admin_body = serde_json::json!({
            "device_id": Uuid::new_v4(),
            "device_name": "test browser",
            "client_platform": "streamarr-admin",
            "client_version": "1.0.0",
        });
        let response = custom_router
            .oneshot(request_from(
                SocketAddr::from(([127, 0, 0, 1], 51234)),
                admin_body,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    /// The mirror-image case: a real streaming user (not an admin) logging
    /// in with `client_platform: "web"` succeeds normally.
    #[tokio::test]
    async fn login_with_streaming_access_succeeds_for_playarr_platform() {
        let (_router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;

        let mut app = state.app.clone();
        app.auth_mode = std::sync::Arc::new(streamarr_auth::AuthMode::TrustedNetwork {
            allowlist: vec![streamarr_auth::TrustedNetwork {
                network: "0.0.0.0/0".parse().unwrap(),
                auto_login_user_id: user_id,
            }],
        });
        let (custom_router, _api) = crate::build_router(app, test_version_gate(), None);

        let body = serde_json::json!({
            "device_id": Uuid::new_v4(),
            "device_name": "test browser",
            "client_platform": "web",
            "client_version": "1.0.0",
        });
        let response = custom_router
            .oneshot(request_from(
                SocketAddr::from(([127, 0, 0, 1], 51234)),
                body,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
}
