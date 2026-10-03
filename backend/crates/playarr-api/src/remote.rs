//! Phone remote and playback handoff (`docs/architecture/remote-control.md`).
//!
//! * A **target** device registers with advertised capabilities and long-polls
//!   its inbox.
//! * A **controller** (another device of the same account) requests a pairing;
//!   the target explicitly approves it. Only an `active`, unexpired, unrevoked
//!   pairing bound to one controller device authorises commands, and each
//!   command must be inside the pairing scopes.
//! * A **handoff** moves playback from a source to a destination. The source
//!   is told to stop only after the destination acknowledges playback.
//!
//! Text-entry payloads can contain secrets: they are never logged, never
//! returned to the controller and are cleared when acknowledged or expired.

use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use playarr_db::{RemoteEvent, RemoteHandoff, RemotePairing, RemoteTarget};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth_extractor::{ensure_library_allowed, forbidden, StreamingUser};
use crate::error::ApiError;
use crate::AppState;

pub const CAPABILITIES: [&str; 5] = ["navigate", "text", "playback", "input", "handoff"];
const COMMAND_SCOPES: [&str; 4] = ["navigate", "text", "playback", "input"];
const NAV_KEYS: [&str; 9] = [
    "up", "down", "left", "right", "select", "back", "home", "menu", "options",
];
const PLAYBACK_ACTIONS: [&str; 11] = [
    "play",
    "pause",
    "toggle",
    "stop",
    "seek",
    "seek_by",
    "next",
    "previous",
    "set_audio",
    "set_subtitle",
    "volume",
];
const PAIRING_PENDING_MS: i64 = 5 * 60_000;
const PAIRING_ACTIVE_MS: i64 = 30 * 24 * 3_600_000;
const ONLINE_WINDOW_MS: i64 = 45_000;
const COMMAND_TTL_MS: i64 = 30_000;
const NOTICE_TTL_MS: i64 = 5 * 60_000;
const HANDOFF_TTL_MS: i64 = 60_000;
const STATE_MAX_AGE_MS: i64 = 20_000;
const MAX_PENDING_PER_TARGET: usize = 5;

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn caller_device(user: &StreamingUser) -> Uuid {
    user.claims.device_id
}

fn api(status: StatusCode, code: &str, message: &str) -> ApiError {
    ApiError::new(status, code, message)
}

fn is_online(target: &RemoteTarget, now: i64) -> bool {
    now - target.last_seen_ms <= ONLINE_WINDOW_MS
}

// ---------------------------------------------------------------- DTOs

