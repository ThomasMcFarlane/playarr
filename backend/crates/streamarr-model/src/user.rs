//! Identity: [`User`], the [`Device`]s they've authenticated from, and the
//! [`Session`]s issued to those devices. Permission logic lives on
//! [`crate::Policy`], not here.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::platform::ClientPlatform;
use crate::sensitive::Sensitive;

// Note: intentionally *not* `ToSchema`, even under the `openapi` feature —
// this struct carries `password_hash`, a secret. Handlers that expose user
// data over HTTP should map to a separate, secret-free DTO rather than
// deriving a schema straight off the domain type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub email: Option<String>,
    /// Argon2/bcrypt hash, never the plaintext password. Wrapped so it can
    /// never accidentally end up in a log line via `{:?}`.
    pub password_hash: Sensitive<String>,
    pub policy_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub disabled: bool,
}

/// A distinct client install/browser this user has authenticated. Devices
/// outlive individual [`Session`]s (a device can hold many sessions over
/// time as tokens are refreshed/expire) and are what `Policy::device_allow`
/// and `Policy::max_concurrent_sessions` reason about.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Device {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub platform: ClientPlatform,
    pub client_version: String,
    pub last_seen_at: Option<DateTime<Utc>>,
    /// Set once the RFC 8628 device-authorization flow (or an equivalent
    /// first-party login) has completed for this device; untrusted devices
    /// may be subject to tighter policy in `streamarr-auth`.
    pub trusted: bool,
}

// Same rationale as `User`: carries `refresh_token`, not schema-derived.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub id: Uuid,
    pub user_id: Uuid,
    pub device_id: Uuid,
    pub issued_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub refresh_token: Sensitive<String>,
    pub revoked: bool,
}
