//! RFC 8628 (OAuth 2.0 Device Authorization Grant) types and handler
//! shapes, for limited-input clients (`tv-webos`/`tv-tizen`/`tv-vidaa`/
//! `android-tv`) that can't reasonably host a password/OAuth-redirect
//! login flow: the TV displays a `user_code` and a URL, the user completes
//! login on a phone/laptop, and the TV polls until it receives a token.

use std::sync::Arc;

use async_trait::async_trait;
use chrono::{DateTime, Duration, Utc};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use streamarr_model::{ClientPlatform, Device};
use uuid::Uuid;

use crate::refresh::RefreshTokenService;

/// `POST /auth/device/code` response — RFC 8628 §3.2.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeviceCodeResponse {
    /// Opaque, high-entropy code the device polls with. Never shown to
    /// the user.
    pub device_code: String,
    /// Short, human-typeable code the user enters on the verification
    /// page (e.g. `"WXYZ-1234"`).
    pub user_code: String,
    pub verification_uri: String,
    /// `verification_uri` with `user_code` pre-filled, for platforms that
    /// can render it as a QR code so the user doesn't have to type
    /// anything.
    pub verification_uri_complete: String,
    /// Seconds until `device_code` expires.
    pub expires_in: i64,
    /// Minimum seconds the client must wait between polls — enforced
    /// server-side by [`TokenError::SlowDown`], not just advisory.
    pub interval: i64,
}

/// `POST /auth/device/token` success response — same shape as a normal
/// OAuth token response so the rest of the client's token-handling code
/// doesn't need a device-flow-specific path once it has a token.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: i64,
    pub refresh_token: String,
}

/// RFC 8628 §3.5 error codes for the token polling endpoint. The client is
/// expected to keep polling on `AuthorizationPending` (and slow its
/// interval on `SlowDown`), and stop on `ExpiredToken`/`AccessDenied`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "snake_case")]
pub enum TokenError {
    #[error("authorization_pending")]
    AuthorizationPending,
    #[error("slow_down")]
    SlowDown,
    #[error("expired_token")]
    ExpiredToken,
    #[error("access_denied")]
    AccessDenied,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceAuthorizationStatus {
    Pending,
    Approved { user_id: Uuid },
    Denied,
}

/// Server-side record of one in-flight (or resolved) device authorization
/// request — what a `DeviceFlowHandler` implementation persists between
/// `start_device_authorization` and the polling/approval calls that follow
/// it.
#[derive(Debug, Clone, PartialEq)]
pub struct DeviceAuthorization {
    pub device_code: String,
    pub user_code: String,
    pub client_platform: ClientPlatform,
    pub status: DeviceAuthorizationStatus,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub last_polled_at: Option<DateTime<Utc>>,
    pub interval_seconds: i64,
    /// The `streamarr_model::Device::id` this authorization will become
    /// once approved. Minted up front (at `start_device_authorization`
    /// time) rather than on approval so `poll_token`'s success path has a
    /// stable id to upsert the `Device` row under -- the TV client never
    /// sees this value, only `device_code`/`user_code` correlate the flow.
    pub device_id: Uuid,
}

#[derive(Debug, thiserror::Error)]
pub enum DeviceFlowError {
    #[error("unknown or expired device/user code")]
    NotFound,
    #[error(transparent)]
    Db(#[from] streamarr_db::DbError),
}

/// Handler-shaped methods for the device authorization flow.
/// `streamarr-api` wraps these in the actual `POST /auth/device/code` and
/// `POST /auth/device/token` Axum routes; `approve_user_code` backs the
/// companion (non-RFC-8628, but required to complete the flow)
/// "enter this code" step served to a logged-in user on a full-input
/// device.
#[async_trait]
pub trait DeviceFlowHandler: Send + Sync {
    /// Starts a new device authorization request for `client_platform`,
    /// generating a fresh `device_code`/`user_code` pair.
    async fn start_device_authorization(
        &self,
        client_platform: ClientPlatform,
    ) -> Result<DeviceCodeResponse, DeviceFlowError>;

