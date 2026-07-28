//! String/JSON encodings shared by [`crate::repo`] and [`crate::analytics`]
//! for the domain identifiers/enums that `sqlx::Any` cannot encode/decode
//! natively.
//!
//! `DbPool` is `sqlx::AnyPool`, and the `Any` driver's own type system
//! (`sqlx_core::any::types`) only has `Encode`/`Decode` impls for
//! `bool`/`i16`/`i32`/`i64`/`f32`/`f64`/`String`/`&str`/`Vec<u8>`/`&[u8]` —
//! there is no `Uuid` or `chrono` support at the `Any` layer (those only
//! exist for the concrete `Postgres`/`Sqlite`/`MySql` types), and obviously
//! no support for this crate's own domain enums. Every repository/store maps
//! its domain type to one of those primitives here, in one place, so the
//! mapping can't drift between the `sqlite`/`postgres` query bodies that use
//! it.

use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
// `LeafRef` isn't re-exported at the `playarr_model` crate root (unlike
// `MediaFile`/`Rendition`/etc.) — imported via its module path rather than
// adding that export, since `playarr-model` is outside this crate's scope.
use playarr_model::media::LeafRef;
use playarr_model::{
    Availability, DownloadStatus, ExternalProvider, PlayMethod, PlaybackEventKind, ProducedBy,
    RenditionStatus, SourceKind, StopReason, TranscodeReason, WorkKind,
};
use uuid::Uuid;

use crate::error::DbError;

/// Builds a `DbError::Backend(sqlx::Error::Decode(..))` for a column value
/// that doesn't parse back into its domain type (corrupt/foreign data,
/// schema drift) — the sqlx `Decode` error variant is exactly this failure
/// mode, so we reuse it rather than adding a parallel `DbError` case.
pub(crate) fn decode_err(msg: impl Into<String>) -> DbError {
    DbError::Backend(sqlx::Error::Decode(msg.into().into()))
}

pub(crate) fn parse_uuid(raw: &str) -> Result<Uuid, DbError> {
    Uuid::parse_str(raw).map_err(|e| decode_err(format!("invalid uuid {raw:?}: {e}")))
}

/// Booleans are stored (and bound/read) as `INTEGER` `0`/`1`, never as a SQL
/// `BOOLEAN` column decoded through `sqlx::Any`'s `bool` support. This isn't
/// just a portability nicety: `sqlx-sqlite`'s bridge into `Any` has no
/// mapping at all for a `BOOLEAN`-affinity column (`sqlx_core::Error::
/// AnyDriverError("Any driver does not support the SQLite type
/// SqliteTypeInfo(Bool)")`) — it fails converting *every* row that touches
/// such a column, not just when a caller asks to decode that column as
/// `bool`. Postgres's own bridge does support native `boolean`, but keeping
/// one representation for both engines (rather than branching per backend)
/// keeps this file — and every row-mapping function that uses it — backend
/// agnostic.
pub(crate) fn bool_to_i64(value: bool) -> i64 {
    value as i64
}

pub(crate) fn bool_from_i64(value: i64) -> bool {
    value != 0
}

pub(crate) fn format_datetime(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub(crate) fn parse_datetime(raw: &str) -> Result<DateTime<Utc>, DbError> {
    DateTime::parse_from_rfc3339(raw)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|e| decode_err(format!("invalid timestamp {raw:?}: {e}")))
}

pub(crate) fn format_date(day: NaiveDate) -> String {
    day.format("%Y-%m-%d").to_string()
}

pub(crate) fn parse_date(raw: &str) -> Result<NaiveDate, DbError> {
    NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .map_err(|e| decode_err(format!("invalid date {raw:?}: {e}")))
}

pub(crate) fn work_kind_to_str(kind: WorkKind) -> &'static str {
    match kind {
        WorkKind::Movie => "movie",
        WorkKind::Series => "series",
        WorkKind::Site => "site",
        WorkKind::Artist => "artist",
        WorkKind::Author => "author",
    }
}

pub(crate) fn work_kind_from_str(raw: &str) -> Result<WorkKind, DbError> {
    match raw {
        "movie" => Ok(WorkKind::Movie),
        "series" => Ok(WorkKind::Series),
        "site" => Ok(WorkKind::Site),
        "artist" => Ok(WorkKind::Artist),
        "author" => Ok(WorkKind::Author),
        other => Err(decode_err(format!("unknown work kind {other:?}"))),
    }
}

