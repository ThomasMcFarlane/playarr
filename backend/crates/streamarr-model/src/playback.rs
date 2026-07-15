//! Playback analytics: [`PlaybackSession`] (one row per play) and
//! [`PlaybackEvent`] (the timeline of things that happened during it).
//! These mirror the `playback_sessions`/`playback_events` tables defined in
//! `streamarr-db::analytics` — keep the two in sync when either changes.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::platform::ClientPlatform;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum PlayMethod {
    /// Source file served byte-for-byte with no remuxing or transcoding.
    DirectPlay,
    /// Source file remuxed into a different container but not re-encoded.
    DirectStream,
    /// A [`crate::Rendition`] (Tdarr-produced or on-demand) is being
    /// served instead of the source file.
    Transcode,
}

/// Why a session couldn't direct-play/direct-stream and had to fall back to
/// a transcode. Populated only when `play_method == Transcode`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum TranscodeReason {
    ContainerNotSupported,
    VideoCodecNotSupported,
    AudioCodecNotSupported,
    VideoBitrateExceedsLimit,
    ResolutionExceedsLimit,
    SubtitleBurnInRequired,
    /// Server-side policy override (e.g. bandwidth cap) rather than a
    /// client capability gap.
    ServerPolicy,
    Other(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum StopReason {
    Completed,
    UserStopped,
    Error,
    DeviceDisconnected,
    SessionRevoked,
    ConcurrentLimitExceeded,
    IdleTimeout,
    Other(String),
}

/// One playback attempt from start to finish. Written incrementally: a row
/// is inserted at playback start and updated (`ended_at`, `stop_reason`,
/// aggregate buffering counters) as the session progresses and closes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PlaybackSession {
    pub id: Uuid,
    pub user_id: Uuid,
    pub device_id: Uuid,
    pub media_file_id: Uuid,
    /// Set only when `play_method == Transcode` and an existing
    /// [`crate::Rendition`] served the session (as opposed to a
    /// short-lived on-demand transcode with no durable rendition record).
    pub rendition_id: Option<Uuid>,

    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,

    pub play_method: PlayMethod,
    pub transcode_reason: Option<TranscodeReason>,

    pub source_codec: String,
    pub source_container: String,
    pub source_bitrate: Option<u64>,

    /// The codec/container/bitrate actually delivered to the client;
    /// equal to the source fields for `DirectPlay`.
    pub target_codec: String,
    pub target_container: String,
    pub target_bitrate: Option<u64>,

    pub client_platform: ClientPlatform,
    pub client_version: String,
    pub ip_address: Option<String>,

    pub bytes_streamed: u64,
    pub buffering_events: u32,
    pub buffering_ms_total: u64,

    pub stop_reason: Option<StopReason>,
}

/// A single timestamped occurrence within a [`PlaybackSession`]. Kept as a
/// tagged enum rather than a generic `{kind: String, payload: Value}` bag
/// so the analytics rollup code (`streamarr-telemetry::analytics::rollup`)
/// can exhaustively match every event type the compiler knows about.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum PlaybackEventKind {
    Start,
    Pause {
        position_ms: u64,
    },
    Resume {
        position_ms: u64,
    },
    Seek {
        from_ms: u64,
        to_ms: u64,
    },
    BufferStart {
        position_ms: u64,
    },
    BufferEnd {
        duration_ms: u64,
    },
    BitrateChange {
        from_bps: Option<u64>,
        to_bps: u64,
    },
    Heartbeat {
        position_ms: u64,
    },
    Stop {
        reason: StopReason,
        position_ms: u64,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PlaybackEvent {
    pub id: Uuid,
    pub session_id: Uuid,
    pub occurred_at: DateTime<Utc>,
    #[serde(flatten)]
    pub kind: PlaybackEventKind,
}