    /// One poll from the device. Returns `Ok(TokenResponse)` once a user
    /// has approved the corresponding `user_code`; otherwise a
    /// [`TokenError`] telling the client whether to keep polling, back
    /// off, or give up. Implementations must enforce `interval` themselves
    /// (return `SlowDown` for polls that arrive too soon) rather than
    /// trusting the client to honor it.
    async fn poll_token(&self, device_code: &str) -> Result<TokenResponse, TokenError>;

    /// A logged-in user, on a separate full-input device, submits the code
    /// displayed on the TV to approve (or the UI's reject action calls
    /// this with `Denied`... modeled as a separate concern — see
    /// `deny_user_code`) that device's pending authorization.
    async fn approve_user_code(
        &self,
        user_code: &str,
        user_id: Uuid,
    ) -> Result<(), DeviceFlowError>;

    async fn deny_user_code(&self, user_code: &str) -> Result<(), DeviceFlowError>;
}

/// Storage boundary for pending/resolved [`DeviceAuthorization`] records,
/// looked up by either `device_code` (the device polls with this) or
/// `user_code` (the approving human types/scans this). In-memory by
/// default (see [`InMemoryDeviceAuthorizationStore`]); a multi-node
/// deployment implements this against a shared store instead so a poll
/// landing on a different node than the approval still sees it.
#[async_trait]
pub trait DeviceAuthorizationStore: Send + Sync {
    async fn insert(&self, authorization: DeviceAuthorization);
    async fn get_by_device_code(&self, device_code: &str) -> Option<DeviceAuthorization>;
    async fn get_by_user_code(&self, user_code: &str) -> Option<DeviceAuthorization>;
    /// Replaces the stored record for `authorization.device_code` (status
    /// transitions, `last_polled_at`/`interval_seconds` updates).
    async fn update(&self, authorization: DeviceAuthorization);
    async fn remove(&self, device_code: &str);
}

/// The default [`DeviceAuthorizationStore`]: two in-process `DashMap`s (one
/// keyed by `device_code`, one a `user_code -> device_code` index).
///
/// TODO(cleanup): expired-but-never-polled-again records are only ever
/// removed when a poll or approval touches them; a real deployment should
/// pair this with a periodic sweep of `expires_at < now` entries so an
/// abandoned device-code request doesn't sit in memory forever. Left as a
/// follow-up since it's an eviction/ops concern orthogonal to the flow's
/// correctness.
#[derive(Default)]
pub struct InMemoryDeviceAuthorizationStore {
    by_device_code: DashMap<String, DeviceAuthorization>,
    by_user_code: DashMap<String, String>,
}

impl InMemoryDeviceAuthorizationStore {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl DeviceAuthorizationStore for InMemoryDeviceAuthorizationStore {
    async fn insert(&self, authorization: DeviceAuthorization) {
        self.by_user_code.insert(
            authorization.user_code.clone(),
            authorization.device_code.clone(),
        );
        self.by_device_code
            .insert(authorization.device_code.clone(), authorization);
    }

    async fn get_by_device_code(&self, device_code: &str) -> Option<DeviceAuthorization> {
        self.by_device_code
            .get(device_code)
            .map(|entry| entry.clone())
    }

    async fn get_by_user_code(&self, user_code: &str) -> Option<DeviceAuthorization> {
        let device_code = self.by_user_code.get(user_code)?.clone();
        self.by_device_code
            .get(&device_code)
            .map(|entry| entry.clone())
    }

    async fn update(&self, authorization: DeviceAuthorization) {
        self.by_device_code
            .insert(authorization.device_code.clone(), authorization);
    }