/// `SourceKind`'s own serde-derived `snake_case` wire form, reused verbatim
/// for storage (same convention as `work_kind_to_str`/`work_kind_from_str`
/// above) rather than inventing a separate storage encoding.
pub(crate) fn source_kind_to_str(kind: SourceKind) -> &'static str {
    match kind {
        SourceKind::Sonarr => "sonarr",
        SourceKind::Radarr => "radarr",
        SourceKind::Lidarr => "lidarr",
        SourceKind::Bazarr => "bazarr",
        SourceKind::Prowlarr => "prowlarr",
        SourceKind::Readarr => "readarr",
        SourceKind::Whisparr => "whisparr",
    }
}

pub(crate) fn source_kind_from_str(raw: &str) -> Result<SourceKind, DbError> {
    match raw {
        "sonarr" => Ok(SourceKind::Sonarr),
        "radarr" => Ok(SourceKind::Radarr),
        "lidarr" => Ok(SourceKind::Lidarr),
        "bazarr" => Ok(SourceKind::Bazarr),
        "prowlarr" => Ok(SourceKind::Prowlarr),
        "readarr" => Ok(SourceKind::Readarr),
        "whisparr" => Ok(SourceKind::Whisparr),
        other => Err(decode_err(format!("unknown source kind {other:?}"))),
    }
}

pub(crate) fn availability_to_str(availability: Availability) -> &'static str {
    match availability {
        Availability::Unknown => "unknown",
        Availability::Pending => "pending",
        Availability::Processing => "processing",
        Availability::PartiallyAvailable => "partially_available",
        Availability::Available => "available",
        Availability::Deleted => "deleted",
    }
}

pub(crate) fn availability_from_str(raw: &str) -> Result<Availability, DbError> {
    match raw {
        "unknown" => Ok(Availability::Unknown),
        "pending" => Ok(Availability::Pending),
        "processing" => Ok(Availability::Processing),
        "partially_available" => Ok(Availability::PartiallyAvailable),
        "available" => Ok(Availability::Available),
        "deleted" => Ok(Availability::Deleted),
        other => Err(decode_err(format!("unknown availability {other:?}"))),
    }
}

/// `ExternalProvider` round-trips through a single TEXT column: the closed
/// variants use their own snake_case name, and `Other(label)` is prefixed
/// (`"other:<label>"`) rather than needing a second nullable column.
pub(crate) fn provider_to_str(provider: &ExternalProvider) -> String {
    match provider {
        ExternalProvider::Tmdb => "tmdb".to_string(),
        ExternalProvider::Tvdb => "tvdb".to_string(),
        ExternalProvider::Imdb => "imdb".to_string(),
        ExternalProvider::MusicBrainzArtist => "music_brainz_artist".to_string(),
        ExternalProvider::MusicBrainzReleaseGroup => "music_brainz_release_group".to_string(),
        ExternalProvider::Goodreads => "goodreads".to_string(),
        ExternalProvider::Isbn => "isbn".to_string(),
        ExternalProvider::Asin => "asin".to_string(),
        ExternalProvider::Tpdb => "tpdb".to_string(),
        ExternalProvider::Other(label) => format!("other:{label}"),
    }
}

pub(crate) fn provider_from_str(raw: &str) -> ExternalProvider {
    match raw {
        "tmdb" => ExternalProvider::Tmdb,
        "tvdb" => ExternalProvider::Tvdb,
        "imdb" => ExternalProvider::Imdb,
        "music_brainz_artist" => ExternalProvider::MusicBrainzArtist,
        "music_brainz_release_group" => ExternalProvider::MusicBrainzReleaseGroup,
        "goodreads" => ExternalProvider::Goodreads,
        "isbn" => ExternalProvider::Isbn,
        "asin" => ExternalProvider::Asin,
        "tpdb" => ExternalProvider::Tpdb,
        other => ExternalProvider::Other(other.strip_prefix("other:").unwrap_or(other).to_string()),
    }
}

pub(crate) fn rendition_status_to_str(status: RenditionStatus) -> &'static str {
    match status {
        RenditionStatus::Queued => "queued",
        RenditionStatus::Processing => "processing",
        RenditionStatus::Ready => "ready",
        RenditionStatus::Failed => "failed",
        RenditionStatus::Expired => "expired",
    }
}

