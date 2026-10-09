//! Native folder browsing ("unsorted folders").
//!
//! Viewers browse the root folders an administrator enabled, as a tree of
//! directories and playable files derived from the scan cache
//! (`folder_scan.rs`). Responses carry opaque root ids and normalised
//! root-relative paths only; no server path ever leaves this module except in
//! the admin endpoints. Every file is an ordinary `media_file_id`, so playback,
//! thumbnails, downloads and watch progress use the existing routes.

use std::collections::BTreeMap;
use std::path::{Component, Path as FsPath, PathBuf};

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{DateTime, Utc};
use playarr_arr_sync::work_kind_and_provider;
use playarr_db::RootConfigUpdate;
use playarr_model::{
    FolderMediaEntry, FolderScanStatus, SourceRootFolder, WatchState, WorkKind, MANUAL_ROOT_PREFIX,
};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::auth_extractor::{ensure_library_allowed, AdminUser, CatalogViewer};
use crate::folder_scan::{self, resolve_local_root, root_display_name, stable_id, ScanSummary};
use crate::{ApiError, AppState};

const DEFAULT_LIMIT: usize = 100;
const MAX_LIMIT: usize = 500;

// ---------------------------------------------------------------------
// Viewer API
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize, IntoParams)]
pub struct FolderRootsQuery {
    /// Only roots of this library kind (`movie`, `series`, `artist`, ...).
    pub kind: Option<WorkKind>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct FolderRootResponse {
    pub id: Uuid,
    pub source_instance_id: Uuid,
    /// Neutral label of the source (equals `display_label`); never the admin-chosen
    /// instance name, which only the admin routes return.
    pub source_name: String,
    /// Neutral label (for example "Movies"); safe to show to any user.
    pub display_label: String,
    pub library_kind: WorkKind,
    pub name: String,
    /// False while the root has never scanned successfully or its last scan failed.
    pub available: bool,
    pub scan_status: FolderScanStatus,
    pub last_scanned_at: Option<DateTime<Utc>>,
    pub item_count: u64,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct FolderRootsResponse {
    pub roots: Vec<FolderRootResponse>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum FolderSort {
    #[default]
    Name,
    Modified,
    Size,
    Duration,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum FolderOrder {
    #[default]
    Asc,
    Desc,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum FolderEntryFilter {
    #[default]
    All,
    Directories,
    Media,
}

#[derive(Debug, Clone, Deserialize, IntoParams)]
pub struct FolderBrowseQuery {
    /// Root-relative directory. Empty or omitted means the root itself.
    pub path: Option<String>,
    /// Case-insensitive name filter applied to this directory's entries.
    pub q: Option<String>,
    #[serde(default)]
    pub sort: FolderSort,
    #[serde(default)]
    pub order: FolderOrder,
    /// Restrict to directories or media files (default: both).
    #[serde(default, rename = "type")]
    #[param(rename = "type")]
    pub entry_type: FolderEntryFilter,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct FolderBreadcrumbResponse {
    pub name: String,
    /// Root-relative path of this ancestor (empty for the root).
    pub path: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum FolderEntryType {
    Directory,
    Media,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct FolderEntryResponse {
    pub entry_type: FolderEntryType,
    pub name: String,
    /// Root-relative path (pass as `path` to open a directory).
    pub path: String,
    /// Playback id for media entries (use the normal playback routes).
    pub media_file_id: Option<Uuid>,
    pub media_kind: Option<WorkKind>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub container: Option<String>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub duration_ms: Option<u64>,
    pub bitrate_bps: Option<u64>,
    pub size_bytes: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub modified_at: Option<DateTime<Utc>>,
    /// Number of playable files below a directory.
    pub item_count: Option<u64>,
    /// The caller's own watched state, when they have watched some of it.
    pub watch_state: Option<WatchState>,
    pub position_ms: Option<u64>,
    pub thumbnail_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct FolderBrowseResponse {
    pub root: FolderRootResponse,
    pub path: String,
    pub breadcrumbs: Vec<FolderBreadcrumbResponse>,
    pub entries: Vec<FolderEntryResponse>,
    pub total: u64,
    pub offset: usize,
    pub limit: usize,
}

/// A profile under rating/tag rules cannot receive unrated, source-less
/// files, so it gets no folder access at all (fail closed).
fn content_restricted(state: &AppState, viewer: &CatalogViewer) -> bool {
    let _ = state;
    crate::household::has_content_rules(&viewer.policy)
}

fn household_blocked() -> ApiError {
    ApiError::new(
        StatusCode::FORBIDDEN,
        "household_blocked",
        "this content is not available for this profile",
    )
    .with_details(serde_json::json!({ "reason": "unrated" }))
}

fn blocked_by_policy(viewer: &CatalogViewer, path: &FsPath) -> bool {
    !viewer.policy.is_admin
        && viewer
            .policy
            .blocked_folders
            .iter()
            .any(|folder| path.starts_with(folder))
}

async fn root_response(
    state: &AppState,
    root: &SourceRootFolder,
    allowed: Option<&[Uuid]>,
) -> Result<FolderRootResponse, ApiError> {
    let visible: Vec<_> = state
        .source_instances
        .all()
        .into_iter()
        .filter(|i| allowed.is_none_or(|ids| ids.contains(&i.id)))
        .collect();
    let label = playarr_model::neutral_source_labels(&visible)
        .remove(&root.source_instance_id)
        .unwrap_or_default();
    Ok(FolderRootResponse {
        id: root.id,
        source_instance_id: root.source_instance_id,
        source_name: label.clone(),
        display_label: label,
        library_kind: root.work_kind,
        name: root.display_name.clone(),
        available: root.scan_status == FolderScanStatus::Ready
            || (root.scan_status == FolderScanStatus::Scanning && root.last_scanned_at.is_some()),
        scan_status: root.scan_status,
        last_scanned_at: root.last_scanned_at,
        item_count: state.folder_repo.count_entries(root.id).await?,
    })
}

#[utoipa::path(
    get,
    path = "/api/v1/folders/roots",
    tag = "folders",
    params(FolderRootsQuery),
    responses(
        (status = 200, description = "Path-free root folders the caller may browse", body = FolderRootsResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller does not have Playarr access")
    )
)]
pub async fn list_folder_roots_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Query(query): Query<FolderRootsQuery>,
) -> Result<Json<FolderRootsResponse>, ApiError> {
    if content_restricted(&state, &viewer) {
        return Ok(Json(FolderRootsResponse { roots: Vec::new() }));
    }
    let allowed = viewer.allowed_libraries();
    let self_peer = folder_scan::self_peer_id(&state).await;
    let mut roots = Vec::new();
    for root in state.folder_repo.list_roots().await? {
        if !root.active || !root.scan_enabled {
            continue;
        }
        if query.kind.is_some_and(|kind| kind != root.work_kind) {
            continue;
        }
        if ensure_library_allowed(root.source_instance_id, allowed.as_deref()).is_err() {
            continue;
        }
        let source = state.source_instances.get(root.source_instance_id);
        let Some(source) = source else { continue };
        if blocked_by_policy(
            &viewer,
            &resolve_local_root(&root, Some(&source), self_peer),
        ) {
            continue;
        }
        roots.push(root_response(&state, &root, allowed.as_deref()).await?);
    }
    roots.sort_by(|a, b| {
        a.source_name
            .to_lowercase()
            .cmp(&b.source_name.to_lowercase())
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(Json(FolderRootsResponse { roots }))
}

/// Normalises a client-supplied root-relative directory path.
pub(crate) fn normalise_relative_path(raw: &str) -> Result<String, ApiError> {
    let invalid = || ApiError::bad_request("path must be a relative folder path inside the root");
    if raw.contains('\0') || raw.contains('\\') {
        return Err(invalid());
    }
    let mut parts = Vec::new();
    for part in raw.split('/') {
        match part {
            "" | "." => {}
            ".." => return Err(invalid()),
            other => parts.push(other),
        }
    }
    Ok(parts.join("/"))
}

fn breadcrumbs(root_name: &str, path: &str) -> Vec<FolderBreadcrumbResponse> {
    let mut crumbs = vec![FolderBreadcrumbResponse {
        name: root_name.to_string(),
        path: String::new(),
    }];
    let mut acc = String::new();
    for part in path.split('/').filter(|p| !p.is_empty()) {
        if !acc.is_empty() {
            acc.push('/');
        }
        acc.push_str(part);
        crumbs.push(FolderBreadcrumbResponse {
            name: part.to_string(),
            path: acc.clone(),
        });
    }
    crumbs
}

struct Dir {
    name: String,
    count: u64,
    newest: Option<DateTime<Utc>>,
}

fn file_response(
    entry: &FolderMediaEntry,
    progress: Option<&playarr_model::WatchProgress>,
) -> FolderEntryResponse {
    FolderEntryResponse {
        entry_type: FolderEntryType::Media,
        name: entry.file_name.clone(),
        path: entry.relative_path.clone(),
        media_file_id: Some(entry.media_file_id),
        media_kind: Some(entry.work_kind),
        title: Some(entry.title.clone()),
        artist: entry.metadata.artist.clone(),
        album: entry.metadata.album.clone(),
        container: Some(entry.container.clone()),
        video_codec: entry.metadata.video_codec.clone(),
        audio_codec: entry.metadata.audio_codec.clone(),
        duration_ms: entry.duration_ms,
        bitrate_bps: entry.bitrate,
        size_bytes: Some(entry.size_bytes),
        width: entry.metadata.width,
        height: entry.metadata.height,
        modified_at: entry.modified_at,
        item_count: None,
        watch_state: progress.map(|p| p.state),
        position_ms: progress.map(|p| p.position_ms),
        // A frame a third of the way in, capped at the usual 30 seconds, so
        // short clips still get a picture.
        thumbnail_url: entry.metadata.video_codec.as_ref().map(|_| {
            let position_ms = entry.duration_ms.map_or(30_000, |d| (d / 3).min(30_000));
            format!(
                "/api/v1/media/{}/thumbnail?position_ms={position_ms}",
                entry.media_file_id
            )
        }),
    }
}

#[utoipa::path(
    get,
    path = "/api/v1/folders/roots/{root_id}/browse",
    tag = "folders",
    params(("root_id" = Uuid, Path, description = "Folder root id"), FolderBrowseQuery),
    responses(
        (status = 200, description = "One directory level: sub-directories first, then media files", body = FolderBrowseResponse),
        (status = 400, description = "Invalid path"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "No access to this library or folder"),
        (status = 404, description = "Unknown root or folder")
    )
)]
pub async fn browse_folder_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(root_id): Path<Uuid>,
    Query(query): Query<FolderBrowseQuery>,
) -> Result<Json<FolderBrowseResponse>, ApiError> {
    let root = state
        .folder_repo
        .get_root(root_id)
        .await
        .map_err(|_| ApiError::not_found("unknown folder root"))?;
    if !root.active || !root.scan_enabled {
        return Err(ApiError::not_found("unknown folder root"));
    }
    ensure_library_allowed(
        root.source_instance_id,
        viewer.allowed_libraries().as_deref(),
    )?;
    if content_restricted(&state, &viewer) {
        return Err(household_blocked());
    }
    let source = state
        .source_instances
        .get(root.source_instance_id)
        .ok_or_else(|| ApiError::not_found("unknown folder root"))?;
    let self_peer = folder_scan::self_peer_id(&state).await;
    if blocked_by_policy(
        &viewer,
        &resolve_local_root(&root, Some(&source), self_peer),
    ) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "household_blocked",
            "this content is not available for this profile",
        )
        .with_details(serde_json::json!({ "reason": "folder_blocked" })));
    }

    let path = normalise_relative_path(query.path.as_deref().unwrap_or(""))?;
    let entries = state.folder_repo.list_entries_under(root_id, &path).await?;
    let entries: Vec<_> = entries
        .into_iter()
        .filter(|entry| !blocked_by_policy(&viewer, &entry.physical_path))
        .collect();
    if entries.is_empty() && !path.is_empty() {
        return Err(ApiError::not_found("unknown folder"));
    }

    let prefix = if path.is_empty() {
        String::new()
    } else {
        format!("{path}/")
    };
    let needle = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .map(str::to_lowercase);
    let matches = |name: &str, title: Option<&str>| {
        needle.as_ref().is_none_or(|n| {
            name.to_lowercase().contains(n) || title.is_some_and(|t| t.to_lowercase().contains(n))
        })
    };

    let progress: BTreeMap<Uuid, playarr_model::WatchProgress> = state
        .watch_progress
        .list_for_user(viewer.user_id)
        .await?
        .into_iter()
        .map(|p| (p.media_file_id, p))
        .collect();

    let mut dirs: BTreeMap<String, Dir> = BTreeMap::new();
    let mut files: Vec<&FolderMediaEntry> = Vec::new();
    for entry in &entries {
        let rest = entry
            .relative_path
            .strip_prefix(&prefix)
            .unwrap_or(&entry.relative_path);
        match rest.split_once('/') {
            None => files.push(entry),
            Some((dir, _)) => {
                let slot = dirs.entry(dir.to_string()).or_insert_with(|| Dir {
                    name: dir.to_string(),
                    count: 0,
                    newest: None,
                });
                slot.count += 1;
                slot.newest = slot.newest.max(entry.modified_at);
            }
        }
    }

    let mut dir_rows: Vec<&Dir> = dirs
        .values()
        .filter(|d| matches(&d.name, None))
        .filter(|_| query.entry_type != FolderEntryFilter::Media)
        .collect();
    let mut file_rows: Vec<&FolderMediaEntry> = files
        .into_iter()
        .filter(|f| matches(&f.file_name, Some(&f.title)))
        .filter(|_| query.entry_type != FolderEntryFilter::Directories)
        .collect();

    let descending = query.order == FolderOrder::Desc;
    match query.sort {
        FolderSort::Name => {
            dir_rows.sort_by_key(|d| d.name.to_lowercase());
            file_rows.sort_by_key(|f| f.file_name.to_lowercase());
        }
        FolderSort::Modified => {
            dir_rows.sort_by(|a, b| a.newest.cmp(&b.newest).then_with(|| a.name.cmp(&b.name)));
            file_rows.sort_by(|a, b| {
                a.modified_at
                    .cmp(&b.modified_at)
                    .then_with(|| a.file_name.cmp(&b.file_name))
            });
        }
        FolderSort::Size => {
            dir_rows.sort_by_key(|d| (d.count, d.name.to_lowercase()));
            file_rows.sort_by(|a, b| {
                a.size_bytes
                    .cmp(&b.size_bytes)
                    .then_with(|| a.file_name.cmp(&b.file_name))
            });
        }
        FolderSort::Duration => {
            dir_rows.sort_by_key(|d| d.name.to_lowercase());
            file_rows.sort_by(|a, b| {
                a.duration_ms
                    .cmp(&b.duration_ms)
                    .then_with(|| a.file_name.cmp(&b.file_name))
            });
        }
    }
    if descending {
        dir_rows.reverse();
        file_rows.reverse();
    }

    let mut rows: Vec<FolderEntryResponse> = dir_rows
        .into_iter()
        .map(|d| FolderEntryResponse {
            entry_type: FolderEntryType::Directory,
            name: d.name.clone(),
            path: format!("{prefix}{}", d.name),
            media_file_id: None,
            media_kind: None,
            title: None,
            artist: None,
            album: None,
            container: None,
            video_codec: None,
            audio_codec: None,
            duration_ms: None,
            bitrate_bps: None,
            size_bytes: None,
            width: None,
            height: None,
            modified_at: d.newest,
            item_count: Some(d.count),
            watch_state: None,
            position_ms: None,
            thumbnail_url: None,
        })
        .collect();
    rows.extend(
        file_rows
            .into_iter()
            .map(|f| file_response(f, progress.get(&f.media_file_id))),
    );

    let total = rows.len() as u64;
    let offset = query.offset.unwrap_or(0);
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let page = rows.into_iter().skip(offset).take(limit).collect();

    Ok(Json(FolderBrowseResponse {
        root: root_response(&state, &root, viewer.allowed_libraries().as_deref()).await?,
        breadcrumbs: breadcrumbs(&root.display_name, &path),
        path,
        entries: page,
        total,
        offset,
        limit,
    }))
}

// ---------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdminFolderRootResponse {
    pub id: Uuid,
    pub source_instance_id: Uuid,
    pub source_name: String,
    pub library_kind: WorkKind,
    pub name: String,
    /// The path as the source application (or the administrator) reported it.
    pub reported_path: String,
    /// Explicit path on this server, when set.
    pub local_path: Option<String>,
    /// The directory the scanner will actually walk.
    pub effective_path: String,
    pub manual: bool,
    pub active: bool,
    pub scan_enabled: bool,
    /// Whether the effective path is a readable directory on this server.
    pub path_available: bool,
    pub scan_status: FolderScanStatus,
    pub scan_error: Option<String>,
    pub last_scanned_at: Option<DateTime<Utc>>,
    pub item_count: u64,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdminFolderRootsResponse {
    pub roots: Vec<AdminFolderRootResponse>,
    /// Sources whose root folders could not be discovered (only on `discover`).
    pub failed_source_instance_ids: Vec<Uuid>,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct CreateFolderRootRequest {
    /// Source instance whose library the folder belongs to (decides the
    /// library kind and who may browse it).
    pub source_instance_id: Uuid,
    /// Absolute directory on this server.
    pub path: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, ToSchema)]
pub struct UpdateFolderRootRequest {
    pub scan_enabled: Option<bool>,
    /// Absolute directory on this server; an empty string clears the override.
    pub local_path: Option<String>,
    pub name: Option<String>,
}

fn validate_absolute_path(raw: &str) -> Result<PathBuf, ApiError> {
    let path = PathBuf::from(raw.trim());
    let ok = path.is_absolute()
        && !raw.contains('\0')
        && path
            .components()
            .all(|c| !matches!(c, Component::ParentDir | Component::CurDir));
    if ok {
        Ok(path)
    } else {
        Err(ApiError::bad_request(
            "path must be an absolute directory path without . or .. parts",
        ))
    }
}

async fn admin_response(
    state: &AppState,
    root: &SourceRootFolder,
    self_peer: Option<Uuid>,
) -> Result<AdminFolderRootResponse, ApiError> {
    let source = state.source_instances.get(root.source_instance_id);
    let effective = resolve_local_root(root, source.as_ref(), self_peer);
    let path_available = tokio::fs::metadata(&effective)
        .await
        .map(|m| m.is_dir())
        .unwrap_or(false);
    Ok(AdminFolderRootResponse {
        id: root.id,
        source_instance_id: root.source_instance_id,
        source_name: source.map(|s| s.name).unwrap_or_default(),
        library_kind: root.work_kind,
        name: root.display_name.clone(),
        reported_path: root.reported_path.clone(),
        local_path: root
            .local_path_override
            .as_ref()
            .map(|p| p.to_string_lossy().into_owned()),
        effective_path: effective.to_string_lossy().into_owned(),
        manual: root.is_manual(),
        active: root.active,
        scan_enabled: root.scan_enabled,
        path_available,
        scan_status: root.scan_status,
        scan_error: root.scan_error.clone(),
        last_scanned_at: root.last_scanned_at,
        item_count: state.folder_repo.count_entries(root.id).await?,
    })
}

async fn admin_list(
    state: &AppState,
    failed: Vec<Uuid>,
) -> Result<AdminFolderRootsResponse, ApiError> {
    let self_peer = folder_scan::self_peer_id(state).await;
    let mut roots = Vec::new();
    for root in state.folder_repo.list_roots().await? {
        roots.push(admin_response(state, &root, self_peer).await?);
    }
    Ok(AdminFolderRootsResponse {
        roots,
        failed_source_instance_ids: failed,
    })
}

fn spawn_scan(state: &AppState, root_id: Uuid) {
    let state = state.clone();
    tokio::spawn(async move {
        let _ = folder_scan::scan_root(&state, root_id).await;
    });
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/folders/roots",
    tag = "admin",
    responses(
        (status = 200, description = "Every known root folder with its scan configuration and state", body = AdminFolderRootsResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is not an admin")
    )
)]
pub async fn admin_list_folder_roots_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<AdminFolderRootsResponse>, ApiError> {
    Ok(Json(admin_list(&state, Vec::new()).await?))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/folders/discover",
    tag = "admin",
    responses(
        (status = 200, description = "Root folders re-read from every media-owning source", body = AdminFolderRootsResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is not an admin")
    )
)]
pub async fn admin_discover_folder_roots_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<AdminFolderRootsResponse>, ApiError> {
    let failed = folder_scan::discover_roots(&state).await?;
    Ok(Json(admin_list(&state, failed).await?))
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/folders/roots",
    tag = "admin",
    request_body = CreateFolderRootRequest,
    responses(
        (status = 201, description = "Root added, enabled and scanning", body = AdminFolderRootResponse),
        (status = 400, description = "Invalid path or source"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is not an admin"),
        (status = 409, description = "This folder is already configured for that source")
    )
)]
pub async fn admin_create_folder_root_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<CreateFolderRootRequest>,
) -> Result<(StatusCode, Json<AdminFolderRootResponse>), ApiError> {
    let source = state
        .source_instances
        .get(body.source_instance_id)
        .ok_or_else(|| ApiError::bad_request("unknown source instance"))?;
    let (kind, _) = work_kind_and_provider(source.kind)
        .ok_or_else(|| ApiError::bad_request("this source does not own a media library"))?;
    let path = validate_absolute_path(&body.path)?;
    let path_text = path.to_string_lossy().into_owned();
    let id = stable_id(source.id, &format!("manual:{path_text}"));
    if state.folder_repo.get_root(id).await.is_ok() {
        return Err(ApiError::conflict(
            "this folder is already configured for that source",
        ));
    }
    let name = body
        .name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| root_display_name(&path_text, &source.name));
    let root = SourceRootFolder {
        id,
        source_instance_id: source.id,
        source_root_id: format!("{MANUAL_ROOT_PREFIX}{path_text}"),
        reported_path: path_text,
        local_path_override: None,
        display_name: name,
        work_kind: kind,
        accessible: true,
        free_space_bytes: None,
        total_space_bytes: None,
        active: true,
        scan_enabled: true,
        scan_status: FolderScanStatus::Pending,
        last_scanned_at: None,
        scan_error: None,
        updated_at: Utc::now(),
    };
    state.folder_repo.upsert_root(&root).await?;
    spawn_scan(&state, id);
    let self_peer = folder_scan::self_peer_id(&state).await;
    Ok((
        StatusCode::CREATED,
        Json(admin_response(&state, &root, self_peer).await?),
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/folders/roots/{root_id}",
    tag = "admin",
    params(("root_id" = Uuid, Path, description = "Folder root id")),
    request_body = UpdateFolderRootRequest,
    responses(
        (status = 200, description = "Updated root", body = AdminFolderRootResponse),
        (status = 400, description = "Invalid path"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is not an admin"),
        (status = 404, description = "Unknown root")
    )
)]
pub async fn admin_update_folder_root_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(root_id): Path<Uuid>,
    Json(body): Json<UpdateFolderRootRequest>,
) -> Result<Json<AdminFolderRootResponse>, ApiError> {
    let previous = state
        .folder_repo
        .get_root(root_id)
        .await
        .map_err(|_| ApiError::not_found("unknown folder root"))?;
    let local_path_override = match body.local_path.as_deref() {
        None => None,
        Some(raw) if raw.trim().is_empty() => Some(None),
        Some(raw) => Some(Some(validate_absolute_path(raw)?)),
    };
    let name = match body.name.as_deref().map(str::trim) {
        Some("") => return Err(ApiError::bad_request("name must not be empty")),
        other => other.map(str::to_string),
    };
    let path_changed = local_path_override.is_some();
    let root = state
        .folder_repo
        .update_root_config(
            root_id,
            &RootConfigUpdate {
                scan_enabled: body.scan_enabled,
                local_path_override,
                display_name: name,
            },
        )
        .await?;
    // Newly enabled or re-pointed roots scan straight away; a disabled root
    // keeps its cache (viewers just stop seeing it).
    if root.scan_enabled && (!previous.scan_enabled || path_changed) {
        spawn_scan(&state, root_id);
    }
    if previous.scan_enabled != root.scan_enabled || path_changed {
        state
            .live_events
            .publish(playarr_db::NewLiveEvent::for_library(
                playarr_db::live_event_kind::LIBRARY,
                "folder_root",
                root_id,
                &["entries"],
                Some(root.source_instance_id),
            ))
            .await;
    }
    let self_peer = folder_scan::self_peer_id(&state).await;
    Ok(Json(admin_response(&state, &root, self_peer).await?))
}

#[utoipa::path(
    delete,
    path = "/api/v1/admin/folders/roots/{root_id}",
    tag = "admin",
    params(("root_id" = Uuid, Path, description = "Folder root id")),
    responses(
        (status = 204, description = "Root and its scanned files removed"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is not an admin"),
        (status = 404, description = "Unknown root"),
        (status = 409, description = "Roots reported by a source cannot be deleted; disable them instead")
    )
)]
pub async fn admin_delete_folder_root_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(root_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let root = state
        .folder_repo
        .get_root(root_id)
        .await
        .map_err(|_| ApiError::not_found("unknown folder root"))?;
    if !root.is_manual() {
        return Err(ApiError::conflict(
            "this root is reported by its source; disable scanning instead",
        ));
    }
    state.folder_repo.delete_root(root_id).await?;
    state
        .live_events
        .publish(playarr_db::NewLiveEvent::for_library(
            playarr_db::live_event_kind::LIBRARY,
            "folder_root",
            root_id,
            &["entries"],
            Some(root.source_instance_id),
        ))
        .await;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/api/v1/admin/folders/roots/{root_id}/scan",
    tag = "admin",
    params(("root_id" = Uuid, Path, description = "Folder root id")),
    responses(
        (status = 200, description = "Scan finished", body = ScanSummary),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is not an admin"),
        (status = 404, description = "Unknown root"),
        (status = 409, description = "A scan of this root is already running"),
        (status = 422, description = "The root could not be scanned")
    )
)]
pub async fn admin_scan_folder_root_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(root_id): Path<Uuid>,
) -> Result<Json<ScanSummary>, ApiError> {
    state
        .folder_repo
        .get_root(root_id)
        .await
        .map_err(|_| ApiError::not_found("unknown folder root"))?;
    match folder_scan::scan_root(&state, root_id).await? {
        Some(summary) => Ok(Json(summary)),
        None => Err(ApiError::conflict("a scan of this root is already running")),
    }
}

#[cfg(test)]
mod path_tests {
    use super::*;

    #[test]
    fn relative_paths_are_normalised_and_traversal_is_rejected() {
        assert_eq!(normalise_relative_path("").unwrap(), "");
        assert_eq!(normalise_relative_path("/a//b/./c/").unwrap(), "a/b/c");
        for bad in ["..", "a/../b", "a\\b", "a\0b"] {
            assert!(normalise_relative_path(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn absolute_admin_paths_only() {
        assert!(validate_absolute_path("/srv/media").is_ok());
        for bad in ["media", "/srv/../etc", "./x", ""] {
            assert!(validate_absolute_path(bad).is_err(), "{bad}");
        }
    }
}
