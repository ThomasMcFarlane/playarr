//! Identity: [`User`], the [`Device`]s they've authenticated from, and the
//! [`Session`]s issued to those devices. Permission logic lives on
//! [`crate::Policy`], not here.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::platform::ClientPlatform;
use crate::sensitive::Sensitive;

pub const DEFAULT_PREFERRED_AUDIO_LANGUAGE: &str = "en";

fn default_preferred_audio_language() -> String {
    DEFAULT_PREFERRED_AUDIO_LANGUAGE.to_string()
}

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
    /// BCP 47-style language preference used to select a player's initial
    /// audio track. Existing and newly-created users default to English.
    #[serde(default = "default_preferred_audio_language")]
    pub preferred_audio_language: String,
}

/// One administrator-issued, time-limited invitation to create a Playarr
/// account. Only the digest of the bearer token is persisted; the raw token
/// is returned once to the administrator and carried in the invite link.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UserInvite {
    pub token_hash: String,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum UserInviteRequestStatus {
    Pending,
    Approved,
    Denied,
    Generated,
}

/// A user's request for permission to generate one friend invitation. The
/// approval itself does not expire and carries no bearer secret; the final
/// 24-hour [`UserInvite`] is created only when the requester uses it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UserInviteRequest {
    pub id: Uuid,
    pub user_id: Uuid,
    pub status: UserInviteRequestStatus,
    pub requested_at: DateTime<Utc>,
    pub reviewed_by: Option<Uuid>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub generated_at: Option<DateTime<Utc>>,
}

/// A signed-in viewer's remembered choices for one concrete media file.
/// Track ids are the stable source ids exposed by playback negotiation
/// (`source-audio-*` / `source-subtitle-*`); `None` means automatic audio
/// selection or subtitles off.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct MediaPlaybackPreferences {
    pub media_file_id: Uuid,
    pub quality_id: String,
    pub audio_track_id: Option<String>,
    pub subtitle_track_id: Option<String>,
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

/// Server-side bookkeeping for one device's current refresh-token family
/// -- see `streamarr_auth::refresh`'s module doc comment for the full
/// rotation/reuse-detection design this backs. Lives here (not in
/// `streamarr-auth`, which owns the rotation *logic*) so `streamarr-db`
/// can implement a real repository for it (`RefreshTokenRepo`) without
/// `streamarr-db` depending on `streamarr-auth` -- the same reason every
/// other persisted domain type lives in this crate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RefreshTokenRecord {
    pub device_id: Uuid,
    pub user_id: Uuid,
    /// Stable across rotations -- the same login "session" as far as
    /// `AccessTokenClaims::session_id` / `Policy::max_concurrent_sessions`
    /// are concerned, even though the underlying secret changes.
    pub session_id: Uuid,
    /// Identifies the family a token belongs to; a brand-new family is
    /// started on every fresh issuance.
    pub family_id: Uuid,
    /// Incremented on every successful rotation; 0 at issuance.
    pub generation: u64,
    pub current_hash: String,
    /// Every hash this family has ever had as its `current_hash`,
    /// including the current one -- checked on reuse so a token from *any*
    /// earlier generation (not just the immediately-prior one) is caught.
    pub used_hashes: std::collections::HashSet<String>,
    pub issued_at: DateTime<Utc>,
    /// Fixed at issuance (not extended by rotation) -- a deliberately
    /// simple, secure-by-default choice: the device must complete a full
    /// login again after this point no matter how often it refreshes.
    pub expires_at: DateTime<Utc>,
    pub rotated_at: Option<DateTime<Utc>>,
    pub revoked: bool,
}