    async fn remove(&self, device_code: &str) {
        if let Some((_, authorization)) = self.by_device_code.remove(device_code) {
            self.by_user_code.remove(&authorization.user_code);
        }
    }
}

/// Tuning knobs for [`DashMapDeviceFlowHandler`].
#[derive(Debug, Clone)]
pub struct DeviceFlowConfig {
    /// How long a `device_code`/`user_code` pair stays valid before
    /// [`TokenError::ExpiredToken`]. RFC 8628 §3.2 recommends this be
    /// "sufficiently large" for a user to complete the out-of-band step;
    /// 10-15 minutes is typical.
    pub code_ttl: Duration,
    /// Minimum gap the device must leave between polls (RFC 8628 §3.5's
    /// `interval`). Enforced server-side, not just advertised.
    pub polling_interval: Duration,
    /// Base URL rendered as `verification_uri` / templated into
    /// `verification_uri_complete`.
    pub verification_base_uri: String,
    /// Absolute lifetime of the refresh-token family minted on a
    /// successful poll (see [`RefreshTokenService`]).
    pub refresh_ttl: Duration,
}

/// The real [`DeviceFlowHandler`]: pending-authorization state in a
/// [`DeviceAuthorizationStore`] (in-memory by default), token issuance
/// delegated to a shared [`RefreshTokenService`] (which is what actually
/// touches `streamarr_db::DeviceRepo` to persist the `Device` row once a
/// code is approved).
pub struct DashMapDeviceFlowHandler {
    store: Arc<dyn DeviceAuthorizationStore>,
    refresh: Arc<RefreshTokenService>,
    config: DeviceFlowConfig,
}

impl DashMapDeviceFlowHandler {
    pub fn new(
        store: Arc<dyn DeviceAuthorizationStore>,
        refresh: Arc<RefreshTokenService>,
        config: DeviceFlowConfig,
    ) -> Self {
        Self {
            store,
            refresh,
            config,
        }
    }
}

#[async_trait]
impl DeviceFlowHandler for DashMapDeviceFlowHandler {
    async fn start_device_authorization(
        &self,
        client_platform: ClientPlatform,
    ) -> Result<DeviceCodeResponse, DeviceFlowError> {
        let now = Utc::now();
        let device_code = crate::secret::opaque_token();

        // Astronomically unlikely to collide, but a short code drawn from
        // a 32-symbol alphabet is cheap enough to double-check against the
        // live store rather than just assume uniqueness.
        let mut user_code = crate::secret::user_code();
        while self.store.get_by_user_code(&user_code).await.is_some() {
            user_code = crate::secret::user_code();
        }

        let authorization = DeviceAuthorization {
            device_code: device_code.clone(),
            user_code: user_code.clone(),
            client_platform,
            status: DeviceAuthorizationStatus::Pending,
            created_at: now,
            expires_at: now + self.config.code_ttl,
            last_polled_at: None,
            interval_seconds: self.config.polling_interval.num_seconds(),
            device_id: Uuid::new_v4(),
        };
        self.store.insert(authorization).await;

        let verification_uri = self.config.verification_base_uri.clone();
        let verification_uri_complete = format!("{verification_uri}?user_code={user_code}");

        Ok(DeviceCodeResponse {
            device_code,
            user_code,
            verification_uri,
            verification_uri_complete,
            expires_in: self.config.code_ttl.num_seconds(),
            interval: self.config.polling_interval.num_seconds(),
        })
    }