pub(crate) fn rendition_status_from_str(raw: &str) -> Result<RenditionStatus, DbError> {
    match raw {
        "queued" => Ok(RenditionStatus::Queued),
        "processing" => Ok(RenditionStatus::Processing),
        "ready" => Ok(RenditionStatus::Ready),
        "failed" => Ok(RenditionStatus::Failed),
        "expired" => Ok(RenditionStatus::Expired),
        other => Err(decode_err(format!("unknown rendition status {other:?}"))),
    }
}

pub(crate) fn download_status_to_str(status: DownloadStatus) -> &'static str {
    match status {
        DownloadStatus::Queued => "queued",
        DownloadStatus::Processing => "processing",
        DownloadStatus::Ready => "ready",
        DownloadStatus::Failed => "failed",
        DownloadStatus::Expired => "expired",
        DownloadStatus::Canceled => "canceled",
    }
}

pub(crate) fn download_status_from_str(raw: &str) -> Result<DownloadStatus, DbError> {
    match raw {
        "queued" => Ok(DownloadStatus::Queued),
        "processing" => Ok(DownloadStatus::Processing),
        "ready" => Ok(DownloadStatus::Ready),
        "failed" => Ok(DownloadStatus::Failed),
        "expired" => Ok(DownloadStatus::Expired),
        "canceled" => Ok(DownloadStatus::Canceled),
        other => Err(decode_err(format!("unknown download status {other:?}"))),
    }
}

pub(crate) fn produced_by_to_str(produced_by: ProducedBy) -> &'static str {
    match produced_by {
        ProducedBy::Tdarr => "tdarr",
        ProducedBy::OnDemand => "on_demand",
    }
}

pub(crate) fn produced_by_from_str(raw: &str) -> Result<ProducedBy, DbError> {
    match raw {
        "tdarr" => Ok(ProducedBy::Tdarr),
        "on_demand" => Ok(ProducedBy::OnDemand),
        other => Err(decode_err(format!("unknown produced_by {other:?}"))),
    }
}

pub(crate) fn play_method_to_str(method: PlayMethod) -> &'static str {
    match method {
        PlayMethod::DirectPlay => "direct_play",
        PlayMethod::DirectStream => "direct_stream",
        PlayMethod::Transcode => "transcode",
    }
}

pub(crate) fn play_method_from_str(raw: &str) -> Result<PlayMethod, DbError> {
    match raw {
        "direct_play" => Ok(PlayMethod::DirectPlay),
        "direct_stream" => Ok(PlayMethod::DirectStream),
        "transcode" => Ok(PlayMethod::Transcode),
        other => Err(decode_err(format!("unknown play method {other:?}"))),
    }
}

pub(crate) fn transcode_reason_to_str(reason: &TranscodeReason) -> String {
    match reason {
        TranscodeReason::ContainerNotSupported => "container_not_supported".to_string(),
        TranscodeReason::VideoCodecNotSupported => "video_codec_not_supported".to_string(),
        TranscodeReason::AudioCodecNotSupported => "audio_codec_not_supported".to_string(),
        TranscodeReason::VideoBitrateExceedsLimit => "video_bitrate_exceeds_limit".to_string(),
        TranscodeReason::ResolutionExceedsLimit => "resolution_exceeds_limit".to_string(),
        TranscodeReason::SubtitleBurnInRequired => "subtitle_burn_in_required".to_string(),
        TranscodeReason::ServerPolicy => "server_policy".to_string(),
        TranscodeReason::Other(label) => format!("other:{label}"),
    }
}

/// Decode counterpart to [`transcode_reason_to_str`] — needed now that
/// `AnalyticsStore::list_sessions` reads full `PlaybackSession` rows back
/// out (the admin session-history endpoint). `Other(label)` round-trips via
/// the same `"other:<label>"` prefix convention `provider_from_str` uses.
pub(crate) fn transcode_reason_from_str(raw: &str) -> TranscodeReason {
    match raw {
        "container_not_supported" => TranscodeReason::ContainerNotSupported,
        "video_codec_not_supported" => TranscodeReason::VideoCodecNotSupported,
        "audio_codec_not_supported" => TranscodeReason::AudioCodecNotSupported,
        "video_bitrate_exceeds_limit" => TranscodeReason::VideoBitrateExceedsLimit,
        "resolution_exceeds_limit" => TranscodeReason::ResolutionExceedsLimit,
        "subtitle_burn_in_required" => TranscodeReason::SubtitleBurnInRequired,
        "server_policy" => TranscodeReason::ServerPolicy,
        other => TranscodeReason::Other(other.strip_prefix("other:").unwrap_or(other).to_string()),
    }
}