#[derive(Debug, Deserialize, ToSchema)]
pub struct RegisterTargetRequest {
    /// Human-readable device name shown on controllers.
    pub name: String,
    /// Client platform wire name, e.g. `android-tv`.
    #[serde(default)]
    pub platform: Option<String>,
    /// Advertised capabilities: `navigate`, `text`, `playback`, `input`, `handoff`.
    pub capabilities: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RemoteTargetResponse {
    pub device_id: Uuid,
    pub name: String,
    pub platform: String,
    pub capabilities: Vec<String>,
    pub online: bool,
    pub is_self: bool,
    /// Last reported playback state, when fresh.
    pub state: Option<Value>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ReportStateRequest {
    /// `{media_file_id, work_id?, position_ms, duration_ms?, paused, audio_language?, subtitle_language?, title?}`
    /// or `null`/empty object when nothing is playing.
    pub state: Value,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreatePairingRequest {
    pub target_device_id: Uuid,
    /// Requested scopes; defaults to every capability the target advertises.
    #[serde(default)]
    pub scopes: Option<Vec<String>>,
    /// Name shown on the target's approval prompt (e.g. "Alex's phone").
    #[serde(default)]
    pub controller_name: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ApprovePairingRequest {
    /// Narrow the granted scopes to a subset of those requested.
    #[serde(default)]
    pub scopes: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PairingResponse {
    pub id: Uuid,
    /// `pending`, `active`, `denied`, `revoked` or `expired`.
    pub status: String,
    pub controller_device_id: Uuid,
    pub controller_name: String,
    pub target_device_id: Uuid,
    pub scopes: Vec<String>,
    /// Six digits shown on both devices while the pairing is pending.
    pub verification_code: Option<String>,
    pub created_ms: i64,
    pub expires_ms: i64,
    /// True when the calling device is this pairing's controller.
    pub is_controller: bool,
    /// True when the calling device is this pairing's target.
    pub is_target: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CommandRequest {
    /// `navigate`, `text`, `playback` or `input`.
    pub kind: String,
    /// navigate: `{key}`; text: `{value, mode?: insert|replace|backspace, submit?}`;
    /// playback: `{action, position_ms?, delta_ms?, language?, level?}`; input: `{input_id}`.
    pub payload: Value,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CommandAccepted {
    pub command_id: Uuid,
    pub seq: i64,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CommandStatusResponse {
    pub command_id: Uuid,
    /// `queued`, `delivered`, `ok`, `failed`, `unsupported`, `revoked` or `expired`.
    pub status: String,
    pub detail: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct InboxQuery {
    #[serde(default)]
    pub after: i64,
    /// Seconds to wait for an event (capped at 25).
    #[serde(default)]
    pub wait: u64,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct InboxEvent {
    pub id: Uuid,
    pub seq: i64,
    /// `pairing_request`, `pairing_revoked`, `command`, `handoff_offer` or `handoff_stop`.
    pub kind: String,
    pub pairing_id: Option<Uuid>,
    pub payload: Option<Value>,
    pub created_ms: i64,
    pub expires_ms: i64,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct InboxResponse {
    pub events: Vec<InboxEvent>,
    /// Highest `seq` returned (or the caller's `after` when empty).
    pub next: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AckEventRequest {
    /// `ok`, `failed` or `unsupported`.
    pub status: String,
    /// Short non-sensitive reason (never user input).
    #[serde(default)]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PlaybackSnapshot {
    pub position_ms: u64,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub paused: bool,
    #[serde(default)]
    pub audio_language: Option<String>,
    #[serde(default)]
    pub subtitle_language: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateHandoffRequest {
    /// Client-chosen idempotency key (unique per initiating device).
    pub request_key: String,
    pub source_device_id: Uuid,
    pub destination_device_id: Uuid,
    /// Required when the initiator is the source; otherwise taken from the
    /// source's last reported state.
    #[serde(default)]
    pub media_file_id: Option<Uuid>,
    #[serde(default)]
    pub snapshot: Option<PlaybackSnapshot>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AckHandoffRequest {
    /// `playing` or `failed`.
    pub status: String,
    /// Position the destination actually started at (required for `playing`).
    #[serde(default)]
    pub position_ms: Option<u64>,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct HandoffResponse {
    pub id: Uuid,
    /// `pending`, `committed`, `failed`, `expired` or `cancelled`.
    pub status: String,
    pub source_device_id: Uuid,
    pub destination_device_id: Uuid,
    pub media_file_id: Uuid,
    pub work_id: Uuid,
    pub snapshot: PlaybackSnapshot,
    pub acked_position_ms: Option<u64>,
    /// Acknowledged position minus the position expected from the snapshot
    /// after the elapsed time (task 53 measures this).
    pub position_drift_ms: Option<i64>,
    pub failure_reason: Option<String>,
    pub created_ms: i64,
    pub expires_ms: i64,
    pub completed_ms: Option<i64>,
}

fn handoff_response(h: &RemoteHandoff) -> HandoffResponse {
    let snapshot: PlaybackSnapshot =
        serde_json::from_value(h.snapshot.clone()).unwrap_or(PlaybackSnapshot {
            position_ms: 0,
            duration_ms: None,
            paused: true,
            audio_language: None,
            subtitle_language: None,
        });
    let drift = h.acked_position_ms.map(|acked| {
        let elapsed = if snapshot.paused {
            0
        } else {
            h.completed_ms.unwrap_or(h.created_ms) - h.created_ms
        };
        acked - (snapshot.position_ms as i64 + elapsed)
    });
    HandoffResponse {
        id: h.id,
        status: h.status.clone(),
        source_device_id: h.source_device_id,
        destination_device_id: h.destination_device_id,
        media_file_id: h.media_file_id,
        work_id: h.work_id,
        snapshot,
        acked_position_ms: h.acked_position_ms.map(|v| v.max(0) as u64),
        position_drift_ms: drift,
        failure_reason: h.failure_reason.clone(),
        created_ms: h.created_ms,
        expires_ms: h.expires_ms,
        completed_ms: h.completed_ms,
    }
}

fn effective_status(p: &RemotePairing, now: i64) -> String {
    if (p.status == "pending" || p.status == "active") && p.expires_ms <= now {
        "expired".to_string()
    } else {
        p.status.clone()
    }
}

fn pairing_response(p: &RemotePairing, now: i64, caller: Uuid) -> PairingResponse {
    let status = effective_status(p, now);
    PairingResponse {
        id: p.id,
        verification_code: (status == "pending").then(|| p.verification_code.clone()),
        status,
        controller_device_id: p.controller_device_id,
        controller_name: p.controller_name.clone(),
        target_device_id: p.target_device_id,
        scopes: p.scopes.clone(),
        created_ms: p.created_ms,
        expires_ms: p.expires_ms,
        is_controller: p.controller_device_id == caller,
        is_target: p.target_device_id == caller,
    }
}

fn validate_capabilities(list: &[String]) -> Result<Vec<String>, ApiError> {
    let mut out: Vec<String> = Vec::new();
    for item in list {
        if !CAPABILITIES.contains(&item.as_str()) {
            return Err(ApiError::bad_request(format!(
                "unknown capability {item:?}"
            )));
        }
        if !out.contains(item) {
            out.push(item.clone());
        }
    }
    Ok(out)
}

fn clean_text(raw: &str, max: usize) -> String {
    raw.chars().filter(|c| !c.is_control()).take(max).collect()
}

// ----------------------------------------------------- target endpoints

#[utoipa::path(
    put,
    path = "/api/v1/remote/target",
    tag = "remote",
    request_body = RegisterTargetRequest,
    responses(
        (status = 200, description = "This device is registered as a remotely controllable target", body = RemoteTargetResponse),
        (status = 400, description = "Unknown capability or empty name"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller lacks Playarr streaming access")
    )
)]
pub async fn register_target_handler(
    State(state): State<AppState>,
    user: StreamingUser,
    Json(body): Json<RegisterTargetRequest>,
) -> Result<Json<RemoteTargetResponse>, ApiError> {
    let name = clean_text(&body.name, 80);
    if name.trim().is_empty() {
        return Err(ApiError::bad_request("name must not be empty"));
    }
    let capabilities = validate_capabilities(&body.capabilities)?;
    let device_id = caller_device(&user);
    let existing = state.remote_repo.get_target(device_id).await?;
    let target = RemoteTarget {
        device_id,
        user_id: user.user_id,
        name,
        platform: clean_text(body.platform.as_deref().unwrap_or("unknown"), 32),
        capabilities,
        state: existing.as_ref().and_then(|t| t.state.clone()),
        state_at_ms: existing.as_ref().and_then(|t| t.state_at_ms),
        last_seen_ms: now_ms(),
    };
    state.remote_repo.upsert_target(&target).await?;
    Ok(Json(target_response(&target, device_id, now_ms())))
}

fn target_response(t: &RemoteTarget, caller: Uuid, now: i64) -> RemoteTargetResponse {
    let fresh = t
        .state_at_ms
        .map(|at| now - at <= STATE_MAX_AGE_MS)
        .unwrap_or(false);
    RemoteTargetResponse {
        device_id: t.device_id,
        name: t.name.clone(),
        platform: t.platform.clone(),
        capabilities: t.capabilities.clone(),
        online: is_online(t, now),
        is_self: t.device_id == caller,
        state: if fresh { t.state.clone() } else { None },
    }
}

#[utoipa::path(
    delete,
    path = "/api/v1/remote/target",
    tag = "remote",
    responses(
        (status = 204, description = "This device is no longer a remote target"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller lacks Playarr streaming access")
    )
)]
pub async fn unregister_target_handler(
    State(state): State<AppState>,
    user: StreamingUser,
) -> Result<StatusCode, ApiError> {
    state
        .remote_repo
        .delete_target(caller_device(&user))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/v1/remote/targets",
    tag = "remote",
    responses(
        (status = 200, description = "Remote targets registered by this account", body = [RemoteTargetResponse]),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller lacks Playarr streaming access")
    )
)]
pub async fn list_targets_handler(
    State(state): State<AppState>,
    user: StreamingUser,
) -> Result<Json<Vec<RemoteTargetResponse>>, ApiError> {
    let now = now_ms();
    let me = caller_device(&user);
    let targets = state
        .remote_repo
        .list_targets_for_user(user.user_id)
        .await?;
    Ok(Json(
        targets
            .iter()
            .map(|t| target_response(t, me, now))
            .collect(),
    ))
}

#[utoipa::path(
    put,
    path = "/api/v1/remote/target/state",
    tag = "remote",
    request_body = ReportStateRequest,
    responses(
        (status = 204, description = "State recorded"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller lacks Playarr streaming access"),
        (status = 404, description = "This device is not registered as a target")
    )
)]
pub async fn report_state_handler(
    State(state): State<AppState>,
    user: StreamingUser,
    Json(body): Json<ReportStateRequest>,
) -> Result<StatusCode, ApiError> {
    let device_id = caller_device(&user);
    match state.remote_repo.get_target(device_id).await? {
        Some(t) if t.user_id == user.user_id => {}
        _ => {
            return Err(ApiError::not_found(
                "this device is not a registered target",
            ))
        }
    }
    state
        .remote_repo
        .set_target_state(device_id, &body.state, now_ms())
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ----------------------------------------------------------- pairings

async fn load_pairing(
    state: &AppState,
    user: &StreamingUser,
    id: Uuid,
) -> Result<RemotePairing, ApiError> {
    match state.remote_repo.get_pairing(id).await? {
        Some(p) if p.user_id == user.user_id => Ok(p),
        // Another account's pairing is indistinguishable from a missing one.
        _ => Err(ApiError::not_found("pairing not found")),
    }
}

#[utoipa::path(
    post,
    path = "/api/v1/remote/pairings",
    tag = "remote",
    request_body = CreatePairingRequest,
    responses(
        (status = 201, description = "A pending pairing; the target must approve it", body = PairingResponse),
        (status = 400, description = "Invalid scopes or pairing with itself"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller lacks Playarr streaming access"),
        (status = 404, description = "Unknown target on this account"),
        (status = 409, description = "Target offline, or already paired"),
        (status = 429, description = "Too many pending pairing requests for this target")
    )
)]
pub async fn create_pairing_handler(
    State(state): State<AppState>,
    user: StreamingUser,
    Json(body): Json<CreatePairingRequest>,
) -> Result<(StatusCode, Json<PairingResponse>), ApiError> {
    let now = now_ms();
    let me = caller_device(&user);
    if body.target_device_id == me {
        return Err(ApiError::bad_request("a device cannot pair with itself"));
    }
    let target = match state.remote_repo.get_target(body.target_device_id).await? {
        Some(t) if t.user_id == user.user_id => t,
        _ => return Err(ApiError::not_found("target device not found")),
    };
    if !is_online(&target, now) {
        return Err(api(
            StatusCode::CONFLICT,
            "target_offline",
            "the target device is not connected",
        ));
    }
    let scopes = match &body.scopes {
        Some(requested) => {
            let requested = validate_capabilities(requested)?;
            if requested.is_empty() || requested.iter().any(|s| !target.capabilities.contains(s)) {
                return Err(ApiError::bad_request(
                    "requested scopes must be a non-empty subset of the target's capabilities",
                ));
            }
            requested
        }
        None => target.capabilities.clone(),
    };

    let existing = state
        .remote_repo
        .list_pairings_for_user(user.user_id)
        .await?;
    let mut pending = 0;
    for p in existing
        .iter()
        .filter(|p| p.target_device_id == target.device_id)
    {
        match effective_status(p, now).as_str() {
            "active" if p.controller_device_id == me => {
                return Err(api(
                    StatusCode::CONFLICT,
                    "already_paired",
                    "this device is already paired with the target",
                ));
            }
            "pending" => {
                if p.controller_device_id == me {
                    return Ok((
                        StatusCode::OK,
                        Json(pairing_response(p, now, caller_device(&user))),
                    ));
                }
                pending += 1;
            }
            _ => {}
        }
    }
    if pending >= MAX_PENDING_PER_TARGET {
        return Err(api(
            StatusCode::TOO_MANY_REQUESTS,
            "too_many_pending",
            "too many pending pairing requests for this target",
        ));
    }

    let controller_name = match body.controller_name.as_deref().map(|n| clean_text(n, 80)) {
        Some(n) if !n.trim().is_empty() => n,
        _ => state
            .remote_repo
            .get_target(me)
            .await?
            .map(|t| t.name)
            .unwrap_or_else(|| "Phone".to_string()),
    };
    let pairing = RemotePairing {
        id: Uuid::new_v4(),
        user_id: user.user_id,
        controller_device_id: me,
        controller_name,
        target_device_id: target.device_id,
        status: "pending".into(),
        scopes,
        verification_code: format!("{:06}", Uuid::new_v4().as_u128() % 1_000_000),
        created_ms: now,
        expires_ms: now + PAIRING_PENDING_MS,
        approved_ms: None,
        revoked_ms: None,
        revoked_by: None,
    };
    state.remote_repo.insert_pairing(&pairing).await?;
    state
        .remote_repo
        .enqueue_event(RemoteEvent {
            id: Uuid::new_v4(),
            target_device_id: target.device_id,
            seq: 0,
            kind: "pairing_request".into(),
            pairing_id: Some(pairing.id),
            user_id: user.user_id,
            controller_device_id: Some(me),
            payload: Some(json!({
                "pairing_id": pairing.id,
                "controller_name": pairing.controller_name,
                "controller_device_id": me,
                "scopes": pairing.scopes,
                "verification_code": pairing.verification_code,
            })),
            status: "queued".into(),
            result: None,
            created_ms: now,
            expires_ms: pairing.expires_ms,
        })
        .await?;
    tracing::info!(pairing_id = %pairing.id, "remote pairing requested");
    Ok((
        StatusCode::CREATED,
        Json(pairing_response(&pairing, now, me)),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/remote/pairings",
    tag = "remote",
    responses(
        (status = 200, description = "Recent pairings of this account", body = [PairingResponse]),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller lacks Playarr streaming access")
    )
)]
pub async fn list_pairings_handler(
    State(state): State<AppState>,
    user: StreamingUser,
) -> Result<Json<Vec<PairingResponse>>, ApiError> {
    let now = now_ms();
    let rows = state
        .remote_repo
        .list_pairings_for_user(user.user_id)
        .await?;
    Ok(Json(
        rows.iter()
            .map(|p| pairing_response(p, now, caller_device(&user)))
            .collect(),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/remote/pairings/{id}",
    tag = "remote",
    params(("id" = Uuid, Path, description = "Pairing id")),
    responses(
        (status = 200, description = "The pairing", body = PairingResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 404, description = "Unknown pairing, or it belongs to another account")
    )
)]
pub async fn get_pairing_handler(
    State(state): State<AppState>,
    user: StreamingUser,
    Path(id): Path<Uuid>,
) -> Result<Json<PairingResponse>, ApiError> {
    let p = load_pairing(&state, &user, id).await?;
    Ok(Json(pairing_response(&p, now_ms(), caller_device(&user))))
}

#[utoipa::path(
    post,
    path = "/api/v1/remote/pairings/{id}/approve",
    tag = "remote",
    params(("id" = Uuid, Path, description = "Pairing id")),
    request_body = ApprovePairingRequest,
    responses(
        (status = 200, description = "Pairing is now active", body = PairingResponse),
        (status = 400, description = "Scopes are not a subset of those requested"),
        (status = 403, description = "Only the target device itself can approve"),
        (status = 404, description = "Unknown pairing, or it belongs to another account"),
        (status = 409, description = "Pairing is no longer pending"),
        (status = 410, description = "Pairing request expired")
    )
)]
pub async fn approve_pairing_handler(
    State(state): State<AppState>,
    user: StreamingUser,
    Path(id): Path<Uuid>,
    Json(body): Json<ApprovePairingRequest>,
) -> Result<Json<PairingResponse>, ApiError> {
    let now = now_ms();
    let p = load_pairing(&state, &user, id).await?;
    if p.target_device_id != caller_device(&user) {
        return Err(forbidden("only the target device can approve a pairing"));
    }
    match effective_status(&p, now).as_str() {
        "pending" => {}
        "expired" => {
            return Err(api(
                StatusCode::GONE,
                "pairing_expired",
                "pairing request expired",
            ))
        }
        _ => return Err(ApiError::conflict("pairing is no longer pending")),
    }
    if let Some(narrow) = &body.scopes {
        let narrow = validate_capabilities(narrow)?;
        if narrow.is_empty() || narrow.iter().any(|s| !p.scopes.contains(s)) {
            return Err(ApiError::bad_request(
                "granted scopes must be a non-empty subset of those requested",
            ));
        }
        // Narrowing happens before activation so the granted set never
        // exceeds what the person at the target approved.
        state.remote_repo.set_pairing_scopes(id, &narrow).await?;
    }
    if !state
        .remote_repo
        .transition_pairing(
            id,
            &["pending"],
            "active",
            now,
            Some(now + PAIRING_ACTIVE_MS),
            None,
        )
        .await?
    {
        return Err(ApiError::conflict("pairing is no longer pending"));
    }
    tracing::info!(pairing_id = %id, "remote pairing approved");
    let p = load_pairing(&state, &user, id).await?;
    Ok(Json(pairing_response(&p, now, caller_device(&user))))
}

#[utoipa::path(
    post,
    path = "/api/v1/remote/pairings/{id}/deny",
    tag = "remote",
    params(("id" = Uuid, Path, description = "Pairing id")),
    responses(
        (status = 200, description = "Pairing denied", body = PairingResponse),
        (status = 403, description = "Only the target device itself can deny"),
        (status = 404, description = "Unknown pairing, or it belongs to another account"),
        (status = 409, description = "Pairing is no longer pending")
    )
)]
pub async fn deny_pairing_handler(
    State(state): State<AppState>,
    user: StreamingUser,
    Path(id): Path<Uuid>,
) -> Result<Json<PairingResponse>, ApiError> {
    let now = now_ms();
    let p = load_pairing(&state, &user, id).await?;
    if p.target_device_id != caller_device(&user) {
        return Err(forbidden("only the target device can deny a pairing"));
    }
    if !state
        .remote_repo
        .transition_pairing(id, &["pending"], "denied", now, None, None)
        .await?
    {
        return Err(ApiError::conflict("pairing is no longer pending"));
    }
    let p = load_pairing(&state, &user, id).await?;
    Ok(Json(pairing_response(&p, now, caller_device(&user))))
}

#[utoipa::path(
    delete,
    path = "/api/v1/remote/pairings/{id}",
    tag = "remote",
    params(("id" = Uuid, Path, description = "Pairing id")),
    responses(
        (status = 204, description = "Pairing revoked (idempotent)"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 404, description = "Unknown pairing, or it belongs to another account")
    )
)]
pub async fn revoke_pairing_handler(
    State(state): State<AppState>,
    user: StreamingUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let now = now_ms();
    let p = load_pairing(&state, &user, id).await?;
    if state
        .remote_repo
        .transition_pairing(
            id,
            &["pending", "active"],
            "revoked",
            now,
            None,
            Some(user.user_id),
        )
        .await?
    {
        state
            .remote_repo
            .enqueue_event(RemoteEvent {
                id: Uuid::new_v4(),
                target_device_id: p.target_device_id,
                seq: 0,
                kind: "pairing_revoked".into(),
                pairing_id: Some(p.id),
                user_id: p.user_id,
                controller_device_id: Some(p.controller_device_id),
                payload: Some(json!({"pairing_id": p.id})),
                status: "queued".into(),
                result: None,
                created_ms: now,
                expires_ms: now + NOTICE_TTL_MS,
            })
            .await?;
        tracing::info!(pairing_id = %id, "remote pairing revoked");
    }
    Ok(StatusCode::NO_CONTENT)
}

// ----------------------------------------------------------- commands

fn validate_command(kind: &str, payload: &Value) -> Result<Value, ApiError> {
    let obj = payload
        .as_object()
        .ok_or_else(|| ApiError::bad_request("payload must be an object"))?;
    let str_field = |name: &str| obj.get(name).and_then(Value::as_str);
    let num_field = |name: &str| obj.get(name).and_then(Value::as_i64);
    match kind {
        "navigate" => {
            let key = str_field("key").unwrap_or_default();
            if !NAV_KEYS.contains(&key) {
                return Err(ApiError::bad_request("unknown navigation key"));
            }
            Ok(json!({"key": key}))
        }
        "text" => {
            let mode = str_field("mode").unwrap_or("insert");
            if !["insert", "replace", "backspace"].contains(&mode) {
                return Err(ApiError::bad_request("unknown text mode"));
            }
            let value = str_field("value").unwrap_or_default();
            if value.chars().count() > 512 {
                return Err(ApiError::bad_request("text is too long"));
            }
            let submit = obj.get("submit").and_then(Value::as_bool).unwrap_or(false);
            Ok(json!({"value": value, "mode": mode, "submit": submit}))
        }
        "playback" => {
            let action = str_field("action").unwrap_or_default();
            if !PLAYBACK_ACTIONS.contains(&action) {
                return Err(ApiError::bad_request("unknown playback action"));
            }
            let mut out = json!({"action": action});
            match action {
                "seek" => {
                    let p = num_field("position_ms")
                        .filter(|p| *p >= 0)
                        .ok_or_else(|| ApiError::bad_request("seek needs position_ms >= 0"))?;
                    out["position_ms"] = json!(p);
                }
                "seek_by" => {
                    let d = num_field("delta_ms")
                        .filter(|d| d.abs() <= 6 * 3_600_000)
                        .ok_or_else(|| ApiError::bad_request("seek_by needs delta_ms"))?;
                    out["delta_ms"] = json!(d);
                }
                "set_audio" | "set_subtitle" => {
                    // `off` is valid for subtitles; otherwise a language tag.
                    let lang = clean_text(str_field("language").unwrap_or("off"), 16);
                    out["language"] = json!(lang);
                }
                "volume" => {
                    let level = num_field("level")
                        .filter(|l| (0..=100).contains(l))
                        .ok_or_else(|| ApiError::bad_request("volume needs level 0..100"))?;
                    out["level"] = json!(level);
                }
                _ => {}
            }
            Ok(out)
        }
        "input" => {
            let id = clean_text(str_field("input_id").unwrap_or_default(), 128);
            if id.is_empty() {
                return Err(ApiError::bad_request("input needs input_id"));
            }
            Ok(json!({"input_id": id}))
        }
        _ => Err(ApiError::bad_request("unknown command kind")),
    }
}

#[utoipa::path(
    post,
    path = "/api/v1/remote/pairings/{id}/commands",
    tag = "remote",
    params(("id" = Uuid, Path, description = "Pairing id")),
    request_body = CommandRequest,
    responses(
        (status = 202, description = "Command queued for the target", body = CommandAccepted),
        (status = 400, description = "Invalid command"),
        (status = 403, description = "Pairing not active, scope not granted, or not this pairing's controller device"),
        (status = 404, description = "Unknown pairing, or it belongs to another account"),
        (status = 409, description = "Target is offline"),
        (status = 410, description = "Pairing expired")
    )
)]
pub async fn send_command_handler(
    State(state): State<AppState>,
    user: StreamingUser,
    Path(id): Path<Uuid>,
    Json(body): Json<CommandRequest>,
) -> Result<(StatusCode, Json<CommandAccepted>), ApiError> {
    let now = now_ms();
    let p = load_pairing(&state, &user, id).await?;
    if p.controller_device_id != caller_device(&user) {
        return Err(forbidden(
            "this pairing belongs to another controller device",
        ));
    }
    match effective_status(&p, now).as_str() {
        "active" => {}
        "expired" => return Err(api(StatusCode::GONE, "pairing_expired", "pairing expired")),
        _ => {
            return Err(api(
                StatusCode::FORBIDDEN,
                "pairing_not_active",
                "pairing is not active",
            ))
        }
    }
    if !COMMAND_SCOPES.contains(&body.kind.as_str()) {
        return Err(ApiError::bad_request("unknown command kind"));
    }
    if !p.scopes.contains(&body.kind) {
        return Err(api(
            StatusCode::FORBIDDEN,
            "scope_not_granted",
            "this pairing does not grant that kind of command",
        ));
    }
    let payload = validate_command(&body.kind, &body.payload)?;
    let target = state
        .remote_repo
        .get_target(p.target_device_id)
        .await?
        .filter(|t| t.user_id == user.user_id);
    match target {
        Some(t) if is_online(&t, now) && t.capabilities.contains(&body.kind) => {}
        Some(t) if is_online(&t, now) => {
            return Err(api(
                StatusCode::CONFLICT,
                "unsupported_by_target",
                "the target no longer advertises that capability",
            ))
        }
        _ => {
            return Err(api(
                StatusCode::CONFLICT,
                "target_offline",
                "the target device is not connected",
            ))
        }
    }
    let event = state
        .remote_repo
        .enqueue_event(RemoteEvent {
            id: Uuid::new_v4(),
            target_device_id: p.target_device_id,
            seq: 0,
            kind: "command".into(),
            pairing_id: Some(p.id),
            user_id: user.user_id,
            controller_device_id: Some(p.controller_device_id),
            payload: Some(json!({"kind": body.kind, "args": payload})),
            status: "queued".into(),
            result: None,
            created_ms: now,
            expires_ms: now + COMMAND_TTL_MS,
        })
        .await?;
    // Deliberately no payload in the log line: `text` commands are keystrokes.
    tracing::debug!(pairing_id = %p.id, command_id = %event.id, kind = %body.kind, "remote command queued");
    Ok((
        StatusCode::ACCEPTED,
        Json(CommandAccepted {
            command_id: event.id,
            seq: event.seq,
        }),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/remote/commands/{id}",
    tag = "remote",
    params(("id" = Uuid, Path, description = "Command id")),
    responses(
        (status = 200, description = "Delivery outcome (never the payload)", body = CommandStatusResponse),
        (status = 404, description = "Unknown command, or not sent by this controller device")
    )
)]
pub async fn command_status_handler(
    State(state): State<AppState>,
    user: StreamingUser,
    Path(id): Path<Uuid>,
) -> Result<Json<CommandStatusResponse>, ApiError> {
    let now = now_ms();
    let event = state
        .remote_repo
        .get_event(id)
        .await?
        .filter(|e| {
            e.kind == "command"
                && e.user_id == user.user_id
                && e.controller_device_id == Some(caller_device(&user))
        })
        .ok_or_else(|| ApiError::not_found("command not found"))?;
    let mut status = event.status.clone();
    if (status == "queued" || status == "delivered") && event.expires_ms <= now {
        status = "expired".into();
    }
    let detail = event
        .result
        .as_ref()
        .and_then(|r| r.get("detail"))
        .and_then(Value::as_str)
        .map(str::to_string);
    Ok(Json(CommandStatusResponse {
        command_id: id,
        status,
        detail,
    }))
}

// -------------------------------------------------------------- inbox

#[utoipa::path(
    get,
    path = "/api/v1/remote/inbox",
    tag = "remote",
    params(
        ("after" = Option<i64>, Query, description = "Last seq already processed"),
        ("wait" = Option<u64>, Query, description = "Seconds to wait for an event (max 25)")
    ),
    responses(
        (status = 200, description = "Events for this target device (long poll)", body = InboxResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 404, description = "This device is not registered as a target")
    )
)]
pub async fn inbox_handler(
    State(state): State<AppState>,
    user: StreamingUser,
    Query(query): Query<InboxQuery>,
) -> Result<Json<InboxResponse>, ApiError> {
    let device_id = caller_device(&user);
    match state.remote_repo.get_target(device_id).await? {
        Some(t) if t.user_id == user.user_id => {}
        _ => {
            return Err(ApiError::not_found(
                "this device is not a registered target",
            ))
        }
    }
    let deadline = tokio::time::Instant::now() + Duration::from_secs(query.wait.min(25));
    loop {
        let now = now_ms();
        state.remote_repo.touch_target(device_id, now).await?;
        let raw = state
            .remote_repo
            .deliver_events(device_id, query.after, now, 50)
            .await?;
        let mut events = Vec::with_capacity(raw.len());
        let mut next = query.after;
        for e in raw {
            next = next.max(e.seq);
            if e.kind == "command" && !pairing_authorises(&state, &e, now).await {
                // Revoked or expired after queueing: never reaches the target.
                let _ = state
                    .remote_repo
                    .ack_event(e.id, device_id, "revoked", None)
                    .await;
                continue;
            }
            events.push(InboxEvent {
                id: e.id,
                seq: e.seq,
                kind: e.kind,
                pairing_id: e.pairing_id,
                payload: e.payload,
                created_ms: e.created_ms,
                expires_ms: e.expires_ms,
            });
        }
        if !events.is_empty() || tokio::time::Instant::now() >= deadline {
            if next == query.after && events.is_empty() {
                let _ = state.remote_repo.purge_events(now).await;
            }
            return Ok(Json(InboxResponse { events, next }));
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
}

async fn pairing_authorises(state: &AppState, event: &RemoteEvent, now: i64) -> bool {
    let Some(pairing_id) = event.pairing_id else {
        return false;
    };
    match state.remote_repo.get_pairing(pairing_id).await {
        Ok(Some(p)) => effective_status(&p, now) == "active",
        _ => false,
    }
}

#[utoipa::path(
    post,
    path = "/api/v1/remote/events/{id}/ack",
    tag = "remote",
    params(("id" = Uuid, Path, description = "Event id")),
    request_body = AckEventRequest,
    responses(
        (status = 204, description = "Acknowledged"),
        (status = 400, description = "Invalid status"),
        (status = 404, description = "Unknown event, or not addressed to this device"),
        (status = 409, description = "Already acknowledged or expired")
    )
)]
pub async fn ack_event_handler(
    State(state): State<AppState>,
    user: StreamingUser,
    Path(id): Path<Uuid>,
    Json(body): Json<AckEventRequest>,
) -> Result<StatusCode, ApiError> {
    if !["ok", "failed", "unsupported"].contains(&body.status.as_str()) {
        return Err(ApiError::bad_request(
            "status must be ok, failed or unsupported",
        ));
    }
    let device_id = caller_device(&user);
    state
        .remote_repo
        .get_event(id)
        .await?
        .filter(|e| e.target_device_id == device_id && e.user_id == user.user_id)
        .ok_or_else(|| ApiError::not_found("event not found"))?;
    let result = body
        .detail
        .as_deref()
        .map(|d| json!({"detail": clean_text(d, 200)}));
    if state
        .remote_repo
        .ack_event(id, device_id, &body.status, result.as_ref())
        .await?
    {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::conflict("event already acknowledged"))
    }
}

// ----------------------------------------------------------- handoffs

async fn require_handoff_pairing(
    state: &AppState,
    initiator: Uuid,
    other: Uuid,
    now: i64,
) -> Result<(), ApiError> {
    if initiator == other {
        return Ok(());
    }
    match state
        .remote_repo
        .find_pairing(initiator, other, "active")
        .await?
    {
        Some(p) if p.expires_ms > now && p.scopes.iter().any(|s| s == "handoff") => Ok(()),
        _ => Err(api(
            StatusCode::FORBIDDEN,
            "pairing_required",
            "an active pairing with the handoff scope is required for that device",
        )),
    }
}

#[utoipa::path(
    post,
    path = "/api/v1/remote/handoffs",
    tag = "remote",
    request_body = CreateHandoffRequest,
    responses(
        (status = 201, description = "Handoff offered to the destination; the source keeps playing until the destination acknowledges", body = HandoffResponse),
        (status = 200, description = "Idempotent replay of an existing handoff", body = HandoffResponse),
        (status = 400, description = "Invalid request"),
        (status = 403, description = "No library access, wrong account, or no active handoff pairing"),
        (status = 404, description = "Unknown device or media file"),
        (status = 409, description = "Destination offline/unsupported, stale source state, or key reused with different parameters")
    )
)]
pub async fn create_handoff_handler(
    State(state): State<AppState>,
    user: StreamingUser,
    Json(body): Json<CreateHandoffRequest>,
) -> Result<(StatusCode, Json<HandoffResponse>), ApiError> {
    let now = now_ms();
    let me = caller_device(&user);
    let key = body.request_key.trim().to_string();
    if key.is_empty() || key.len() > 128 {
        return Err(ApiError::bad_request(
            "request_key must be 1..128 characters",
        ));
    }
    if body.source_device_id == body.destination_device_id {
        return Err(ApiError::bad_request("source and destination must differ"));
    }
    // A third device (typically a phone) may direct the transfer; it still
    // needs an active handoff pairing with each end, checked below.

    // Idempotent replay.
    if let Some(existing) = state.remote_repo.find_handoff_by_key(me, &key).await? {
        if existing.user_id == user.user_id
            && existing.source_device_id == body.source_device_id
            && existing.destination_device_id == body.destination_device_id
        {
            return Ok((StatusCode::OK, Json(handoff_response(&existing))));
        }
        return Err(ApiError::conflict(
            "request_key was already used for a different handoff",
        ));
    }

    let lookup = |id: Uuid| {
        let repo = state.remote_repo.clone();
        let user_id = user.user_id;
        async move {
            match repo.get_target(id).await? {
                Some(t) if t.user_id == user_id => Ok(t),
                _ => Err(ApiError::not_found("device not found")),
            }
        }
    };
    let source = lookup(body.source_device_id).await?;
    let destination = lookup(body.destination_device_id).await?;

    require_handoff_pairing(&state, me, source.device_id, now).await?;
    require_handoff_pairing(&state, me, destination.device_id, now).await?;
    if !destination.capabilities.iter().any(|c| c == "handoff") {
        return Err(api(
            StatusCode::CONFLICT,
            "destination_unsupported",
            "the destination does not support handoff",
        ));
    }
    if !is_online(&destination, now) {
        return Err(api(
            StatusCode::CONFLICT,
            "target_offline",
            "the destination device is not connected",
        ));
    }
    if !source.capabilities.iter().any(|c| c == "handoff") {
        return Err(api(
            StatusCode::CONFLICT,
            "source_unsupported",
            "the source cannot be stopped by handoff",
        ));
    }

    let (media_file_id, snapshot) = if me == source.device_id {
        let media = body
            .media_file_id
            .ok_or_else(|| ApiError::bad_request("media_file_id is required from the source"))?;
        let snap = body
            .snapshot
            .clone()
            .ok_or_else(|| ApiError::bad_request("snapshot is required from the source"))?;
        (media, snap)
    } else {
        let reported = source
            .state
            .as_ref()
            .zip(source.state_at_ms)
            .filter(|(_, at)| now - *at <= STATE_MAX_AGE_MS)
            .map(|(s, _)| s.clone())
            .ok_or_else(|| {
                api(
                    StatusCode::CONFLICT,
                    "source_state_stale",
                    "the source has not reported playback recently",
                )
            })?;
        let media = reported
            .get("media_file_id")
            .and_then(Value::as_str)
            .and_then(|s| Uuid::parse_str(s).ok())
            .ok_or_else(|| {
                api(
                    StatusCode::CONFLICT,
                    "nothing_playing",
                    "the source is not playing anything",
                )
            })?;
        if body.media_file_id.is_some_and(|m| m != media) {
            return Err(ApiError::conflict("the source is playing different media"));
        }
        let snap: PlaybackSnapshot = serde_json::from_value(reported)
            .map_err(|_| ApiError::conflict("the source reported an unusable state"))?;
        (media, snap)
    };

    // Destination access, evaluated like playback negotiation would.
    let media = state
        .media_files
        .get(media_file_id)
        .await
        .ok_or_else(|| ApiError::not_found("media file not found"))?;
    ensure_library_allowed(
        media.source_instance_id,
        user.allowed_libraries().as_deref(),
    )?;

    let handoff = RemoteHandoff {
        id: Uuid::new_v4(),
        user_id: user.user_id,
        initiator_device_id: me,
        request_key: key,
        source_device_id: source.device_id,
        destination_device_id: destination.device_id,
        media_file_id,
        work_id: media.work_id,
        snapshot: serde_json::to_value(&snapshot).map_err(|e| ApiError::internal(e.to_string()))?,
        status: "pending".into(),
        created_ms: now,
        expires_ms: now + HANDOFF_TTL_MS,
        completed_ms: None,
        acked_position_ms: None,
        failure_reason: None,
    };
    state.remote_repo.insert_handoff(&handoff).await?;
    state
        .remote_repo
        .enqueue_event(RemoteEvent {
            id: Uuid::new_v4(),
            target_device_id: destination.device_id,
            seq: 0,
            kind: "handoff_offer".into(),
            pairing_id: None,
            user_id: user.user_id,
            controller_device_id: Some(me),
            payload: Some(json!({
                "handoff_id": handoff.id,
                "media_file_id": media_file_id,
                "work_id": media.work_id,
                "source_device_id": source.device_id,
                "snapshot": handoff.snapshot,
                "expires_ms": handoff.expires_ms,
            })),
            status: "queued".into(),
            result: None,
            created_ms: now,
            expires_ms: handoff.expires_ms,
        })
        .await?;
    tracing::info!(handoff_id = %handoff.id, "handoff offered");
    Ok((StatusCode::CREATED, Json(handoff_response(&handoff))))
}

async fn load_handoff(
    state: &AppState,
    user: &StreamingUser,
    id: Uuid,
) -> Result<RemoteHandoff, ApiError> {
    let now = now_ms();
    let mut h = match state.remote_repo.get_handoff(id).await? {
        Some(h) if h.user_id == user.user_id => h,
        _ => return Err(ApiError::not_found("handoff not found")),
    };
    if h.status == "pending" && h.expires_ms <= now {
        // Lazy expiry; the source was never told to stop.
        if state
            .remote_repo
            .close_handoff(
                id,
                "expired",
                Some("destination did not acknowledge in time"),
                now,
            )
            .await?
        {
            h = state.remote_repo.get_handoff(id).await?.unwrap_or(h);
        }
    }
    Ok(h)
}

#[utoipa::path(
    get,
    path = "/api/v1/remote/handoffs/{id}",
    tag = "remote",
    params(("id" = Uuid, Path, description = "Handoff id")),
    responses(
        (status = 200, description = "Current handoff state", body = HandoffResponse),
        (status = 404, description = "Unknown handoff, or it belongs to another account")
    )
)]
pub async fn get_handoff_handler(
    State(state): State<AppState>,
    user: StreamingUser,
    Path(id): Path<Uuid>,
) -> Result<Json<HandoffResponse>, ApiError> {
    Ok(Json(handoff_response(
        &load_handoff(&state, &user, id).await?,
    )))
}

