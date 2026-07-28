//! Admin `SourceInstance` registration -- `POST`/`GET`/`DELETE
//! /api/v1/admin/source-instances[/{id}]`. Closes the gap
//! `SourceInstanceRegistry`'s own doc comment calls out explicitly: the
//! registry was a real, working in-process store from the moment it was
//! written, but nothing ever called `upsert`/had a way to remove an entry
//! -- there was no way, short of editing `backend/src/main.rs` and
//! rebuilding, to actually tell a running Playarr Server instance about a
//! `*arr` app to talk to. This is that missing "way".
//!
//! Every write here confirms the instance is actually reachable (the same
//! `health_check` call `HealthCheckArrPusher` already makes) before
//! accepting it -- an operator registering a mistyped URL or a stale API
//! key gets a clear 502 immediately, not a silent no-op that only surfaces
//! later as `arr-sync` reconciliation failures nobody's watching yet.

use std::collections::{BTreeMap, HashMap};

use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use playarr_arr_client::ArrConnector;
use playarr_arr_sync::ArrClient;
use playarr_model::{LeafSelector, PeerNodeStatus, SourceInstance, SourceKind};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth_extractor::AdminUser;
use crate::error::ApiError;
use crate::physical_path::{existing_physical_file, map_source_path};
use crate::AppState;

async fn health_check(client: &ArrClient) -> Result<(), playarr_arr_client::ArrClientError> {
    match client {
        ArrClient::Sonarr(c) => c.health_check().await,
        ArrClient::Radarr(c) => c.health_check().await,
        ArrClient::Lidarr(c) => c.health_check().await,
        ArrClient::Readarr(c) => c.health_check().await,
        ArrClient::Bazarr(c) => c.health_check().await,
        ArrClient::Prowlarr(c) => c.health_check().await,
        ArrClient::Whisparr(c) => c.health_check().await,
    }
}

/// Request body for registering (or re-registering, by re-POSTing with the
/// same `id` you got back) a `*arr` connection. `api_key` is write-only --
/// it is never echoed back in [`SourceInstanceResponse`].
#[derive(Debug, Deserialize, ToSchema)]
pub struct SourceInstanceRequest {
    /// Omit to create a new instance (a fresh id is assigned and returned);
    /// set to an id from a prior response to update that same instance in
    /// place (e.g. to rotate its API key).
    pub id: Option<Uuid>,
    pub kind: SourceKind,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub default_root_folder_id: Option<String>,
    #[serde(default)]
    pub default_quality_profile_id: Option<i64>,
    #[serde(default)]
    pub best_effort: bool,
}

/// The redacted, admin-facing projection of [`SourceInstance`] -- see that
/// type's own doc comment for why it isn't `ToSchema`-derived directly
/// (it carries the API key). `api_key` is never included, not even
/// redacted-looking -- the field simply doesn't exist on the response.
#[derive(Debug, Serialize, ToSchema)]
pub struct SourceInstanceResponse {
    pub id: Uuid,
    pub kind: SourceKind,
    pub name: String,
    pub base_url: String,
    pub priority: i32,
    pub default_root_folder_id: Option<String>,
    pub folder_mappings: BTreeMap<Uuid, String>,
    pub default_quality_profile_id: Option<i64>,
    pub best_effort: bool,
}

impl From<SourceInstance> for SourceInstanceResponse {
    fn from(instance: SourceInstance) -> Self {
        Self {
            id: instance.id,
            kind: instance.kind,
            name: instance.name,
            base_url: instance.base_url,
            priority: instance.priority,
            default_root_folder_id: instance.default_root_folder_id,
            folder_mappings: instance.folder_mappings,
            default_quality_profile_id: instance.default_quality_profile_id,
            best_effort: instance.best_effort,
        }
    }
}

/// Complete per-node root mapping for one ordinary Source instance.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SourceFolderMappingsRequest {
    pub folder_mappings: BTreeMap<Uuid, String>,
}

