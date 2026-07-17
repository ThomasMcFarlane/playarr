//! Admin user management -- `POST`/`GET`/`PATCH`/`DELETE
//! /api/v1/admin/users[/{id}]`. Closes the persistence gap
//! `streamarr_auth::login::InMemoryUserDirectory`'s own doc comment calls
//! out: real Argon2 password hashing (`streamarr_auth::login::hash_password`)
//! and `AuthMode::FullAccount` login already existed, but there was no
//! durable place to store an account and no way to create one -- login
//! depended entirely on `AuthMode::TrustedNetwork`'s source-IP trust. This
//! is the missing "way": real username/password accounts backed by
//! `streamarr_db::UserRepo`/`PolicyRepo`, so login stops depending on
//! network-position trust entirely.
//!
//! Every handler here is `AdminUser`-gated, exactly like `admin.rs`'s
//! source-instance handlers -- there is no self-service account creation
//! yet, only admin-provisioned accounts.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use streamarr_auth::PasswordVerifier;
use streamarr_model::{Policy, Sensitive, User, UserInvite};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth_extractor::{AdminUser, AuthUser, StreamingUser};
use crate::error::ApiError;
use crate::AppState;

/// Request body for provisioning a new account. `password` is write-only
/// -- it is hashed via `streamarr_auth::login::hash_password` immediately
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
    /// Grants Playarr streaming access -- see `streamarr_model::Policy::
    /// can_stream`'s doc comment. Independent of `is_admin`; defaults to
    /// `false` (least privilege), same as every other grant this handler
    /// starts a new account with.
    #[serde(default)]
    pub can_stream: bool,
    /// Source-instance ids ("libraries") this account may browse/stream --
    /// see `streamarr_model::Policy::library_allow`'s doc comment. Defaults
    /// to empty (no grants yet, deny-all -- not all-allow), same
    /// least-privilege-by-default philosophy as `is_admin`/`can_stream`
    /// above: an admin still has to explicitly grant library access after
    /// creating the account.
    #[serde(default)]
    pub library_allow: Vec<Uuid>,
}

/// Public account-creation body. The bearer invitation is write-only and
/// grants exactly one ordinary Playarr account: never administrator access,
/// and no libraries until an administrator shares them after sign-up.
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

const USER_INVITE_TTL: Duration = Duration::hours(24);

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
}

/// The redacted, admin-facing projection of [`streamarr_model::User`] --
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
    /// `streamarr_model::Policy::can_stream`'s doc comment. Independent of
    /// `is_admin`.
    pub can_stream: bool,
    /// Source-instance ids ("libraries") this account may browse/stream --
    /// see `streamarr_model::Policy::library_allow`'s doc comment. Empty
    /// means no grants (deny-all), not all-allow; irrelevant (but still
    /// truthfully reported) for an `is_admin` account, since `is_admin`
    /// bypasses this check entirely at enforcement time.
    pub library_allow: Vec<Uuid>,
    pub disabled: bool,
    pub created_at: DateTime<Utc>,
    pub preferred_audio_language: String,
}