#[utoipa::path(
    post,
    path = "/api/v1/remote/handoffs/{id}/ack",
    tag = "remote",
    params(("id" = Uuid, Path, description = "Handoff id")),
    request_body = AckHandoffRequest,
    responses(
        (status = 200, description = "Outcome recorded. Replays return the recorded outcome without a second stop", body = HandoffResponse),
        (status = 400, description = "Invalid status"),
        (status = 403, description = "Only the destination device can acknowledge"),
        (status = 404, description = "Unknown handoff, or it belongs to another account"),
        (status = 410, description = "Handoff expired; the source keeps playing")
    )
)]
pub async fn ack_handoff_handler(
    State(state): State<AppState>,
    user: StreamingUser,
    Path(id): Path<Uuid>,
    Json(body): Json<AckHandoffRequest>,
) -> Result<Json<HandoffResponse>, ApiError> {
    let now = now_ms();
    let h = load_handoff(&state, &user, id).await?;
    if h.destination_device_id != caller_device(&user) {
        return Err(forbidden(
            "only the destination device can acknowledge a handoff",
        ));
    }
    let playing = match body.status.as_str() {
        "playing" => true,
        "failed" => false,
        _ => return Err(ApiError::bad_request("status must be playing or failed")),
    };
    if h.status != "pending" {
        if h.status == "expired" {
            return Err(api(StatusCode::GONE, "handoff_expired", "handoff expired"));
        }
        // Replay: report the recorded outcome, change nothing.
        return Ok(Json(handoff_response(&h)));
    }
    if !playing {
        let reason = clean_text(
            body.reason
                .as_deref()
                .unwrap_or("destination failed to play"),
            200,
        );
        state
            .remote_repo
            .close_handoff(id, "failed", Some(&reason), now)
            .await?;
        let h = load_handoff(&state, &user, id).await?;
        return Ok(Json(handoff_response(&h)));
    }
    let position = body
        .position_ms
        .ok_or_else(|| ApiError::bad_request("position_ms is required for playing"))?;
    if state
        .remote_repo
        .commit_handoff(id, position as i64, now)
        .await?
    {
        // Only now is the source told to stop.
        state
            .remote_repo
            .enqueue_event(RemoteEvent {
                id: Uuid::new_v4(),
                target_device_id: h.source_device_id,
                seq: 0,
                kind: "handoff_stop".into(),
                pairing_id: None,
                user_id: h.user_id,
                controller_device_id: Some(h.destination_device_id),
                payload: Some(json!({
                    "handoff_id": h.id,
                    "destination_device_id": h.destination_device_id,
                    "position_ms": position,
                })),
                status: "queued".into(),
                result: None,
                created_ms: now,
                expires_ms: now + NOTICE_TTL_MS,
            })
            .await?;
        tracing::info!(handoff_id = %id, "handoff committed");
    }
    let h = load_handoff(&state, &user, id).await?;
    if h.status == "expired" {
        return Err(api(StatusCode::GONE, "handoff_expired", "handoff expired"));
    }
    Ok(Json(handoff_response(&h)))
}

