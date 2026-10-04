//! Admin user management -- `POST`/`GET`/`PATCH`/`DELETE
//! /api/v1/admin/users[/{id}]`. Closes the persistence gap
//! `playarr_auth::login::InMemoryUserDirectory`'s own doc comment calls
//! out: real Argon2 password hashing (`playarr_auth::login::hash_password`)
//! and `AuthMode::FullAccount` login already existed, but there was no
//! durable place to store an account and no way to create one -- login
//! depended entirely on `AuthMode::TrustedNetwork`'s source-IP trust. This
//! is the missing "way": real username/password accounts backed by
//! `playarr_db::UserRepo`/`PolicyRepo`, so login stops depending on
//! network-position trust entirely.
//!
//! Every handler here is `AdminUser`-gated, exactly like `admin.rs`'s
//! source-instance handlers -- there is no self-service account creation
//! yet, only admin-provisioned accounts.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{DateTime, Duration, Utc};
use playarr_auth::PasswordVerifier;
use playarr_model::{
    Policy, ProfileAvatarKind, ProfileAvatarPreference, Sensitive, User, UserInvite,
    UserInviteRequest, UserInviteRequestStatus,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth_extractor::{AdminUser, AnytimeStreamingUser, AuthUser};
use crate::error::ApiError;
use crate::AppState;

/// Request body for provisioning a new account. `password` is write-only
/// -- it is hashed via `playarr_auth::login::hash_password` immediately
/// and never echoed back in [`UserResponse`].
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateUserRequest {
    pub username: String,
    pub display_name: String,
    #[serde(default)]
    pub email: Option<String>,
    pub password: String,
    #[serde(default)]
    pub is_admin: bool,
    /// Grants Playarr streaming access -- see `playarr_model::Policy::
    /// can_stream`'s doc comment. Independent of `is_admin`; defaults to
    /// `false` (least privilege), same as every other grant this handler
    /// starts a new account with.
    #[serde(default)]
    pub can_stream: bool,
    /// Source-instance ids ("libraries") this account may browse/stream --
    /// see `playarr_model::Policy::library_allow`'s doc comment. Defaults
    /// to empty (no grants yet, deny-all -- not all-allow), same
    /// least-privilege-by-default philosophy as `is_admin`/`can_stream`
    /// above: an admin still has to explicitly grant library access after
    /// creating the account.
    #[serde(default)]
    pub library_allow: Vec<Uuid>,
    /// Grants permission to create/fetch downloads of media this account
    /// can already stream -- see `playarr_model::Policy::can_download`'s
    /// doc comment. Defaults to `false` (least privilege), same philosophy
    /// as `can_stream`/`library_allow` above: an admin has to explicitly
    /// grant download access, it is never on by default.
    #[serde(default)]
    pub can_download: bool,
    /// Grants permission to request titles that are not in the library --
    /// see `playarr_model::Policy::can_request`'s doc comment. Defaults to
    /// `false` (least privilege).
    #[serde(default)]
    pub can_request: bool,
}

/// Public account-creation body. The bearer invitation is write-only and
/// grants exactly one ordinary Playarr account with the access chosen by the
/// administrator who issued or approved it.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SignupRequest {
    pub invite_token: String,
    pub username: String,
    pub display_name: String,
    #[serde(default)]
    pub email: Option<String>,
    pub password: String,
}

/// The raw invite token is returned only when it is issued. Persistence
/// stores its digest, so this response is the administrator's sole chance to
/// put the bearer token into the QR link.
#[derive(Debug, Serialize, ToSchema)]
pub struct UserInviteResponse {
    pub invite_token: String,
    pub expires_at: DateTime<Utc>,
}

fn default_invite_can_stream() -> bool {
    true
}

/// Access attached to a direct administrator-issued invitation.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateUserInvite {
    #[serde(default = "default_invite_can_stream")]
    pub can_stream: bool,
    #[serde(default)]
    pub library_allow: Vec<Uuid>,
    /// Exact expiry chosen by the administrator. Omitting it preserves the
    /// existing 24-hour lifetime.
    #[serde(default)]
    pub expires_at: Option<DateTime<Utc>>,
}

/// Optional context supplied by the Playarr user requesting an invitation.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateUserInviteRequest {
    #[serde(default)]
    pub message: Option<String>,
}

/// One Playarr user's request for permission to invite a friend. User
/// identity is included so the admin console can review the queue without
/// making a second request per row.
#[derive(Debug, Serialize, ToSchema)]
pub struct UserInviteRequestResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub message: Option<String>,
    pub status: UserInviteRequestStatus,
    pub requested_at: DateTime<Utc>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub generated_at: Option<DateTime<Utc>>,
    pub can_stream: bool,
    pub library_allow: Vec<Uuid>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ReviewUserInviteRequest {
    /// `true` grants exactly one generation; `false` denies this request.
    pub approved: bool,
    #[serde(default = "default_invite_can_stream")]
    pub can_stream: bool,
    #[serde(default)]
    pub library_allow: Vec<Uuid>,
}

const USER_INVITE_TTL: Duration = Duration::hours(24);

async fn invite_request_response(
    state: &AppState,
    request: UserInviteRequest,
) -> Result<UserInviteRequestResponse, ApiError> {
    let user = state
        .user_repo
        .find_by_id(request.user_id)
        .await
        .map_err(|err| ApiError::internal(format!("failed to resolve invite requester: {err}")))?
        .ok_or_else(|| ApiError::not_found("invite requester no longer exists"))?;
    Ok(UserInviteRequestResponse {
        id: request.id,
        user_id: request.user_id,
        username: user.username,
        display_name: user.display_name,
        message: request.message,
        status: request.status,
        requested_at: request.requested_at,
        reviewed_at: request.reviewed_at,
        generated_at: request.generated_at,
        can_stream: request.can_stream,
        library_allow: request.library_allow,
    })
}

fn normalise_invite_message(message: Option<String>) -> Result<Option<String>, ApiError> {
    let Some(message) = message else {
        return Ok(None);
    };
    let message = message.trim();
    if message.is_empty() {
        return Ok(None);
    }
    if message.chars().count() > 500 {
        return Err(ApiError::bad_request(
            "invite request message must be 500 characters or fewer",
        ));
    }
    Ok(Some(message.to_string()))
}

/// All-optional patch body -- only fields set to `Some` are applied.
/// `password`, when set, is re-hashed the same way [`CreateUserRequest`]'s
/// is; `is_admin`, when set, updates the user's [`Policy`] rather than the
/// `User` row itself (`is_admin` lives on `Policy`, not `User`).
#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateUserRequest {
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub is_admin: Option<bool>,
    #[serde(default)]
    pub can_stream: Option<bool>,
    #[serde(default)]
    pub disabled: Option<bool>,
    /// `Some(ids)` replaces the account's entire `Policy::library_allow`
    /// with `ids`; `None` (the field omitted from the request body) leaves
    /// it untouched -- same all-optional-patch shape as every other field
    /// here. See [`update_user_handler`]'s doc comment for how this is
    /// folded into the same single conditional policy re-persist
    /// `is_admin`/`can_stream` already use.
    #[serde(default)]
    pub library_allow: Option<Vec<Uuid>>,
    /// `Some(bool)` replaces the account's `Policy::can_download`; `None`
    /// (the field omitted) leaves it untouched -- same all-optional-patch
    /// shape as every other field here.
    #[serde(default)]
    pub can_download: Option<bool>,
    /// `Some(bool)` replaces the account's `Policy::can_request`; `None`
    /// leaves it untouched.
    #[serde(default)]
    pub can_request: Option<bool>,
}

/// The redacted, admin-facing projection of [`playarr_model::User`] --
/// same rationale as `admin.rs`'s `SourceInstanceResponse`: `User` itself
/// is deliberately not `ToSchema` (it carries `password_hash`), so
/// handlers map to this secret-free DTO instead. `is_admin` is pulled in
/// from the user's `Policy` (see [`UserResponse::from_user`])
/// since it isn't a field on `User` at all.
#[derive(Debug, Serialize, ToSchema)]
pub struct UserResponse {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub email: Option<String>,
    pub is_admin: bool,
    /// Whether this account is permitted to sign in to Playarr -- see
    /// `playarr_model::Policy::can_stream`'s doc comment. Independent of
    /// `is_admin`.
    pub can_stream: bool,
    /// Source-instance ids ("libraries") this account may browse/stream --
    /// see `playarr_model::Policy::library_allow`'s doc comment. Empty
    /// means no grants (deny-all), not all-allow; irrelevant (but still
    /// truthfully reported) for an `is_admin` account, since `is_admin`
    /// bypasses this check entirely at enforcement time.
    pub library_allow: Vec<Uuid>,
    /// Whether this account may create/fetch downloads -- see
    /// `playarr_model::Policy::can_download`'s doc comment. Independent
    /// of `can_stream`/`library_allow`; defaults to `false` for a newly
    /// created account.
    pub can_download: bool,
    /// Whether this account may request titles that are not in the
    /// library -- see `playarr_model::Policy::can_request`'s doc comment.
    pub can_request: bool,
    pub disabled: bool,
    pub created_at: DateTime<Utc>,
    pub preferred_audio_language: String,
}