/// Replaces one Source instance's peer-root mappings. Because mappings are
/// part of the normal Source row, the existing signed Source replication
/// carries this change to every peer.
#[utoipa::path(
    put,
    path = "/api/v1/admin/source-instances/{id}/folder-mappings",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Source instance id")),
    request_body = SourceFolderMappingsRequest,
    responses(
        (status = 200, description = "Updated Source instance", body = SourceInstanceResponse),
        (status = 400, description = "A mapped path was empty"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 404, description = "No source instance registered with this id")
    )
)]
pub async fn update_source_folder_mappings_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<SourceFolderMappingsRequest>,
) -> Result<Json<SourceInstanceResponse>, ApiError> {
    let mut instance = state
        .source_instances
        .get(id)
        .ok_or_else(|| ApiError::not_found("source instance not found"))?;
    let mut mappings = BTreeMap::new();
    for (peer_id, path) in body.folder_mappings {
        let path = path.trim();
        if path.is_empty() {
            return Err(ApiError::bad_request("mapped folder paths cannot be empty"));
        }
        mappings.insert(peer_id, path.to_string());
    }
    instance.folder_mappings = mappings;
    state
        .source_instance_repo
        .upsert(&instance)
        .await
        .map_err(|error| ApiError::internal(format!("failed to save folder mappings: {error}")))?;
    state.source_instances.upsert(instance.clone());
    Ok(Json(instance.into()))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SourceMatrixFileResponse {
    pub id: Uuid,
    pub work_id: Uuid,
    pub leaf_selector: LeafSelector,
    pub peer_node_id: Uuid,
    pub source_instance_id: Uuid,
    pub path: String,
    pub mapped_path: String,
    pub mapped: bool,
    pub container: Option<String>,
    pub codec: Option<String>,
    pub bitrate: Option<u64>,
    pub duration_ms: Option<u64>,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PeerMatrixNodeResponse {
    pub id: Uuid,
    pub name: String,
    pub is_self: bool,
    pub status: PeerNodeStatus,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SourceMatrixResponse {
    pub peers: Vec<PeerMatrixNodeResponse>,
    pub sources: Vec<SourceInstanceResponse>,
    pub files: Vec<SourceMatrixFileResponse>,
}

/// Physical media-file inventory reported by every node in this peer group.
#[utoipa::path(
    get,
    path = "/api/v1/admin/library/source-matrix",
    tag = "admin",
    responses(
        (status = 200, description = "Peer nodes and their reported physical files", body = SourceMatrixResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn source_matrix_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<SourceMatrixResponse>, ApiError> {
    let self_peer_id = state
        .node_identity_repo
        .get()
        .await
        .map_err(|error| ApiError::internal(format!("failed to load node identity: {error}")))?
        .map(|identity| identity.peer_id)
        .ok_or_else(|| ApiError::internal("node identity is missing"))?;
    let peer_nodes = state
        .peer_node_repo
        .list_all()
        .await
        .map_err(|error| ApiError::internal(format!("failed to list peer nodes: {error}")))?;
    let instances = state.source_instances.all();
    let by_id: HashMap<Uuid, SourceInstance> = instances
        .iter()
        .cloned()
        .map(|instance| (instance.id, instance))
        .collect();
    let mut leaf_selectors = HashMap::new();
    for work_id in state
        .media_file_repo
        .list_work_ids()
        .await
        .map_err(|error| ApiError::internal(format!("failed to list media-file works: {error}")))?
    {
        if let Ok(detail) = state.catalog.get_by_id(work_id, None).await {
            leaf_selectors.extend(crate::peer::leaf_selectors_for(&detail));
        }
    }

    let local_media_files = state
        .media_file_repo
        .list_all()
        .await
        .map_err(|error| ApiError::internal(format!("failed to list media files: {error}")))?;
    let mut files = Vec::new();
    for file in local_media_files {
        let Some(source) = by_id.get(&file.source_instance_id) else {
            continue;
        };
        let Some(leaf_selector) = leaf_selectors.get(&file.id).cloned() else {
            continue;
        };
        let path = file.path.to_string_lossy().into_owned();
        let Some((mapped_path, mapped)) = existing_physical_file(source, self_peer_id, &path).await
        else {
            continue;
        };
        files.push(SourceMatrixFileResponse {
            id: file.id,
            work_id: file.work_id,
            leaf_selector,
            peer_node_id: self_peer_id,
            source_instance_id: file.source_instance_id,
            path,
            mapped_path,
            mapped,
            container: Some(file.container),
            codec: Some(file.codec),
            bitrate: file.bitrate,
            duration_ms: file.duration_ms,
            size_bytes: Some(file.size_bytes),
        });
    }

    for peer in peer_nodes.iter().filter(|peer| !peer.is_self) {
        let rows = state
            .peer_leaf_availability_repo
            .list_for_peer(peer.id)
            .await
            .map_err(|error| {
                ApiError::internal(format!(
                    "failed to list inventory for peer {}: {error}",
                    peer.id
                ))
            })?;
        files.extend(rows.into_iter().filter_map(|row| {
            let work_id = row.local_work_id?;
            let source = by_id.get(&row.source_instance_id)?;
            let mapped_root = source.folder_mappings.get(&peer.id);
            let (mapped_path, mapped) = map_source_path(
                &row.path,
                source.default_root_folder_id.as_deref(),
                mapped_root.map(String::as_str),
            );
            Some(SourceMatrixFileResponse {
                id: row.media_file_id,
                work_id,
                leaf_selector: row.leaf_selector,
                peer_node_id: peer.id,
                source_instance_id: row.source_instance_id,
                path: row.path,
                mapped_path,
                mapped,
                container: row.container,
                codec: row.codec,
                bitrate: row.bitrate,
                duration_ms: row.duration_ms,
                size_bytes: row.size_bytes,
            })
        }));
    }
    Ok(Json(SourceMatrixResponse {
        peers: peer_nodes
            .into_iter()
            .filter(|peer| peer.status != PeerNodeStatus::Left)
            .map(|peer| PeerMatrixNodeResponse {
                id: peer.id,
                name: peer.name,
                is_self: peer.is_self,
                status: peer.status,
            })
            .collect(),
        sources: instances
            .into_iter()
            .map(SourceInstanceResponse::from)
            .collect(),
        files,
    }))
}

/// Registers a new `*arr` connection, or updates an existing one in place
/// when `id` is set. Confirms the instance is actually reachable with the
/// given `base_url`/`api_key` before accepting it.
#[utoipa::path(
    post,
    path = "/api/v1/admin/source-instances",
    tag = "admin",
    request_body(content = SourceInstanceRequest, example = json!({
        "kind": "radarr",
        "name": "Radarr (4K)",
        "base_url": "http://radarr.local:7878",
        "api_key": "s3cr3t-api-key",
        "priority": 0,
        "default_root_folder_id": "/movies-4k",
        "default_quality_profile_id": 4,
        "best_effort": false
    })),
    responses(
        (status = 200, description = "Registered (or updated) and confirmed reachable", body = SourceInstanceResponse, example = json!({
            "id": "9c858901-8a57-4791-81fe-4c455b099bc9",
            "kind": "radarr",
            "name": "Radarr (4K)",
            "base_url": "http://radarr.local:7878",
            "priority": 0,
            "default_root_folder_id": "/movies-4k",
            "default_quality_profile_id": 4,
            "best_effort": false
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 502, description = "base_url/api_key rejected, or the instance could not be reached")
    )
)]
pub async fn create_source_instance_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<SourceInstanceRequest>,
) -> Result<Json<SourceInstanceResponse>, ApiError> {
    let id = body.id.unwrap_or_else(Uuid::new_v4);
    let existing = state.source_instances.get(id);
    let instance = SourceInstance {
        id,
        kind: body.kind,
        name: body.name,
        base_url: body.base_url,
        api_key_encrypted: playarr_model::Sensitive::new(body.api_key),
        priority: body.priority,
        default_root_folder_id: body.default_root_folder_id,
        folder_mappings: existing
            .as_ref()
            .map(|instance| instance.folder_mappings.clone())
            .unwrap_or_default(),
        default_quality_profile_id: body.default_quality_profile_id,
        best_effort: body.best_effort,
        // Not settable through this endpoint's request body. Preserve the
        // existing group mapping on an edit; a genuinely new Source starts
        // ungrouped.
        group_library_id: existing.and_then(|instance| instance.group_library_id),
    };

    let client = ArrClient::from_source_instance(&instance);
    health_check(&client).await.map_err(|err| {
        ApiError::bad_gateway(format!(
            "could not reach {:?} at {}: {err}",
            instance.kind, instance.base_url
        ))
    })?;

    // Write-through: the durable repo first, so a failed persist never
    // leaves `source_instances`' in-memory cache claiming something that
    // isn't actually saved to disk -- see `AppState::source_instance_repo`'s
    // doc comment.
    state
        .source_instance_repo
        .upsert(&instance)
        .await
        .map_err(|err| {
            ApiError::internal(format!(
                "failed to persist source instance {}: {err}",
                instance.id
            ))
        })?;

    if let Some(identity) = state
        .node_identity_repo
        .get()
        .await
        .map_err(|err| ApiError::internal(format!("failed to load node identity: {err}")))?
    {
        state
            .source_instance_repo
            .set_origin_peer_id_if_unset(instance.id, identity.peer_id)
            .await
            .map_err(|err| ApiError::internal(format!("failed to set source origin: {err}")))?;
    }

    state.source_instances.upsert(instance.clone());

    tracing::info!(
        instance_id = %instance.id,
        instance_kind = ?instance.kind,
        instance_name = %instance.name,
        "registered source instance (confirmed reachable)"
    );

    Ok(Json(instance.into()))
}

/// Every currently-registered `*arr` connection.
#[utoipa::path(
    get,
    path = "/api/v1/admin/source-instances",
    tag = "admin",
    responses(
        (status = 200, description = "All registered source instances", body = Vec<SourceInstanceResponse>, example = json!([
            {
                "id": "9c858901-8a57-4791-81fe-4c455b099bc9",
                "kind": "radarr",
                "name": "Radarr (4K)",
                "base_url": "http://radarr.local:7878",
                "priority": 0,
                "default_root_folder_id": "/movies-4k",
                "default_quality_profile_id": 4,
                "best_effort": false
            }
        ])),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn list_source_instances_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Json<Vec<SourceInstanceResponse>> {
    Json(
        state
            .source_instances
            .all()
            .into_iter()
            .map(SourceInstanceResponse::from)
            .collect(),
    )
}

/// De-registers a `*arr` connection. `arr-sync` stops polling it on its
/// next reconciliation tick; already-imported catalog data is untouched.
#[utoipa::path(
    delete,
    path = "/api/v1/admin/source-instances/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Source instance id")),
    responses(
        (status = 204, description = "Removed (or was already absent)"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn delete_source_instance_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<axum::http::StatusCode, ApiError> {
    // Same write-through-first ordering as create, and the same repo --
    // see `AppState::source_instance_repo`'s doc comment. A `NotFound` from
    // the repo is not a caller-facing failure here: deleting an
    // already-absent row is exactly as much a no-op as
    // `SourceInstanceRegistry::remove` already treats it (that method
    // returns `Option` and callers here have never checked it either).
    match state.source_instance_repo.delete(id).await {
        Ok(()) | Err(playarr_db::DbError::NotFound) => {}
        Err(err) => {
            return Err(ApiError::internal(format!(
                "failed to delete source instance {id}: {err}"
            )))
        }
    }

    state.source_instances.remove(id);
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// Asks this source instance's running `ReconciliationPoller` to do a full
/// sync right now, instead of waiting for its next scheduled (every 300s)
/// pass -- the "Sync now" action every `*arr` app itself exposes per
/// configured connection. Fire-and-forget: a `202` means the request
/// reached the poller, not that the resulting sync has finished yet.
#[utoipa::path(
    post,
    path = "/api/v1/admin/source-instances/{id}/sync",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Source instance id")),
    responses(
        (status = 202, description = "Sync request handed to the running reconciliation poller"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 404, description = "No source instance registered with this id"),
        (status = 503, description = "No reconciliation poller is currently running for this instance yet")
    )
)]
pub async fn sync_source_instance_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<axum::http::StatusCode, ApiError> {
    state.source_instances.trigger_sync(id)?;
    Ok(axum::http::StatusCode::ACCEPTED)
}

/// One source instance's most recently reported reconciliation outcome --
/// see `playarr_arr_sync::SyncRunStatus`. `status`/`error`/`finished_at`
/// are `None` together when no poller has reported anything for this
/// instance yet (e.g. it was registered less than ~10s ago).
#[derive(Debug, Serialize, ToSchema)]
pub struct SourceInstanceSyncStatusResponse {
    pub source_instance_id: Uuid,
    pub name: String,
    pub kind: SourceKind,
    /// `"running"` | `"succeeded"` | `"failed"`, or absent if unreported.
    pub status: Option<&'static str>,
    /// Only set when `status` is `"failed"`.
    pub error: Option<String>,
    /// Only set when `status` is `"running"` and the poller has something
    /// more specific to report than "running" alone -- see
    /// `playarr_arr_sync::SyncRunStatus::Running`'s doc comment (e.g. a
    /// large missing-media-file backfill's live "N/total" progress).
    pub detail: Option<String>,
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub finished_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Every registered source instance's last-known sync status in one call --
/// backs the admin "Tasks" screen. Purely in-memory/runtime, like `POST
/// .../sync`'s underlying trigger channel: nothing here survives a restart,
/// and an instance with no poller running yet (or one that's never
/// completed a pass) simply has `status: null`, not a synthetic "idle" or
/// "unknown" state.
#[utoipa::path(
    get,
    path = "/api/v1/admin/source-instances/sync-status",
    tag = "admin",
    responses(
        (status = 200, description = "Every registered instance's last-known sync status", body = Vec<SourceInstanceSyncStatusResponse>, example = json!([
            {
                "source_instance_id": "9c858901-8a57-4791-81fe-4c455b099bc9",
                "name": "Radarr (4K)",
                "kind": "radarr",
                "status": "succeeded",
                "error": null,
                "detail": null,
                "started_at": "2026-07-20T18:40:00Z",
                "finished_at": "2026-07-20T18:40:12Z"
            }
        ])),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn sync_status_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<Vec<SourceInstanceSyncStatusResponse>>, ApiError> {
    use playarr_arr_sync::SyncRunStatus;

    let responses = state
        .source_instances
        .all_sync_statuses()
        .into_iter()
        .map(|(instance, status)| {
            let (status_label, error, detail, started_at, finished_at) = match status {
                None => (None, None, None, None, None),
                Some(SyncRunStatus::Running { started_at, detail }) => {
                    (Some("running"), None, detail, Some(started_at), None)
                }
                Some(SyncRunStatus::Succeeded { finished_at }) => {
                    (Some("succeeded"), None, None, None, Some(finished_at))
                }
                Some(SyncRunStatus::Failed { error, finished_at }) => {
                    (Some("failed"), Some(error), None, None, Some(finished_at))
                }
            };
            SourceInstanceSyncStatusResponse {
                source_instance_id: instance.id,
                name: instance.name,
                kind: instance.kind,
                status: status_label,
                error,
                detail,
                started_at,
                finished_at,
            }
        })
        .collect();

    Ok(Json(responses))
}

/// Response body for [`impersonate_user_handler`] -- mirrors
/// [`crate::login::LoginResponse`]'s shape but deliberately has no
/// `refresh_token`: impersonation mints a single stateless access token (no
/// persisted `Session`/`Device` row backs it -- see the handler's doc
/// comment), so there is nothing to refresh.
#[derive(Debug, Serialize, ToSchema)]
pub struct ImpersonationResponse {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: i64,
    pub user_id: Uuid,
    pub impersonated_by: Uuid,
}

/// Mints a short-lived access token for `user_id`, letting an admin act as
/// that user (e.g. to reproduce a user-reported bug from their exact
/// account state). Deliberately stateless and non-refreshable: no
/// `Session`/`Device` row is persisted for this token, unlike a real login
/// -- it simply expires with the normal access-token TTL and cannot be
/// renewed, which bounds the blast radius of a leaked or misused
/// impersonation token to that TTL with no separate revocation path
/// required. Every issuance is logged at `warn` (not `info`) since this is
/// a security-sensitive action operators should see by default.
#[utoipa::path(
    post,
    path = "/api/v1/admin/users/{user_id}/impersonate",
    tag = "admin",
    params(("user_id" = Uuid, Path, description = "The user to impersonate")),
    responses(
        (status = 200, description = "Short-lived, non-refreshable access token minted for the target user", body = ImpersonationResponse, example = json!({
            "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5Yzg1ODkwMS04YTU3LTQ3OTEtODFmZS00YzQ1NWIwOTliYzkifQ.dQw4w9WgXcQ",
            "token_type": "Bearer",
            "expires_in": 900,
            "user_id": "9c858901-8a57-4791-81fe-4c455b099bc9",
            "impersonated_by": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
        })),
        (status = 400, description = "Cannot impersonate yourself, or the target account is disabled"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 404, description = "No user with this id")
    )
)]
pub async fn impersonate_user_handler(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(user_id): Path<Uuid>,
) -> Result<Json<ImpersonationResponse>, ApiError> {
    if user_id == admin.user_id {
        return Err(ApiError::bad_request(
            "cannot impersonate yourself -- you are already signed in as this account",
        ));
    }

    let target = state
        .user_repo
        .find_by_id(user_id)
        .await
        .map_err(|err| ApiError::internal(format!("failed to look up user {user_id}: {err}")))?
        .ok_or_else(|| ApiError::not_found(format!("no user with id {user_id}")))?;

    if target.disabled {
        return Err(ApiError::bad_request(format!(
            "user {user_id} is disabled and cannot be impersonated"
        )));
    }

    // Fresh, unpersisted device/session ids -- see the doc comment above
    // for why this deliberately never touches `sessions`/`DeviceRepo`.
    let access_token = state
        .jwt
        .issue_access_token_for(user_id, Uuid::new_v4(), Uuid::new_v4(), Some(admin.user_id))
        .map_err(|err| ApiError::internal(format!("failed to issue impersonation token: {err}")))?;

    tracing::warn!(
        admin_id = %admin.user_id,
        target_user_id = %user_id,
        "admin impersonation issued"
    );

    Ok(Json(ImpersonationResponse {
        access_token,
        token_type: "Bearer".to_string(),
        expires_in: state.jwt.access_ttl().num_seconds(),
        user_id,
        impersonated_by: admin.user_id,
    }))
}

/// Aggregated p50/p95/p99/avg/max/count HTTP latency per (method, route
/// template), computed on demand from whatever
/// `request_timing_middleware::record_request_timing` has recorded in
/// `AppState::request_timing` since this process started -- see that
/// registry's own doc comment for the bounded-ring-buffer shape backing
/// it. Sorted by `p95_ms` descending, so the routes worth investigating
/// first are always at the top. Purely in-memory and per-node, like
/// `sync_status_handler`'s view of sync state: nothing here survives a
/// restart, and a multi-node deployment reports each node's own traffic
/// only.
#[utoipa::path(
    get,
    path = "/api/v1/admin/metrics/http-latency",
    tag = "admin",
    responses(
        (status = 200, description = "Aggregated request-duration stats per (method, route template), sorted by p95_ms descending", body = Vec<playarr_telemetry::request_timing::RouteLatencyStats>, example = json!([
            {
                "method": "GET",
                "route": "/api/v1/catalog/{id}",
                "sample_count": 812,
                "avg_ms": 4.2,
                "p50_ms": 3.1,
                "p95_ms": 11.4,
                "p99_ms": 22.0,
                "max_ms": 58.7
            }
        ])),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn http_latency_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Json<Vec<playarr_telemetry::request_timing::RouteLatencyStats>> {
    Json(state.request_timing.snapshot())
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;
    use uuid::Uuid;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use crate::test_support::{
        bearer_header, mint_access_token, seed_admin_user, seed_streaming_user, test_state,
    };

    #[tokio::test]
    async fn register_confirms_reachability_before_accepting() {
        let mock = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/system/status"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "version": "4.0.0"
            })))
            .mount(&mock)
            .await;

        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let body = serde_json::json!({
            "kind": "radarr",
            "name": "Live Radarr",
            "base_url": mock.uri(),
            "api_key": "test-key",
        });
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/source-instances")
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
        assert_eq!(json["name"], "Live Radarr");
        assert!(
            json.get("api_key").is_none(),
            "api_key must never be echoed back"
        );
        assert_eq!(state.app.source_instances.all().len(), 1);
    }

    #[tokio::test]
    async fn register_rejects_unreachable_instance() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let body = serde_json::json!({
            "kind": "sonarr",
            "name": "Unreachable Sonarr",
            "base_url": "http://127.0.0.1:1",
            "api_key": "test-key",
        });
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/source-instances")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        assert_eq!(state.app.source_instances.all().len(), 0);
    }

    #[tokio::test]
    async fn list_and_delete_round_trip() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let instance = playarr_model::SourceInstance {
            id: Uuid::new_v4(),
            kind: playarr_model::SourceKind::Prowlarr,
            name: "Prowlarr".to_string(),
            base_url: "http://localhost:9696".to_string(),
            api_key_encrypted: playarr_model::Sensitive::new("key".to_string()),
            priority: 0,
            default_root_folder_id: None,
            folder_mappings: Default::default(),
            default_quality_profile_id: None,
            best_effort: false,
            group_library_id: None,
        };
        state.app.source_instances.upsert(instance.clone());

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/source-instances")
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
        assert_eq!(json.as_array().unwrap().len(), 1);

        let response = router
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/v1/admin/source-instances/{}", instance.id))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert_eq!(state.app.source_instances.all().len(), 0);
    }

    #[tokio::test]
    async fn folder_mapping_update_changes_the_normal_source_instance() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);
        let instance = playarr_model::SourceInstance {
            id: Uuid::new_v4(),
            kind: playarr_model::SourceKind::Radarr,
            name: "Mapped Radarr".to_string(),
            base_url: "http://localhost:7878".to_string(),
            api_key_encrypted: playarr_model::Sensitive::new("key".to_string()),
            priority: 0,
            default_root_folder_id: Some("/source/movies".to_string()),
            folder_mappings: Default::default(),
            default_quality_profile_id: None,
            best_effort: false,
            group_library_id: None,
        };
        state
            .app
            .source_instance_repo
            .upsert(&instance)
            .await
            .unwrap();
        state.app.source_instances.upsert(instance.clone());
        let peer_id = Uuid::new_v4();

        let response = router
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!(
                        "/api/v1/admin/source-instances/{}/folder-mappings",
                        instance.id
                    ))
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(
                        serde_json::json!({
                            "folder_mappings": { peer_id.to_string(): "/mnt/media/movies" }
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            state
                .app
                .source_instances
                .get(instance.id)
                .unwrap()
                .folder_mappings[&peer_id],
            "/mnt/media/movies"
        );
        assert_eq!(
            state.app.source_instance_repo.list_all().await.unwrap()[0].folder_mappings[&peer_id],
            "/mnt/media/movies"
        );
    }

    #[tokio::test]
    async fn sync_reports_not_found_for_unknown_instance() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!(
                        "/api/v1/admin/source-instances/{}/sync",
                        Uuid::new_v4()
                    ))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn sync_reports_poller_not_running_when_none_is_registered() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let instance = playarr_model::SourceInstance {
            id: Uuid::new_v4(),
            kind: playarr_model::SourceKind::Prowlarr,
            name: "Prowlarr".to_string(),
            base_url: "http://localhost:9696".to_string(),
            api_key_encrypted: playarr_model::Sensitive::new("key".to_string()),
            priority: 0,
            default_root_folder_id: None,
            folder_mappings: Default::default(),
            default_quality_profile_id: None,
            best_effort: false,
            group_library_id: None,
        };
        state.app.source_instances.upsert(instance.clone());

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!(
                        "/api/v1/admin/source-instances/{}/sync",
                        instance.id
                    ))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn non_admin_is_rejected() {
        let (router, state) = test_state().await;
        let token = mint_access_token(&state, Uuid::new_v4());

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/source-instances")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    fn impersonate_request(token: &str, target: Uuid) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri(format!("/api/v1/admin/users/{target}/impersonate"))
            .header("Authorization", bearer_header(token))
            .body(Body::empty())
            .unwrap()
    }

    #[tokio::test]
    async fn impersonate_requires_admin() {
        let (router, state) = test_state().await;
        let non_admin_id = Uuid::new_v4();
        seed_streaming_user(&state, non_admin_id).await;
        let caller_token = mint_access_token(&state, non_admin_id);

        let target_id = Uuid::new_v4();
        seed_streaming_user(&state, target_id).await;

        let response = router
            .oneshot(impersonate_request(&caller_token, target_id))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn admin_can_impersonate_a_real_user_and_claims_resolve_to_the_target() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let admin_token = mint_access_token(&state, admin_id);

        let target_id = Uuid::new_v4();
        seed_streaming_user(&state, target_id).await;

        let response = router
            .oneshot(impersonate_request(&admin_token, target_id))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["user_id"].as_str().unwrap(), target_id.to_string());
        assert_eq!(
            json["impersonated_by"].as_str().unwrap(),
            admin_id.to_string()
        );
        assert_eq!(json["token_type"], "Bearer");

        // The token itself, not just the response envelope, carries the
        // impersonated user as `sub` (not the calling admin) and the
        // calling admin as `impersonated_by` -- this is the actual
        // security-relevant behavior, verified the same way any other
        // caller of this token would: through `AppState::jwt`.
        let access_token = json["access_token"].as_str().unwrap();
        let claims = state
            .app
            .jwt
            .verify_access_token(access_token)
            .await
            .unwrap();
        assert_eq!(claims.sub, target_id);
        assert_eq!(claims.impersonated_by, Some(admin_id));
    }

    #[tokio::test]
    async fn impersonating_a_nonexistent_user_404s() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let admin_token = mint_access_token(&state, admin_id);

        let response = router
            .oneshot(impersonate_request(&admin_token, Uuid::new_v4()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn self_impersonation_is_rejected() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let admin_token = mint_access_token(&state, admin_id);

        let response = router
            .oneshot(impersonate_request(&admin_token, admin_id))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn impersonating_a_disabled_user_is_rejected() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let admin_token = mint_access_token(&state, admin_id);

        let target_id = Uuid::new_v4();
        seed_streaming_user(&state, target_id).await;
        let mut target = state
            .user_repo
            .find_by_id(target_id)
            .await
            .unwrap()
            .unwrap();
        target.disabled = true;
        state.user_repo.upsert(&target).await.unwrap();

        let response = router
            .oneshot(impersonate_request(&admin_token, target_id))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    fn http_latency_request(token: Option<&str>) -> Request<Body> {
        let mut builder = Request::builder()
            .method("GET")
            .uri("/api/v1/admin/metrics/http-latency");
        if let Some(token) = token {
            builder = builder.header("Authorization", bearer_header(token));
        }
        builder.body(Body::empty()).unwrap()
    }

    #[tokio::test]
    async fn http_latency_without_token_is_unauthorized() {
        let (router, _state) = test_state().await;

        let response = router.oneshot(http_latency_request(None)).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn http_latency_requires_admin() {
        let (router, state) = test_state().await;
        let non_admin_id = Uuid::new_v4();
        seed_streaming_user(&state, non_admin_id).await;
        let token = mint_access_token(&state, non_admin_id);

        let response = router
            .oneshot(http_latency_request(Some(&token)))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    /// Doubles as the end-to-end proof that
    /// `request_timing_middleware::record_request_timing` is actually
    /// layered where `MatchedPath` is populated (see that middleware's own
    /// doc comment, and `crate::build_router`'s, for why ordering matters):
    /// a real request through the *same* router this test hits the
    /// endpoint on is what has to have populated
    /// `AppState::request_timing` for this to pass -- there is no separate
    /// seeding path into the registry.
    #[tokio::test]
    async fn http_latency_reports_a_sample_recorded_by_a_real_request() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let warm_up = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/v1/admin/source-instances/sync-status")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(warm_up.status(), StatusCode::OK);

        let response = router
            .oneshot(http_latency_request(Some(&token)))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let rows: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
        let row = rows
            .iter()
            .find(|row| row["route"] == "/api/v1/admin/source-instances/sync-status")
            .expect("the warm-up request's route template was recorded");
        assert_eq!(row["method"], "GET");
        assert_eq!(row["sample_count"], 1);
    }
}