pub(crate) fn stop_reason_to_str(reason: &StopReason) -> String {
    match reason {
        StopReason::Completed => "completed".to_string(),
        StopReason::UserStopped => "user_stopped".to_string(),
        StopReason::Error => "error".to_string(),
        StopReason::DeviceDisconnected => "device_disconnected".to_string(),
        StopReason::SessionRevoked => "session_revoked".to_string(),
        StopReason::ConcurrentLimitExceeded => "concurrent_limit_exceeded".to_string(),
        StopReason::IdleTimeout => "idle_timeout".to_string(),
        StopReason::Other(label) => format!("other:{label}"),
    }
}

/// Decode counterpart to [`stop_reason_to_str`] — same rationale/round-trip
/// convention as [`transcode_reason_from_str`] above.
pub(crate) fn stop_reason_from_str(raw: &str) -> StopReason {
    match raw {
        "completed" => StopReason::Completed,
        "user_stopped" => StopReason::UserStopped,
        "error" => StopReason::Error,
        "device_disconnected" => StopReason::DeviceDisconnected,
        "session_revoked" => StopReason::SessionRevoked,
        "concurrent_limit_exceeded" => StopReason::ConcurrentLimitExceeded,
        "idle_timeout" => StopReason::IdleTimeout,
        other => StopReason::Other(other.strip_prefix("other:").unwrap_or(other).to_string()),
    }
}

/// `LeafRef` round-trips through a single TEXT column, the same way
/// `ExternalProvider` does (see `provider_to_str`/`provider_from_str`
/// above): the data-less `Work` variant is its own bare discriminant
/// string, and each data-carrying variant is `"<discriminant>:<uuid>"`
/// (e.g. `"episode:3fa85f64-..."`) rather than needing a second nullable id
/// column.
pub(crate) fn leaf_ref_to_str(leaf_ref: &LeafRef) -> String {
    match leaf_ref {
        LeafRef::Work => "work".to_string(),
        LeafRef::Episode(id) => format!("episode:{id}"),
        LeafRef::Track(id) => format!("track:{id}"),
        LeafRef::Book(id) => format!("book:{id}"),
    }
}

pub(crate) fn leaf_ref_from_str(raw: &str) -> Result<LeafRef, DbError> {
    if raw == "work" {
        return Ok(LeafRef::Work);
    }
    if let Some(id) = raw.strip_prefix("episode:") {
        return Ok(LeafRef::Episode(parse_uuid(id)?));
    }
    if let Some(id) = raw.strip_prefix("track:") {
        return Ok(LeafRef::Track(parse_uuid(id)?));
    }
    if let Some(id) = raw.strip_prefix("book:") {
        return Ok(LeafRef::Book(parse_uuid(id)?));
    }
    Err(decode_err(format!("unknown leaf ref {raw:?}")))
}

/// The `#[serde(tag = "kind")]` discriminant `PlaybackEventKind` already
/// uses for its own snake_case JSON tag — reused verbatim for the
/// `playback_events.kind` column so the column stays a human-readable,
/// independently-queryable mirror of the JSON `payload` column.
pub(crate) fn playback_event_kind_discriminant(kind: &PlaybackEventKind) -> &'static str {
    match kind {
        PlaybackEventKind::Start => "start",
        PlaybackEventKind::Pause { .. } => "pause",
        PlaybackEventKind::Resume { .. } => "resume",
        PlaybackEventKind::Seek { .. } => "seek",
        PlaybackEventKind::BufferStart { .. } => "buffer_start",
        PlaybackEventKind::BufferEnd { .. } => "buffer_end",
        PlaybackEventKind::BitrateChange { .. } => "bitrate_change",
        PlaybackEventKind::Heartbeat { .. } => "heartbeat",
        PlaybackEventKind::Stop { .. } => "stop",
        PlaybackEventKind::Error { .. } => "error",
    }
}