impl UserResponse {
    /// `is_admin`/`can_stream`/`library_allow`/`can_download` are threaded
    /// in separately (rather than this taking a `Policy`) so callers that
    /// already handled a missing `Policy` (a data-integrity gap, not a
    /// caller error -- see [`list_users_handler`]) can just pass
    /// `false`/`false`/`Vec::new()`/`false` without constructing a
    /// placeholder `Policy`.
    fn from_user(
        user: User,
        is_admin: bool,
        can_stream: bool,
        library_allow: Vec<Uuid>,
        can_download: bool,
        can_request: bool,
    ) -> Self {
        Self {
            id: user.id,
            username: user.username,
            display_name: user.display_name,
            email: user.email,
            is_admin,
            can_stream,
            library_allow,
            can_download,
            can_request,
            disabled: user.disabled,
            created_at: user.created_at,
            preferred_audio_language: user.preferred_audio_language,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PlayerPreferencesResponse {
    pub preferred_audio_language: String,
}

/// The signed-in Playarr user's own capability grants -- the client-side
/// counterpart to `ensure_can_download`'s server-side enforcement. A
/// capability being enforced server-side is not the same as it being
/// visibly gated in the UI: without this, a client has no way to know
/// whether to show a "Download" button/nav item at all, only whether the
/// resulting API call will succeed once clicked. Deliberately just the
/// capability booleans a Playarr client actually needs to gate its own UI
/// on -- not `library_allow`/`is_admin`/`max_rating`, which are either
/// already enforced per-request server-side (so the client never needs to
/// duplicate that check) or not relevant to what Playarr's own chrome
/// renders.
#[derive(Debug, Serialize, ToSchema)]
pub struct SelfCapabilitiesResponse {
    pub can_download: bool,
    /// Whether this account may request titles that are not in the library
    /// (administrators always may; `PLAYARR_REQUESTS_ALLOW_ALL_USERS`
    /// overrides for everyone).
    pub can_request: bool,
}

#[utoipa::path(
    get,
    path = "/api/v1/users/me/capabilities",
    tag = "users",
    responses(
        (status = 200, description = "The signed-in user's own capability grants", body = SelfCapabilitiesResponse, example = json!({
            "can_download": true,
            "can_request": false
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller does not have Playarr streaming access")
    )
)]
pub async fn get_self_capabilities_handler(
    State(state): State<AppState>,
    streaming: AnytimeStreamingUser,
) -> Json<SelfCapabilitiesResponse> {
    Json(SelfCapabilitiesResponse {
        can_download: streaming.policy.can_download,
        can_request: streaming.policy.is_admin
            || streaming.policy.can_request
            || state.discovery_requests_allow_all_users,
    })
}

/// Minimal household-profile projection for Playarr's 'who is watching'
/// screen. Password hashes, email addresses and policy details are never
/// exposed.
///
/// Only ever lists *sibling* profiles -- accounts that share the operator's
/// single-household trust boundary. See
/// [`list_available_profiles_handler`]'s doc comment for what "sibling"
/// means per `AuthMode` and why this must never include a stranger's
/// account.
#[derive(Debug, Serialize, ToSchema)]
pub struct AvailableProfileResponse {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub is_current: bool,
    pub pin_locked: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ProfilePinSettingResponse {
    pub pin_locked: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ProfileAvatarSettingResponse {
    /// `null` means this profile has not chosen an avatar yet; clients may
    /// render their deterministic built-in default.
    pub preference: Option<ProfileAvatarPreference>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateProfileAvatarRequest {
    pub preference: ProfileAvatarPreference,
}

#[derive(Debug, ToSchema)]
pub struct UpdateProfilePinRequest {
    /// Exactly four ASCII decimal digits. `null` removes the profile lock.
    #[schema(required = true, nullable = true)]
    pub pin: Option<String>,
}

impl<'de> Deserialize<'de> for UpdateProfilePinRequest {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct RequiredPinField {
            pin: serde_json::Value,
        }

        let body = RequiredPinField::deserialize(deserializer)?;
        let pin = match body.pin {
            serde_json::Value::Null => None,
            serde_json::Value::String(pin) => Some(pin),
            _ => {
                return Err(<D::Error as serde::de::Error>::custom(
                    "pin must be a string or null",
                ))
            }
        };
        Ok(Self { pin })
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct VerifyProfilePinRequest {
    pub pin: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct VerifyProfilePinResponse {
    pub verified: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdatePlayerPreferencesRequest {
    pub preferred_audio_language: String,
}

fn normalize_audio_language(language: &str) -> Result<String, ApiError> {
    let language = language.trim();
    if language.is_empty()
        || language.len() > 35
        || !language
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(ApiError::bad_request(
            "preferred_audio_language must be a non-empty BCP 47-style language tag",
        ));
    }
    Ok(language.to_ascii_lowercase())
}

fn validate_profile_pin(pin: &str) -> Result<(), ApiError> {
    if pin.len() != 4 || !pin.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(ApiError::bad_request(
            "pin must contain exactly four ASCII decimal digits",
        ));
    }
    Ok(())
}

const PROFILE_AVATAR_PRESETS: [&str; 6] =
    ["astronaut", "cat", "dinosaur", "robot", "pirate", "alien"];
const MAX_PROFILE_AVATAR_DATA_URL_BYTES: usize = 1024 * 1024;

fn validate_profile_avatar(preference: &ProfileAvatarPreference) -> Result<(), ApiError> {
    match preference.kind {
        ProfileAvatarKind::Preset => {
            if !PROFILE_AVATAR_PRESETS.contains(&preference.value.as_str()) {
                return Err(ApiError::bad_request("unknown profile avatar preset"));
            }
        }
        ProfileAvatarKind::Custom => {
            let Some(payload) = preference.value.strip_prefix("data:image/jpeg;base64,") else {
                return Err(ApiError::bad_request(
                    "custom profile avatar must be a JPEG data URL",
                ));
            };
            if preference.value.len() > MAX_PROFILE_AVATAR_DATA_URL_BYTES
                || payload.is_empty()
                || payload.len() % 4 != 0
                || !payload
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
            {
                return Err(ApiError::bad_request(
                    "custom profile avatar is not valid resized JPEG data",
                ));
            }
        }
    }
    Ok(())
}

fn invalid_pin() -> ApiError {
    ApiError::new(
        StatusCode::UNAUTHORIZED,
        "invalid_pin",
        "invalid profile PIN",
    )
}

/// A sensible, permissive-but-not-dangerous default `Policy` for a newly
/// provisioned user: can stream and transcode, can't delete library
/// content or share publicly, `library_allow`/`group_library_allow` set
/// from the caller's request (empty by default -- an admin still has to
/// grant access explicitly, "no access" not "all access"), no
/// device/session/schedule restrictions. `can_download` follows the same
/// least-privilege-by-default philosophy as `can_stream`/`library_allow`:
/// set from the caller's request, `false` unless explicitly granted --
/// being able to stream a library does not imply being allowed to copy it
/// off the server.
#[allow(clippy::too_many_arguments)]
fn default_policy(
    id: Uuid,
    username: &str,
    is_admin: bool,
    can_stream: bool,
    can_download: bool,
    can_request: bool,
    library_allow: Vec<Uuid>,
    group_library_allow: Vec<Uuid>,
) -> Policy {
    Policy {
        id,
        name: format!("{username}'s policy"),
        library_allow,
        group_library_allow,
        blocked_folders: Vec::new(),
        max_rating: None,
        blocked_tags: Vec::new(),
        allowed_tags: Vec::new(),
        can_transcode: true,
        can_download,
        can_delete: false,
        can_share_public: false,
        can_request,
        device_allow: Vec::new(),
        max_concurrent_sessions: None,
        household: Default::default(),
        access_schedule: None,
        can_stream,
        is_admin,
    }
}

async fn ensure_username_available(state: &AppState, username: &str) -> Result<(), ApiError> {
    let existing = state
        .user_repo
        .find_by_username(username)
        .await
        .map_err(|err| {
            ApiError::internal(format!(
                "failed to look up existing username {username}: {err}"
            ))
        })?;
    if existing.is_some() {
        return Err(ApiError::conflict(format!(
            "username {username} is already taken"
        )));
    }
    Ok(())
}

async fn persist_new_user(
    state: &AppState,
    user_id: Uuid,
    body: CreateUserRequest,
    group_library_allow: Vec<Uuid>,
) -> Result<UserResponse, ApiError> {
    let policy = default_policy(
        Uuid::new_v4(),
        &body.username,
        body.is_admin,
        body.can_stream,
        body.can_download,
        body.can_request,
        body.library_allow,
        group_library_allow,
    );
    let user = User {
        id: user_id,
        username: body.username,
        display_name: body.display_name,
        email: body.email,
        password_hash: Sensitive::new(playarr_auth::login::hash_password(&body.password)),
        policy_id: policy.id,
        created_at: Utc::now(),
        disabled: false,
        preferred_audio_language: playarr_model::DEFAULT_PREFERRED_AUDIO_LANGUAGE.to_string(),
    };

    // Policy first so `user.policy_id`'s FK is satisfiable the moment the
    // user row lands.
    state.policy_repo.upsert(&policy).await.map_err(|err| {
        ApiError::internal(format!(
            "failed to persist policy for new user {}: {err}",
            user.username
        ))
    })?;
    state.user_repo.upsert(&user).await.map_err(|err| {
        ApiError::internal(format!(
            "failed to persist new user {}: {err}",
            user.username
        ))
    })?;

    // Every locally-created account defaults `origin_peer_id` to this
    // node's own identity -- see docs/architecture/peer-groups.md §2.2's
    // scope note. Deliberately best-effort: the user and policy rows above
    // are already durably persisted by this point, so a hiccup here
    // (`ensure_node_identity` is already called once at boot in
    // `backend/src/main.rs`, so this is normally a no-op read) must not
    // turn an account that was actually created into a reported failure --
    // it just leaves `origin_peer_id` `NULL`, the same value every
    // pre-existing row already has.
    match crate::admin_peer::ensure_node_identity(&state.node_identity_repo).await {
        Ok(identity) => {
            if let Err(err) = state
                .policy_repo
                .set_origin_peer_id_if_unset(policy.id, identity.peer_id)
                .await
            {
                tracing::warn!(policy_id = %policy.id, %err, "failed to default origin_peer_id for new policy");
            }
            if let Err(err) = state
                .user_repo
                .set_origin_peer_id_if_unset(user.id, identity.peer_id)
                .await
            {
                tracing::warn!(user_id = %user.id, %err, "failed to default origin_peer_id for new user");
            }
        }
        Err(err) => {
            tracing::warn!(
                ?err,
                "failed to load node identity; new user/policy rows keep a NULL origin_peer_id"
            );
        }
    }

    tracing::info!(user_id = %user.id, username = %user.username, is_admin = policy.is_admin, can_stream = policy.can_stream, "created user account");

    Ok(UserResponse::from_user(
        user,
        policy.is_admin,
        policy.can_stream,
        policy.library_allow,
        policy.can_download,
        policy.can_request,
    ))
}

/// Provisions a new account: hashes the password, creates a default
/// [`Policy`] for it (see [`default_policy`]), and persists the policy
/// *before* the user -- same write-ordering rationale as `admin.rs`'s
/// create handler (the durable dependency first), except here it's an
/// actual foreign key: `User::policy_id` must resolve.
#[utoipa::path(
    post,
    path = "/api/v1/admin/users",
    tag = "users",
    request_body(content = CreateUserRequest, example = json!({
        "username": "alice",
        "display_name": "Alice Nguyen",
        "email": "alice@example.com",
        "password": "correct horse battery staple",
        "is_admin": false,
        "can_stream": true,
        "library_allow": ["11111111-1111-4111-8111-111111111111"]
    })),
    responses(
        (status = 200, description = "Account created", body = UserResponse, example = json!({
            "id": "22222222-2222-4222-8222-222222222222",
            "username": "alice",
            "display_name": "Alice Nguyen",
            "email": "alice@example.com",
            "is_admin": false,
            "can_stream": true,
            "library_allow": ["11111111-1111-4111-8111-111111111111"],
            "disabled": false,
            "created_at": "2026-07-20T12:00:00Z",
            "preferred_audio_language": "en"
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 409, description = "Username is already taken")
    )
)]
pub async fn create_user_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<CreateUserRequest>,
) -> Result<Json<UserResponse>, ApiError> {
    ensure_username_available(&state, &body.username).await?;
    // No direct group-library grant surface exists for admin-created
    // accounts -- only invite redemption populates `group_library_allow`
    // (`docs/architecture/peer-groups.md` §2.5/§6.2; see `signup_handler`).
    Ok(Json(
        persist_new_user(&state, Uuid::new_v4(), body, Vec::new()).await?,
    ))
}

/// Issues a one-use bearer invitation. It lasts 24 hours unless the
/// administrator supplies a future `expires_at`. The administrator console
/// combines the token with its externally visible server origin when it builds
/// the `playarr.app/signup` QR link.
#[utoipa::path(
    post,
    path = "/api/v1/admin/user-invites",
    tag = "users",
    request_body(content = CreateUserInvite, example = json!({
        "can_stream": true,
        "library_allow": ["11111111-1111-4111-8111-111111111111"],
        "expires_at": "2026-07-28T12:00:00Z"
    })),
    responses(
        (status = 200, description = "Account invitation issued", body = UserInviteResponse, example = json!({
            "invite_token": "5f8a1c2e9b3d4f6a8c1e2b3d4f6a8c1e",
            "expires_at": "2026-07-21T12:00:00Z"
        })),
        (status = 400, description = "Expiry is not in the future"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn create_user_invite_handler(
    State(state): State<AppState>,
    admin: AdminUser,
    Json(body): Json<CreateUserInvite>,
) -> Result<Json<UserInviteResponse>, ApiError> {
    let invite_token = playarr_auth::secret::opaque_token();
    let now = Utc::now();
    let expires_at = body.expires_at.unwrap_or(now + USER_INVITE_TTL);
    if expires_at <= now {
        return Err(ApiError::bad_request(
            "invitation expiry must be in the future",
        ));
    }
    // Same admin-selected grant set that populates `library_allow`, mapped
    // through any granted `SourceInstance`'s `group_library_id` -- see
    // `docs/architecture/peer-groups.md` §2.5/§6.2.
    let group_library_allow = state
        .source_instances
        .group_library_ids_for_source_instances(&body.library_allow);
    state
        .user_invite_repo
        .create(&UserInvite {
            token_hash: playarr_auth::secret::hash_token(&invite_token),
            created_by: admin.user_id,
            created_at: now,
            expires_at,
            can_stream: body.can_stream,
            library_allow: body.library_allow,
            group_library_allow,
            consumed_at: None,
            consumed_by_user_id: None,
            consumed_by_peer_id: None,
        })
        .await
        .map_err(|err| ApiError::internal(format!("failed to persist user invitation: {err}")))?;

    tracing::info!(created_by = %admin.user_id, %expires_at, "created user invitation");
    Ok(Json(UserInviteResponse {
        invite_token,
        expires_at,
    }))
}

/// Opens (or returns) the signed-in user's current invitation request. A
/// pending or approved request remains the one active request; denied and
/// generated requests may be followed by a new request.
#[utoipa::path(
    post,
    path = "/api/v1/users/me/user-invite-request",
    tag = "users",
    request_body(content = CreateUserInviteRequest, example = json!({
        "message": "Can I invite my roommate?"
    })),
    responses(
        (status = 200, description = "Current invitation request", body = UserInviteRequestResponse, example = json!({
            "id": "33333333-3333-4333-8333-333333333333",
            "user_id": "22222222-2222-4222-8222-222222222222",
            "username": "alice",
            "display_name": "Alice Nguyen",
            "message": "Can I invite my roommate?",
            "status": "pending",
            "requested_at": "2026-07-20T12:00:00Z",
            "reviewed_at": null,
            "generated_at": null,
            "can_stream": true,
            "library_allow": []
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Account cannot use Playarr")
    )
)]
pub async fn create_user_invite_request_handler(
    State(state): State<AppState>,
    streaming: AnytimeStreamingUser,
    Json(body): Json<CreateUserInviteRequest>,
) -> Result<Json<UserInviteRequestResponse>, ApiError> {
    if let Some(existing) = state
        .user_invite_request_repo
        .find_latest_for_user(streaming.user_id)
        .await
        .map_err(|err| ApiError::internal(format!("failed to read invitation request: {err}")))?
    {
        if matches!(
            existing.status,
            UserInviteRequestStatus::Pending | UserInviteRequestStatus::Approved
        ) {
            return Ok(Json(invite_request_response(&state, existing).await?));
        }
    }

    let request = UserInviteRequest {
        id: Uuid::new_v4(),
        user_id: streaming.user_id,
        message: normalise_invite_message(body.message)?,
        status: UserInviteRequestStatus::Pending,
        requested_at: Utc::now(),
        reviewed_by: None,
        reviewed_at: None,
        generated_at: None,
        can_stream: true,
        library_allow: Vec::new(),
        // Nothing chosen yet -- an admin hasn't reviewed this request, so
        // there's nothing to map through `SourceInstance.group_library_id`
        // (see `review_user_invite_request_handler`, where this is
        // actually populated).
        group_library_allow: Vec::new(),
    };
    state
        .user_invite_request_repo
        .create(&request)
        .await
        .map_err(|err| ApiError::internal(format!("failed to create invitation request: {err}")))?;
    tracing::info!(request_id = %request.id, user_id = %request.user_id, "requested friend invitation");
    Ok(Json(invite_request_response(&state, request).await?))
}

/// Returns the signed-in user's most recent request, or `null` before they
/// have requested permission.
#[utoipa::path(
    get,
    path = "/api/v1/users/me/user-invite-request",
    tag = "users",
    responses(
        (status = 200, description = "Latest invitation request, if any", body = Option<UserInviteRequestResponse>, example = json!({
            "id": "33333333-3333-4333-8333-333333333333",
            "user_id": "22222222-2222-4222-8222-222222222222",
            "username": "alice",
            "display_name": "Alice Nguyen",
            "message": "Can I invite my roommate?",
            "status": "approved",
            "requested_at": "2026-07-20T12:00:00Z",
            "reviewed_at": "2026-07-20T13:00:00Z",
            "generated_at": null,
            "can_stream": true,
            "library_allow": ["11111111-1111-4111-8111-111111111111"]
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Account cannot use Playarr")
    )
)]
pub async fn get_my_user_invite_request_handler(
    State(state): State<AppState>,
    streaming: AnytimeStreamingUser,
) -> Result<Json<Option<UserInviteRequestResponse>>, ApiError> {
    let request = state
        .user_invite_request_repo
        .find_latest_for_user(streaming.user_id)
        .await
        .map_err(|err| ApiError::internal(format!("failed to read invitation request: {err}")))?;
    let response = match request {
        Some(request) => Some(invite_request_response(&state, request).await?),
        None => None,
    };
    Ok(Json(response))
}

/// Consumes one approval and creates the final one-use invitation. Its
/// 24-hour lifetime begins here, not when the administrator approved it.
#[utoipa::path(
    post,
    path = "/api/v1/users/me/user-invite-request/generate",
    tag = "users",
    responses(
        (status = 200, description = "Friend invitation generated", body = UserInviteResponse, example = json!({
            "invite_token": "9c1e2b3d4f6a8c1e2b3d4f6a8c1e2b3d",
            "expires_at": "2026-07-21T13:00:00Z"
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Account cannot use Playarr"),
        (status = 409, description = "No unused approval is available")
    )
)]
pub async fn generate_user_invite_handler(
    State(state): State<AppState>,
    streaming: AnytimeStreamingUser,
) -> Result<Json<UserInviteResponse>, ApiError> {
    let request = state
        .user_invite_request_repo
        .find_latest_for_user(streaming.user_id)
        .await
        .map_err(|err| ApiError::internal(format!("failed to read invitation request: {err}")))?
        .filter(|request| request.status == UserInviteRequestStatus::Approved)
        .ok_or_else(|| ApiError::conflict("no unused invitation approval is available"))?;

    let invite_token = playarr_auth::secret::opaque_token();
    let now = Utc::now();
    let expires_at = now + USER_INVITE_TTL;
    let generated = state
        .user_invite_request_repo
        .generate_invite(
            request.id,
            streaming.user_id,
            now,
            &UserInvite {
                token_hash: playarr_auth::secret::hash_token(&invite_token),
                created_by: streaming.user_id,
                created_at: now,
                expires_at,
                can_stream: request.can_stream,
                library_allow: request.library_allow.clone(),
                group_library_allow: request.group_library_allow.clone(),
                consumed_at: None,
                consumed_by_user_id: None,
                consumed_by_peer_id: None,
            },
        )
        .await
        .map_err(|err| {
            ApiError::internal(format!("failed to generate friend invitation: {err}"))
        })?;
    if !generated {
        return Err(ApiError::conflict(
            "this invitation approval has already been used",
        ));
    }
    tracing::info!(request_id = %request.id, user_id = %streaming.user_id, %expires_at, "generated approved friend invitation");
    Ok(Json(UserInviteResponse {
        invite_token,
        expires_at,
    }))
}

/// Lists every invitation request for the Playarr Server admin console, newest
/// first.
#[utoipa::path(
    get,
    path = "/api/v1/admin/user-invite-requests",
    tag = "users",
    responses(
        (status = 200, description = "Invitation requests", body = Vec<UserInviteRequestResponse>, example = json!([
            {
                "id": "33333333-3333-4333-8333-333333333333",
                "user_id": "22222222-2222-4222-8222-222222222222",
                "username": "alice",
                "display_name": "Alice Nguyen",
                "message": "Can I invite my roommate?",
                "status": "pending",
                "requested_at": "2026-07-20T12:00:00Z",
                "reviewed_at": null,
                "generated_at": null,
                "can_stream": true,
                "library_allow": []
            }
        ])),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn list_user_invite_requests_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<Vec<UserInviteRequestResponse>>, ApiError> {
    let requests = state
        .user_invite_request_repo
        .list_all()
        .await
        .map_err(|err| ApiError::internal(format!("failed to list invitation requests: {err}")))?;
    let mut responses = Vec::with_capacity(requests.len());
    for request in requests {
        responses.push(invite_request_response(&state, request).await?);
    }
    Ok(Json(responses))
}

/// Approves or denies one pending request. Review is compare-and-set so a
/// second admin cannot overwrite the first decision.
#[utoipa::path(
    patch,
    path = "/api/v1/admin/user-invite-requests/{id}",
    tag = "users",
    params(("id" = Uuid, Path, description = "Invitation request id")),
    request_body(content = ReviewUserInviteRequest, example = json!({
        "approved": true,
        "can_stream": true,
        "library_allow": ["11111111-1111-4111-8111-111111111111"]
    })),
    responses(
        (status = 200, description = "Reviewed invitation request", body = UserInviteRequestResponse, example = json!({
            "id": "33333333-3333-4333-8333-333333333333",
            "user_id": "22222222-2222-4222-8222-222222222222",
            "username": "alice",
            "display_name": "Alice Nguyen",
            "message": "Can I invite my roommate?",
            "status": "approved",
            "requested_at": "2026-07-20T12:00:00Z",
            "reviewed_at": "2026-07-20T13:00:00Z",
            "generated_at": null,
            "can_stream": true,
            "library_allow": ["11111111-1111-4111-8111-111111111111"]
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 404, description = "Invitation request not found"),
        (status = 409, description = "Invitation request was already reviewed")
    )
)]
pub async fn review_user_invite_request_handler(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<ReviewUserInviteRequest>,
) -> Result<Json<UserInviteRequestResponse>, ApiError> {
    if state
        .user_invite_request_repo
        .find_by_id(id)
        .await
        .map_err(|err| ApiError::internal(format!("failed to read invitation request: {err}")))?
        .is_none()
    {
        return Err(ApiError::not_found("invitation request not found"));
    }
    let status = if body.approved {
        UserInviteRequestStatus::Approved
    } else {
        UserInviteRequestStatus::Denied
    };
    // Same admin-selected grant set that populates `library_allow`, mapped
    // through any granted `SourceInstance`'s `group_library_id` -- see
    // `docs/architecture/peer-groups.md` §2.5/§6.2. Carried over onto the
    // final `UserInvite` when the requester generates it
    // (`generate_user_invite_handler`).
    let group_library_allow = if body.approved {
        state
            .source_instances
            .group_library_ids_for_source_instances(&body.library_allow)
    } else {
        Vec::new()
    };
    let reviewed = state
        .user_invite_request_repo
        .review(
            id,
            admin.user_id,
            status,
            Utc::now(),
            body.approved && body.can_stream,
            if body.approved {
                &body.library_allow
            } else {
                &[]
            },
            &group_library_allow,
        )
        .await
        .map_err(|err| ApiError::internal(format!("failed to review invitation request: {err}")))?;
    if !reviewed {
        return Err(ApiError::conflict(
            "this invitation request has already been reviewed",
        ));
    }
    let request = state
        .user_invite_request_repo
        .find_by_id(id)
        .await
        .map_err(|err| ApiError::internal(format!("failed to reload invitation request: {err}")))?
        .ok_or_else(|| ApiError::not_found("invitation request not found"))?;
    tracing::info!(request_id = %id, reviewed_by = %admin.user_id, ?status, "reviewed friend invitation request");
    if status == UserInviteRequestStatus::Approved {
        crate::notifications::notify_invite_approved(&state, request.user_id).await;
    }
    Ok(Json(invite_request_response(&state, request).await?))
}

/// Redeems one valid invitation and creates an ordinary Playarr account.
/// Invitation consumption is atomic and occurs before persistence, so two
/// concurrent submissions can never create two accounts from one QR code.
#[utoipa::path(
    post,
    path = "/api/v1/auth/signup",
    tag = "auth",
    request_body(content = SignupRequest, example = json!({
        "invite_token": "5f8a1c2e9b3d4f6a8c1e2b3d4f6a8c1e",
        "username": "bob",
        "display_name": "Bob Martinez",
        "email": "bob@example.com",
        "password": "another secure passphrase"
    })),
    responses(
        (status = 200, description = "Account created", body = UserResponse, example = json!({
            "id": "44444444-4444-4444-8444-444444444444",
            "username": "bob",
            "display_name": "Bob Martinez",
            "email": "bob@example.com",
            "is_admin": false,
            "can_stream": true,
            "library_allow": ["11111111-1111-4111-8111-111111111111"],
            "disabled": false,
            "created_at": "2026-07-20T12:05:00Z",
            "preferred_audio_language": "en"
        })),
        (status = 409, description = "Username is already taken"),
        (status = 410, description = "Invitation is invalid, expired, or already used")
    )
)]
pub async fn signup_handler(
    State(state): State<AppState>,
    Json(body): Json<SignupRequest>,
) -> Result<Json<UserResponse>, ApiError> {
    let token_hash = playarr_auth::secret::hash_token(&body.invite_token);
    let now = Utc::now();
    let invite = state
        .user_invite_repo
        .find_valid(&token_hash, now)
        .await
        .map_err(|err| ApiError::internal(format!("failed to validate user invitation: {err}")))?;
    let invite = invite.ok_or_else(invalid_invite)?;

    ensure_username_available(&state, &body.username).await?;

    // Generated up front (rather than inside `persist_new_user`) so the
    // very same id can be recorded as `consumed_by_user_id` on the invite
    // row atomically with consumption itself -- see `docs/architecture/
    // peer-groups.md` §3.5's "UserInvite double-redemption" for why that
    // linkage matters (it's what a future reconciliation pass would use to
    // find and disable the losing side's account).
    let new_user_id = Uuid::new_v4();
    // Best-effort, same tolerance `persist_new_user`'s own `origin_peer_id`
    // defaulting already applies: redemption itself must never depend on
    // this node's identity being resolvable.
    let consumed_by_peer_id =
        match crate::admin_peer::ensure_node_identity(&state.node_identity_repo).await {
            Ok(identity) => Some(identity.peer_id),
            Err(err) => {
                tracing::warn!(
                    ?err,
                    "failed to load node identity; redeemed invite keeps a NULL consumed_by_peer_id"
                );
                None
            }
        };
    let consumed = state
        .user_invite_repo
        .consume(&token_hash, now, new_user_id, consumed_by_peer_id)
        .await
        .map_err(|err| ApiError::internal(format!("failed to redeem user invitation: {err}")))?;
    if !consumed {
        return Err(invalid_invite());
    }

    let username = body.username.clone();
    let user = persist_new_user(
        &state,
        new_user_id,
        CreateUserRequest {
            username: body.username,
            display_name: body.display_name,
            email: body.email,
            password: body.password,
            is_admin: false,
            can_stream: invite.can_stream,
            library_allow: invite.library_allow,
            // Invitations don't carry a download grant yet (`UserInvite`
            // has no `can_download` field) -- least privilege by default,
            // same as everywhere else in this handler; an admin can grant
            // it afterward via `PATCH /api/v1/admin/users/{id}`.
            can_download: false,
            can_request: false,
        },
        invite.group_library_allow,
    )
    .await?;
    tracing::info!(user_id = %user.id, %username, "redeemed user invitation");
    Ok(Json(user))
}

fn invalid_invite() -> ApiError {
    ApiError::new(
        StatusCode::GONE,
        "invalid_invite",
        "this invitation is invalid, expired, or has already been used",
    )
}

/// Every provisioned account. A user whose `Policy` has gone missing (a
/// data-integrity gap, not something a caller can cause through this API)
/// is still listed -- just with `is_admin: false` and a logged warning --
/// rather than failing the whole list over one bad row.
#[utoipa::path(
    get,
    path = "/api/v1/admin/users",
    tag = "users",
    responses(
        (status = 200, description = "All provisioned accounts", body = Vec<UserResponse>, example = json!([
            {
                "id": "22222222-2222-4222-8222-222222222222",
                "username": "alice",
                "display_name": "Alice Nguyen",
                "email": "alice@example.com",
                "is_admin": false,
                "can_stream": true,
                "library_allow": ["11111111-1111-4111-8111-111111111111"],
                "disabled": false,
                "created_at": "2026-07-20T12:00:00Z",
                "preferred_audio_language": "en"
            }
        ])),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn list_users_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<Vec<UserResponse>>, ApiError> {
    let users = state
        .user_repo
        .list_all()
        .await
        .map_err(|err| ApiError::internal(format!("failed to list users: {err}")))?;

    let mut responses = Vec::with_capacity(users.len());
    for user in users {
        let (is_admin, can_stream, library_allow, can_download, can_request) = match state
            .policy_repo
            .find_by_id(user.policy_id)
            .await
        {
            Ok(Some(policy)) => (
                policy.is_admin,
                policy.can_stream,
                policy.library_allow,
                policy.can_download,
                policy.can_request,
            ),
            Ok(None) => {
                tracing::warn!(
                    user_id = %user.id,
                    policy_id = %user.policy_id,
                    "user references a policy that no longer exists; treating as non-admin, non-streaming"
                );
                (false, false, Vec::new(), false, false)
            }
            Err(err) => {
                tracing::warn!(
                    user_id = %user.id,
                    policy_id = %user.policy_id,
                    %err,
                    "failed to load policy for user; treating as non-admin, non-streaming"
                );
                (false, false, Vec::new(), false, false)
            }
        };
        responses.push(UserResponse::from_user(
            user,
            is_admin,
            can_stream,
            library_allow,
            can_download,
            can_request,
        ));
    }

    Ok(Json(responses))
}

/// Every account this endpoint returns is implicitly disclosed -- id,
/// username, display name, PIN-lock status -- to every other account it's
/// also returned to. That's the intended "who's watching" tradeoff *within
/// one household* (`AuthMode::TrustedNetwork`/`ManagedProfiles`: nobody
/// reaches this endpoint who isn't already on the trusted LAN, so household
/// members already know who else lives there). It stops being a reasonable
/// tradeoff the moment two accounts might belong to unrelated people
/// (`AuthMode::FullAccount`, "remote access, shared with people outside the
/// household" per `docs/architecture/auth-modes.md`) -- there is no
/// `household_id` or account-grouping concept anywhere in `playarr-model`/
/// `playarr-db` to scope by (see that doc's "no `household_id`... claim"
/// note), so under `FullAccount` this must fall back to "every account is a
/// stranger" and list only the caller's own profile. This is a strict
/// server-side gate, not merely relied on by the client: it must hold even
/// for a direct API call, not just Playarr's own UI.
#[utoipa::path(
    get,
    path = "/api/v1/users/profiles",
    tag = "users",
    responses(
        (status = 200, description = "Enabled Playarr profiles available to the caller -- every enabled account under AuthMode::TrustedNetwork/ManagedProfiles (single trusted household), or only the caller's own account under AuthMode::FullAccount (accounts may belong to unrelated people)", body = Vec<AvailableProfileResponse>, example = json!([
            {
                "id": "22222222-2222-4222-8222-222222222222",
                "username": "alice",
                "display_name": "Alice Nguyen",
                "is_current": true,
                "pin_locked": false
            }
        ])),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller does not have Playarr streaming access")
    )
)]
pub async fn list_available_profiles_handler(
    State(state): State<AppState>,
    streaming: AnytimeStreamingUser,
) -> Result<Json<Vec<AvailableProfileResponse>>, ApiError> {
    let users =
        state.user_repo.list_all().await.map_err(|error| {
            ApiError::internal(format!("failed to list viewer profiles: {error}"))
        })?;
    let single_household = !matches!(*state.auth_mode, playarr_auth::AuthMode::FullAccount);
    let mut profiles = Vec::new();

    for user in users {
        if user.disabled {
            continue;
        }
        if !single_household && user.id != streaming.user_id {
            continue;
        }
        let can_stream = state
            .policy_repo
            .find_by_id(user.policy_id)
            .await
            .map_err(|error| {
                ApiError::internal(format!(
                    "failed to load policy for viewer profile {}: {error}",
                    user.id
                ))
            })?
            .is_some_and(|policy| policy.can_stream);
        if !can_stream {
            continue;
        }
        profiles.push(AvailableProfileResponse {
            id: user.id,
            username: user.username,
            display_name: user.display_name,
            is_current: user.id == streaming.user_id,
            pin_locked: state
                .profile_pin_repo
                .find_hash(user.id)
                .await
                .map_err(|error| {
                    ApiError::internal(format!(
                        "failed to load PIN setting for viewer profile {}: {error}",
                        user.id
                    ))
                })?
                .is_some(),
        });
    }

    profiles.sort_by(|left, right| {
        right.is_current.cmp(&left.is_current).then_with(|| {
            left.display_name
                .to_lowercase()
                .cmp(&right.display_name.to_lowercase())
        })
    });
    Ok(Json(profiles))
}

#[utoipa::path(
    get,
    path = "/api/v1/users/me/profile-pin",
    tag = "users",
    responses(
        (status = 200, description = "The signed-in user's profile PIN setting", body = ProfilePinSettingResponse, example = json!({
            "pin_locked": true
        })),
        (status = 401, description = "Missing or invalid access token")
    )
)]
pub async fn get_profile_pin_setting_handler(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<ProfilePinSettingResponse>, ApiError> {
    let pin_locked = state
        .profile_pin_repo
        .find_hash(auth.user_id)
        .await
        .map_err(|error| {
            ApiError::internal(format!(
                "failed to load profile PIN setting for user {}: {error}",
                auth.user_id
            ))
        })?
        .is_some();
    Ok(Json(ProfilePinSettingResponse { pin_locked }))
}

#[utoipa::path(
    patch,
    path = "/api/v1/users/me/profile-pin",
    tag = "users",
    request_body(content = UpdateProfilePinRequest, example = json!({
        "pin": "4821"
    })),
    responses(
        (status = 200, description = "Updated profile PIN setting", body = ProfilePinSettingResponse, example = json!({
            "pin_locked": true
        })),
        (status = 400, description = "PIN is not exactly four decimal digits"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 404, description = "The signed-in user no longer exists")
    )
)]
pub async fn update_profile_pin_setting_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<UpdateProfilePinRequest>,
) -> Result<Json<ProfilePinSettingResponse>, ApiError> {
    let user_exists = state
        .user_repo
        .find_by_id(auth.user_id)
        .await
        .map_err(|error| {
            ApiError::internal(format!(
                "failed to load user {} before updating profile PIN: {error}",
                auth.user_id
            ))
        })?
        .is_some();
    if !user_exists {
        return Err(ApiError::not_found("signed-in user no longer exists"));
    }

    if let Some(pin) = body.pin.as_deref() {
        validate_profile_pin(pin)?;
        let pin_hash = playarr_auth::login::hash_password(pin);
        state
            .profile_pin_repo
            .upsert_hash(auth.user_id, &pin_hash)
            .await
            .map_err(|error| {
                ApiError::internal(format!(
                    "failed to persist profile PIN for user {}: {error}",
                    auth.user_id
                ))
            })?;
        Ok(Json(ProfilePinSettingResponse { pin_locked: true }))
    } else {
        state
            .profile_pin_repo
            .delete(auth.user_id)
            .await
            .map_err(|error| {
                ApiError::internal(format!(
                    "failed to remove profile PIN for user {}: {error}",
                    auth.user_id
                ))
            })?;
        Ok(Json(ProfilePinSettingResponse { pin_locked: false }))
    }
}

#[utoipa::path(
    get,
    path = "/api/v1/users/me/profile-avatar",
    tag = "users",
    responses(
        (status = 200, description = "The signed-in user's cross-device avatar preference", body = ProfileAvatarSettingResponse, example = json!({
            "preference": {
                "kind": "preset",
                "value": "astronaut"
            }
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 404, description = "The signed-in user no longer exists")
    )
)]
pub async fn get_profile_avatar_handler(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<ProfileAvatarSettingResponse>, ApiError> {
    let user_exists = state
        .user_repo
        .find_by_id(auth.user_id)
        .await
        .map_err(|error| {
            ApiError::internal(format!(
                "failed to load user {} before reading profile avatar: {error}",
                auth.user_id
            ))
        })?
        .is_some();
    if !user_exists {
        return Err(ApiError::not_found("signed-in user no longer exists"));
    }

    let preference = state
        .user_repo
        .get_profile_avatar(auth.user_id)
        .await
        .map_err(|error| {
            ApiError::internal(format!(
                "failed to load profile avatar for user {}: {error}",
                auth.user_id
            ))
        })?;
    Ok(Json(ProfileAvatarSettingResponse { preference }))
}

#[utoipa::path(
    put,
    path = "/api/v1/users/me/profile-avatar",
    tag = "users",
    request_body(content = UpdateProfileAvatarRequest, example = json!({
        "preference": {
            "kind": "preset",
            "value": "astronaut"
        }
    })),
    responses(
        (status = 200, description = "Updated cross-device avatar preference", body = ProfileAvatarSettingResponse, example = json!({
            "preference": {
                "kind": "preset",
                "value": "astronaut"
            }
        })),
        (status = 400, description = "Invalid preset or custom photo data"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 404, description = "The signed-in user no longer exists")
    )
)]
pub async fn update_profile_avatar_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<UpdateProfileAvatarRequest>,
) -> Result<Json<ProfileAvatarSettingResponse>, ApiError> {
    validate_profile_avatar(&body.preference)?;
    let user_exists = state
        .user_repo
        .find_by_id(auth.user_id)
        .await
        .map_err(|error| {
            ApiError::internal(format!(
                "failed to load user {} before updating profile avatar: {error}",
                auth.user_id
            ))
        })?
        .is_some();
    if !user_exists {
        return Err(ApiError::not_found("signed-in user no longer exists"));
    }

    state
        .user_repo
        .upsert_profile_avatar(auth.user_id, &body.preference)
        .await
        .map_err(|error| {
            ApiError::internal(format!(
                "failed to persist profile avatar for user {}: {error}",
                auth.user_id
            ))
        })?;
    Ok(Json(ProfileAvatarSettingResponse {
        preference: Some(body.preference),
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/users/profiles/{id}/verify-pin",
    tag = "users",
    params(("id" = Uuid, Path, description = "Profile user id")),
    request_body(content = VerifyProfilePinRequest, example = json!({
        "pin": "4821"
    })),
    responses(
        (status = 200, description = "The profile is unlocked for switching", body = VerifyProfilePinResponse, example = json!({
            "verified": true
        })),
        (status = 401, description = "The target profile is unavailable or the PIN is invalid"),
        (status = 403, description = "Caller does not have Playarr streaming access, or a restricted caller targets a less restricted profile that has no PIN (`guardian_pin_required`)"),
        (status = 429, description = "Too many incorrect PIN attempts (`pin_locked`, with `retry_after_seconds`)")
    )
)]
pub async fn verify_profile_pin_handler(
    State(state): State<AppState>,
    streaming: AnytimeStreamingUser,
    Path(id): Path<Uuid>,
    Json(body): Json<VerifyProfilePinRequest>,
) -> Result<Json<VerifyProfilePinResponse>, ApiError> {
    // Same single-household boundary as `list_available_profiles_handler`:
    // under `AuthMode::FullAccount` a target id may belong to a stranger,
    // not a sibling profile, so this must not become a cross-account PIN
    // oracle -- reject before even loading the target user, and reuse
    // `invalid_pin()` so a disallowed target is indistinguishable from a
    // wrong PIN (same non-enumeration posture this handler already applies
    // to a missing/disabled/non-streaming target below).
    let cross_account_probe =
        matches!(*state.auth_mode, playarr_auth::AuthMode::FullAccount) && id != streaming.user_id;
    if cross_account_probe {
        return Err(invalid_pin());
    }
    // Brute-force lockout: a four-digit PIN has only 10,000 values, so
    // failures are counted per (caller, target) and per target.
    state
        .household
        .ensure_pin_not_locked(streaming.user_id, id)
        .await?;
    let user = state
        .user_repo
        .find_by_id(id)
        .await
        .map_err(|error| {
            ApiError::internal(format!(
                "failed to load target profile {id} for PIN verification: {error}"
            ))
        })?
        .ok_or_else(invalid_pin)?;
    if user.disabled {
        return Err(invalid_pin());
    }
    let target_policy = state
        .policy_repo
        .find_by_id(user.policy_id)
        .await
        .map_err(|error| {
            ApiError::internal(format!(
                "failed to load policy for target profile {id}: {error}"
            ))
        })?
        .filter(|policy| policy.can_stream);
    let Some(target_policy) = target_policy else {
        return Err(invalid_pin());
    };

    let Some(pin_hash) = state
        .profile_pin_repo
        .find_hash(id)
        .await
        .map_err(|error| {
            ApiError::internal(format!(
                "failed to load PIN setting for target profile {id}: {error}"
            ))
        })?
    else {
        // No PIN on the target. A restricted profile may move to another
        // equally restricted one (a sibling) but never to a less
        // restricted profile that has no PIN protecting it.
        let switching_up = id != streaming.user_id
            && crate::household::is_restricted(&streaming.policy)
            && !crate::household::is_restricted(&target_policy);
        if switching_up {
            return Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "guardian_pin_required",
                "this profile needs a PIN before a restricted profile can switch to it",
            ));
        }
        return Ok(Json(VerifyProfilePinResponse { verified: true }));
    };

    let verifier = playarr_auth::Argon2PasswordVerifier;
    if !verifier.verify(&body.pin, &pin_hash) {
        state
            .household
            .record_pin_failure(streaming.user_id, id)
            .await;
        return Err(invalid_pin());
    }
    state
        .household
        .reset_pin_failures(streaming.user_id, id)
        .await;
    Ok(Json(VerifyProfilePinResponse { verified: true }))
}

/// Applies a partial update to an existing account. Only fields present as
/// `Some` in the body are changed; `password`, when set, is re-hashed the
/// same way [`create_user_handler`] does; `is_admin`/`can_stream`/
/// `library_allow`, when set, update the user's `Policy` row (loaded via
/// `policy_id`) rather than `User` itself.
#[utoipa::path(
    patch,
    path = "/api/v1/admin/users/{id}",
    tag = "users",
    params(("id" = Uuid, Path, description = "User id")),
    request_body(content = UpdateUserRequest, example = json!({
        "display_name": "Alice N.",
        "email": "alice.n@example.com",
        "can_stream": true,
        "library_allow": ["11111111-1111-4111-8111-111111111111"]
    })),
    responses(
        (status = 200, description = "Updated", body = UserResponse, example = json!({
            "id": "22222222-2222-4222-8222-222222222222",
            "username": "alice",
            "display_name": "Alice N.",
            "email": "alice.n@example.com",
            "is_admin": false,
            "can_stream": true,
            "library_allow": ["11111111-1111-4111-8111-111111111111"],
            "disabled": false,
            "created_at": "2026-07-20T12:00:00Z",
            "preferred_audio_language": "en"
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 404, description = "No user with this id")
    )
)]
pub async fn update_user_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateUserRequest>,
) -> Result<Json<UserResponse>, ApiError> {
    let mut user = state
        .user_repo
        .find_by_id(id)
        .await
        .map_err(|err| ApiError::internal(format!("failed to look up user {id}: {err}")))?
        .ok_or_else(|| ApiError::not_found(format!("no user with id {id}")))?;

    if let Some(display_name) = body.display_name {
        user.display_name = display_name;
    }
    if let Some(email) = body.email {
        user.email = Some(email);
    }
    if let Some(password) = body.password {
        user.password_hash = Sensitive::new(playarr_auth::login::hash_password(&password));
    }
    if let Some(disabled) = body.disabled {
        user.disabled = disabled;
    }

    // `is_admin`/`can_stream`/`library_allow`/`can_download` all live on
    // `Policy`, not `User` -- only touch (and only persist) the policy at
    // all when the caller actually asked to change one of them.
    let (is_admin, can_stream, library_allow, can_download, can_request) = if body
        .is_admin
        .is_some()
        || body.can_stream.is_some()
        || body.library_allow.is_some()
        || body.can_download.is_some()
        || body.can_request.is_some()
    {
        let mut policy = state
            .policy_repo
            .find_by_id(user.policy_id)
            .await
            .map_err(|err| {
                ApiError::internal(format!(
                    "failed to look up policy {} for user {id}: {err}",
                    user.policy_id
                ))
            })?
            .ok_or_else(|| {
                ApiError::internal(format!(
                    "user {id} references policy {} which no longer exists",
                    user.policy_id
                ))
            })?;
        if let Some(is_admin) = body.is_admin {
            policy.is_admin = is_admin;
        }
        if let Some(can_stream) = body.can_stream {
            policy.can_stream = can_stream;
        }
        if let Some(library_allow) = body.library_allow {
            policy.library_allow = library_allow;
        }
        if let Some(can_download) = body.can_download {
            policy.can_download = can_download;
        }
        if let Some(can_request) = body.can_request {
            policy.can_request = can_request;
        }
        state.policy_repo.upsert(&policy).await.map_err(|err| {
            ApiError::internal(format!("failed to persist policy {}: {err}", policy.id))
        })?;
        (
            policy.is_admin,
            policy.can_stream,
            policy.library_allow,
            policy.can_download,
            policy.can_request,
        )
    } else {
        match state.policy_repo.find_by_id(user.policy_id).await {
            Ok(Some(policy)) => (
                policy.is_admin,
                policy.can_stream,
                policy.library_allow,
                policy.can_download,
                policy.can_request,
            ),
            Ok(None) => {
                tracing::warn!(
                    user_id = %user.id,
                    policy_id = %user.policy_id,
                    "user references a policy that no longer exists; treating as non-admin, non-streaming"
                );
                (false, false, Vec::new(), false, false)
            }
            Err(err) => {
                tracing::warn!(
                    user_id = %user.id,
                    policy_id = %user.policy_id,
                    %err,
                    "failed to load policy for user; treating as non-admin, non-streaming"
                );
                (false, false, Vec::new(), false, false)
            }
        }
    };

    state
        .user_repo
        .upsert(&user)
        .await
        .map_err(|err| ApiError::internal(format!("failed to persist updated user {id}: {err}")))?;

    tracing::info!(user_id = %user.id, "updated user account");
    crate::events::publish_to_users(
        &state,
        [user.id],
        playarr_db::live_event_kind::ACCOUNT,
        "profile",
        user.id,
        &["policy", "profile"],
    )
    .await;

    Ok(Json(UserResponse::from_user(
        user,
        is_admin,
        can_stream,
        library_allow,
        can_download,
        can_request,
    )))
}

#[utoipa::path(
    get,
    path = "/api/v1/users/me/player-preferences",
    tag = "users",
    responses(
        (status = 200, description = "The signed-in user's player preferences", body = PlayerPreferencesResponse, example = json!({
            "preferred_audio_language": "en"
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 404, description = "The signed-in user no longer exists")
    )
)]
pub async fn get_player_preferences_handler(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<PlayerPreferencesResponse>, ApiError> {
    let user = state
        .user_repo
        .find_by_id(auth.user_id)
        .await
        .map_err(|err| {
            ApiError::internal(format!(
                "failed to load player preferences for user {}: {err}",
                auth.user_id
            ))
        })?
        .ok_or_else(|| ApiError::not_found("signed-in user no longer exists"))?;
    Ok(Json(PlayerPreferencesResponse {
        preferred_audio_language: user.preferred_audio_language,
    }))
}

#[utoipa::path(
    patch,
    path = "/api/v1/users/me/player-preferences",
    tag = "users",
    request_body(content = UpdatePlayerPreferencesRequest, example = json!({
        "preferred_audio_language": "es"
    })),
    responses(
        (status = 200, description = "Updated player preferences", body = PlayerPreferencesResponse, example = json!({
            "preferred_audio_language": "es"
        })),
        (status = 400, description = "Invalid preferred audio language"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 404, description = "The signed-in user no longer exists")
    )
)]
pub async fn update_player_preferences_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<UpdatePlayerPreferencesRequest>,
) -> Result<Json<PlayerPreferencesResponse>, ApiError> {
    let mut user = state
        .user_repo
        .find_by_id(auth.user_id)
        .await
        .map_err(|err| {
            ApiError::internal(format!(
                "failed to load player preferences for user {}: {err}",
                auth.user_id
            ))
        })?
        .ok_or_else(|| ApiError::not_found("signed-in user no longer exists"))?;
    user.preferred_audio_language = normalize_audio_language(&body.preferred_audio_language)?;
    state.user_repo.upsert(&user).await.map_err(|err| {
        ApiError::internal(format!(
            "failed to persist player preferences for user {}: {err}",
            auth.user_id
        ))
    })?;
    Ok(Json(PlayerPreferencesResponse {
        preferred_audio_language: user.preferred_audio_language,
    }))
}

/// Removes an account and, best-effort, its `Policy`. Mirrors
/// `admin.rs`'s `delete_source_instance_handler`: a `NotFound` deleting the
/// policy is not a caller-facing failure (an already-absent/shared/
/// orphaned policy is exactly as much a no-op as deleting an
/// already-absent user would be).
#[utoipa::path(
    delete,
    path = "/api/v1/admin/users/{id}",
    tag = "users",
    params(("id" = Uuid, Path, description = "User id")),
    responses(
        (status = 204, description = "Removed (or was already absent)"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn delete_user_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<axum::http::StatusCode, ApiError> {
    // Look the user up first (best-effort) purely so we know which policy
    // to also delete; a user that's already gone means there's nothing
    // left to clean up either.
    let policy_id = state
        .user_repo
        .find_by_id(id)
        .await
        .map_err(|err| ApiError::internal(format!("failed to look up user {id}: {err}")))?
        .map(|user| user.policy_id);

    match state.user_repo.delete(id).await {
        Ok(()) | Err(playarr_db::DbError::NotFound) => {}
        Err(err) => {
            return Err(ApiError::internal(format!(
                "failed to delete user {id}: {err}"
            )))
        }
    }

    if let Some(policy_id) = policy_id {
        match state.policy_repo.delete(policy_id).await {
            Ok(()) | Err(playarr_db::DbError::NotFound) => {}
            Err(err) => {
                return Err(ApiError::internal(format!(
                    "failed to delete policy {policy_id} for user {id}: {err}"
                )))
            }
        }
    }

    tracing::info!(user_id = %id, "deleted user account");
    crate::events::publish_to_users(
        &state,
        [id],
        playarr_db::live_event_kind::ACCOUNT,
        "profile",
        id,
        &["removed"],
    )
    .await;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use chrono::{DateTime, Duration, Utc};
    use tower::ServiceExt;
    use uuid::Uuid;

    use crate::test_support::{
        bearer_header, mint_access_token, seed_admin_user, seed_streaming_user, test_state,
    };
    use crate::version_gate::{ClientCompatibilityTable, VersionGateLayer};

    /// Same minimal table `test_support::test_state`'s router is built
    /// with -- duplicated here (rather than made `pub(crate)` there) since
    /// this is the only test in this module that needs a *second*,
    /// differently-configured router built from a mutated clone of
    /// `TestState::app` (see `login.rs`'s own copy of this helper for the
    /// same rationale).
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

    async fn issue_invite(router: &axum::Router, token: &str) -> String {
        let body = serde_json::json!({
            "can_stream": true,
            "library_allow": ["11111111-1111-4111-8111-111111111111"],
        });
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/user-invites")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(token))
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(json["expires_at"].is_string());
        json["invite_token"].as_str().unwrap().to_string()
    }

    #[tokio::test]
    async fn admin_invite_accepts_an_exact_future_expiry() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let admin_token = mint_access_token(&state, admin_id);
        let expires_at = Utc::now() + Duration::days(7);
        let body = serde_json::json!({
            "can_stream": true,
            "library_allow": [],
            "expires_at": expires_at,
        });

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/user-invites")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&admin_token))
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            DateTime::parse_from_rfc3339(json["expires_at"].as_str().unwrap()).unwrap(),
            expires_at
        );
    }

    #[tokio::test]
    async fn admin_invite_rejects_an_expiry_that_is_not_in_the_future() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let admin_token = mint_access_token(&state, admin_id);
        let body = serde_json::json!({
            "can_stream": true,
            "library_allow": [],
            "expires_at": Utc::now() - Duration::minutes(1),
        });

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/user-invites")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&admin_token))
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn invite_redeems_once_into_a_non_admin_streaming_account() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let admin_token = mint_access_token(&state, admin_id);
        let invite_token = issue_invite(&router, &admin_token).await;

        let signup_body = serde_json::json!({
            "invite_token": invite_token,
            "username": "invited-alice",
            "display_name": "Invited Alice",
            "email": "alice@example.com",
            "password": "correct horse battery staple",
        });
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/auth/signup")
                    .header("content-type", "application/json")
                    .body(Body::from(signup_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let created: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(created["username"], "invited-alice");
        assert_eq!(created["is_admin"], false);
        assert_eq!(created["can_stream"], true);
        assert_eq!(
            created["library_allow"],
            serde_json::json!(["11111111-1111-4111-8111-111111111111"])
        );

        let second_body = serde_json::json!({
            "invite_token": signup_body["invite_token"],
            "username": "second-user",
            "display_name": "Second User",
            "password": "another secure password",
        });
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/auth/signup")
                    .header("content-type", "application/json")
                    .body(Body::from(second_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::GONE);
    }

    /// `docs/architecture/peer-groups.md` §2.5/§6.2 end to end: an invite
    /// issued with `library_allow` naming a `SourceInstance` that maps onto
    /// a `GroupLibrary` carries that grant through as `group_library_allow`
    /// (§6.2), and redemption both applies it to the new account's `Policy`
    /// and records who/which peer redeemed it (§3.5's "UserInvite
    /// double-redemption" bookkeeping) on the invite row itself.
    #[tokio::test]
    async fn invite_redemption_grants_group_library_allow_and_records_who_redeemed_it() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let admin_token = mint_access_token(&state, admin_id);

        let source_instance_id = Uuid::new_v4();
        let group_library_id = Uuid::new_v4();
        state
            .source_instances
            .upsert(playarr_model::SourceInstance {
                id: source_instance_id,
                kind: playarr_model::SourceKind::Radarr,
                name: "Grouped Radarr".to_string(),
                base_url: "http://localhost".to_string(),
                api_key_encrypted: playarr_model::Sensitive::new("key".to_string()),
                priority: 0,
                default_root_folder_id: None,
                folder_mappings: Default::default(),
                default_quality_profile_id: None,
                best_effort: false,
                group_library_id: Some(group_library_id),
            });

        let invite_body = serde_json::json!({
            "can_stream": true,
            "library_allow": [source_instance_id],
        });
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/user-invites")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&admin_token))
                    .body(Body::from(invite_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let issued: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let invite_token = issued["invite_token"].as_str().unwrap().to_string();

        let signup_body = serde_json::json!({
            "invite_token": invite_token,
            "username": "grouped-invitee",
            "display_name": "Grouped Invitee",
            "password": "correct horse battery staple",
        });
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/auth/signup")
                    .header("content-type", "application/json")
                    .body(Body::from(signup_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let created: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let user_id: Uuid = created["id"].as_str().unwrap().parse().unwrap();

        let user = state.user_repo.find_by_id(user_id).await.unwrap().unwrap();
        let policy = state
            .policy_repo
            .find_by_id(user.policy_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            policy.group_library_allow,
            vec![group_library_id],
            "the redeemed account's policy must carry the invite's group_library_allow"
        );

        let identity = state
            .app
            .node_identity_repo
            .get()
            .await
            .unwrap()
            .expect("signup mints this node's identity if it didn't exist yet");
        let token_hash = playarr_auth::secret::hash_token(&invite_token);
        let (consumed_by_user_id, consumed_by_peer_id): (Option<String>, Option<String>) =
            sqlx::query_as(
                "SELECT consumed_by_user_id, consumed_by_peer_id FROM user_invites WHERE token_hash = ?",
            )
            .bind(&token_hash)
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(consumed_by_user_id, Some(user_id.to_string()));
        assert_eq!(consumed_by_peer_id, Some(identity.peer_id.to_string()));
    }

    #[tokio::test]
    async fn invite_issuance_requires_an_admin() {
        let (router, _) = test_state().await;
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/user-invites")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn invalid_invite_does_not_reveal_whether_a_username_exists() {
        let (router, _) = test_state().await;
        let body = serde_json::json!({
            "invite_token": "not-a-real-invite",
            "username": "test-default",
            "display_name": "Existing Username Probe",
            "password": "a reasonably long password",
        });
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/auth/signup")
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::GONE);
    }

    #[tokio::test]
    async fn create_then_list_round_trips() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let body = serde_json::json!({
            "username": "alice",
            "display_name": "Alice",
            "email": "alice@example.com",
            "password": "correct horse battery staple",
            "is_admin": true,
        });
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/users")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["username"], "alice");
        assert_eq!(json["is_admin"], true);
        assert_eq!(json["preferred_audio_language"], "en");
        assert!(
            json.get("password").is_none() && json.get("password_hash").is_none(),
            "password must never be echoed back"
        );

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/users")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let users = json.as_array().unwrap();
        assert!(users.iter().any(|u| u["username"] == "alice"));
    }

    /// `docs/architecture/peer-groups.md` §2.2's scope note: every locally
    /// created user/policy row defaults `origin_peer_id` to this node's own
    /// identity. Neither column is part of `playarr_model::{User,
    /// Policy}` (see `playarr-db::repo::user`'s own doc comment for why),
    /// so this asserts on the raw row via `state.pool` rather than the
    /// JSON response.
    #[tokio::test]
    async fn create_defaults_origin_peer_id_to_this_nodes_own_identity() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let body = serde_json::json!({
            "username": "erin",
            "display_name": "Erin",
            "password": "correct horse battery staple",
            "is_admin": false,
        });
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/users")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let user_id: Uuid = json["id"].as_str().unwrap().parse().unwrap();
        let user = state.user_repo.find_by_id(user_id).await.unwrap().unwrap();

        let identity = state
            .app
            .node_identity_repo
            .get()
            .await
            .unwrap()
            .expect("creating a user must mint this node's identity if it didn't exist yet");

        let (user_origin,): (Option<String>,) =
            sqlx::query_as("SELECT origin_peer_id FROM users WHERE id = ?")
                .bind(user_id.to_string())
                .fetch_one(&state.pool)
                .await
                .unwrap();
        assert_eq!(user_origin, Some(identity.peer_id.to_string()));

        let (policy_origin,): (Option<String>,) =
            sqlx::query_as("SELECT origin_peer_id FROM policies WHERE id = ?")
                .bind(user.policy_id.to_string())
                .fetch_one(&state.pool)
                .await
                .unwrap();
        assert_eq!(policy_origin, Some(identity.peer_id.to_string()));
    }

    /// Per-user library access control admin API round trip: create an
    /// account with `library_allow` set, confirm the created and listed
    /// projections both report it, then patch it to a different set and
    /// confirm the patch actually persisted (not just echoed back).
    #[tokio::test]
    async fn create_with_library_allow_then_patch_and_list_reflect_it() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let library_a = Uuid::new_v4();
        let library_b = Uuid::new_v4();

        let create_body = serde_json::json!({
            "username": "erin",
            "display_name": "Erin",
            "password": "a reasonably long password",
            "can_stream": true,
            "library_allow": [library_a],
        });
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/users")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(create_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let created: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let user_id = created["id"].as_str().unwrap();
        assert_eq!(
            created["library_allow"],
            serde_json::json!([library_a.to_string()])
        );

        // Listing reflects the same grant.
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/users")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let listed: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let erin = listed
            .as_array()
            .unwrap()
            .iter()
            .find(|u| u["id"] == user_id)
            .expect("erin present in the list");
        assert_eq!(
            erin["library_allow"],
            serde_json::json!([library_a.to_string()])
        );

        // Patch replaces the whole set.
        let patch_body = serde_json::json!({
            "library_allow": [library_b],
        });
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/api/v1/admin/users/{user_id}"))
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(patch_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let patched: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            patched["library_allow"],
            serde_json::json!([library_b.to_string()])
        );
        // Untouched field survives the patch unchanged, same as the
        // existing `is_admin`/`disabled` patch test asserts.
        assert_eq!(patched["display_name"], "Erin");

        // Persisted, not just echoed -- re-fetch the real Policy directly.
        let user_uuid = Uuid::parse_str(user_id).unwrap();
        let persisted_user = state
            .user_repo
            .find_by_id(user_uuid)
            .await
            .unwrap()
            .unwrap();
        let persisted_policy = state
            .policy_repo
            .find_by_id(persisted_user.policy_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(persisted_policy.library_allow, vec![library_b]);
    }

    #[tokio::test]
    async fn create_rejects_duplicate_username() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let body = serde_json::json!({
            "username": "bob",
            "display_name": "Bob",
            "password": "hunter2hunter2",
            "is_admin": false,
        });
        let first = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/users")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(first.status(), StatusCode::OK);

        let second = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/users")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(second.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn update_patches_only_provided_fields_and_toggles_admin_policy() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let create_body = serde_json::json!({
            "username": "carol",
            "display_name": "Carol",
            "password": "original password",
            "is_admin": false,
        });
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/users")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(create_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let created: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let user_id = created["id"].as_str().unwrap();
        assert_eq!(created["is_admin"], false);

        let patch_body = serde_json::json!({
            "is_admin": true,
            "disabled": true,
        });
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/api/v1/admin/users/{user_id}"))
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(patch_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let updated: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(updated["is_admin"], true);
        assert_eq!(updated["disabled"], true);
        // Untouched field survives the patch unchanged.
        assert_eq!(updated["display_name"], "Carol");
    }

    #[tokio::test]
    async fn update_unknown_user_is_not_found() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let response = router
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/api/v1/admin/users/{}", Uuid::new_v4()))
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(
                        serde_json::json!({ "disabled": true }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn delete_removes_user_and_is_idempotent() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let create_body = serde_json::json!({
            "username": "dave",
            "display_name": "Dave",
            "password": "another good password",
            "is_admin": false,
        });
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/users")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(create_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let created: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let user_id = created["id"].as_str().unwrap();

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/v1/admin/users/{user_id}"))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        // Deleting again is a no-op, not an error.
        let response = router
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/v1/admin/users/{user_id}"))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn non_admin_is_rejected() {
        let (router, state) = test_state().await;
        let token = mint_access_token(&state, Uuid::new_v4());

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/users")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn signed_in_user_gets_and_updates_own_player_preferences() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        crate::test_support::seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/users/me/player-preferences")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let preferences: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(preferences["preferred_audio_language"], "en");

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri("/api/v1/users/me/player-preferences")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(
                        serde_json::json!({ "preferred_audio_language": "FR-ca" }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let preferences: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(preferences["preferred_audio_language"], "fr-ca");
        assert_eq!(
            state
                .user_repo
                .find_by_id(user_id)
                .await
                .unwrap()
                .unwrap()
                .preferred_audio_language,
            "fr-ca"
        );
    }

    #[tokio::test]
    async fn player_preferences_reject_invalid_language_and_require_authentication() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        crate::test_support::seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri("/api/v1/users/me/player-preferences")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(
                        serde_json::json!({ "preferred_audio_language": "not a tag" }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/users/me/player-preferences")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn profile_avatar_persists_for_the_signed_in_user() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        crate::test_support::seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/users/me/profile-avatar")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let setting: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(setting["preference"].is_null());

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/v1/users/me/profile-avatar")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(
                        serde_json::json!({
                            "preference": {
                                "kind": "custom",
                                "value": "data:image/jpeg;base64,YXZhdGFy"
                            }
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/users/me/profile-avatar")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let setting: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(setting["preference"]["kind"], "custom");
        assert_eq!(
            setting["preference"]["value"],
            "data:image/jpeg;base64,YXZhdGFy"
        );
    }

    #[tokio::test]
    async fn profile_avatar_rejects_invalid_values_and_requires_authentication() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        crate::test_support::seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        for preference in [
            serde_json::json!({ "kind": "preset", "value": "unknown" }),
            serde_json::json!({ "kind": "custom", "value": "https://example.test/avatar.jpg" }),
        ] {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .method("PUT")
                        .uri("/api/v1/users/me/profile-avatar")
                        .header("content-type", "application/json")
                        .header("Authorization", bearer_header(&token))
                        .body(Body::from(
                            serde_json::json!({ "preference": preference }).to_string(),
                        ))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        }

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/users/me/profile-avatar")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn profile_pin_setting_listing_and_verification_round_trip() {
        let (router, state) = test_state().await;
        let current_user_id = Uuid::new_v4();
        let target_user_id = Uuid::new_v4();
        crate::test_support::seed_streaming_user(&state, current_user_id).await;
        crate::test_support::seed_streaming_user(&state, target_user_id).await;
        let token = mint_access_token(&state, current_user_id);

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/users/me/profile-pin")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["pin_locked"], false);

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri("/api/v1/users/me/profile-pin")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(serde_json::json!({ "pin": "12x4" }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        let pin_hash = playarr_auth::login::hash_password("4821");
        state
            .app
            .profile_pin_repo
            .upsert_hash(target_user_id, &pin_hash)
            .await
            .unwrap();

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/users/profiles")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let profiles: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let profiles = profiles.as_array().unwrap();
        assert_eq!(profiles[0]["id"], current_user_id.to_string());
        assert_eq!(profiles[0]["pin_locked"], false);
        let target = profiles
            .iter()
            .find(|profile| profile["id"] == target_user_id.to_string())
            .unwrap();
        assert_eq!(target["pin_locked"], true);
        assert!(target.get("pin_hash").is_none());

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!(
                        "/api/v1/users/profiles/{target_user_id}/verify-pin"
                    ))
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(serde_json::json!({ "pin": "0000" }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["error"], "invalid_pin");

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!(
                        "/api/v1/users/profiles/{target_user_id}/verify-pin"
                    ))
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(serde_json::json!({ "pin": "4821" }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["verified"], true);

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri("/api/v1/users/me/profile-pin")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(serde_json::json!({ "pin": "1234" }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["pin_locked"], true);

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri("/api/v1/users/me/profile-pin")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert!(
            state
                .app
                .profile_pin_repo
                .find_hash(current_user_id)
                .await
                .unwrap()
                .is_some(),
            "a malformed patch must not silently remove the existing PIN"
        );

        let response = router
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri("/api/v1/users/me/profile-pin")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(serde_json::json!({ "pin": null }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["pin_locked"], false);
    }

    /// The regression this pass exists for: under `AuthMode::FullAccount`
    /// ("remote access, shared with people outside the household" --
    /// `docs/architecture/auth-modes.md`), two accounts may belong to
    /// unrelated people, so `GET /api/v1/users/profiles` must never
    /// disclose anyone but the caller, and
    /// `POST /api/v1/users/profiles/{id}/verify-pin` must reject any target
    /// id but the caller's own -- both regardless of the target's own PIN
    /// being correct. `AuthMode::TrustedNetwork` (a single trusted
    /// household, exercised above) is unaffected.
    #[tokio::test]
    async fn full_account_mode_never_discloses_or_pin_probes_another_user() {
        let (_router, state) = test_state().await;
        let caller_id = Uuid::new_v4();
        let stranger_id = Uuid::new_v4();
        seed_streaming_user(&state, caller_id).await;
        seed_streaming_user(&state, stranger_id).await;
        let pin_hash = playarr_auth::login::hash_password("4821");
        state
            .app
            .profile_pin_repo
            .upsert_hash(stranger_id, &pin_hash)
            .await
            .unwrap();

        let mut app = state.app.clone();
        app.auth_mode = std::sync::Arc::new(playarr_auth::AuthMode::FullAccount);
        let (router, _api) = crate::build_router(app, test_version_gate(), None);
        let token = mint_access_token(&state, caller_id);

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/users/profiles")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let profiles: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let profiles = profiles.as_array().unwrap();
        assert_eq!(
            profiles.len(),
            1,
            "FullAccount must list only the caller's own profile, never a stranger's"
        );
        assert_eq!(profiles[0]["id"], caller_id.to_string());

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/users/profiles/{stranger_id}/verify-pin"))
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(serde_json::json!({ "pin": "4821" }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::UNAUTHORIZED,
            "the correct PIN must still be rejected for a stranger's id under FullAccount"
        );
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["error"], "invalid_pin");
    }

    #[tokio::test]
    async fn friend_invite_requires_approval_and_starts_expiry_when_generated() {
        let (router, state) = test_state().await;
        let requester_id = Uuid::new_v4();
        seed_streaming_user(&state, requester_id).await;
        let requester_token = mint_access_token(&state, requester_id);
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let admin_token = mint_access_token(&state, admin_id);

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/users/me/user-invite-request")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&requester_token))
                    .body(Body::from(
                        serde_json::json!({
                            "message": "For Sam, who would like films and television."
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let request: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(request["status"], "pending");
        assert_eq!(
            request["message"],
            "For Sam, who would like films and television."
        );
        let request_id = request["id"].as_str().unwrap();

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/users/me/user-invite-request/generate")
                    .header("Authorization", bearer_header(&requester_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);

        state
            .app
            .push_registration_repo
            .upsert(&playarr_model::PushRegistration {
                token: "requester-installation-id".to_string(),
                user_id: requester_id,
                platform: playarr_model::ClientPlatform::Web,
                updated_at: Utc::now(),
            })
            .await
            .unwrap();

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/api/v1/admin/user-invite-requests/{request_id}"))
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&admin_token))
                    .body(Body::from(
                        serde_json::json!({
                            "approved": true,
                            "can_stream": true,
                            "library_allow": ["22222222-2222-4222-8222-222222222222"]
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let approved: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(approved["status"], "approved");
        assert_eq!(
            approved["library_allow"],
            serde_json::json!(["22222222-2222-4222-8222-222222222222"])
        );
        assert!(approved["reviewed_at"].is_string());
        let notifications = state.push_notifications.sent.lock().await;
        assert_eq!(notifications.len(), 1);
        assert_eq!(notifications[0].0, "requester-installation-id");
        assert_eq!(notifications[0].1.link, "https://playarr.app/settings");
        drop(notifications);

        let generated_at = Utc::now();
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/users/me/user-invite-request/generate")
                    .header("Authorization", bearer_header(&requester_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let invite: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(invite["invite_token"].is_string());
        let expires_at = DateTime::parse_from_rfc3339(invite["expires_at"].as_str().unwrap())
            .unwrap()
            .with_timezone(&Utc);
        let remaining = expires_at - generated_at;
        assert!(remaining >= Duration::hours(23));
        assert!(remaining <= Duration::hours(24) + Duration::seconds(2));

        let signup_body = serde_json::json!({
            "invite_token": invite["invite_token"],
            "username": "requesters-friend",
            "display_name": "Requester's Friend",
            "password": "a secure password for the invited friend",
        });
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/auth/signup")
                    .header("content-type", "application/json")
                    .body(Body::from(signup_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let invited_user: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(invited_user["can_stream"], true);
        assert_eq!(
            invited_user["library_allow"],
            serde_json::json!(["22222222-2222-4222-8222-222222222222"])
        );

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/v1/users/me/user-invite-request")
                    .header("Authorization", bearer_header(&requester_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let request: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(request["status"], "generated");

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/users/me/user-invite-request/generate")
                    .header("Authorization", bearer_header(&requester_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
    }
}
