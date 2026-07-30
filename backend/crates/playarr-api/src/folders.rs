//! Path-safe, file-derived browsing for media that has not been organised
//! into a source application's catalogue.
//!
//! Root paths remain server-only. Clients receive opaque root ids and
//! normalised root-relative paths; every browse target is canonicalised and
//! proven to remain beneath its root before the filesystem is read.

use std::collections::BTreeMap;
use std::path::{Component, Path as FsPath, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{DateTime, Utc};
use futures::{stream, StreamExt};
use playarr_arr_sync::{work_kind_and_provider, ArrClient};
use playarr_model::{
    FolderFileMetadata, FolderMediaEntry, FolderScanStatus, MediaFile, ScannedFolderFile,
    SourceInstance, SourceRootFolder, WorkKind,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::process::Command;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::auth_extractor::{ensure_library_allowed, forbidden, StreamingUser};
use crate::physical_path::map_source_path;
use crate::{ApiError, AppState};

const DEFAULT_PAGE_SIZE: usize = 200;
const MAX_PAGE_SIZE: usize = 500;
const MAX_PARALLEL_PROBES: usize = 4;
const MAX_NEW_PROBES_PER_BROWSE: usize = 8;
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const FAILED_PROBE_CACHE_TTL: chrono::Duration = chrono::Duration::minutes(5);
const ROOT_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(8);
const ROOT_CACHE_TTL: chrono::Duration = chrono::Duration::minutes(5);
static FOLDER_PROBE_PERMITS: tokio::sync::Semaphore =
    tokio::sync::Semaphore::const_new(MAX_PARALLEL_PROBES * 2);

/// An already-authorised folder media file held open by descriptor.
///
/// Folder paths are mutable external state: validating a path and later
/// asking [`tower_http::services::ServeFile`] to open the same pathname
/// leaves a race in which a writable directory can replace it with a
/// symlink. On Linux this guard owns the descriptor opened relative to the
/// canonical root. Callers either serve `/proc/self/fd/<fd>` in-process or
/// give subprocesses `/proc/<server-pid>/fd/<fd>`, retaining the guard until
/// the consumer has finished or its long-lived session expires.
#[derive(Debug)]
pub(crate) struct PinnedFolderFile {
    #[cfg(target_os = "linux")]
    file: std::fs::File,
    mime_path: PathBuf,
}

impl PinnedFolderFile {
    /// Extension-bearing, root-relative path used only for MIME inference.
    pub(crate) fn mime_path(&self) -> &FsPath {
        &self.mime_path
    }

    /// A path that reopens this exact descriptor, not the mutable media
    /// pathname. Folder originals fail closed when procfs is unavailable.
    pub(crate) fn proc_path(&self) -> Result<PathBuf, ApiError> {
        #[cfg(target_os = "linux")]
        {
            use std::os::fd::AsRawFd;

            let proc_fd_dir = FsPath::new("/proc/self/fd");
            if !std::fs::metadata(proc_fd_dir)
                .map(|metadata| metadata.is_dir())
                .unwrap_or(false)
            {
                return Err(unavailable_media());
            }
            let path = proc_fd_dir.join(self.file.as_raw_fd().to_string());
            if !std::fs::metadata(&path)
                .map(|metadata| metadata.is_file())
                .unwrap_or(false)
            {
                return Err(unavailable_media());
            }
            Ok(path)
        }

        #[cfg(not(target_os = "linux"))]
        {
            Err(unavailable_media())
        }
    }

    /// A procfs path that a spawned subprocess can use to reopen this
    /// server-owned descriptor.
    ///
    /// `/proc/self/fd` would refer to the child after `exec`, where this
    /// `CLOEXEC` descriptor no longer exists. Naming the owning server PID
    /// keeps the path bound to this descriptor while the guard is retained.
    pub(crate) fn subprocess_path(&self) -> Result<PathBuf, ApiError> {
        #[cfg(target_os = "linux")]
        {
            use std::os::fd::AsRawFd;

            let proc_fd_dir = PathBuf::from(format!("/proc/{}/fd", std::process::id()));
            if !std::fs::metadata(&proc_fd_dir)
                .map(|metadata| metadata.is_dir())
                .unwrap_or(false)
            {
                return Err(unavailable_media());
            }
            let path = proc_fd_dir.join(self.file.as_raw_fd().to_string());
            if !std::fs::metadata(&path)
                .map(|metadata| metadata.is_file())
                .unwrap_or(false)
            {
                return Err(unavailable_media());
            }
            Ok(path)
        }

        #[cfg(not(target_os = "linux"))]
        {
            Err(unavailable_media())
        }
    }

    /// Transfers the descriptor guard to a long-lived consumer such as an
    /// on-demand transcode session.
    pub(crate) fn into_file(self) -> Result<std::fs::File, ApiError> {
        #[cfg(target_os = "linux")]
        {
            Ok(self.file)
        }

        #[cfg(not(target_os = "linux"))]
        {
            Err(unavailable_media())
        }
    }
}

#[derive(Debug, Clone, Deserialize, IntoParams)]
pub struct FolderRootsQuery {
    pub kind: WorkKind,
}

#[derive(Debug, Clone, Deserialize, IntoParams)]
pub struct FolderBrowseQuery {
    /// Root-relative directory path. Empty or omitted means the root.
    pub path: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct FolderRootResponse {
    pub id: Uuid,
    pub source_instance_id: Uuid,
    pub source_name: String,
    pub library_kind: WorkKind,
    pub name: String,
    pub available: bool,
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct FolderRootErrorResponse {
    pub source_instance_id: Uuid,
    pub source_name: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct FolderRootsResponse {
    pub roots: Vec<FolderRootResponse>,
    pub errors: Vec<FolderRootErrorResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct FolderBreadcrumbResponse {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FolderEntryType {
    Directory,
    Media,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct FolderEntryResponse {
    pub entry_type: FolderEntryType,
    pub name: String,
    pub path: String,
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
    pub thumbnail_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct FolderBrowseResponse {
    pub root: FolderRootResponse,
    pub path: String,
    pub breadcrumbs: Vec<FolderBreadcrumbResponse>,
    pub entries: Vec<FolderEntryResponse>,
    pub total: u64,
    pub offset: usize,
    pub limit: usize,
}

#[utoipa::path(
    get,
    path = "/api/v1/folders/roots",
    tag = "folders",
    params(FolderRootsQuery),
    responses(
        (status = 200, description = "Opaque, path-free root folders for the requested library kind", body = FolderRootsResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller does not have Playarr streaming access")
    )
)]
pub async fn list_folder_roots_handler(
    State(state): State<AppState>,
    streaming: StreamingUser,
    Query(query): Query<FolderRootsQuery>,
) -> Result<Json<FolderRootsResponse>, ApiError> {
    let allowed_libraries = streaming.allowed_libraries();
    let sources: Vec<_> = state
        .source_instances
        .all()
        .into_iter()
        .filter(|source| {
            work_kind_and_provider(source.kind).is_some_and(|(kind, _)| kind == query.kind)
                && ensure_library_allowed(source.id, allowed_libraries.as_deref()).is_ok()
        })
        .collect();

    let self_peer_id = crate::admin_peer::ensure_node_identity(&state.node_identity_repo)
        .await?
        .peer_id;
    let cached = state.folder_repo.list_active_roots().await?;
    let due = sources_due_for_refresh(&state, &sources, &cached).await;
    let needs_first_discovery = due.iter().any(|source| {
        !cached
            .iter()
            .any(|root| root.source_instance_id == source.id)
    });
    let mut errors = if needs_first_discovery {
        refresh_due_sources(&state, sources.clone(), self_peer_id, query.kind).await?
    } else {
        if !due.is_empty() {
            let refresh_state = state.clone();
            let refresh_sources = sources.clone();
            tokio::spawn(async move {
                if let Err(error) =
                    refresh_due_sources(&refresh_state, refresh_sources, self_peer_id, query.kind)
                        .await
                {
                    tracing::warn!(
                        error = ?error,
                        "background root-folder refresh failed; cached roots remain available"
                    );
                }
            });
        }
        Vec::new()
    };
    let failure_cutoff = Utc::now() - ROOT_CACHE_TTL;
    let failures = state.folder_root_refresh_failures.lock().await;
    for source in &sources {
        if failures
            .get(&source.id)
            .is_some_and(|failed_at| *failed_at >= failure_cutoff)
            && !errors
                .iter()
                .any(|error| error.source_instance_id == source.id)
        {
            errors.push(root_refresh_error(source));
        }
    }
    drop(failures);

    let source_names = sources
        .iter()
        .map(|source| (source.id, source.name.clone()))
        .collect::<BTreeMap<_, _>>();
    let mut roots = Vec::new();
    for root in state.folder_repo.list_active_roots().await? {
        if root.work_kind != query.kind || !source_names.contains_key(&root.source_instance_id) {
            continue;
        }
        let local_path = sources
            .iter()
            .find(|source| source.id == root.source_instance_id)
            .and_then(|source| resolve_local_root_path(&root, source, self_peer_id));
        let canonical = match local_path {
            Some(path) => tokio::fs::canonicalize(path).await.ok(),
            None => None,
        };
        if !streaming.policy.is_admin
            && canonical.as_deref().is_some_and(|path| {
                folder_path_is_blocked("", path, &streaming.policy.blocked_folders)
            })
        {
            continue;
        }
        let local_directory = match canonical.as_deref() {
            Some(path) => tokio::fs::metadata(path)
                .await
                .is_ok_and(|metadata| metadata.is_dir()),
            None => false,
        };
        let available = root.accessible && local_directory;
        let unavailable_reason = (!available).then(|| {
            if let Some(message) = root.scan_error.as_deref() {
                message.to_string()
            } else if !root.accessible {
                "The source reports this root as unavailable.".to_string()
            } else {
                "This root is not mounted on the current Playarr server.".to_string()
            }
        });
        roots.push(FolderRootResponse {
            id: root.id,
            source_instance_id: root.source_instance_id,
            source_name: source_names
                .get(&root.source_instance_id)
                .cloned()
                .unwrap_or_else(|| "Source".to_string()),
            library_kind: root.work_kind,
            name: root.display_name,
            available,
            unavailable_reason,
        });
    }
    roots.sort_by(|left, right| {
        left.source_name
            .to_lowercase()
            .cmp(&right.source_name.to_lowercase())
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(Json(FolderRootsResponse { roots, errors }))
}

async fn sources_due_for_refresh(
    state: &AppState,
    sources: &[SourceInstance],
    cached: &[SourceRootFolder],
) -> Vec<SourceInstance> {
    let attempts = state.folder_root_refresh_attempts.lock().await;
    let cutoff = Utc::now() - ROOT_CACHE_TTL;
    sources
        .iter()
        .filter(|source| {
            let newest_root = cached
                .iter()
                .filter(|root| root.source_instance_id == source.id)
                .map(|root| root.updated_at)
                .max();
            let newest_attempt = attempts.get(&source.id).copied();
            newest_root
                .into_iter()
                .chain(newest_attempt)
                .max()
                .is_none_or(|updated_at| updated_at < cutoff)
        })
        .cloned()
        .collect()
}

async fn refresh_due_sources(
    state: &AppState,
    sources: Vec<SourceInstance>,
    self_peer_id: Uuid,
    kind: WorkKind,
) -> Result<Vec<FolderRootErrorResponse>, ApiError> {
    let _refresh_guard = state.folder_root_refresh_gate.lock().await;
    let cached = state.folder_repo.list_active_roots().await?;
    let sources = sources_due_for_refresh(state, &sources, &cached).await;
    if sources.is_empty() {
        return Ok(Vec::new());
    }

    let attempted_at = Utc::now();
    {
        let mut attempts = state.folder_root_refresh_attempts.lock().await;
        for source in &sources {
            attempts.insert(source.id, attempted_at);
        }
    }

    let discoveries = stream::iter(sources)
        .map(|source| async move {
            let discovery = tokio::time::timeout(
                ROOT_DISCOVERY_TIMEOUT,
                ArrClient::from_source_instance(&source).list_root_folders(),
            )
            .await;
            (source, discovery)
        })
        .buffer_unordered(4)
        .collect::<Vec<_>>()
        .await;

    let mut errors = Vec::new();
    let cached_overrides = cached
        .iter()
        .filter_map(|root| root.local_path_override.clone().map(|path| (root.id, path)))
        .collect::<BTreeMap<_, _>>();
    for (source, discovery) in discoveries {
        let remote_roots = match discovery {
            Ok(Ok(remote_roots)) => remote_roots,
            Ok(Err(error)) => {
                tracing::warn!(
                    source_instance_id = %source.id,
                    source_kind = ?source.kind,
                    error = %error,
                    "could not refresh source root folders; serving the last cached roots"
                );
                state
                    .folder_root_refresh_failures
                    .lock()
                    .await
                    .insert(source.id, attempted_at);
                errors.push(root_refresh_error(&source));
                continue;
            }
            Err(_) => {
                tracing::warn!(
                    source_instance_id = %source.id,
                    source_kind = ?source.kind,
                    timeout_seconds = ROOT_DISCOVERY_TIMEOUT.as_secs(),
                    "source root-folder refresh timed out; serving the last cached roots"
                );
                state
                    .folder_root_refresh_failures
                    .lock()
                    .await
                    .insert(source.id, attempted_at);
                errors.push(root_refresh_error(&source));
                continue;
            }
        };
        state
            .folder_root_refresh_failures
            .lock()
            .await
            .remove(&source.id);

        let roots = remote_roots
            .into_iter()
            .map(|remote| {
                let root_id = stable_uuid(
                    "folder-root",
                    &format!("{self_peer_id}:{}:{}", source.id, remote.id),
                );
                let source_path = resolve_source_root_path(&source, self_peer_id, &remote.path);
                let local_path_override = cached_overrides.get(&root_id).cloned();
                let mapping_missing = source_path.is_none() && local_path_override.is_none();
                SourceRootFolder {
                    id: root_id,
                    source_instance_id: source.id,
                    source_root_id: remote.id.to_string(),
                    reported_path: remote.path.clone(),
                    local_path_override,
                    display_name: root_display_name(&remote.path, &source.name),
                    work_kind: kind,
                    accessible: remote.accessible,
                    free_space_bytes: remote
                        .free_space
                        .and_then(|value| u64::try_from(value).ok()),
                    total_space_bytes: remote
                        .total_space
                        .and_then(|value| u64::try_from(value).ok()),
                    active: true,
                    scan_status: if mapping_missing {
                        FolderScanStatus::Failed
                    } else {
                        FolderScanStatus::Pending
                    },
                    last_scanned_at: None,
                    scan_error: mapping_missing.then(|| {
                        "This root has no mapping on the current Playarr server.".to_string()
                    }),
                    updated_at: attempted_at,
                }
            })
            .collect::<Vec<_>>();
        state
            .folder_repo
            .replace_active_roots(source.id, &roots)
            .await?;
    }
    Ok(errors)
}

fn root_refresh_error(source: &SourceInstance) -> FolderRootErrorResponse {
    FolderRootErrorResponse {
        source_instance_id: source.id,
        source_name: source.name.clone(),
        message: "Could not refresh root folders; cached results may be shown.".to_string(),
    }
}

#[utoipa::path(
    get,
    path = "/api/v1/folders/{root_folder_id}",
    tag = "folders",
    params(
        ("root_folder_id" = Uuid, Path, description = "Opaque root-folder id"),
        FolderBrowseQuery
    ),
    responses(
        (status = 200, description = "One path-safe, paginated directory level with file-derived metadata", body = FolderBrowseResponse),
        (status = 400, description = "The requested path is absolute or contains traversal"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller cannot access this library or folder"),
        (status = 404, description = "Unknown root or directory"),
        (status = 503, description = "The root is not mounted on this server")
    )
)]
pub async fn browse_folder_handler(
    State(state): State<AppState>,
    streaming: StreamingUser,
    Path(root_folder_id): Path<Uuid>,
    Query(query): Query<FolderBrowseQuery>,
) -> Result<Json<FolderBrowseResponse>, ApiError> {
    let root = state
        .folder_repo
        .list_active_roots()
        .await?
        .into_iter()
        .find(|root| root.id == root_folder_id)
        .ok_or_else(|| ApiError::not_found("unknown root folder"))?;
    ensure_library_allowed(
        root.source_instance_id,
        streaming.allowed_libraries().as_deref(),
    )?;
    let relative_path = normalise_relative_path(query.path.as_deref().unwrap_or(""))?;
    let local_root = current_local_root_path(&state, &root).await?;
    let canonical_root = tokio::fs::canonicalize(&local_root)
        .await
        .map_err(|_| unavailable_root())?;
    let root_metadata = tokio::fs::metadata(&canonical_root)
        .await
        .map_err(|_| unavailable_root())?;
    if !root.accessible || !root_metadata.is_dir() {
        return Err(unavailable_root());
    }

    let target = if relative_path.is_empty() {
        canonical_root.clone()
    } else {
        canonical_root.join(relative_path_to_pathbuf(&relative_path))
    };
    let canonical_target = tokio::fs::canonicalize(&target)
        .await
        .map_err(|_| ApiError::not_found("folder not found"))?;
    if !canonical_target.starts_with(&canonical_root) {
        return Err(ApiError::bad_request(
            "folder path must remain beneath its root",
        ));
    }
    let target_metadata = tokio::fs::metadata(&canonical_target)
        .await
        .map_err(|_| ApiError::not_found("folder not found"))?;
    if !target_metadata.is_dir() {
        return Err(ApiError::not_found("folder not found"));
    }
    if !streaming.policy.is_admin
        && folder_path_is_blocked(
            &relative_path,
            &canonical_target,
            &streaming.policy.blocked_folders,
        )
    {
        return Err(forbidden("this folder is blocked by the account policy"));
    }

    let mut discovered = read_directory(
        &canonical_root,
        &canonical_target,
        root.work_kind,
        &streaming.policy.blocked_folders,
        streaming.policy.is_admin,
    )
    .await?;
    discovered.sort_by(|left, right| {
        left.sort_group()
            .cmp(&right.sort_group())
            .then_with(|| left.name().to_lowercase().cmp(&right.name().to_lowercase()))
            .then_with(|| left.name().cmp(right.name()))
    });

    let total = u64::try_from(discovered.len()).unwrap_or(u64::MAX);
    let offset = query.offset.unwrap_or(0).min(discovered.len());
    let limit = query
        .limit
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(1, MAX_PAGE_SIZE);
    let page = discovered
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    let probe_budget = Arc::new(AtomicUsize::new(MAX_NEW_PROBES_PER_BROWSE));
    let entries =
        stream::iter(page)
            .map(|entry| {
                let state = state.clone();
                let root = root.clone();
                let canonical_root = canonical_root.clone();
                let probe_budget = probe_budget.clone();
                async move {
                    materialise_entry(&state, &root, &canonical_root, entry, &probe_budget).await
                }
            })
            .buffered(MAX_PARALLEL_PROBES)
            .collect::<Vec<_>>()
            .await
            .into_iter()
            .collect::<Result<Vec<_>, _>>()?;

    let source_name = state
        .source_instances
        .get(root.source_instance_id)
        .map(|source| source.name)
        .unwrap_or_else(|| "Source".to_string());
    let root_response = FolderRootResponse {
        id: root.id,
        source_instance_id: root.source_instance_id,
        source_name,
        library_kind: root.work_kind,
        name: root.display_name.clone(),
        available: true,
        unavailable_reason: None,
    };

    Ok(Json(FolderBrowseResponse {
        breadcrumbs: breadcrumbs(&root_response.name, &relative_path),
        root: root_response,
        path: relative_path,
        entries,
        total,
        offset,
        limit,
    }))
}

/// Adds the folder-specific policy gate to existing media/playback/download
/// routes. Non-folder media returns immediately.
pub(crate) async fn ensure_folder_media_allowed(
    state: &AppState,
    media_file_id: Uuid,
    policy: &playarr_model::Policy,
) -> Result<(), ApiError> {
    validate_folder_media(state, media_file_id, policy)
        .await
        .map(|_| ())
}

/// Validates and pins a folder-backed original for immediate byte delivery.
///
/// `Ok(None)` means the media file is not folder-backed and the caller
/// should retain the ordinary media-file path. A folder-backed file never
/// falls back to path-based serving: unsupported platforms, missing procfs,
/// or any descriptor-relative open failure all fail closed.
pub(crate) async fn open_pinned_folder_media(
    state: &AppState,
    media_file_id: Uuid,
    policy: &playarr_model::Policy,
) -> Result<Option<PinnedFolderFile>, ApiError> {
    let Some(validated) = validate_folder_media(state, media_file_id, policy).await? else {
        return Ok(None);
    };

    let pinned = tokio::task::spawn_blocking(move || {
        pin_relative_folder_file(
            validated.canonical_root,
            validated.relative_path,
            validated.mime_path,
            validated.expected_identity,
        )
    })
    .await
    .map_err(|error| ApiError::internal(format!("folder file open task failed: {error}")))??;
    Ok(Some(pinned))
}

struct ValidatedFolderMedia {
    canonical_root: PathBuf,
    relative_path: String,
    mime_path: PathBuf,
    expected_identity: (u64, u64),
}

async fn validate_folder_media(
    state: &AppState,
    media_file_id: Uuid,
    policy: &playarr_model::Policy,
) -> Result<Option<ValidatedFolderMedia>, ApiError> {
    let Some(entry) = state
        .folder_repo
        .find_media_entry_by_media_file_id(media_file_id)
        .await?
    else {
        return Ok(None);
    };
    let root = state
        .folder_repo
        .list_active_roots()
        .await?
        .into_iter()
        .find(|root| root.id == entry.root_folder_id)
        .ok_or_else(|| forbidden("this folder is no longer available"))?;
    if !root.active || !root.accessible {
        return Err(unavailable_root());
    }

    let media_file = state
        .media_files
        .get(media_file_id)
        .await
        .ok_or_else(unavailable_media)?;
    let local_root = current_local_root_path(state, &root).await?;
    let canonical_root = tokio::fs::canonicalize(&local_root)
        .await
        .map_err(|_| unavailable_root())?;
    let relative_path = normalise_relative_path(&entry.relative_path)
        .ok()
        .filter(|normalised| normalised == &entry.relative_path)
        .ok_or_else(|| forbidden("folder media has an invalid persisted relative path"))?;
    if relative_path.is_empty() {
        return Err(forbidden(
            "folder media must have a non-empty relative path",
        ));
    }
    let expected_path = local_root.join(relative_path_to_pathbuf(&relative_path));
    let canonical_expected = tokio::fs::canonicalize(expected_path)
        .await
        .map_err(|_| unavailable_media())?;
    let resolved_media_path = playarr_model::resolve_media_path(&media_file.path);
    let canonical_media = tokio::fs::canonicalize(resolved_media_path)
        .await
        .map_err(|_| unavailable_media())?;
    let metadata = tokio::fs::metadata(&canonical_media)
        .await
        .map_err(|_| unavailable_media())?;
    if !metadata.is_file()
        || !canonical_media.starts_with(&canonical_root)
        || canonical_expected != canonical_media
    {
        return Err(forbidden("folder media must remain beneath its root"));
    }
    if !policy.is_admin
        && folder_path_is_blocked(&relative_path, &canonical_media, &policy.blocked_folders)
    {
        return Err(forbidden("this folder is blocked by the account policy"));
    }
    #[cfg(target_os = "linux")]
    let expected_identity = {
        use std::os::unix::fs::MetadataExt;

        (metadata.dev(), metadata.ino())
    };
    #[cfg(not(target_os = "linux"))]
    let expected_identity = (0, 0);
    Ok(Some(ValidatedFolderMedia {
        canonical_root,
        mime_path: relative_path_to_pathbuf(&relative_path),
        relative_path,
        expected_identity,
    }))
}

#[cfg(target_os = "linux")]
fn pin_relative_folder_file(
    canonical_root: PathBuf,
    relative_path: String,
    mime_path: PathBuf,
    expected_identity: (u64, u64),
) -> Result<PinnedFolderFile, ApiError> {
    use rustix::fs::{Mode, OFlags, ResolveFlags};
    use std::os::unix::fs::MetadataExt;

    let root_fd = rustix::fs::open(
        &canonical_root,
        OFlags::PATH | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(|_| unavailable_root())?;
    let file_flags = OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC;
    let resolve = ResolveFlags::BENEATH | ResolveFlags::NO_MAGICLINKS | ResolveFlags::NO_SYMLINKS;
    let file_fd = match rustix::fs::openat2(
        &root_fd,
        FsPath::new(&relative_path),
        file_flags,
        Mode::empty(),
        resolve,
    ) {
        Ok(file) => file,
        Err(rustix::io::Errno::NOSYS) => {
            openat_without_symlinks(root_fd, FsPath::new(&relative_path), file_flags)
                .map_err(|_| unavailable_media())?
        }
        Err(_) => return Err(unavailable_media()),
    };
    let file = std::fs::File::from(file_fd);
    let metadata = file.metadata().map_err(|_| unavailable_media())?;
    if !metadata.is_file() || (metadata.dev(), metadata.ino()) != expected_identity {
        return Err(unavailable_media());
    }
    Ok(PinnedFolderFile { file, mime_path })
}

#[cfg(target_os = "linux")]
fn openat_without_symlinks(
    root_fd: rustix::fd::OwnedFd,
    relative_path: &FsPath,
    file_flags: rustix::fs::OFlags,
) -> rustix::io::Result<rustix::fd::OwnedFd> {
    use rustix::fs::{Mode, OFlags};

    let components = relative_path
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value),
            _ => None,
        })
        .collect::<Vec<_>>();
    let Some((file_name, directories)) = components.split_last() else {
        return Err(rustix::io::Errno::INVAL);
    };

    // Retaining every directory descriptor until the leaf is open prevents
    // renames higher in the path from changing what a later component is
    // resolved against.
    let mut directory_fds = vec![root_fd];
    for directory in directories {
        let next = rustix::fs::openat(
            &directory_fds[directory_fds.len() - 1],
            *directory,
            OFlags::PATH | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )?;
        directory_fds.push(next);
    }
    rustix::fs::openat(
        &directory_fds[directory_fds.len() - 1],
        *file_name,
        file_flags,
        Mode::empty(),
    )
}

#[cfg(not(target_os = "linux"))]
fn pin_relative_folder_file(
    _canonical_root: PathBuf,
    _relative_path: String,
    _mime_path: PathBuf,
    _expected_identity: (u64, u64),
) -> Result<PinnedFolderFile, ApiError> {
    Err(unavailable_media())
}

#[derive(Debug, Clone)]
enum DiscoveredEntry {
    Directory {
        name: String,
        relative_path: String,
    },
    Media {
        name: String,
        relative_path: String,
        physical_path: PathBuf,
        expected_identity: (u64, u64),
        size_bytes: u64,
        modified_at: Option<DateTime<Utc>>,
    },
}

impl DiscoveredEntry {
    fn sort_group(&self) -> u8 {
        match self {
            Self::Directory { .. } => 0,
            Self::Media { .. } => 1,
        }
    }

    fn name(&self) -> &str {
        match self {
            Self::Directory { name, .. } | Self::Media { name, .. } => name,
        }
    }
}

async fn read_directory(
    canonical_root: &FsPath,
    canonical_target: &FsPath,
    work_kind: WorkKind,
    blocked_folders: &[String],
    is_admin: bool,
) -> Result<Vec<DiscoveredEntry>, ApiError> {
    let mut reader = tokio::fs::read_dir(canonical_target)
        .await
        .map_err(|_| ApiError::not_found("folder not found"))?;
    let mut entries = Vec::new();
    while let Some(entry) = reader
        .next_entry()
        .await
        .map_err(|error| ApiError::internal(format!("failed to read folder: {error}")))?
    {
        let name = entry.file_name().to_string_lossy().into_owned();
        let candidate = entry.path();
        let canonical = match tokio::fs::canonicalize(&candidate).await {
            Ok(path) if path.starts_with(canonical_root) => path,
            _ => continue,
        };
        let metadata = match tokio::fs::metadata(&canonical).await {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let relative = match canonical.strip_prefix(canonical_root) {
            Ok(path) => normalised_path_string(path),
            Err(_) => continue,
        };
        if !is_admin && folder_path_is_blocked(&relative, &canonical, blocked_folders) {
            continue;
        }
        if metadata.is_dir() {
            entries.push(DiscoveredEntry::Directory {
                name,
                relative_path: relative,
            });
        } else if metadata.is_file() && is_supported_media_file(&canonical, work_kind) {
            #[cfg(target_os = "linux")]
            let expected_identity = {
                use std::os::unix::fs::MetadataExt;

                (metadata.dev(), metadata.ino())
            };
            #[cfg(not(target_os = "linux"))]
            let expected_identity = (0, 0);
            entries.push(DiscoveredEntry::Media {
                name,
                relative_path: relative,
                physical_path: canonical,
                expected_identity,
                size_bytes: metadata.len(),
                modified_at: metadata.modified().ok().map(DateTime::<Utc>::from),
            });
        }
    }
    Ok(entries)
}

async fn materialise_entry(
    state: &AppState,
    root: &SourceRootFolder,
    canonical_root: &FsPath,
    entry: DiscoveredEntry,
    probe_budget: &AtomicUsize,
) -> Result<FolderEntryResponse, ApiError> {
    match entry {
        DiscoveredEntry::Directory {
            name,
            relative_path,
        } => Ok(FolderEntryResponse {
            entry_type: FolderEntryType::Directory,
            name,
            path: relative_path,
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
            modified_at: None,
            thumbnail_url: None,
        }),
        DiscoveredEntry::Media {
            name,
            relative_path,
            physical_path,
            expected_identity,
            size_bytes,
            modified_at,
        } => {
            let entry_id = stable_uuid("folder-entry", &format!("{}:{relative_path}", root.id));
            let work_id = stable_uuid("folder-work", &format!("{}:{relative_path}", root.id));
            let media_file_id =
                stable_uuid("folder-media", &format!("{}:{relative_path}", root.id));
            if let Some(existing) = state
                .folder_repo
                .find_media_entry(root.id, &relative_path)
                .await?
            {
                if let Some(media_file) = state.media_files.get(existing.media_file_id).await {
                    if cached_file_is_current(
                        &existing,
                        &media_file,
                        &physical_path,
                        size_bytes,
                        modified_at,
                    ) {
                        return Ok(media_entry_response(existing, &media_file));
                    }
                }
            }

            let (probe, scanned_at) = if claim_probe_slot(probe_budget) {
                let pinned = {
                    let canonical_root = canonical_root.to_path_buf();
                    let relative_path = relative_path.clone();
                    let mime_path = relative_path_to_pathbuf(&relative_path);
                    tokio::task::spawn_blocking(move || {
                        pin_relative_folder_file(
                            canonical_root,
                            relative_path,
                            mime_path,
                            expected_identity,
                        )
                    })
                    .await
                    .map_err(|error| {
                        ApiError::internal(format!("folder file open task failed: {error}"))
                    })?
                };
                let probe = match pinned {
                    Ok(pinned) => match pinned.subprocess_path() {
                        Ok(path) => {
                            let result = probe_file(&path).await;
                            drop(pinned);
                            result.unwrap_or_else(|error| {
                                tracing::debug!(
                                    path = %physical_path.display(),
                                    error = ?error,
                                    "file metadata probe failed; using filesystem fallbacks"
                                );
                                FileProbe::default()
                            })
                        }
                        Err(error) => {
                            tracing::debug!(
                                path = %physical_path.display(),
                                error = ?error,
                                "file metadata probe could not pin its source; using filesystem fallbacks"
                            );
                            FileProbe::default()
                        }
                    },
                    Err(error) => {
                        tracing::debug!(
                            path = %physical_path.display(),
                            error = ?error,
                            "folder file changed before metadata probing; using filesystem fallbacks"
                        );
                        FileProbe::default()
                    }
                };
                (probe, Utc::now())
            } else {
                // Keep the entry immediately playable, but make this fallback
                // stale so later browse requests progressively fill metadata.
                (FileProbe::default(), Utc::now() - FAILED_PROBE_CACHE_TTL)
            };
            let fallback_title = physical_path
                .file_stem()
                .and_then(|value| value.to_str())
                .filter(|value| !value.is_empty())
                .unwrap_or(&name)
                .to_string();
            let title = probe.title.clone().unwrap_or(fallback_title);
            let container = physical_path
                .extension()
                .and_then(|value| value.to_str())
                .map(str::to_ascii_lowercase)
                .unwrap_or_else(|| "unknown".to_string());
            let primary_codec = probe
                .video_codec
                .clone()
                .or_else(|| probe.audio_codec.clone())
                .unwrap_or_else(|| "unknown".to_string());
            let metadata = FolderFileMetadata {
                title: probe.title.clone(),
                artist: probe.artist.clone(),
                album: probe.album.clone(),
                year: probe.year,
                video_codec: probe.video_codec.clone(),
                audio_codec: probe.audio_codec.clone(),
                width: probe.width,
                height: probe.height,
                audio_channels: probe.audio_channels,
                embedded_artwork: probe.embedded_artwork,
            };
            let scanned = ScannedFolderFile {
                entry_id,
                work_id,
                media_file_id,
                root_folder_id: root.id,
                physical_path: physical_path.clone(),
                relative_path: relative_path.clone(),
                work_kind: root.work_kind,
                title: title.clone(),
                sort_title: title.to_lowercase(),
                container: container.clone(),
                codec: primary_codec.clone(),
                bitrate: probe.bitrate_bps,
                duration_ms: probe.duration_ms,
                size_bytes,
                modified_at,
                metadata: metadata.clone(),
                scanned_at,
            };
            let persisted = state.folder_repo.upsert_scanned_file(&scanned).await?;

            // Production's repository-backed lookup sees the row immediately.
            // Test/in-memory lookups override `register` so the same request can
            // proceed into playback without a second fixture-only database path.
            let media_file = MediaFile {
                id: media_file_id,
                work_id,
                leaf_ref: playarr_model::media::LeafRef::Work,
                path: physical_path,
                container: container.clone(),
                codec: primary_codec,
                bitrate: probe.bitrate_bps,
                duration_ms: probe.duration_ms,
                size_bytes,
                source_instance_id: root.source_instance_id,
                source_file_id: Some(format!("playarr_folder:{entry_id}")),
            };
            state.media_files.register(media_file.clone());

            Ok(media_entry_response(persisted, &media_file))
        }
    }
}

fn cached_file_is_current(
    entry: &FolderMediaEntry,
    media_file: &MediaFile,
    physical_path: &FsPath,
    size_bytes: u64,
    modified_at: Option<DateTime<Utc>>,
) -> bool {
    let same_modified_at = match (entry.modified_at, modified_at) {
        (Some(cached), Some(current)) => cached.timestamp_millis() == current.timestamp_millis(),
        (None, None) => true,
        _ => false,
    };
    let probe_cache_is_fresh = entry.metadata.video_codec.is_some()
        || entry.metadata.audio_codec.is_some()
        || entry.scanned_at > Utc::now() - FAILED_PROBE_CACHE_TTL;
    probe_cache_is_fresh
        && same_modified_at
        && media_file.size_bytes == size_bytes
        && media_file.path.as_path() == physical_path
}

fn media_entry_response(entry: FolderMediaEntry, media_file: &MediaFile) -> FolderEntryResponse {
    let has_file_thumbnail =
        entry.metadata.video_codec.is_some() || entry.metadata.embedded_artwork;
    FolderEntryResponse {
        entry_type: FolderEntryType::Media,
        name: entry.file_name,
        path: entry.relative_path,
        media_file_id: Some(entry.media_file_id),
        media_kind: Some(entry.work_kind),
        title: Some(entry.title),
        artist: entry.metadata.artist,
        album: entry.metadata.album,
        container: Some(media_file.container.clone()),
        video_codec: entry.metadata.video_codec,
        audio_codec: entry.metadata.audio_codec,
        duration_ms: media_file.duration_ms,
        bitrate_bps: media_file.bitrate,
        size_bytes: Some(media_file.size_bytes),
        width: entry.metadata.width,
        height: entry.metadata.height,
        modified_at: entry.modified_at,
        thumbnail_url: has_file_thumbnail
            .then(|| format!("/api/v1/media/{}/thumbnail", entry.media_file_id)),
    }
}

fn claim_probe_slot(remaining: &AtomicUsize) -> bool {
    remaining
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
            current.checked_sub(1)
        })
        .is_ok()
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct FileProbe {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    year: Option<i32>,
    video_codec: Option<String>,
    audio_codec: Option<String>,
    duration_ms: Option<u64>,
    bitrate_bps: Option<u64>,
    width: Option<u32>,
    height: Option<u32>,
    audio_channels: Option<u32>,
    embedded_artwork: bool,
}

async fn probe_file(path: &FsPath) -> Result<FileProbe, ApiError> {
    let _permit = FOLDER_PROBE_PERMITS
        .acquire()
        .await
        .map_err(|_| ApiError::internal("folder metadata probe limiter closed"))?;
    let binary = std::env::var("PLAYARR_FFPROBE_BINARY").unwrap_or_else(|_| "ffprobe".to_string());
    let output = tokio::time::timeout(
        PROBE_TIMEOUT,
        Command::new(binary)
            .kill_on_drop(true)
            .args([
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
            ])
            .arg(path)
            .stdin(Stdio::null())
            .stderr(Stdio::piped())
            .stdout(Stdio::piped())
            .output(),
    )
    .await
    .map_err(|_| ApiError::internal("ffprobe metadata scan timed out"))?
    .map_err(|error| ApiError::internal(format!("could not start ffprobe: {error}")))?;
    if !output.status.success() {
        return Err(ApiError::internal(format!(
            "ffprobe metadata scan failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    parse_probe_output(&output.stdout)
}

fn parse_probe_output(output: &[u8]) -> Result<FileProbe, ApiError> {
    let value: Value = serde_json::from_slice(output)
        .map_err(|error| ApiError::internal(format!("invalid ffprobe metadata: {error}")))?;
    let format = value.get("format").and_then(Value::as_object);
    let streams = value
        .get("streams")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let format_tags = format
        .and_then(|format| format.get("tags"))
        .and_then(Value::as_object);
    let title = tag(format_tags, &["title"]).or_else(|| stream_tag(streams, &["title"]));
    let artist = tag(format_tags, &["artist", "album_artist", "albumartist"])
        .or_else(|| stream_tag(streams, &["artist", "album_artist", "albumartist"]));
    let album = tag(format_tags, &["album"]).or_else(|| stream_tag(streams, &["album"]));
    let year = tag(format_tags, &["date", "year"])
        .or_else(|| stream_tag(streams, &["date", "year"]))
        .and_then(|value| value.chars().take(4).collect::<String>().parse().ok());

    let video = streams.iter().find(|stream| {
        stream.get("codec_type").and_then(Value::as_str) == Some("video")
            && stream
                .get("disposition")
                .and_then(|value| value.get("attached_pic"))
                .and_then(Value::as_i64)
                != Some(1)
    });
    let audio = streams
        .iter()
        .find(|stream| stream.get("codec_type").and_then(Value::as_str) == Some("audio"));
    let embedded_artwork = streams.iter().any(|stream| {
        stream
            .get("disposition")
            .and_then(|value| value.get("attached_pic"))
            .and_then(Value::as_i64)
            == Some(1)
    });
    let duration_ms = format
        .and_then(|format| format.get("duration"))
        .and_then(number_string)
        .or_else(|| {
            streams
                .iter()
                .find_map(|stream| stream.get("duration").and_then(number_string))
        })
        .and_then(seconds_to_millis);
    let bitrate_bps = format
        .and_then(|format| format.get("bit_rate"))
        .and_then(unsigned_number)
        .or_else(|| {
            video
                .and_then(|stream| stream.get("bit_rate"))
                .and_then(unsigned_number)
        })
        .or_else(|| {
            audio
                .and_then(|stream| stream.get("bit_rate"))
                .and_then(unsigned_number)
        });

    Ok(FileProbe {
        title,
        artist,
        album,
        year,
        video_codec: video
            .and_then(|stream| stream.get("codec_name"))
            .and_then(Value::as_str)
            .map(str::to_string),
        audio_codec: audio
            .and_then(|stream| stream.get("codec_name"))
            .and_then(Value::as_str)
            .map(str::to_string),
        duration_ms,
        bitrate_bps,
        width: video
            .and_then(|stream| stream.get("width"))
            .and_then(unsigned_number)
            .and_then(|value| u32::try_from(value).ok()),
        height: video
            .and_then(|stream| stream.get("height"))
            .and_then(unsigned_number)
            .and_then(|value| u32::try_from(value).ok()),
        audio_channels: audio
            .and_then(|stream| stream.get("channels"))
            .and_then(unsigned_number)
            .and_then(|value| u32::try_from(value).ok()),
        embedded_artwork,
    })
}

fn tag(tags: Option<&serde_json::Map<String, Value>>, keys: &[&str]) -> Option<String> {
    let tags = tags?;
    keys.iter().find_map(|wanted| {
        tags.iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(wanted))
            .and_then(|(_, value)| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn stream_tag(streams: &[Value], keys: &[&str]) -> Option<String> {
    streams
        .iter()
        .find_map(|stream| tag(stream.get("tags").and_then(Value::as_object), keys))
}

fn number_string(value: &Value) -> Option<f64> {
    value
        .as_str()
        .and_then(|value| value.parse().ok())
        .or_else(|| value.as_f64())
}

fn unsigned_number(value: &Value) -> Option<u64> {
    value
        .as_str()
        .and_then(|value| value.parse().ok())
        .or_else(|| value.as_u64())
}

fn seconds_to_millis(seconds: f64) -> Option<u64> {
    (seconds.is_finite() && seconds >= 0.0).then(|| (seconds * 1_000.0).round() as u64)
}

fn stable_uuid(domain: &str, value: &str) -> Uuid {
    let digest = Sha256::digest(format!("{domain}\0{value}"));
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    // RFC 9562 custom UUIDv8 plus the standard RFC variant.
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes)
}

fn root_display_name(path: &str, fallback: &str) -> String {
    path.replace('\\', "/")
        .trim_end_matches('/')
        .rsplit('/')
        .find(|part| !part.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn resolve_source_root_path(
    source: &SourceInstance,
    self_peer_id: Uuid,
    remote_path: &str,
) -> Option<PathBuf> {
    let mapped_root = source.folder_mappings.get(&self_peer_id);
    let (mapped_path, mapped) = map_source_path(
        remote_path,
        source.default_root_folder_id.as_deref(),
        mapped_root.map(String::as_str),
    );
    if mapped_root.is_some() && !mapped {
        None
    } else {
        Some(playarr_model::resolve_media_path(FsPath::new(&mapped_path)))
    }
}

fn resolve_local_root_path(
    root: &SourceRootFolder,
    source: &SourceInstance,
    self_peer_id: Uuid,
) -> Option<PathBuf> {
    root.local_path_override
        .clone()
        .or_else(|| resolve_source_root_path(source, self_peer_id, root.reported_path.as_str()))
}

async fn current_local_root_path(
    state: &AppState,
    root: &SourceRootFolder,
) -> Result<PathBuf, ApiError> {
    let source = state
        .source_instances
        .get(root.source_instance_id)
        .ok_or_else(unavailable_root)?;
    let self_peer_id = crate::admin_peer::ensure_node_identity(&state.node_identity_repo)
        .await?
        .peer_id;
    resolve_local_root_path(root, &source, self_peer_id).ok_or_else(unavailable_root)
}

fn normalise_relative_path(raw: &str) -> Result<String, ApiError> {
    if raw.is_empty() {
        return Ok(String::new());
    }
    if raw.contains('\\') || raw.contains('\0') {
        return Err(ApiError::bad_request(
            "folder path must use normal relative path components",
        ));
    }
    let path = FsPath::new(raw);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(ApiError::bad_request(
            "folder path must use normal relative path components",
        ));
    }
    Ok(normalised_path_string(path))
}

fn relative_path_to_pathbuf(relative: &str) -> PathBuf {
    relative
        .split('/')
        .filter(|part| !part.is_empty())
        .collect()
}

fn normalised_path_string(path: &FsPath) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn folder_path_is_blocked(
    relative_path: &str,
    absolute_path: &FsPath,
    blocked_folders: &[String],
) -> bool {
    blocked_folders.iter().any(|blocked| {
        let blocked = blocked.trim();
        if blocked.is_empty() {
            return false;
        }
        let normalised = blocked.replace('\\', "/");
        let blocked_path = FsPath::new(&normalised);
        if blocked_path.is_absolute() {
            let canonical_blocked =
                std::fs::canonicalize(blocked_path).unwrap_or_else(|_| blocked_path.to_path_buf());
            absolute_path == canonical_blocked || absolute_path.starts_with(&canonical_blocked)
        } else {
            let blocked_relative = normalised.trim_matches('/');
            relative_path == blocked_relative
                || relative_path.starts_with(&format!("{blocked_relative}/"))
        }
    })
}

fn is_supported_media_file(path: &FsPath, work_kind: WorkKind) -> bool {
    let Some(extension) = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
    else {
        return false;
    };
    let video = matches!(
        extension.as_str(),
        "mp4"
            | "m4v"
            | "mkv"
            | "webm"
            | "avi"
            | "mov"
            | "ts"
            | "m2ts"
            | "mpg"
            | "mpeg"
            | "wmv"
            | "ogv"
    );
    let audio = matches!(
        extension.as_str(),
        "mp3"
            | "flac"
            | "m4a"
            | "m4b"
            | "aac"
            | "ogg"
            | "oga"
            | "opus"
            | "wav"
            | "wma"
            | "alac"
            | "aiff"
            | "aif"
    );
    match work_kind {
        WorkKind::Movie | WorkKind::Series | WorkKind::Site => video,
        WorkKind::Artist | WorkKind::Author => audio,
    }
}

fn breadcrumbs(root_name: &str, relative_path: &str) -> Vec<FolderBreadcrumbResponse> {
    let mut result = vec![FolderBreadcrumbResponse {
        name: root_name.to_string(),
        path: String::new(),
    }];
    let mut path = String::new();
    for component in relative_path
        .split('/')
        .filter(|component| !component.is_empty())
    {
        if !path.is_empty() {
            path.push('/');
        }
        path.push_str(component);
        result.push(FolderBreadcrumbResponse {
            name: component.to_string(),
            path: path.clone(),
        });
    }
    result
}

fn unavailable_root() -> ApiError {
    ApiError::new(
        StatusCode::SERVICE_UNAVAILABLE,
        "folder_root_unavailable",
        "this root folder is not currently mounted on the Playarr server",
    )
}

fn unavailable_media() -> ApiError {
    ApiError::new(
        StatusCode::SERVICE_UNAVAILABLE,
        "folder_media_unavailable",
        "this folder media file is no longer safely reachable beneath its root",
    )
}

#[cfg(test)]
mod tests {
    use axum::body::to_bytes;
    use axum::http::Request;
    use playarr_model::{Sensitive, SourceInstance, SourceKind};
    use tower::ServiceExt;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::playback::MediaFileLookup;

    #[test]
    fn relative_paths_reject_absolute_parent_dot_and_backslash_components() {
        assert_eq!(normalise_relative_path("").unwrap(), "");
        assert_eq!(
            normalise_relative_path("Season 01/Extras").unwrap(),
            "Season 01/Extras"
        );
        for invalid in [
            "/etc",
            "../secret",
            "Season 01/../secret",
            "./Season 01",
            r"C:\Media",
            r"Season 01\Extras",
        ] {
            assert!(normalise_relative_path(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn blocked_folder_matching_is_component_aware_for_relative_and_absolute_paths() {
        assert!(folder_path_is_blocked(
            "Pre-release/Episode.mkv",
            FsPath::new("/media/TV/Pre-release/Episode.mkv"),
            &["Pre-release".to_string()]
        ));
        assert!(!folder_path_is_blocked(
            "Pre-release-old/Episode.mkv",
            FsPath::new("/media/TV/Pre-release-old/Episode.mkv"),
            &["Pre-release".to_string()]
        ));
        assert!(folder_path_is_blocked(
            "Pre-release/Episode.mkv",
            FsPath::new("/media/TV/Pre-release/Episode.mkv"),
            &["/media/TV/Pre-release".to_string()]
        ));
    }

    #[cfg(unix)]
    #[test]
    fn blocked_folder_matching_canonicalises_absolute_symlink_policies() {
        let root = tempfile::tempdir().unwrap();
        let blocked = root.path().join("blocked");
        let alias = root.path().join("blocked-alias");
        std::fs::create_dir(&blocked).unwrap();
        std::os::unix::fs::symlink(&blocked, &alias).unwrap();

        assert!(folder_path_is_blocked(
            "Episode.mkv",
            &blocked.join("Episode.mkv"),
            &[alias.to_string_lossy().into_owned()]
        ));
    }

    #[test]
    fn browse_probe_budget_is_atomic_and_bounded() {
        let remaining = AtomicUsize::new(2);
        assert!(claim_probe_slot(&remaining));
        assert!(claim_probe_slot(&remaining));
        assert!(!claim_probe_slot(&remaining));
        assert_eq!(remaining.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn probe_parser_uses_container_tags_and_ignores_attached_art_as_video() {
        let probe = parse_probe_output(
            br#"{
                "streams": [
                    {"codec_type":"video","codec_name":"mjpeg","width":600,"height":600,"disposition":{"attached_pic":1}},
                    {"codec_type":"audio","codec_name":"flac","channels":2}
                ],
                "format": {
                    "duration":"185.125",
                    "bit_rate":"945000",
                    "tags":{"TITLE":"Night Drive","ARTIST":"Example","ALBUM":"Roads","DATE":"2025-10-12"}
                }
            }"#,
        )
        .unwrap();

        assert_eq!(probe.title.as_deref(), Some("Night Drive"));
        assert_eq!(probe.artist.as_deref(), Some("Example"));
        assert_eq!(probe.album.as_deref(), Some("Roads"));
        assert_eq!(probe.year, Some(2025));
        assert_eq!(probe.video_codec, None);
        assert_eq!(probe.audio_codec.as_deref(), Some("flac"));
        assert_eq!(probe.duration_ms, Some(185_125));
        assert_eq!(probe.bitrate_bps, Some(945_000));
        assert!(probe.embedded_artwork);
    }

    #[test]
    fn breadcrumbs_keep_only_root_relative_paths() {
        assert_eq!(
            breadcrumbs("TV", "Show/Season 01")
                .into_iter()
                .map(|crumb| (crumb.name, crumb.path))
                .collect::<Vec<_>>(),
            vec![
                ("TV".to_string(), "".to_string()),
                ("Show".to_string(), "Show".to_string()),
                ("Season 01".to_string(), "Show/Season 01".to_string()),
            ]
        );
    }

    #[test]
    fn stable_ids_change_by_domain_but_repeat_for_the_same_file() {
        assert_eq!(
            stable_uuid("folder-media", "root:path"),
            stable_uuid("folder-media", "root:path")
        );
        assert_ne!(
            stable_uuid("folder-media", "root:path"),
            stable_uuid("folder-work", "root:path")
        );
    }

    #[test]
    fn media_extensions_are_scoped_to_the_root_library_kind() {
        assert!(is_supported_media_file(
            FsPath::new("film.mkv"),
            WorkKind::Movie
        ));
        assert!(!is_supported_media_file(
            FsPath::new("song.mp3"),
            WorkKind::Movie
        ));
        assert!(is_supported_media_file(
            FsPath::new("song.flac"),
            WorkKind::Artist
        ));
        assert!(!is_supported_media_file(
            FsPath::new("film.mp4"),
            WorkKind::Artist
        ));
    }

    #[test]
    fn configured_peer_mapping_never_falls_back_to_an_unmapped_secondary_root() {
        let peer_id = Uuid::new_v4();
        let source = SourceInstance {
            id: Uuid::new_v4(),
            kind: SourceKind::Radarr,
            name: "Movies".to_string(),
            base_url: "https://radarr.example.test".to_string(),
            api_key_encrypted: Sensitive::new("test-key".to_string()),
            priority: 0,
            default_root_folder_id: Some("/remote/movies".to_string()),
            folder_mappings: BTreeMap::from([(peer_id, "/local/movies".to_string())]),
            default_quality_profile_id: None,
            best_effort: false,
            group_library_id: None,
        };

        assert_eq!(
            resolve_source_root_path(&source, peer_id, "/remote/movies/4k"),
            Some(PathBuf::from("/local/movies/4k"))
        );
        assert_eq!(
            resolve_source_root_path(&source, peer_id, "/remote/anime"),
            None
        );

        let mut root = SourceRootFolder {
            id: Uuid::new_v4(),
            source_instance_id: source.id,
            source_root_id: "secondary".to_string(),
            reported_path: "/remote/anime".to_string(),
            local_path_override: Some(PathBuf::from("/local/anime")),
            display_name: "Anime".to_string(),
            work_kind: WorkKind::Movie,
            accessible: true,
            free_space_bytes: None,
            total_space_bytes: None,
            active: true,
            scan_status: FolderScanStatus::Pending,
            last_scanned_at: None,
            scan_error: None,
            updated_at: Utc::now(),
        };
        assert_eq!(
            resolve_local_root_path(&root, &source, peer_id),
            Some(PathBuf::from("/local/anime"))
        );
        root.local_path_override = None;
        assert_eq!(resolve_local_root_path(&root, &source, peer_id), None);
        root.reported_path = "/remote/movies/4k".to_string();
        assert_eq!(
            resolve_local_root_path(&root, &source, peer_id),
            Some(PathBuf::from("/local/movies/4k"))
        );
    }

    #[tokio::test]
    async fn discovers_path_free_roots_and_materialises_a_playable_file() {
        let source_server = MockServer::start().await;
        let media_root = tempfile::tempdir().unwrap();
        std::fs::create_dir(media_root.path().join("Extras")).unwrap();
        std::fs::write(
            media_root
                .path()
                .join("Extras")
                .join("Behind the Scenes.mkv"),
            b"media",
        )
        .unwrap();
        Mock::given(method("GET"))
            .and(path("/api/v3/rootfolder"))
            .and(header("X-Api-Key", "test-key"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!([{
                    "id": 7,
                    "path": media_root.path().to_string_lossy(),
                    "accessible": true,
                    "freeSpace": 1024,
                    "totalSpace": 2048
                }])),
            )
            .expect(1)
            .mount(&source_server)
            .await;

        let (router, state) = crate::test_support::test_state().await;
        let source = SourceInstance {
            id: Uuid::new_v4(),
            kind: SourceKind::Radarr,
            name: "Movies".to_string(),
            base_url: source_server.uri(),
            api_key_encrypted: Sensitive::new("test-key".to_string()),
            priority: 0,
            default_root_folder_id: Some(media_root.path().to_string_lossy().into_owned()),
            folder_mappings: BTreeMap::new(),
            default_quality_profile_id: None,
            best_effort: false,
            group_library_id: None,
        };
        state
            .app
            .source_instance_repo
            .upsert(&source)
            .await
            .unwrap();
        state.source_instances.upsert(source.clone());

        let user_id = Uuid::new_v4();
        crate::test_support::seed_streaming_user_with_library_allow(
            &state,
            user_id,
            vec![source.id],
        )
        .await;
        let token = crate::test_support::mint_access_token(&state, user_id);
        let roots_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/folders/roots?kind=movie")
                    .header("Authorization", crate::test_support::bearer_header(&token))
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(roots_response.status(), StatusCode::OK);
        let roots_body = to_bytes(roots_response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert!(
            !String::from_utf8_lossy(&roots_body)
                .contains(&media_root.path().to_string_lossy().into_owned()),
            "absolute root path leaked into the response"
        );
        let roots: FolderRootsResponse = serde_json::from_slice(&roots_body).unwrap();
        assert_eq!(roots.roots.len(), 1);
        assert!(roots.roots[0].available);
        let root_id = roots.roots[0].id;

        let cached_roots_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/folders/roots?kind=movie")
                    .header("Authorization", crate::test_support::bearer_header(&token))
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(cached_roots_response.status(), StatusCode::OK);
        source_server.verify().await;

        let browse_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/v1/folders/{root_id}?path=Extras&limit=50&offset=0"
                    ))
                    .header("Authorization", crate::test_support::bearer_header(&token))
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(browse_response.status(), StatusCode::OK);
        let browse: FolderBrowseResponse = serde_json::from_slice(
            &to_bytes(browse_response.into_body(), usize::MAX)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(browse.path, "Extras");
        assert_eq!(browse.entries.len(), 1);
        let file = &browse.entries[0];
        assert_eq!(file.entry_type, FolderEntryType::Media);
        assert_eq!(file.name, "Behind the Scenes.mkv");
        assert_eq!(file.title.as_deref(), Some("Behind the Scenes"));
        assert_eq!(file.container.as_deref(), Some("mkv"));
        assert_eq!(file.thumbnail_url, None);
        let media_file_id = file.media_file_id.unwrap();
        assert!(state.media_files.get(media_file_id).await.is_some());
        assert!(state
            .folder_repo
            .find_media_entry_by_media_file_id(media_file_id)
            .await
            .unwrap()
            .is_some());

        #[cfg(target_os = "linux")]
        {
            let range_response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(format!("/api/v1/media/{media_file_id}/stream"))
                        .header("Authorization", crate::test_support::bearer_header(&token))
                        .header("Range", "bytes=1-3")
                        .body(axum::body::Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(range_response.status(), StatusCode::PARTIAL_CONTENT);
            assert_eq!(
                range_response.headers().get("content-type").unwrap(),
                "video/x-matroska"
            );
            assert_eq!(
                range_response.headers().get("content-range").unwrap(),
                "bytes 1-3/5"
            );
            assert_eq!(
                to_bytes(range_response.into_body(), usize::MAX)
                    .await
                    .unwrap()
                    .as_ref(),
                b"edi"
            );

            let user = state.user_repo.find_by_id(user_id).await.unwrap().unwrap();
            let policy = state
                .policy_repo
                .find_by_id(user.policy_id)
                .await
                .unwrap()
                .unwrap();
            let pinned = open_pinned_folder_media(&state.app, media_file_id, &policy)
                .await
                .unwrap()
                .expect("folder media should return a pinned descriptor");
            let original = media_root
                .path()
                .join("Extras")
                .join("Behind the Scenes.mkv");
            let moved = media_root.path().join("pinned-original.mkv");
            std::fs::rename(&original, &moved).unwrap();
            std::fs::write(&original, b"replacement").unwrap();
            assert_eq!(
                std::fs::read(pinned.proc_path().unwrap()).unwrap(),
                b"media",
                "the descriptor must remain pinned to the authorised inode"
            );
            let child_output = std::process::Command::new("cat")
                .arg(pinned.subprocess_path().unwrap())
                .output()
                .unwrap();
            assert!(child_output.status.success());
            assert_eq!(
                child_output.stdout, b"media",
                "a subprocess must reopen the authorised inode through the server-owned fd"
            );
            drop(pinned);
            std::fs::remove_file(&original).unwrap();
            std::fs::rename(&moved, &original).unwrap();

            let in_root_target = media_root.path().join("in-root-target.mkv");
            std::fs::rename(&original, &in_root_target).unwrap();
            std::os::unix::fs::symlink(&in_root_target, &original).unwrap();
            open_pinned_folder_media(&state.app, media_file_id, &policy)
                .await
                .expect_err("even an in-root symlink must not produce a pinned descriptor");
            std::fs::remove_file(&original).unwrap();
            std::fs::rename(&in_root_target, &original).unwrap();
        }

        let traversal = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/folders/{root_id}?path=..%2Foutside"))
                    .header("Authorization", crate::test_support::bearer_header(&token))
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(traversal.status(), StatusCode::BAD_REQUEST);

        #[cfg(unix)]
        {
            let outside = tempfile::tempdir().unwrap();
            let outside_file = outside.path().join("outside.mkv");
            std::fs::write(&outside_file, b"outside").unwrap();
            let original = media_root
                .path()
                .join("Extras")
                .join("Behind the Scenes.mkv");
            std::fs::remove_file(&original).unwrap();
            std::os::unix::fs::symlink(&outside_file, &original).unwrap();
            let user = state.user_repo.find_by_id(user_id).await.unwrap().unwrap();
            let policy = state
                .policy_repo
                .find_by_id(user.policy_id)
                .await
                .unwrap()
                .unwrap();

            let error = ensure_folder_media_allowed(&state.app, media_file_id, &policy)
                .await
                .expect_err("a scanned path replaced by an escaping symlink must be rejected");
            assert_eq!(error.status, StatusCode::FORBIDDEN);

            #[cfg(target_os = "linux")]
            open_pinned_folder_media(&state.app, media_file_id, &policy)
                .await
                .expect_err("an escaping symlink must never produce a pinned descriptor");
        }
    }
}