impl UserResponse {
    /// `is_admin`/`can_stream`/`library_allow` are threaded in separately
    /// (rather than this taking a `Policy`) so callers that already handled
    /// a missing `Policy` (a data-integrity gap, not a caller error -- see
    /// [`list_users_handler`]) can just pass `false`/`false`/`Vec::new()`
    /// without constructing a placeholder `Policy`.
    fn from_user(user: User, is_admin: bool, can_stream: bool, library_allow: Vec<Uuid>) -> Self {
        Self {
            id: user.id,
            username: user.username,
            display_name: user.display_name,
            email: user.email,
            is_admin,
            can_stream,
            library_allow,
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

/// Minimal household-profile projection for Playarr's 'who is watching'
/// screen. Password hashes, email addresses and policy details are never
/// exposed.
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

fn invalid_pin() -> ApiError {
    ApiError::new(
        StatusCode::UNAUTHORIZED,
        "invalid_pin",
        "invalid profile PIN",
    )
}

/// A sensible, permissive-but-not-dangerous default `Policy` for a newly
/// provisioned user: can stream and transcode, can't delete library
/// content or share publicly, `library_allow` set from the caller's
/// request (empty by default -- an admin still has to grant access
/// explicitly, "no access" not "all access"), no device/session/schedule
/// restrictions.
fn default_policy(
    id: Uuid,
    username: &str,
    is_admin: bool,
    can_stream: bool,
    library_allow: Vec<Uuid>,
) -> Policy {
    Policy {
        id,
        name: format!("{username}'s policy"),
        library_allow,
        blocked_folders: Vec::new(),
        max_rating: None,
        blocked_tags: Vec::new(),
        allowed_tags: Vec::new(),
        can_transcode: true,
        can_download: true,
        can_delete: false,
        can_share_public: false,
        device_allow: Vec::new(),
        max_concurrent_sessions: None,
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
    body: CreateUserRequest,
) -> Result<UserResponse, ApiError> {
    let policy = default_policy(
        Uuid::new_v4(),
        &body.username,
        body.is_admin,
        body.can_stream,
        body.library_allow,
    );
    let user = User {
        id: Uuid::new_v4(),
        username: body.username,
        display_name: body.display_name,
        email: body.email,
        password_hash: Sensitive::new(streamarr_auth::login::hash_password(&body.password)),
        policy_id: policy.id,
        created_at: Utc::now(),
        disabled: false,
        preferred_audio_language: streamarr_model::DEFAULT_PREFERRED_AUDIO_LANGUAGE.to_string(),
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

    tracing::info!(user_id = %user.id, username = %user.username, is_admin = policy.is_admin, can_stream = policy.can_stream, "created user account");

    Ok(UserResponse::from_user(
        user,
        policy.is_admin,
        policy.can_stream,
        policy.library_allow,
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
    request_body = CreateUserRequest,
    responses(
        (status = 200, description = "Account created", body = UserResponse),
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
    Ok(Json(persist_new_user(&state, body).await?))
}

/// Issues a 24-hour, one-use bearer invitation. The administrator console
/// combines this token with its externally visible server origin when it
/// builds the `playarr.app/signup` QR link.
#[utoipa::path(
    post,
    path = "/api/v1/admin/user-invites",
    tag = "users",
    responses(
        (status = 200, description = "Account invitation issued", body = UserInviteResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn create_user_invite_handler(
    State(state): State<AppState>,
    admin: AdminUser,
) -> Result<Json<UserInviteResponse>, ApiError> {
    let invite_token = streamarr_auth::secret::opaque_token();
    let now = Utc::now();
    let expires_at = now + USER_INVITE_TTL;
    state
        .user_invite_repo
        .create(&UserInvite {
            token_hash: streamarr_auth::secret::hash_token(&invite_token),
            created_by: admin.user_id,
            created_at: now,
            expires_at,
        })
        .await
        .map_err(|err| ApiError::internal(format!("failed to persist user invitation: {err}")))?;

    tracing::info!(created_by = %admin.user_id, %expires_at, "created user invitation");
    Ok(Json(UserInviteResponse {
        invite_token,
        expires_at,
    }))
}

/// Redeems one valid invitation and creates an ordinary Playarr account.
/// Invitation consumption is atomic and occurs before persistence, so two
/// concurrent submissions can never create two accounts from one QR code.
#[utoipa::path(
    post,
    path = "/api/v1/auth/signup",
    tag = "auth",
    request_body = SignupRequest,
    responses(
        (status = 200, description = "Account created", body = UserResponse),
        (status = 409, description = "Username is already taken"),
        (status = 410, description = "Invitation is invalid, expired, or already used")
    )
)]
pub async fn signup_handler(
    State(state): State<AppState>,
    Json(body): Json<SignupRequest>,
) -> Result<Json<UserResponse>, ApiError> {
    let token_hash = streamarr_auth::secret::hash_token(&body.invite_token);
    let now = Utc::now();
    let valid = state
        .user_invite_repo
        .is_valid(&token_hash, now)
        .await
        .map_err(|err| ApiError::internal(format!("failed to validate user invitation: {err}")))?;
    if !valid {
        return Err(invalid_invite());
    }

    ensure_username_available(&state, &body.username).await?;
    let consumed = state
        .user_invite_repo
        .consume(&token_hash, now)
        .await
        .map_err(|err| ApiError::internal(format!("failed to redeem user invitation: {err}")))?;
    if !consumed {
        return Err(invalid_invite());
    }

    let username = body.username.clone();
    let user = persist_new_user(
        &state,
        CreateUserRequest {
            username: body.username,
            display_name: body.display_name,
            email: body.email,
            password: body.password,
            is_admin: false,
            can_stream: true,
            library_allow: Vec::new(),
        },
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
        (status = 200, description = "All provisioned accounts", body = Vec<UserResponse>),
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
        let (is_admin, can_stream, library_allow) = match state
            .policy_repo
            .find_by_id(user.policy_id)
            .await
        {
            Ok(Some(policy)) => (policy.is_admin, policy.can_stream, policy.library_allow),
            Ok(None) => {
                tracing::warn!(
                    user_id = %user.id,
                    policy_id = %user.policy_id,
                    "user references a policy that no longer exists; treating as non-admin, non-streaming"
                );
                (false, false, Vec::new())
            }
            Err(err) => {
                tracing::warn!(
                    user_id = %user.id,
                    policy_id = %user.policy_id,
                    %err,
                    "failed to load policy for user; treating as non-admin, non-streaming"
                );
                (false, false, Vec::new())
            }
        };
        responses.push(UserResponse::from_user(
            user,
            is_admin,
            can_stream,
            library_allow,
        ));
    }

    Ok(Json(responses))
}

#[utoipa::path(
    get,
    path = "/api/v1/users/profiles",
    tag = "users",
    responses(
        (status = 200, description = "Enabled Playarr profiles available on this server", body = Vec<AvailableProfileResponse>),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller does not have Playarr streaming access")
    )
)]
pub async fn list_available_profiles_handler(
    State(state): State<AppState>,
    streaming: StreamingUser,
) -> Result<Json<Vec<AvailableProfileResponse>>, ApiError> {
    let users =
        state.user_repo.list_all().await.map_err(|error| {
            ApiError::internal(format!("failed to list viewer profiles: {error}"))
        })?;
    let mut profiles = Vec::new();

    for user in users {
        if user.disabled {
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
        (status = 200, description = "The signed-in user's profile PIN setting", body = ProfilePinSettingResponse),
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
    request_body = UpdateProfilePinRequest,
    responses(
        (status = 200, description = "Updated profile PIN setting", body = ProfilePinSettingResponse),
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
        let pin_hash = streamarr_auth::login::hash_password(pin);
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
    post,
    path = "/api/v1/users/profiles/{id}/verify-pin",
    tag = "users",
    params(("id" = Uuid, Path, description = "Profile user id")),
    request_body = VerifyProfilePinRequest,
    responses(
        (status = 200, description = "The profile is unlocked for switching", body = VerifyProfilePinResponse),
        (status = 401, description = "The target profile is unavailable or the PIN is invalid"),
        (status = 403, description = "Caller does not have Playarr streaming access")
    )
)]
pub async fn verify_profile_pin_handler(
    State(state): State<AppState>,
    _streaming: StreamingUser,
    Path(id): Path<Uuid>,
    Json(body): Json<VerifyProfilePinRequest>,
) -> Result<Json<VerifyProfilePinResponse>, ApiError> {
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
    let can_stream = state
        .policy_repo
        .find_by_id(user.policy_id)
        .await
        .map_err(|error| {
            ApiError::internal(format!(
                "failed to load policy for target profile {id}: {error}"
            ))
        })?
        .is_some_and(|policy| policy.can_stream);
    if !can_stream {
        return Err(invalid_pin());
    }

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
        return Ok(Json(VerifyProfilePinResponse { verified: true }));
    };

    let verifier = streamarr_auth::Argon2PasswordVerifier;
    if !verifier.verify(&body.pin, &pin_hash) {
        return Err(invalid_pin());
    }
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
    request_body = UpdateUserRequest,
    responses(
        (status = 200, description = "Updated", body = UserResponse),
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
        user.password_hash = Sensitive::new(streamarr_auth::login::hash_password(&password));
    }
    if let Some(disabled) = body.disabled {
        user.disabled = disabled;
    }

    // `is_admin`/`can_stream`/`library_allow` all live on `Policy`, not
    // `User` -- only touch (and only persist) the policy at all when the
    // caller actually asked to change one of them.
    let (is_admin, can_stream, library_allow) = if body.is_admin.is_some()
        || body.can_stream.is_some()
        || body.library_allow.is_some()
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
        state.policy_repo.upsert(&policy).await.map_err(|err| {
            ApiError::internal(format!("failed to persist policy {}: {err}", policy.id))
        })?;
        (policy.is_admin, policy.can_stream, policy.library_allow)
    } else {
        match state.policy_repo.find_by_id(user.policy_id).await {
            Ok(Some(policy)) => (policy.is_admin, policy.can_stream, policy.library_allow),
            Ok(None) => {
                tracing::warn!(
                    user_id = %user.id,
                    policy_id = %user.policy_id,
                    "user references a policy that no longer exists; treating as non-admin, non-streaming"
                );
                (false, false, Vec::new())
            }
            Err(err) => {
                tracing::warn!(
                    user_id = %user.id,
                    policy_id = %user.policy_id,
                    %err,
                    "failed to load policy for user; treating as non-admin, non-streaming"
                );
                (false, false, Vec::new())
            }
        }
    };

    state
        .user_repo
        .upsert(&user)
        .await
        .map_err(|err| ApiError::internal(format!("failed to persist updated user {id}: {err}")))?;

    tracing::info!(user_id = %user.id, "updated user account");

    Ok(Json(UserResponse::from_user(
        user,
        is_admin,
        can_stream,
        library_allow,
    )))
}

#[utoipa::path(
    get,
    path = "/api/v1/users/me/player-preferences",
    tag = "users",
    responses(
        (status = 200, description = "The signed-in user's player preferences", body = PlayerPreferencesResponse),
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
    request_body = UpdatePlayerPreferencesRequest,
    responses(
        (status = 200, description = "Updated player preferences", body = PlayerPreferencesResponse),
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
        Ok(()) | Err(streamarr_db::DbError::NotFound) => {}
        Err(err) => {
            return Err(ApiError::internal(format!(
                "failed to delete user {id}: {err}"
            )))
        }
    }

    if let Some(policy_id) = policy_id {
        match state.policy_repo.delete(policy_id).await {
            Ok(()) | Err(streamarr_db::DbError::NotFound) => {}
            Err(err) => {
                return Err(ApiError::internal(format!(
                    "failed to delete policy {policy_id} for user {id}: {err}"
                )))
            }
        }
    }

    tracing::info!(user_id = %id, "deleted user account");

    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;
    use uuid::Uuid;

    use crate::test_support::{bearer_header, mint_access_token, seed_admin_user, test_state};

    async fn issue_invite(router: &axum::Router, token: &str) -> String {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/user-invites")
                    .header("Authorization", bearer_header(token))
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
        assert!(json["expires_at"].is_string());
        json["invite_token"].as_str().unwrap().to_string()
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
        assert_eq!(created["library_allow"], serde_json::json!([]));

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

        let pin_hash = streamarr_auth::login::hash_password("4821");
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
}