    async fn poll_token(&self, device_code: &str) -> Result<TokenResponse, TokenError> {
        let mut authorization = self
            .store
            .get_by_device_code(device_code)
            .await
            // `TokenError` has no "unknown code" variant (its shape is
            // fixed to RFC 8628 §3.5's four error codes); an entirely
            // unrecognized device_code is reported the same way an
            // expired one is, since the client's correct next move is
            // identical either way -- stop polling, restart the flow.
            .ok_or(TokenError::ExpiredToken)?;

        let now = Utc::now();
        if now > authorization.expires_at {
            self.store.remove(device_code).await;
            return Err(TokenError::ExpiredToken);
        }

        if let Some(last_polled_at) = authorization.last_polled_at {
            let min_gap = Duration::seconds(authorization.interval_seconds);
            if now - last_polled_at < min_gap {
                // RFC 8628 §3.5: "the client MUST increase its polling
                // interval by 5 seconds for this and all subsequent
                // requests" whenever slow_down is returned.
                authorization.interval_seconds += 5;
                authorization.last_polled_at = Some(now);
                self.store.update(authorization).await;
                return Err(TokenError::SlowDown);
            }
        }
        authorization.last_polled_at = Some(now);

        match authorization.status {
            DeviceAuthorizationStatus::Pending => {
                self.store.update(authorization).await;
                Err(TokenError::AuthorizationPending)
            }
            DeviceAuthorizationStatus::Denied => {
                self.store.remove(device_code).await;
                Err(TokenError::AccessDenied)
            }
            DeviceAuthorizationStatus::Approved { user_id } => {
                self.store.remove(device_code).await;

                let device = Device {
                    id: authorization.device_id,
                    user_id,
                    name: format!("{:?} device", authorization.client_platform),
                    platform: authorization.client_platform,
                    client_version: "unknown".to_string(),
                    last_seen_at: Some(now),
                    trusted: true,
                };

                match self.refresh.issue(device, self.config.refresh_ttl).await {
                    Ok((_, token_response)) => Ok(token_response),
                    Err(err) => {
                        // Same closed-error-set problem as the "unknown
                        // code" branch above: `TokenError` has no slot for
                        // an internal-server-error. Log loudly and report
                        // the code as no longer viable rather than
                        // fabricating a misleading RFC 8628 error code.
                        tracing::error!(
                            error = %err,
                            device_code,
                            "device-flow token issuance failed after approval"
                        );
                        Err(TokenError::ExpiredToken)
                    }
                }
            }
        }
    }

    async fn approve_user_code(
        &self,
        user_code: &str,
        user_id: Uuid,
    ) -> Result<(), DeviceFlowError> {
        let mut authorization = self
            .store
            .get_by_user_code(user_code)
            .await
            .ok_or(DeviceFlowError::NotFound)?;

        if Utc::now() > authorization.expires_at {
            self.store.remove(&authorization.device_code).await;
            return Err(DeviceFlowError::NotFound);
        }

        authorization.status = DeviceAuthorizationStatus::Approved { user_id };
        self.store.update(authorization).await;
        Ok(())
    }

