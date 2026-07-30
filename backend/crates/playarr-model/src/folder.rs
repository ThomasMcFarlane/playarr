//! First-class persistence models for browsing media by source folder.
//!
//! A folder-discovered file deliberately gets its own hidden [`crate::Work`]
//! and normal [`crate::MediaFile`] so the existing playback, download and
//! thumbnail paths can serve it without trusting metadata from an external
//! source application. Every path on [`SourceRootFolder`] remains internal
//! server state and this type intentionally does not implement `Serialize`.

use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{ExternalProvider, WorkKind};

/// Reserved [`ExternalProvider::Other`] label identifying hidden backing
/// works created for folder-discovered files.
pub const FOLDER_WORK_PROVIDER: &str = "playarr_folder";

/// Constructs the reserved provider identity without duplicating its string
/// representation throughout the database and scanner layers.
pub fn folder_work_provider() -> ExternalProvider {
    ExternalProvider::Other(FOLDER_WORK_PROVIDER.to_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum FolderScanStatus {
    Pending,
    Scanning,
    Ready,
    Failed,
}

/// One root folder reported by one source instance.
///
/// Its path fields are deliberately not serialisable: API layers must
/// project this type into a path-free response instead of accidentally
/// disclosing source or server filesystem paths.
#[derive(Debug, Clone, PartialEq)]
pub struct SourceRootFolder {
    /// Stable, deterministic identifier supplied by the discovery caller.
    pub id: Uuid,
    pub source_instance_id: Uuid,
    /// The source application's native root-folder identifier.
    pub source_root_id: String,
    /// Root path exactly as reported by the source application. It may name
    /// a path that only exists on another host. Never return this to a
    /// viewer client.
    pub reported_path: String,
    /// Explicit current-node override for this one opaque root id. This is
    /// local configuration and is never replicated through Source rows.
    pub local_path_override: Option<PathBuf>,
    pub display_name: String,
    pub work_kind: WorkKind,
    /// Whether the source application reports the root as accessible.
    pub accessible: bool,
    pub free_space_bytes: Option<u64>,
    pub total_space_bytes: Option<u64>,
    /// False when a later root refresh no longer includes this row. Keeping
    /// the row preserves its scan cache if the root is subsequently restored.
    pub active: bool,
    pub scan_status: FolderScanStatus,
    pub last_scanned_at: Option<DateTime<Utc>>,
    pub scan_error: Option<String>,
    pub updated_at: DateTime<Utc>,
}

/// Metadata obtained from the physical file itself, never from Sonarr,
/// Radarr, Lidarr, or another source application.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct FolderFileMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<i32>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub audio_channels: Option<u32>,
    /// True when the file probe found embedded artwork. Video thumbnails are
    /// still generated lazily through the existing media-file endpoint.
    pub embedded_artwork: bool,
}

/// Scanner input for one playable physical file.
///
/// All identifiers are caller-provided and deterministic. The repository
/// does not generate UUIDs, which makes rescans idempotent and keeps playback
/// URLs stable.
#[derive(Debug, Clone, PartialEq)]
pub struct ScannedFolderFile {
    pub entry_id: Uuid,
    pub work_id: Uuid,
    pub media_file_id: Uuid,
    pub root_folder_id: Uuid,
    /// Canonical local file path selected by the path-safe scanner. This is
    /// persisted only to the existing server-side `media_files` row.
    pub physical_path: PathBuf,
    /// Normalised root-relative path. The repository rejects absolute paths,
    /// `.` components and `..` traversal.
    pub relative_path: String,
    pub work_kind: WorkKind,
    /// Display title after applying file-derived metadata and filename
    /// fallbacks.
    pub title: String,
    pub sort_title: String,
    pub container: String,
    /// Primary codec used by the existing `MediaFile` playback contract.
    /// Richer audio/video codec fields live in `metadata`.
    pub codec: String,
    pub bitrate: Option<u64>,
    pub duration_ms: Option<u64>,
    pub size_bytes: u64,
    pub modified_at: Option<DateTime<Utc>>,
    pub metadata: FolderFileMetadata,
    pub scanned_at: DateTime<Utc>,
}

/// Safe, path-relative folder item returned by the persistence layer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct FolderMediaEntry {
    pub id: Uuid,
    pub root_folder_id: Uuid,
    pub media_file_id: Uuid,
    pub work_id: Uuid,
    pub relative_path: String,
    /// Empty for a file directly below the root.
    pub directory_path: String,
    pub file_name: String,
    pub work_kind: WorkKind,
    pub title: String,
    pub modified_at: Option<DateTime<Utc>>,
    pub metadata: FolderFileMetadata,
    pub scanned_at: DateTime<Utc>,
}