#[utoipa::path(
    post,
    path = "/api/v1/remote/handoffs/{id}/cancel",
    tag = "remote",
    params(("id" = Uuid, Path, description = "Handoff id")),
    responses(
        (status = 200, description = "Cancelled (or the recorded outcome if already closed)", body = HandoffResponse),
        (status = 403, description = "Only the initiating device can cancel"),
        (status = 404, description = "Unknown handoff, or it belongs to another account")
    )
)]
pub async fn cancel_handoff_handler(
    State(state): State<AppState>,
    user: StreamingUser,
    Path(id): Path<Uuid>,
) -> Result<Json<HandoffResponse>, ApiError> {
    let h = load_handoff(&state, &user, id).await?;
    if h.initiator_device_id != caller_device(&user) {
        return Err(forbidden("only the initiating device can cancel a handoff"));
    }
    state
        .remote_repo
        .close_handoff(id, "cancelled", Some("cancelled by initiator"), now_ms())
        .await?;
    Ok(Json(handoff_response(
        &load_handoff(&state, &user, id).await?,
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        seed_downloadable_media_file, seed_movie, seed_streaming_user,
        seed_streaming_user_with_library_allow, test_state, TestState,
    };
    use axum::body::Body;
    use axum::http::Request;
    use axum::Router;
    use tower::ServiceExt;

    const LIB: Uuid = Uuid::from_u128(7);

    struct Dev {
        id: Uuid,
        token: String,
    }

    fn dev(state: &TestState, user: Uuid) -> Dev {
        let id = Uuid::new_v4();
        let token = state
            .app
            .jwt
            .issue_access_token(user, id, Uuid::new_v4())
            .unwrap();
        Dev { id, token }
    }

    async fn call(
        router: &Router,
        method: &str,
        uri: &str,
        token: &str,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let mut req = Request::builder()
            .method(method)
            .uri(uri)
            .header("Authorization", format!("Bearer {token}"));
        let body = match body {
            Some(b) => {
                req = req.header("Content-Type", "application/json");
                Body::from(serde_json::to_vec(&b).unwrap())
            }
            None => Body::empty(),
        };
        let res = router
            .clone()
            .oneshot(req.body(body).unwrap())
            .await
            .unwrap();
        let status = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap();
        let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, value)
    }

    async fn register(router: &Router, d: &Dev, name: &str, caps: &[&str]) {
        let (s, _) = call(
            router,
            "PUT",
            "/api/v1/remote/target",
            &d.token,
            Some(json!({"name": name, "platform": "android-tv", "capabilities": caps})),
        )
        .await;
        assert_eq!(s, StatusCode::OK);
    }

    async fn inbox(router: &Router, d: &Dev, after: i64) -> Vec<Value> {
        let (s, v) = call(
            router,
            "GET",
            &format!("/api/v1/remote/inbox?after={after}"),
            &d.token,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        v["events"].as_array().unwrap().clone()
    }

    /// Pairs `phone` with `tv` and returns the pairing id.
    async fn pair(router: &Router, phone: &Dev, tv: &Dev, scopes: Option<Value>) -> String {
        let mut body = json!({"target_device_id": tv.id, "controller_name": "Test phone"});
        if let Some(s) = scopes {
            body["scopes"] = s;
        }
        let (s, v) = call(
            router,
            "POST",
            "/api/v1/remote/pairings",
            &phone.token,
            Some(body),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        let id = v["id"].as_str().unwrap().to_string();
        let (s, _) = call(
            router,
            "POST",
            &format!("/api/v1/remote/pairings/{id}/approve"),
            &tv.token,
            Some(json!({})),
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        id
    }

    async fn setup() -> (Router, TestState, Uuid, Dev, Dev) {
        let (router, state) = test_state().await;
        let user = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user, vec![LIB]).await;
        let phone = dev(&state, user);
        let tv = dev(&state, user);
        register(&router, &tv, "Living room TV", &CAPABILITIES).await;
        register(&router, &phone, "Phone", &["handoff", "playback"]).await;
        (router, state, user, phone, tv)
    }

    #[tokio::test]
    async fn pairing_needs_target_approval_before_commands_work() {
        let (router, _state, _user, phone, tv) = setup().await;
        let (s, v) = call(
            &router,
            "POST",
            "/api/v1/remote/pairings",
            &phone.token,
            Some(json!({"target_device_id": tv.id})),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED);
        let id = v["id"].as_str().unwrap().to_string();
        assert_eq!(v["status"], "pending");
        assert_eq!(v["verification_code"].as_str().unwrap().len(), 6);

        let events = inbox(&router, &tv, 0).await;
        assert_eq!(events[0]["kind"], "pairing_request");
        assert_eq!(
            events[0]["payload"]["verification_code"],
            v["verification_code"]
        );

        let cmd = json!({"kind": "navigate", "payload": {"key": "down"}});
        let (s, v) = call(
            &router,
            "POST",
            &format!("/api/v1/remote/pairings/{id}/commands"),
            &phone.token,
            Some(cmd.clone()),
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
        assert_eq!(v["error"], "pairing_not_active");

        // The controller cannot approve its own pairing.
        let (s, _) = call(
            &router,
            "POST",
            &format!("/api/v1/remote/pairings/{id}/approve"),
            &phone.token,
            Some(json!({})),
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN);

        let (s, _) = call(
            &router,
            "POST",
            &format!("/api/v1/remote/pairings/{id}/approve"),
            &tv.token,
            Some(json!({})),
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        let (s, v) = call(
            &router,
            "POST",
            &format!("/api/v1/remote/pairings/{id}/commands"),
            &phone.token,
            Some(cmd),
        )
        .await;
        assert_eq!(s, StatusCode::ACCEPTED, "{v}");
        let command_id = v["command_id"].as_str().unwrap().to_string();

        let events = inbox(&router, &tv, 1).await;
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["kind"], "command");
        assert_eq!(events[0]["payload"]["args"]["key"], "down");
        let (s, _) = call(
            &router,
            "POST",
            &format!("/api/v1/remote/events/{command_id}/ack"),
            &tv.token,
            Some(json!({"status": "ok"})),
        )
        .await;
        assert_eq!(s, StatusCode::NO_CONTENT);
        let (_, v) = call(
            &router,
            "GET",
            &format!("/api/v1/remote/commands/{command_id}"),
            &phone.token,
            None,
        )
        .await;
        assert_eq!(v["status"], "ok");
    }

    #[tokio::test]
    async fn wrong_account_and_wrong_device_are_rejected() {
        let (router, state, user, phone, tv) = setup().await;
        let id = pair(&router, &phone, &tv, None).await;
        let cmd = json!({"kind": "navigate", "payload": {"key": "up"}});
        let uri = format!("/api/v1/remote/pairings/{id}/commands");

        // Another account sees nothing.
        let other_user = Uuid::new_v4();
        seed_streaming_user(&state, other_user).await;
        let stranger = dev(&state, other_user);
        let (s, _) = call(&router, "POST", &uri, &stranger.token, Some(cmd.clone())).await;
        assert_eq!(s, StatusCode::NOT_FOUND);
        let (s, _) = call(
            &router,
            "GET",
            &format!("/api/v1/remote/pairings/{id}"),
            &stranger.token,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::NOT_FOUND);
        let (s, _) = call(
            &router,
            "DELETE",
            &format!("/api/v1/remote/pairings/{id}"),
            &stranger.token,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::NOT_FOUND);
        // ... and cannot pair with or list the account's targets.
        let (s, _) = call(
            &router,
            "POST",
            "/api/v1/remote/pairings",
            &stranger.token,
            Some(json!({"target_device_id": tv.id})),
        )
        .await;
        assert_eq!(s, StatusCode::NOT_FOUND);

        // A second device of the right account cannot reuse the pairing.
        let tablet = dev(&state, user);
        let (s, v) = call(&router, "POST", &uri, &tablet.token, Some(cmd)).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
        // The target cannot send commands to itself via the pairing either.
        let (s, _) = call(
            &router,
            "POST",
            &uri,
            &tv.token,
            Some(json!({"kind": "navigate", "payload": {"key": "up"}})),
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn scopes_are_enforced() {
        let (router, _state, _user, phone, tv) = setup().await;
        let id = pair(&router, &phone, &tv, Some(json!(["navigate", "text"]))).await;
        let uri = format!("/api/v1/remote/pairings/{id}/commands");
        let (s, v) = call(
            &router,
            "POST",
            &uri,
            &phone.token,
            Some(json!({"kind": "playback", "payload": {"action": "pause"}})),
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN);
        assert_eq!(v["error"], "scope_not_granted");
        let (s, _) = call(
            &router,
            "POST",
            "/api/v1/remote/pairings",
            &phone.token,
            Some(json!({"target_device_id": tv.id, "scopes": ["navigate", "bogus"]})),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn invalid_commands_are_rejected() {
        let (router, _state, _user, phone, tv) = setup().await;
        let id = pair(&router, &phone, &tv, None).await;
        let uri = format!("/api/v1/remote/pairings/{id}/commands");
        for cmd in [
            json!({"kind": "navigate", "payload": {"key": "teleport"}}),
            json!({"kind": "playback", "payload": {"action": "seek"}}),
            json!({"kind": "text", "payload": {"value": "x".repeat(600)}}),
            json!({"kind": "shell", "payload": {}}),
            json!({"kind": "input", "payload": {}}),
        ] {
            let (s, _) = call(&router, "POST", &uri, &phone.token, Some(cmd)).await;
            assert_eq!(s, StatusCode::BAD_REQUEST);
        }
    }

    #[tokio::test]
    async fn revoked_pairing_rejects_new_and_queued_commands() {
        let (router, _state, _user, phone, tv) = setup().await;
        let id = pair(&router, &phone, &tv, None).await;
        let uri = format!("/api/v1/remote/pairings/{id}/commands");
        let (s, _) = call(
            &router,
            "POST",
            &uri,
            &phone.token,
            Some(json!({"kind": "navigate", "payload": {"key": "left"}})),
        )
        .await;
        assert_eq!(s, StatusCode::ACCEPTED);
        // Revoked from the target side before the command is delivered.
        let (s, _) = call(
            &router,
            "DELETE",
            &format!("/api/v1/remote/pairings/{id}"),
            &tv.token,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::NO_CONTENT);
        let events = inbox(&router, &tv, 0).await;
        let kinds: Vec<&str> = events.iter().map(|e| e["kind"].as_str().unwrap()).collect();
        assert!(
            !kinds.contains(&"command"),
            "queued command leaked: {kinds:?}"
        );
        assert!(kinds.contains(&"pairing_revoked"));
        let (s, v) = call(
            &router,
            "POST",
            &uri,
            &phone.token,
            Some(json!({"kind": "navigate", "payload": {"key": "left"}})),
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
        // Revoking again is harmless.
        let (s, _) = call(
            &router,
            "DELETE",
            &format!("/api/v1/remote/pairings/{id}"),
            &phone.token,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn expired_pairing_and_offline_target_reject_commands() {
        let (router, state, _user, phone, tv) = setup().await;
        let id = pair(&router, &phone, &tv, None).await;
        let uri = format!("/api/v1/remote/pairings/{id}/commands");
        let cmd = json!({"kind": "navigate", "payload": {"key": "left"}});

        sqlx::query("UPDATE remote_targets SET last_seen_ms = 0 WHERE device_id = ?")
            .bind(tv.id.to_string())
            .execute(&state.pool)
            .await
            .unwrap();
        let (s, v) = call(&router, "POST", &uri, &phone.token, Some(cmd.clone())).await;
        assert_eq!(s, StatusCode::CONFLICT);
        assert_eq!(v["error"], "target_offline");
        // The offline target cannot be paired either.
        let tablet = dev(&state, _user);
        let (s, _) = call(
            &router,
            "POST",
            "/api/v1/remote/pairings",
            &tablet.token,
            Some(json!({"target_device_id": tv.id})),
        )
        .await;
        assert_eq!(s, StatusCode::CONFLICT);

        register(&router, &tv, "Living room TV", &CAPABILITIES).await;
        sqlx::query("UPDATE remote_pairings SET expires_ms = 1 WHERE id = ?")
            .bind(&id)
            .execute(&state.pool)
            .await
            .unwrap();
        let (s, v) = call(&router, "POST", &uri, &phone.token, Some(cmd)).await;
        assert_eq!(s, StatusCode::GONE, "{v}");
    }

    #[tokio::test]
    async fn text_payload_is_cleared_after_ack_and_never_returned_to_controller() {
        let (router, state, _user, phone, tv) = setup().await;
        let id = pair(&router, &phone, &tv, None).await;
        let (_, v) = call(
            &router,
            "POST",
            &format!("/api/v1/remote/pairings/{id}/commands"),
            &phone.token,
            Some(json!({"kind": "text", "payload": {"value": "hunter2-secret", "submit": true}})),
        )
        .await;
        let command_id = v["command_id"].as_str().unwrap().to_string();
        let (_, status) = call(
            &router,
            "GET",
            &format!("/api/v1/remote/commands/{command_id}"),
            &phone.token,
            None,
        )
        .await;
        assert!(!status.to_string().contains("hunter2"));
        let events = inbox(&router, &tv, 0).await;
        let cmd = events.iter().find(|e| e["kind"] == "command").unwrap();
        assert_eq!(cmd["payload"]["args"]["value"], "hunter2-secret");
        let (s, _) = call(
            &router,
            "POST",
            &format!("/api/v1/remote/events/{command_id}/ack"),
            &tv.token,
            Some(json!({"status": "ok"})),
        )
        .await;
        assert_eq!(s, StatusCode::NO_CONTENT);
        let stored: Option<String> =
            sqlx::query_scalar("SELECT payload FROM remote_events WHERE id = ?")
                .bind(&command_id)
                .fetch_one(&state.pool)
                .await
                .unwrap();
        assert!(stored.is_none());
        // Double ack is a conflict, and another device cannot ack.
        let (s, _) = call(
            &router,
            "POST",
            &format!("/api/v1/remote/events/{command_id}/ack"),
            &tv.token,
            Some(json!({"status": "ok"})),
        )
        .await;
        assert_eq!(s, StatusCode::CONFLICT);
        let (s, _) = call(
            &router,
            "POST",
            &format!("/api/v1/remote/events/{command_id}/ack"),
            &phone.token,
            Some(json!({"status": "ok"})),
        )
        .await;
        assert_eq!(s, StatusCode::NOT_FOUND);
    }

    struct HandoffFixture {
        router: Router,
        state: TestState,
        user: Uuid,
        phone: Dev,
        tv: Dev,
        media_file_id: Uuid,
    }

    async fn handoff_fixture() -> HandoffFixture {
        let (router, state, user, phone, tv) = setup().await;
        // phone pairs with the TV with the handoff scope; the phone is the source.
        pair(&router, &phone, &tv, None).await;
        let work = seed_movie(&state, "Movie").await;
        let file = seed_downloadable_media_file(&state, work, LIB).await;
        HandoffFixture {
            router,
            state,
            user,
            phone,
            tv,
            media_file_id: file.id,
        }
    }

    fn handoff_body(f: &HandoffFixture, key: &str) -> Value {
        json!({
            "request_key": key,
            "source_device_id": f.phone.id,
            "destination_device_id": f.tv.id,
            "media_file_id": f.media_file_id,
            "snapshot": {"position_ms": 600_000, "paused": true, "audio_language": "en"}
        })
    }

    #[tokio::test]
    async fn handoff_stops_source_only_after_destination_acknowledges() {
        let f = handoff_fixture().await;
        let (s, v) = call(
            &f.router,
            "POST",
            "/api/v1/remote/handoffs",
            &f.phone.token,
            Some(handoff_body(&f, "k1")),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        let id = v["id"].as_str().unwrap().to_string();
        assert_eq!(v["status"], "pending");

        // Offer reaches the TV; the phone has no stop event yet.
        let offers = inbox(&f.router, &f.tv, 0).await;
        let offer = offers
            .iter()
            .find(|e| e["kind"] == "handoff_offer")
            .unwrap();
        assert_eq!(offer["payload"]["snapshot"]["position_ms"], 600_000);
        assert!(inbox(&f.router, &f.phone, 0)
            .await
            .iter()
            .all(|e| e["kind"] != "handoff_stop"));

        // Only the destination can acknowledge.
        let ack_uri = format!("/api/v1/remote/handoffs/{id}/ack");
        let ack = json!({"status": "playing", "position_ms": 601_000});
        let (s, _) = call(
            &f.router,
            "POST",
            &ack_uri,
            &f.phone.token,
            Some(ack.clone()),
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN);

        let (s, v) = call(&f.router, "POST", &ack_uri, &f.tv.token, Some(ack.clone())).await;
        assert_eq!(s, StatusCode::OK, "{v}");
        assert_eq!(v["status"], "committed");
        assert_eq!(v["acked_position_ms"], 601_000);
        assert_eq!(v["position_drift_ms"], 1000);
        let stops = inbox(&f.router, &f.phone, 0).await;
        let stops: Vec<_> = stops
            .iter()
            .filter(|e| e["kind"] == "handoff_stop")
            .collect();
        assert_eq!(stops.len(), 1);
        assert_eq!(stops[0]["payload"]["position_ms"], 601_000);

        // Replayed ack: recorded outcome, no second stop.
        let (s, v) = call(&f.router, "POST", &ack_uri, &f.tv.token, Some(ack)).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["status"], "committed");
        let again = inbox(&f.router, &f.phone, 0).await;
        assert_eq!(
            again.iter().filter(|e| e["kind"] == "handoff_stop").count(),
            1
        );
        // A failure report after commit cannot undo it.
        let (_, v) = call(
            &f.router,
            "POST",
            &ack_uri,
            &f.tv.token,
            Some(json!({"status": "failed"})),
        )
        .await;
        assert_eq!(v["status"], "committed");
    }

    #[tokio::test]
    async fn failed_destination_leaves_the_source_playing() {
        let f = handoff_fixture().await;
        let (_, v) = call(
            &f.router,
            "POST",
            "/api/v1/remote/handoffs",
            &f.phone.token,
            Some(handoff_body(&f, "k")),
        )
        .await;
        let id = v["id"].as_str().unwrap().to_string();
        let (s, v) = call(
            &f.router,
            "POST",
            &format!("/api/v1/remote/handoffs/{id}/ack"),
            &f.tv.token,
            Some(json!({"status": "failed", "reason": "codec unsupported"})),
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["status"], "failed");
        assert_eq!(v["failure_reason"], "codec unsupported");
        assert!(inbox(&f.router, &f.phone, 0)
            .await
            .iter()
            .all(|e| e["kind"] != "handoff_stop"));
        // A late success cannot resurrect it.
        let (_, v) = call(
            &f.router,
            "POST",
            &format!("/api/v1/remote/handoffs/{id}/ack"),
            &f.tv.token,
            Some(json!({"status": "playing", "position_ms": 1})),
        )
        .await;
        assert_eq!(v["status"], "failed");
        assert!(inbox(&f.router, &f.phone, 0)
            .await
            .iter()
            .all(|e| e["kind"] != "handoff_stop"));
    }

    #[tokio::test]
    async fn expired_handoff_cannot_commit_and_source_keeps_playing() {
        let f = handoff_fixture().await;
        let (_, v) = call(
            &f.router,
            "POST",
            "/api/v1/remote/handoffs",
            &f.phone.token,
            Some(handoff_body(&f, "k")),
        )
        .await;
        let id = v["id"].as_str().unwrap().to_string();
        sqlx::query("UPDATE remote_handoffs SET expires_ms = 1 WHERE id = ?")
            .bind(&id)
            .execute(&f.state.pool)
            .await
            .unwrap();
        let (s, v) = call(
            &f.router,
            "POST",
            &format!("/api/v1/remote/handoffs/{id}/ack"),
            &f.tv.token,
            Some(json!({"status": "playing", "position_ms": 5})),
        )
        .await;
        assert_eq!(s, StatusCode::GONE, "{v}");
        let (_, v) = call(
            &f.router,
            "GET",
            &format!("/api/v1/remote/handoffs/{id}"),
            &f.phone.token,
            None,
        )
        .await;
        assert_eq!(v["status"], "expired");
        assert!(inbox(&f.router, &f.phone, 0)
            .await
            .iter()
            .all(|e| e["kind"] != "handoff_stop"));
    }

    #[tokio::test]
    async fn handoff_create_is_idempotent_and_rejects_key_reuse() {
        let f = handoff_fixture().await;
        let body = handoff_body(&f, "same");
        let (s, first) = call(
            &f.router,
            "POST",
            "/api/v1/remote/handoffs",
            &f.phone.token,
            Some(body.clone()),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED);
        let (s, second) = call(
            &f.router,
            "POST",
            "/api/v1/remote/handoffs",
            &f.phone.token,
            Some(body),
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(first["id"], second["id"]);
        let offers = inbox(&f.router, &f.tv, 0).await;
        assert_eq!(
            offers
                .iter()
                .filter(|e| e["kind"] == "handoff_offer")
                .count(),
            1
        );

        let other_tv = dev(&f.state, f.user);
        register(&f.router, &other_tv, "Bedroom TV", &CAPABILITIES).await;
        let mut clash = handoff_body(&f, "same");
        clash["destination_device_id"] = json!(other_tv.id);
        let (s, _) = call(
            &f.router,
            "POST",
            "/api/v1/remote/handoffs",
            &f.phone.token,
            Some(clash),
        )
        .await;
        assert_eq!(s, StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn handoff_requires_pairing_scope_library_access_and_same_account() {
        let (router, state, user, phone, tv) = setup().await;
        let work = seed_movie(&state, "Movie").await;
        let file = seed_downloadable_media_file(&state, work, LIB).await;
        let body = |key: &str, dst: Uuid| {
            json!({
                "request_key": key,
                "source_device_id": phone.id,
                "destination_device_id": dst,
                "media_file_id": file.id,
                "snapshot": {"position_ms": 10, "paused": false}
            })
        };
        // No pairing at all.
        let (s, v) = call(
            &router,
            "POST",
            "/api/v1/remote/handoffs",
            &phone.token,
            Some(body("a", tv.id)),
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
        assert_eq!(v["error"], "pairing_required");

        // Paired without the handoff scope.
        pair(&router, &phone, &tv, Some(json!(["navigate"]))).await;
        let (s, _) = call(
            &router,
            "POST",
            "/api/v1/remote/handoffs",
            &phone.token,
            Some(body("b", tv.id)),
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN);

        // Another account's TV is invisible.
        let other = Uuid::new_v4();
        seed_streaming_user(&state, other).await;
        let foreign = dev(&state, other);
        register(&router, &foreign, "Neighbour TV", &CAPABILITIES).await;
        let (s, _) = call(
            &router,
            "POST",
            "/api/v1/remote/handoffs",
            &phone.token,
            Some(body("c", foreign.id)),
        )
        .await;
        assert_eq!(s, StatusCode::NOT_FOUND);

        // A viewer restricted to another library cannot hand off this title.
        let restricted_user = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, restricted_user, vec![Uuid::new_v4()]).await;
        let rp = dev(&state, restricted_user);
        let rtv = dev(&state, restricted_user);
        register(&router, &rtv, "TV", &CAPABILITIES).await;
        register(&router, &rp, "Phone", &CAPABILITIES).await;
        pair(&router, &rp, &rtv, None).await;
        let (s, _) = call(
            &router,
            "POST",
            "/api/v1/remote/handoffs",
            &rp.token,
            Some(json!({
                "request_key": "d", "source_device_id": rp.id, "destination_device_id": rtv.id,
                "media_file_id": file.id, "snapshot": {"position_ms": 1}
            })),
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN);
        let _ = user;
    }

    #[tokio::test]
    async fn phone_can_move_tv_playback_to_another_tv_using_reported_state() {
        let (router, state, user, phone, tv) = setup().await;
        let tv2 = dev(&state, user);
        register(&router, &tv2, "Bedroom TV", &CAPABILITIES).await;
        pair(&router, &phone, &tv, None).await;
        pair(&router, &phone, &tv2, None).await;
        let work = seed_movie(&state, "Movie").await;
        let file = seed_downloadable_media_file(&state, work, LIB).await;
        let body = json!({
            "request_key": "k", "source_device_id": tv.id, "destination_device_id": tv2.id
        });

        // Nothing reported yet: refuse rather than guess.
        let (s, v) = call(
            &router,
            "POST",
            "/api/v1/remote/handoffs",
            &phone.token,
            Some(body.clone()),
        )
        .await;
        assert_eq!(s, StatusCode::CONFLICT);
        assert_eq!(v["error"], "source_state_stale");

        let (s, _) = call(
            &router,
            "PUT",
            "/api/v1/remote/target/state",
            &tv.token,
            Some(json!({"state": {"media_file_id": file.id, "position_ms": 90_000, "paused": false, "audio_language": "fr"}})),
        )
        .await;
        assert_eq!(s, StatusCode::NO_CONTENT);
        let (s, v) = call(
            &router,
            "POST",
            "/api/v1/remote/handoffs",
            &phone.token,
            Some(body.clone()),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        assert_eq!(v["snapshot"]["position_ms"], 90_000);
        assert_eq!(v["snapshot"]["audio_language"], "fr");

        // Stale state is refused.
        sqlx::query("UPDATE remote_targets SET state_at_ms = 1 WHERE device_id = ?")
            .bind(tv.id.to_string())
            .execute(&state.pool)
            .await
            .unwrap();
        let mut again = body;
        again["request_key"] = json!("k2");
        let (s, _) = call(
            &router,
            "POST",
            "/api/v1/remote/handoffs",
            &phone.token,
            Some(again),
        )
        .await;
        assert_eq!(s, StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn only_the_initiator_cancels_and_cancel_blocks_commit() {
        let f = handoff_fixture().await;
        let (_, v) = call(
            &f.router,
            "POST",
            "/api/v1/remote/handoffs",
            &f.phone.token,
            Some(handoff_body(&f, "k")),
        )
        .await;
        let id = v["id"].as_str().unwrap().to_string();
        let (s, _) = call(
            &f.router,
            "POST",
            &format!("/api/v1/remote/handoffs/{id}/cancel"),
            &f.tv.token,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN);
        let (s, v) = call(
            &f.router,
            "POST",
            &format!("/api/v1/remote/handoffs/{id}/cancel"),
            &f.phone.token,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["status"], "cancelled");
        let (_, v) = call(
            &f.router,
            "POST",
            &format!("/api/v1/remote/handoffs/{id}/ack"),
            &f.tv.token,
            Some(json!({"status": "playing", "position_ms": 5})),
        )
        .await;
        assert_eq!(v["status"], "cancelled");
        assert!(inbox(&f.router, &f.phone, 0)
            .await
            .iter()
            .all(|e| e["kind"] != "handoff_stop"));
    }

    #[tokio::test]
    async fn unregistered_devices_cannot_poll_and_targets_list_marks_self() {
        let (router, state, user, phone, _tv) = setup().await;
        let stranger = dev(&state, user);
        let (s, _) = call(
            &router,
            "GET",
            "/api/v1/remote/inbox",
            &stranger.token,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::NOT_FOUND);
        let (s, v) = call(&router, "GET", "/api/v1/remote/targets", &phone.token, None).await;
        assert_eq!(s, StatusCode::OK);
        let list = v.as_array().unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list.iter().filter(|t| t["is_self"] == true).count(), 1);
        let (s, _) = call(
            &router,
            "PUT",
            "/api/v1/remote/target",
            &phone.token,
            Some(json!({"name": "x", "capabilities": ["nuke"]})),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
        let (s, _) = call(&router, "GET", "/api/v1/remote/targets", "garbage", None).await;
        assert_eq!(s, StatusCode::UNAUTHORIZED);
    }
}
