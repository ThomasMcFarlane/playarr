//! Models for browsing media by folder ("unsorted folders").
//!
//! A folder-discovered file gets its own hidden [`crate::Work`] and a normal
//! [`crate::MediaFile`], so the existing playback, download, thumbnail and
//! watch-progress paths serve it without any source-application metadata.
//! Every path on [`SourceRootFolder`] is server-only state: that type does not
//! implement `Serialize`, so an API layer must project it into a path-free
//! response.

use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{ExternalProvider, WorkKind};

/// Reserved [`ExternalProvider::Other`] label of the hidden backing works.
pub const FOLDER_WORK_PROVIDER: &str = "playarr_folder";

/// Prefix of `source_root_id` for roots an administrator added by hand
/// rather than a source application reporting them.
pub const MANUAL_ROOT_PREFIX: &str = "manual:";

/// Prefix of `media_files.source_file_id` for folder-discovered files.
pub const FOLDER_SOURCE_FILE_PREFIX: &str = "playarr_folder:";

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

/// One root folder of one source instance. Paths are never serialisable.
#[derive(Debug, Clone, PartialEq)]
pub struct SourceRootFolder {
    pub id: Uuid,
    pub source_instance_id: Uuid,
    pub source_root_id: String,
    /// The path as the source application (or the administrator) reported it.
    pub reported_path: String,
    /// Explicit path on this server, when it differs from `reported_path`.
    pub local_path_override: Option<PathBuf>,
    pub display_name: String,
    pub work_kind: WorkKind,
    pub accessible: bool,
    pub free_space_bytes: Option<u64>,
    pub total_space_bytes: Option<u64>,
    /// False once a source refresh no longer reports the root.
    pub active: bool,
    /// Administrator opt-in: only enabled roots are scanned and browsable.
    pub scan_enabled: bool,
    pub scan_status: FolderScanStatus,
    pub last_scanned_at: Option<DateTime<Utc>>,
    pub scan_error: Option<String>,
    pub updated_at: DateTime<Utc>,
}

impl SourceRootFolder {
    pub fn is_manual(&self) -> bool {
        self.source_root_id.starts_with(MANUAL_ROOT_PREFIX)
    }

    /// The directory to walk on this server.
    pub fn local_path(&self) -> PathBuf {
        self.local_path_override
            .clone()
            .unwrap_or_else(|| PathBuf::from(&self.reported_path))
    }
}

/// Metadata read from the file itself, never from a source application.
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
}

/// Scanner output for one playable file. Identifiers are deterministic so a
/// rescan is idempotent and playback URLs stay stable.
#[derive(Debug, Clone, PartialEq)]
pub struct ScannedFolderFile {
    pub entry_id: Uuid,
    pub work_id: Uuid,
    pub media_file_id: Uuid,
    pub root_folder_id: Uuid,
    pub source_instance_id: Uuid,
    /// Absolute local path, stored only in the server-side `media_files` row.
    pub physical_path: PathBuf,
    /// Normalised root-relative path with `/` separators.
    pub relative_path: String,
    pub work_kind: WorkKind,
    pub title: String,
    pub sort_title: String,
    pub container: String,
    pub codec: String,
    pub bitrate: Option<u64>,
    pub duration_ms: Option<u64>,
    pub size_bytes: u64,
    pub modified_at: Option<DateTime<Utc>>,
    pub metadata: FolderFileMetadata,
    pub scanned_at: DateTime<Utc>,
}

/// A stored folder item, with the file facts joined from `media_files`.
#[derive(Debug, Clone, PartialEq)]
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
    pub container: String,
    pub codec: String,
    pub bitrate: Option<u64>,
    pub duration_ms: Option<u64>,
    pub size_bytes: u64,
    /// The stored (server-side) file path; never serialise it.
    pub physical_path: PathBuf,
}