    async fn deny_user_code(&self, user_code: &str) -> Result<(), DeviceFlowError> {
        let mut authorization = self
            .store
            .get_by_user_code(user_code)
            .await
            .ok_or(DeviceFlowError::NotFound)?;

        authorization.status = DeviceAuthorizationStatus::Denied;
        self.store.update(authorization).await;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jwt::JwtIssuer;
    use crate::refresh::{InMemoryRefreshTokenStore, RefreshTokenStore};
    use crate::test_support::FakeDeviceRepo;
    use streamarr_db::DeviceRepo;

    fn handler_with_config(config: DeviceFlowConfig) -> DashMapDeviceFlowHandler {
        let jwt = Arc::new(JwtIssuer::new(
            b"test-secret-key-at-least-32-bytes!!",
            "streamarr",
            Duration::minutes(15),
        ));
        let devices: Arc<dyn DeviceRepo> = Arc::new(FakeDeviceRepo::default());
        let store: Arc<dyn RefreshTokenStore> = Arc::new(InMemoryRefreshTokenStore::new());
        let refresh = Arc::new(RefreshTokenService::new(store, devices, jwt));
        let auth_store: Arc<dyn DeviceAuthorizationStore> =
            Arc::new(InMemoryDeviceAuthorizationStore::new());
        DashMapDeviceFlowHandler::new(auth_store, refresh, config)
    }

    fn handler() -> DashMapDeviceFlowHandler {
        handler_with_config(DeviceFlowConfig {
            code_ttl: Duration::minutes(10),
            polling_interval: Duration::seconds(5),
            verification_base_uri: "https://streamarr.example/link".to_string(),
            refresh_ttl: Duration::days(30),
        })
    }

    #[tokio::test]
    async fn full_state_machine_issue_pending_approve_success() {
        // Zero polling interval so the test's own rapid back-to-back polls
        // don't trip `SlowDown` -- that behavior gets its own dedicated
        // test below with the default interval.
        let handler = handler_with_config(DeviceFlowConfig {
            code_ttl: Duration::minutes(10),
            polling_interval: Duration::zero(),
            verification_base_uri: "https://streamarr.example/link".to_string(),
            refresh_ttl: Duration::days(30),
        });
        let code = handler
            .start_device_authorization(ClientPlatform::TvWebos)
            .await
            .unwrap();
        assert!(!code.device_code.is_empty());
        assert!(code.user_code.contains('-'));
        assert!(code.verification_uri_complete.contains(&code.user_code));

        // Poll before approval -> still pending.
        let pending = handler.poll_token(&code.device_code).await;
        assert!(matches!(pending, Err(TokenError::AuthorizationPending)));

        let user_id = Uuid::new_v4();
        handler
            .approve_user_code(&code.user_code, user_id)
            .await
            .unwrap();

        let tokens = handler.poll_token(&code.device_code).await.unwrap();
        assert!(!tokens.access_token.is_empty());
        assert!(!tokens.refresh_token.is_empty());
        assert_eq!(tokens.token_type, "Bearer");

        // The device_code is single-use: it's gone once tokens are issued.
        let after = handler.poll_token(&code.device_code).await;
        assert!(matches!(after, Err(TokenError::ExpiredToken)));
    }

    #[tokio::test]
    async fn denied_code_reports_access_denied() {
        let handler = handler();
        let code = handler
            .start_device_authorization(ClientPlatform::AndroidTv)
            .await
            .unwrap();
        handler.deny_user_code(&code.user_code).await.unwrap();

        let result = handler.poll_token(&code.device_code).await;
        assert!(matches!(result, Err(TokenError::AccessDenied)));
    }

    #[tokio::test]
    async fn polling_too_quickly_returns_slow_down_and_backs_off_the_interval() {
        let handler = handler();
        let code = handler
            .start_device_authorization(ClientPlatform::TvTizen)
            .await
            .unwrap();

        let _ = handler.poll_token(&code.device_code).await; // sets last_polled_at
        let second = handler.poll_token(&code.device_code).await;
        assert!(matches!(second, Err(TokenError::SlowDown)));
    }

    #[tokio::test]
    async fn expired_code_reports_expired_token() {
        let handler = handler_with_config(DeviceFlowConfig {
            code_ttl: Duration::seconds(-1), // already expired at creation
            polling_interval: Duration::seconds(5),
            verification_base_uri: "https://streamarr.example/link".to_string(),
            refresh_ttl: Duration::days(30),
        });
        let code = handler
            .start_device_authorization(ClientPlatform::Web)
            .await
            .unwrap();

        let result = handler.poll_token(&code.device_code).await;
        assert!(matches!(result, Err(TokenError::ExpiredToken)));
    }

    #[tokio::test]
    async fn unknown_device_code_reports_expired_token() {
        let handler = handler();
        let result = handler.poll_token("does-not-exist").await;
        assert!(matches!(result, Err(TokenError::ExpiredToken)));
    }

    #[tokio::test]
    async fn approving_an_unknown_user_code_is_not_found() {
        let handler = handler();
        let result = handler.approve_user_code("ZZZZ-9999", Uuid::new_v4()).await;
        assert!(matches!(result, Err(DeviceFlowError::NotFound)));
    }
}
