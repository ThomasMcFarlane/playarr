//! On-disk files: [`MediaFile`] (what an *arr app imported) and
//! [`Rendition`] (a derived, playback-ready encode of one).

use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Identifies exactly which leaf of a [`crate::Work`] a [`MediaFile`] is
/// the source for. A movie's file points straight at the work; a TV/music/
/// book file points at the specific episode/track/book child.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "leaf_kind", content = "leaf_id")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum LeafRef {
    /// The file *is* the work (movies).
    Work,
    Episode(Uuid),
    Track(Uuid),
    Book(Uuid),
}

/// A file on disk as imported by a source *arr instance. This is the
/// "source of truth" media — encodes derived from it for playback are
/// [`Rendition`]s, never mutations of the `MediaFile` itself.
// Not `ToSchema`-derived: `path` is a `PathBuf` (utoipa has no built-in
// mapping for it) and this is an internal/storage-facing type anyway — API
// responses should project it into a DTO with string paths.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MediaFile {
    pub id: Uuid,
    pub work_id: Uuid,
    pub leaf_ref: LeafRef,
    pub path: PathBuf,
    pub container: String,
    pub codec: String,
    /// Bits per second; `None` when the source instance didn't report it.
    pub bitrate: Option<u64>,
    pub size_bytes: u64,
    /// The *arr instance this file was imported by/discovered through.
    pub source_instance_id: Uuid,
    /// The file/episode-file/track-file id in the source instance's own
    /// API, kept so we can correlate webhook payloads and re-fetches back
    /// to this row without re-deriving it from the path.
    pub source_file_id: Option<String>,
}

/// Who produced a [`Rendition`]: the background Tdarr pipeline (proactive,
/// runs ahead of playback) or an on-demand transcode spawned to serve a
/// specific playback session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum ProducedBy {
    Tdarr,
    OnDemand,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum RenditionStatus {
    Queued,
    Processing,
    Ready,
    Failed,
    /// Ready once but past its retention window; the output file may have
    /// been swept and needs regenerating before it can serve playback.
    Expired,
}

/// A playback-ready encode of a [`MediaFile`], produced either proactively
/// by Tdarr or on-demand in response to a client that can't direct-play the
/// source. Multiple renditions can exist per `media_file_id` (one per
/// distinct target profile).
// Not `ToSchema`-derived, same `PathBuf` reason as `MediaFile`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Rendition {
    pub id: Uuid,
    pub media_file_id: Uuid,
    /// Name of the transcode profile that produced this (e.g.
    /// `"h264-1080p-8mbps"`); resolved against the transcode profile table,
    /// not stored inline here.
    pub profile: String,
    pub container: String,
    pub codec: String,
    pub bitrate: Option<u64>,
    pub output_path: PathBuf,
    pub produced_by: ProducedBy,
    pub produced_at: DateTime<Utc>,
    pub status: RenditionStatus,
}
