//! RFC 8628 (OAuth 2.0 Device Authorization Grant) types and handler
//! shapes, for limited-input clients (`tv-webos`/`tv-tizen`/`tv-vidaa`/
//! `android-tv`) that can't reasonably host a password/OAuth-redirect
//! login flow: the TV displays a `user_code` and a URL, the user completes
//! login on a phone/laptop, and the TV polls until it receives a token.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use streamarr_model::ClientPlatform;
use uuid::Uuid;

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
