//! [`DownloadTicket`]: a server-staged, quality-selectable, resumable
//! download of a [`crate::MediaFile`] the requesting user already has
//! playback access to. Distinct from [`crate::Rendition`] even though both
//! represent a transcoded/derived output: a `Rendition` exists to serve
//! *playback* (HLS segments, reused across every viewer who requests the
//! same profile) while a `DownloadTicket` is a *per-user* grant to fetch a
//! single file (Original quality, or a named transcode profile), tracked
//! through its own lifecycle so the caller can poll for readiness and the
//! server can expire/sweep stale output.

use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum DownloadStatus {
    Queued,
    Processing,
    Ready,
    Failed,
    /// Ready once but past its retention window; the output file (if any)
    /// may have been swept and needs a fresh ticket before it can serve a
    /// download again.
    Expired,
    Canceled,
}

/// A single requested download. `quality_id == "original"` tickets resolve
/// to [`DownloadStatus::Ready`] immediately (the source [`crate::MediaFile`]
/// is served byte-for-byte, no transcode needed); a named transcode profile
/// ticket starts `Queued` and transitions asynchronously.
// Not `ToSchema`-derived: `output_path` is a `PathBuf` (utoipa has no
// built-in mapping for it) and this is an internal/storage-facing type
// anyway — same reasoning as `MediaFile`/`Rendition`. API responses project
// it into a DTO with string paths instead (see `streamarr_api::downloads`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DownloadTicket {
    pub id: Uuid,
    pub user_id: Uuid,
    pub media_file_id: Uuid,
    /// Stable selector matching `PlaybackQualityOption::id` /
    /// `DownloadQualityOption::id` -- `"original"` or a real transcode
    /// profile name.
    pub quality_id: String,
    /// `None` for Original; otherwise the exact transcode profile name that
    /// produced (or will produce) this ticket's output.
    pub profile: Option<String>,
    pub container: String,
    pub status: DownloadStatus,
    /// Resolved filesystem path to the file this ticket serves once
    /// `status == Ready`. `None` for an Original-quality ticket, which
    /// serves the source `MediaFile`'s own path directly instead of a
    /// separately-produced file.
    pub output_path: Option<PathBuf>,
    pub size_bytes: Option<u64>,
    pub error_message: Option<String>,
    pub requested_at: DateTime<Utc>,
    pub ready_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
}
