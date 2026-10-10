//! `GET /api/v1/playback/{media_file_id}` -- the playback negotiation
//! endpoint: runs [`playarr_transcode::TranscodeOrchestrator`]'s
//! documented decision order (`can_direct_play` ->
//! `find_existing_rendition` -> `spawn_on_demand_transcode`) and returns
//! either a direct-play URL or an HLS manifest URL.
//!
//! Actually serving the bytes at either returned URL (raw file range
//! requests for direct-play, HLS segment/playlist serving for the
//! transcode paths) is a separate concern from this decision endpoint and
//! is not implemented here -- see the TODO on [`PlaybackInfoResponse`].
//!
//! Gated by [`crate::auth_extractor::StreamingUser`], same as
//! `catalog.rs` -- see that extractor's doc comment.
//!
//! Every handler that resolves a [`MediaFile`] additionally checks its
//! `source_instance_id` against [`StreamingUser::allowed_libraries`]
//! immediately after the lookup, returning a 403 for a file outside the
//! caller's allowed set -- this is the cheapest and most security-critical
//! per-user library access control enforcement point in the whole read
//! path (see `playarr_model::Policy::library_allow`'s doc comment):
//! `MediaFile` already carries `source_instance_id` directly, so no extra
//! N+1 lookup is needed the way the catalog's `Work`-level checks require.

use std::net::SocketAddr;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use axum::extract::{ConnectInfo, Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use chrono::Utc;
use dashmap::DashMap;
use playarr_model::{
    ClientPlatform, DeliveryMode, ExternalProvider, LeafSelector, MediaFile, PeerNode, PlayMethod,
    PlaybackEvent, PlaybackEventKind, PlaybackSession, TranscodeReason, WatchProgress,
};
use playarr_transcode::ClientCapabilities;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth_extractor::{
    ensure_library_allowed, forbidden, resolve_streaming_access, StreamingUser,
};
use crate::error::ApiError;
use crate::peer_extractor::PeerSignedRequest;
use crate::routing;
use crate::version_gate::{CLIENT_PLATFORM_HEADER, CLIENT_VERSION_HEADER};
use crate::AppState;

/// Resolves a [`MediaFile`] by id. [`RepoBackedMediaFileLookup`] below is
/// the real, `MediaFileRepo`-backed implementation `boot_api` wires into
/// production; [`InMemoryMediaFileLookup`] exists only for tests.
#[async_trait]
pub trait MediaFileLookup: Send + Sync {
    async fn get(&self, id: Uuid) -> Option<MediaFile>;
}

/// Real (not a mock), thread-safe, in-process [`MediaFileLookup`] -- starts
/// empty and is populated via [`InMemoryMediaFileLookup::insert`] until a
/// real `MediaFileRepo` lands.
#[derive(Default)]
pub struct InMemoryMediaFileLookup {
    files: DashMap<Uuid, MediaFile>,
}

impl InMemoryMediaFileLookup {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&self, file: MediaFile) {
        self.files.insert(file.id, file);
    }
}

#[async_trait]
impl MediaFileLookup for InMemoryMediaFileLookup {
    async fn get(&self, id: Uuid) -> Option<MediaFile> {
        self.files.get(&id).map(|entry| entry.clone())
    }
}

/// The real, production [`MediaFileLookup`]: delegates to `playarr-db`'s
/// [`playarr_db::MediaFileRepo`], which `arr-sync` now actually populates
/// (see `playarr_arr_sync::media_sync`). Replaces the once-necessary
/// [`InMemoryMediaFileLookup`] in `AppState` now that a real repo exists;
/// `InMemoryMediaFileLookup` is kept only for tests, which want to seed a
/// `MediaFile` without a real database.
///
/// A lookup miss and a real backend error both collapse to `None` here
/// because [`MediaFileLookup::get`] has no room for an error variant (the
/// handler already turns `None` into a 404, which is the right response for
/// both cases from a caller's perspective) — but a backend error is still
/// logged at `warn`, since silently treating "the database is unreachable"
/// the same as "no such media file" would otherwise be surprising to debug.
pub struct RepoBackedMediaFileLookup {
    repo: std::sync::Arc<dyn playarr_db::MediaFileRepo>,
}

impl RepoBackedMediaFileLookup {
    pub fn new(repo: std::sync::Arc<dyn playarr_db::MediaFileRepo>) -> Self {
        Self { repo }
    }
}

#[async_trait]
impl MediaFileLookup for RepoBackedMediaFileLookup {
    async fn get(&self, id: Uuid) -> Option<MediaFile> {
        match self.repo.get_playable(id).await {
            Ok(media_file) => Some(media_file),
            Err(playarr_db::DbError::NotFound) => None,
            Err(err) => {
                tracing::warn!(media_file_id = %id, error = %err, "media file lookup failed");
                None
            }
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, ToSchema, utoipa::IntoParams)]
pub struct PlaybackQuery {
    /// Comma-separated container names the client can play, e.g. `"mp4"`.
    #[serde(default)]
    pub containers: String,
    /// Comma-separated video codecs the client can play, e.g. `"h264"`.
    #[serde(default)]
    pub video_codecs: String,
    /// Comma-separated audio codecs the client can play; informational
    /// only today -- see `TranscodeOrchestrator::can_direct_play`'s docs.
    #[serde(default)]
    pub audio_codecs: String,
    pub max_bitrate_bps: Option<u64>,
    /// Target rendition profile name if a transcode is needed; defaults to
    /// `"h264-720p-4mbps"` (an unrecognized name still resolves to a sane
    /// default -- see `TranscodeTargetProfile::resolve`).
    pub profile: Option<String>,
    /// Skip direct play and produce the requested rendition profile. Used
    /// by an explicit player quality choice; omitted/false keeps Original
    /// as the default uncapped negotiation behaviour.
    #[serde(default)]
    pub force_transcode: bool,
    /// Absolute source timestamp at which a newly-created on-demand
    /// transcode should begin. Direct play and complete renditions ignore
    /// this and remain normally seekable by the player.
    #[serde(default)]
    pub start_position_ms: u64,
    /// Global ffprobe stream index of the source audio track to encode into
    /// an on-demand HLS session. Supplying this forces a fresh transcode so
    /// a track-specific stream never reuses a default-audio rendition.
    pub audio_stream_index: Option<u32>,
    /// Ignore this viewer's remembered per-media choices for this request.
    /// Used when the player explicitly switches back to Original/automatic.
    #[serde(default)]
    pub ignore_saved_preferences: bool,
}

fn split_csv(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

fn canonical_audio_language(raw: &str) -> String {
    let primary = raw
        .split(['-', '_'])
        .next()
        .unwrap_or(raw)
        .trim()
        .to_ascii_lowercase();
    match primary.as_str() {
        "eng" => "en".to_string(),
        "spa" => "es".to_string(),
        "fre" | "fra" => "fr".to_string(),
        "ger" | "deu" => "de".to_string(),
        "ita" => "it".to_string(),
        "por" => "pt".to_string(),
        "jpn" => "ja".to_string(),
        "kor" => "ko".to_string(),
        "chi" | "zho" => "zh".to_string(),
        "hin" => "hi".to_string(),
        "ara" => "ar".to_string(),
        "tha" => "th".to_string(),
        _ => primary,
    }
}

pub(crate) fn audio_language_matches(
    track_language: Option<&str>,
    preferred_language: &str,
) -> bool {
    track_language
        .map(canonical_audio_language)
        .is_some_and(|language| language == canonical_audio_language(preferred_language))
}

impl From<&PlaybackQuery> for ClientCapabilities {
    fn from(query: &PlaybackQuery) -> Self {
        ClientCapabilities {
            supported_containers: split_csv(&query.containers),
            supported_video_codecs: split_csv(&query.video_codecs),
            supported_audio_codecs: split_csv(&query.audio_codecs),
            max_bitrate_bps: query.max_bitrate_bps,
        }
    }
}

const DEFAULT_PROFILE: &str = "h264-720p-4mbps";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackMode {
    Direct,
    Hls,
}

/// One quality the server can genuinely deliver through its current
/// playback/transcode implementation.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PlaybackQualityOption {
    /// Stable selector. `"original"` means normal uncapped negotiation;
    /// profile qualities use their real rendition profile name.
    pub id: String,
    pub label: String,
    /// `None` for Original; otherwise the exact profile accepted by this
    /// endpoint's `profile` query parameter.
    pub profile: Option<String>,
    /// Target picture height for a rendition. Original is source-defined.
    pub height: Option<u16>,
    /// Target video bitrate for a rendition. Original is source-defined.
    pub video_bitrate_bps: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PlaybackAudioTrackOption {
    pub id: String,
    pub stream_index: u32,
    pub label: String,
    pub language: Option<String>,
    pub codec: Option<String>,
    pub channels: Option<u32>,
    /// Raw ffprobe `profile` (e.g. "DTS-HD MA"), when the stream reports one.
    #[serde(default)]
    pub profile: Option<String>,
    /// Profile-refined codec name for display, e.g. "DTS-HD MA" or
    /// "TrueHD Atmos".
    #[serde(default)]
    pub codec_label: Option<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PlaybackSubtitleTrackOption {
    pub id: String,
    pub stream_index: u32,
    pub label: String,
    pub language: Option<String>,
    pub codec: String,
    pub is_default: bool,
    pub forced: bool,
    /// Authenticated WebVTT sidecar aligned to this playback URL's timeline.
    pub url: String,
}

pub(crate) fn playback_subtitle_options(
    media_file_id: Uuid,
    source_offset_ms: u64,
    tracks: &[crate::media::SourceSubtitleTrack],
) -> Vec<PlaybackSubtitleTrackOption> {
    tracks
        .iter()
        .map(|track| PlaybackSubtitleTrackOption {
            id: format!("source-subtitle-{}", track.stream_index),
            stream_index: track.stream_index,
            label: track.label.clone(),
            language: track.language.clone(),
            codec: track.codec.clone(),
            is_default: track.is_default,
            forced: track.forced,
            url: format!(
                "/api/v1/media/{media_file_id}/subtitles/{}?source_offset_ms={source_offset_ms}",
                track.stream_index
            ),
        })
        .collect()
}

/// The source file's overall bitrate for the "Original" quality entry.
///
/// The stored value is rejected when it is zero (arr apps report `0` when
/// their media analysis is missing), and the average bitrate is then derived
/// from file size and duration. `None` when neither is usable, so clients show
/// no bitrate at all rather than `0 Mbps`.
pub(crate) fn source_bitrate_bps(media_file: &MediaFile, duration_ms: u64) -> Option<u64> {
    media_file
        .bitrate
        .filter(|bitrate| *bitrate > 0)
        .or_else(|| {
            let duration_ms = if duration_ms > 0 {
                duration_ms
            } else {
                media_file.duration_ms.unwrap_or(0)
            };
            (media_file.size_bytes > 0 && duration_ms > 0)
                .then(|| media_file.size_bytes.saturating_mul(8000) / duration_ms)
                .filter(|bitrate| *bitrate > 0)
        })
}

pub(crate) fn playback_quality_options(
    source_video_bitrate_bps: Option<u64>,
) -> Vec<PlaybackQualityOption> {
    std::iter::once(PlaybackQualityOption {
        id: "original".to_string(),
        label: "Original".to_string(),
        profile: None,
        height: None,
        video_bitrate_bps: source_video_bitrate_bps,
    })
    .chain(
        playarr_transcode::TranscodeTargetProfile::supported()
            .into_iter()
            .map(|profile| PlaybackQualityOption {
                id: profile.name.clone(),
                label: format!(
                    "{} {}",
                    match profile.height {
                        2160 => "UHD",
                        1080 => "FHD",
                        720 => "HD",
                        480 => "SD",
                        _ => "Video",
                    },
                    profile.quality_level.as_str()
                ),
                profile: Some(profile.name),
                height: Some(profile.height),
                video_bitrate_bps: profile
                    .video_bitrate_kbps
                    .map(|kilobits| u64::from(kilobits) * 1000),
            }),
    )
    .collect()
}

/// TODO(streaming): `url` today is a well-known, stable path convention
/// (`/api/v1/media/{media_file_id}/stream` for direct-play,
/// `/api/v1/media/renditions/{rendition_id}/playlist.m3u8` for a ready
/// rendition, `/api/v1/media/sessions/{session_id}/playlist.m3u8` for a
/// freshly spawned on-demand session) rather than a route this crate
/// actually serves yet -- implementing byte-range/HLS-segment serving at
/// those paths is out of this endpoint's scope (this endpoint only makes
/// the direct-play/existing-rendition/on-demand-transcode *decision*).
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PlaybackInfoResponse {
    pub mode: PlaybackMode,
    pub url: String,
    /// MIME type for the direct media file or adaptive manifest in `url`.
    pub mime_type: String,
    /// Fixed runtime read from the source media container with ffprobe.
    /// Zero means probing failed; clients may then fall back to their
    /// playback engine's duration without failing negotiation.
    pub duration_ms: u64,
    /// Absolute source timestamp represented by time zero in `url`.
    /// Non-zero only for a freshly-created on-demand HLS session started
    /// part-way through the source.
    pub source_offset_ms: u64,
    /// Source-container audio streams. For on-demand HLS, choosing one
    /// creates a replacement session that maps this exact stream.
    pub audio_tracks: Vec<PlaybackAudioTrackOption>,
    pub selected_audio_track_id: Option<String>,
    /// Supported embedded text subtitles, exposed as authenticated WebVTT
    /// sidecars. Bitmap subtitle codecs are deliberately omitted.
    pub subtitle_tracks: Vec<PlaybackSubtitleTrackOption>,
    pub selected_subtitle_track_id: Option<String>,
    /// The server-owned quality ladder. Original is always first and is
    /// the default when the request does not explicitly force a profile.
    pub quality_options: Vec<PlaybackQualityOption>,
    /// The option represented by this URL.
    pub selected_quality_id: String,
    /// The freshly-created [`PlaybackSession`] id -- the client uses this
    /// for every subsequent `POST .../sessions/{session_id}/events` call
    /// (heartbeats, buffering, stop). Session creation piggybacks on this
    /// endpoint entirely: `device_id` comes from the caller's JWT and
    /// `client_platform`/`client_version` from headers the client already
    /// sends on every request, so no separate "start session" call is
    /// needed -- see [`record_playback_event_handler`]'s doc comment.
    pub session_id: Uuid,
}

fn direct_play_mime_type(container: &str) -> &'static str {
    match container.to_ascii_lowercase().as_str() {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/ogg; codecs=opus",
        "wav" => "audio/wav",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        _ => "video/mp4",
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateWatchProgressRequest {
    pub position_ms: u64,
    pub duration_ms: u64,
    #[serde(default)]
    pub completed: bool,
    /// When this progress update actually happened, RFC3339. Optional and
    /// additive -- lets an offline-buffered client (one that kept recording
    /// progress while disconnected and is only now replaying it) timestamp
    /// the update for when it occurred rather than when it's replayed after
    /// reconnecting. Omitted by every existing caller, who get the prior
    /// behaviour unchanged: the server falls back to `Utc::now()`.
    #[serde(default)]
    pub occurred_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[utoipa::path(
    get,
    path = "/api/v1/playback/progress",
    tag = "playback",
    responses(
        (status = 200, description = "Durable progress rows for the signed-in viewer, restricted to this account's allowed libraries", body = [WatchProgress], example = json!([
            {
                "media_file_id": "3f9c1e2d-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
                "work_id": "7a9d3e1f-8b4c-4d2a-9b3e-5f6a7b8c9d0e",
                "position_ms": 1_530_000,
                "duration_ms": 5_400_000,
                "state": "part_watched",
                "updated_at": "2026-07-18T21:04:12Z"
            }
        ])),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller does not have Playarr streaming access")
    )
)]
pub async fn list_watch_progress_handler(
    State(state): State<AppState>,
    streaming: StreamingUser,
) -> Result<Json<Vec<WatchProgress>>, ApiError> {
    let allowed = streaming.allowed_libraries();
    let mut all_progress = state
        .watch_progress
        .list_for_user(streaming.user_id)
        .await?;
    // Progress on a file the source dropped (hidden, not deleted) is not
    // listed: the client could not play it.
    let works: Vec<Uuid> = all_progress
        .iter()
        .map(|p| p.work_id)
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    let playable: std::collections::HashSet<Uuid> = state
        .media_file_repo
        .list_by_work_ids(&works)
        .await?
        .into_iter()
        .map(|f| f.id)
        .collect();
    all_progress.retain(|p| playable.contains(&p.media_file_id));

    // Unrestricted (`None`) is the common case and needs no per-row
    // `MediaFile` resolution at all. A restricted caller's "continue
    // watching"/history list must not surface rows for media outside their
    // current `Policy::library_allow` -- e.g. after an admin narrows a
    // grant, a stale progress row for now-inaccessible content shouldn't
    // keep confirming it exists. A row whose `MediaFile` no longer resolves
    // at all is dropped for a restricted caller too (fail closed -- there's
    // nothing left to check its library against), same as every other gate
    // in this module.
    // Household content rules (rating/tags) filter history too, so a
    // blocked title does not linger in "continue watching".
    if allowed.is_none() && !crate::household::has_content_rules(&streaming.policy) {
        return Ok(Json(all_progress));
    }
    let mut visible = Vec::with_capacity(all_progress.len());
    for progress in all_progress {
        if let Some(media_file) = state.media_files.get(progress.media_file_id).await {
            if crate::auth_extractor::ensure_media_access(&state, &streaming, &media_file)
                .await
                .is_ok()
            {
                visible.push(progress);
            }
        }
    }
    Ok(Json(visible))
}

#[utoipa::path(
    get,
    path = "/api/v1/playback/{media_file_id}/progress",
    tag = "playback",
    params(("media_file_id" = Uuid, Path, description = "MediaFile id")),
    responses(
        (status = 200, description = "Viewer progress, including a synthetic unseen state when no row exists", body = WatchProgress, example = json!({
            "media_file_id": "3f9c1e2d-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
            "work_id": "7a9d3e1f-8b4c-4d2a-9b3e-5f6a7b8c9d0e",
            "position_ms": 1_530_000,
            "duration_ms": 5_400_000,
            "state": "part_watched",
            "updated_at": "2026-07-18T21:04:12Z"
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller does not have Playarr streaming access"),
        (status = 404, description = "Unknown media_file_id")
    )
)]
pub async fn get_watch_progress_handler(
    State(state): State<AppState>,
    streaming: StreamingUser,
    Path(media_file_id): Path<Uuid>,
) -> Result<Json<WatchProgress>, ApiError> {
    let media_file = state
        .media_files
        .get(media_file_id)
        .await
        .ok_or_else(|| ApiError::not_found(format!("unknown media file {media_file_id}")))?;
    crate::auth_extractor::ensure_media_access(&state, &streaming, &media_file).await?;
    let progress = state
        .watch_progress
        .get(streaming.user_id, media_file_id)
        .await?
        .unwrap_or(WatchProgress {
            media_file_id,
            work_id: media_file.work_id,
            position_ms: 0,
            duration_ms: 0,
            state: playarr_model::WatchState::Unseen,
            updated_at: None,
        });
    Ok(Json(progress))
}

#[utoipa::path(
    put,
    path = "/api/v1/playback/{media_file_id}/progress",
    tag = "playback",
    params(("media_file_id" = Uuid, Path, description = "MediaFile id")),
    request_body(content = UpdateWatchProgressRequest, example = json!({
        "position_ms": 1_530_000,
        "duration_ms": 5_400_000,
        "completed": false
    })),
    responses(
        (status = 200, description = "Persisted viewer progress", body = WatchProgress, example = json!({
            "media_file_id": "3f9c1e2d-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
            "work_id": "7a9d3e1f-8b4c-4d2a-9b3e-5f6a7b8c9d0e",
            "position_ms": 1_530_000,
            "duration_ms": 5_400_000,
            "state": "part_watched",
            "updated_at": "2026-07-20T14:22:05Z"
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller does not have Playarr streaming access"),
        (status = 404, description = "Unknown media_file_id")
    )
)]
pub async fn update_watch_progress_handler(
    State(state): State<AppState>,
    streaming: StreamingUser,
    Path(media_file_id): Path<Uuid>,
    Json(body): Json<UpdateWatchProgressRequest>,
) -> Result<Json<WatchProgress>, ApiError> {
    let media_file = state
        .media_files
        .get(media_file_id)
        .await
        .ok_or_else(|| ApiError::not_found(format!("unknown media file {media_file_id}")))?;
    crate::auth_extractor::ensure_media_access(&state, &streaming, &media_file).await?;
    let position_ms = if body.duration_ms > 0 {
        body.position_ms.min(body.duration_ms)
    } else {
        body.position_ms
    };
    let progress = WatchProgress {
        media_file_id,
        work_id: media_file.work_id,
        position_ms,
        duration_ms: body.duration_ms,
        state: playarr_model::WatchProgress::state_for(
            position_ms,
            body.duration_ms,
            body.completed,
        ),
        updated_at: Some(body.occurred_at.unwrap_or_else(chrono::Utc::now)),
    };
    // The file can be removed between the lookup above and this write (a sync
    // replaced it); the foreign key then rejects the row. That is "unknown
    // file" to the client, not a server error.
    state
        .watch_progress
        .upsert(streaming.user_id, &progress)
        .await
        .map_err(|err| {
            if err.is_constraint_violation() {
                ApiError::not_found(format!("unknown media file {media_file_id}"))
            } else {
                err.into()
            }
        })?;
    Ok(Json(progress))
}

/// Whether an audio switch can keep the source video untouched. True only
/// when the quality is "original", the source video is H.264 or HEVC and the
/// client reports that codec and a bitrate cap the file fits under.
fn video_copy_for_audio_selection(
    media_file: &MediaFile,
    capabilities: &ClientCapabilities,
    requires_audio_selection: bool,
    force_transcode: bool,
) -> Option<playarr_transcode::VideoCopy> {
    if !requires_audio_selection || force_transcode {
        return None;
    }
    let video = playarr_transcode::VideoCopy::for_codec(&media_file.codec)?;
    let codec_ok = capabilities
        .supported_video_codecs
        .iter()
        .any(|c| playarr_transcode::codecs_match(c, &media_file.codec));
    let bitrate_ok = match (media_file.bitrate, capabilities.max_bitrate_bps) {
        (Some(file_bitrate), Some(max_bitrate)) => file_bitrate <= max_bitrate,
        _ => true,
    };
    (codec_ok && bitrate_ok).then_some(video)
}

/// Compares `media_file` against `capabilities` the same three ways
/// `TranscodeOrchestrator::can_direct_play` does (container/video-codec/
/// bitrate), but reports *which* check failed instead of collapsing to a
/// bare `bool` -- `can_direct_play` itself has no room in its signature for
/// this, and extending it would risk touching shared transcode logic
/// another in-flight effort might also be near, so this stays local to
/// `playarr-api` and is only ever called once `can_direct_play` has
/// already returned `false` for the same inputs.
fn derive_transcode_reason(
    media_file: &MediaFile,
    capabilities: &ClientCapabilities,
) -> TranscodeReason {
    let container_ok = capabilities
        .supported_containers
        .iter()
        .any(|c| c.eq_ignore_ascii_case(&media_file.container));
    let codec_ok = capabilities
        .supported_video_codecs
        .iter()
        .any(|c| playarr_transcode::codecs_match(c, &media_file.codec));
    let bitrate_ok = match (media_file.bitrate, capabilities.max_bitrate_bps) {
        (Some(file_bitrate), Some(max_bitrate)) => file_bitrate <= max_bitrate,
        _ => true,
    };

    match (container_ok, codec_ok, bitrate_ok) {
        (false, true, true) => TranscodeReason::ContainerNotSupported,
        (true, false, true) => TranscodeReason::VideoCodecNotSupported,
        (true, true, false) => TranscodeReason::VideoBitrateExceedsLimit,
        _ => TranscodeReason::Other("multiple_constraints".to_string()),
    }
}

/// Everything about a about-to-be-created [`PlaybackSession`] that's the
/// same across all three decision branches -- derived once up front so each
/// branch below only has to supply what's actually branch-specific
/// (`rendition_id`/`play_method`/`transcode_reason`/`target_*`).
struct SessionSeed {
    user_id: Uuid,
    device_id: Uuid,
    media_file_id: Uuid,
    client_platform: ClientPlatform,
    client_version: String,
    ip_address: Option<String>,
    source_codec: String,
    source_container: String,
    source_bitrate: Option<u64>,
}

impl SessionSeed {
    #[allow(clippy::too_many_arguments)]
    fn into_session(
        self,
        rendition_id: Option<Uuid>,
        play_method: PlayMethod,
        transcode_reason: Option<TranscodeReason>,
        target_codec: String,
        target_container: String,
        target_bitrate: Option<u64>,
    ) -> PlaybackSession {
        PlaybackSession {
            id: Uuid::new_v4(),
            user_id: self.user_id,
            device_id: self.device_id,
            media_file_id: self.media_file_id,
            rendition_id,
            started_at: Utc::now(),
            ended_at: None,
            play_method,
            transcode_reason,
            source_codec: self.source_codec,
            source_container: self.source_container,
            source_bitrate: self.source_bitrate,
            target_codec,
            target_container,
            target_bitrate,
            client_platform: self.client_platform,
            client_version: self.client_version,
            ip_address: self.ip_address,
            bytes_streamed: 0,
            buffering_events: 0,
            buffering_ms_total: 0,
            stop_reason: None,
        }
    }
}

/// A real playback start showing up twice within this window (same user,
/// device, and media file) is treated as the same watch, not two -- see
/// `start_analytics_session`'s doc comment for why this exists.
const DUPLICATE_SESSION_WINDOW: chrono::Duration = chrono::Duration::seconds(10);

/// Stops the on-demand transcodes of the viewer's still-open playback
/// sessions for the same title on the same device, which a new transcode is
/// about to replace (see `start_analytics_session`, which closes the
/// bookkeeping afterwards). Called before admission so the replaced
/// transcode's node-local slot is available to its own replacement.
async fn release_replaced_transcodes(state: &AppState, seed: &SessionSeed) {
    let replaced: Vec<Uuid> = state
        .session_registry
        .list_all()
        .into_iter()
        .filter(|existing| {
            existing.user_id == seed.user_id
                && existing.device_id == seed.device_id
                && existing.media_file_id == seed.media_file_id
                && existing.ended_at.is_none()
        })
        .map(|existing| existing.id)
        .collect();
    for old_id in replaced {
        if let Err(err) = state.transcode.expire_playback_session(old_id).await {
            tracing::warn!(
                session_id = %old_id,
                error = %err,
                "failed to stop the transcode being replaced"
            );
        }
    }
}

/// Writes `session`'s start through `AnalyticsCollector::on_session_start`,
/// returning the session's id -- unless an open session for the exact same
/// `(user_id, device_id, media_file_id)` was already recorded within
/// [`DUPLICATE_SESSION_WINDOW`], in which case that existing session's id is
/// reused and no new row is written.
///
/// This endpoint is a pure GET with no client-side idempotency key, and a
/// real client can and does call it more than once for what is, to the
/// viewer, a single playback start (confirmed live: React's
/// StrictMode-style double-invoke of the negotiation effect in
/// `usePlaybackEngine.ts`, 18ms apart) -- without this check, every real
/// playback was recorded as two identical `PlaybackSession` rows, visible
/// as duplicate pairs throughout the admin Activity page's live and
/// history views. `state.session_registry` (in-memory, no DB round trip)
/// is the cheap source of truth for "is one already open" -- checking the
/// durable store instead would add a query to the hot playback-start path
/// for a lookup the registry already answers for free.
///
/// Deliberately non-fatal to playback beyond the dedupe check: a write
/// failure is logged at `warn` and swallowed rather than propagated as an
/// `ApiError` -- this matches `playarr_db::analytics`'s own stated
/// tolerance for eventual consistency (see that module's doc comment). The
/// watch experience itself must never fail just because analytics couldn't
/// write.
async fn start_analytics_session(state: &AppState, session: PlaybackSession) -> Uuid {
    let now = Utc::now();
    if let Some(existing) = state
        .session_registry
        .list_all()
        .into_iter()
        .find(|existing| {
            existing.user_id == session.user_id
                && existing.device_id == session.device_id
                && existing.media_file_id == session.media_file_id
                && existing.ended_at.is_none()
                && now.signed_duration_since(existing.started_at) < DUPLICATE_SESSION_WINDOW
        })
    {
        return existing.id;
    }

    // The viewer replaced an earlier playback of the same title on the same
    // device (an audio, quality or dub switch after the dedupe window): the
    // old HLS session will never be requested again, so stop its ffmpeg now
    // instead of letting it encode until the node runs out of CPU.
    let superseded: Vec<Uuid> = state
        .session_registry
        .list_all()
        .into_iter()
        .filter(|existing| {
            existing.id != session.id
                && existing.user_id == session.user_id
                && existing.device_id == session.device_id
                && existing.media_file_id == session.media_file_id
                && existing.ended_at.is_none()
        })
        .map(|existing| existing.id)
        .collect();
    for old_id in superseded {
        if let Err(err) = state.transcode.expire_playback_session(old_id).await {
            tracing::warn!(
                session_id = %old_id,
                error = %err,
                "failed to stop the superseded transcode"
            );
        }
    }

    let session_id = session.id;
    if let Err(err) = state.analytics.on_session_start(session).await {
        tracing::warn!(
            session_id = %session_id,
            error = %err,
            "failed to record playback session start; continuing playback anyway"
        );
    }
    session_id
}

#[utoipa::path(
    get,
    path = "/api/v1/playback/{media_file_id}",
    tag = "playback",
    params(
        ("media_file_id" = Uuid, Path, description = "MediaFile id"),
        PlaybackQuery
    ),
    responses(
        (status = 200, description = "Direct-play URL or HLS manifest URL, plus the new PlaybackSession id", body = PlaybackInfoResponse, example = json!({
            "mode": "hls",
            "url": "/api/v1/media/sessions/6a5e2c3e-2b9a-4b3e-9b7a-8e2f1c3d4a5b/playlist.m3u8",
            "mime_type": "application/x-mpegURL",
            "duration_ms": 5_400_000,
            "source_offset_ms": 0,
            "audio_tracks": [
                {
                    "id": "source-audio-1",
                    "stream_index": 1,
                    "label": "English (AAC 5.1)",
                    "language": "eng",
                    "codec": "aac",
                    "channels": 6,
                    "is_default": true
                }
            ],
            "selected_audio_track_id": "source-audio-1",
            "subtitle_tracks": [
                {
                    "id": "source-subtitle-2",
                    "stream_index": 2,
                    "label": "English",
                    "language": "eng",
                    "codec": "subrip",
                    "is_default": false,
                    "forced": false,
                    "url": "/api/v1/media/3f9c1e2d-5a6b-4c7d-8e9f-0a1b2c3d4e5f/subtitles/2?source_offset_ms=0"
                }
            ],
            "selected_subtitle_track_id": null,
            "quality_options": [
                {
                    "id": "original",
                    "label": "Original",
                    "profile": null,
                    "height": null,
                    "video_bitrate_bps": 15_000_000
                },
                {
                    "id": "h264-720p-4mbps",
                    "label": "HD Medium",
                    "profile": "h264-720p-4mbps",
                    "height": 720,
                    "video_bitrate_bps": 4_000_000
                }
            ],
            "selected_quality_id": "h264-720p-4mbps",
            "session_id": "9c8b7a6f-5e4d-3c2b-1a0f-9e8d7c6b5a4f"
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller does not have Playarr streaming access"),
        (status = 404, description = "Unknown media_file_id"),
        (status = 503, description = "No on-demand transcode capacity available on this node")
    )
)]
pub async fn playback_info_handler(
    State(state): State<AppState>,
    streaming: StreamingUser,
    Path(media_file_id): Path<Uuid>,
    Query(query): Query<PlaybackQuery>,
    ConnectInfo(remote_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Json<PlaybackInfoResponse>, ApiError> {
    let media_file = state
        .media_files
        .get(media_file_id)
        .await
        .ok_or_else(|| ApiError::not_found(format!("unknown media file {media_file_id}")))?;
    crate::auth_extractor::ensure_media_access(&state, &streaming, &media_file).await?;

    // Clients already send these on every request -- see
    // `crate::version_gate`'s own doc comment -- so deriving session
    // metadata from them is zero extra client work. Computed here, ahead of
    // the routing step immediately below, since a delegated request needs
    // to forward the same values.
    let client_platform = headers
        .get(CLIENT_PLATFORM_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(ClientPlatform::from_wire_name)
        .unwrap_or(ClientPlatform::Web);
    let client_version = headers
        .get(CLIENT_VERSION_HEADER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("unknown")
        .to_string();

    // §5.2 (`docs/architecture/peer-groups.md`): immediately after the
    // library-access check above and before any of the direct-play/
    // rendition/on-demand-transcode negotiation below -- this ordering is
    // load-bearing, not stylistic (see this module's own doc comment on
    // `negotiate_playback`). Byte-for-byte today's existing behavior
    // (`LocalRouteOutcome::ServeLocally`, falling straight through to the
    // unchanged negotiation logic below) for a single, ungrouped node, or a
    // grouped node with no matching rule.
    match resolve_route_for_local_media_file(&state, &media_file, streaming.user_id).await? {
        LocalRouteOutcome::ServeLocally => {}
        LocalRouteOutcome::Delegate {
            peer_node_id,
            delivery,
            target,
        } => {
            return forward_negotiation_to_peer(
                &state,
                peer_node_id,
                delivery,
                target,
                streaming.user_id,
                streaming.claims.device_id,
                client_platform,
                client_version,
                &query,
            )
            .await;
        }
        LocalRouteOutcome::Unavailable => {
            return Err(ApiError::no_peer_available(format!(
                "media file {media_file_id} is not currently available on any peer"
            )));
        }
    }

    Ok(Json(
        negotiate_playback(
            &state,
            media_file,
            streaming.user_id,
            streaming.claims.device_id,
            client_platform,
            client_version,
            Some(remote_addr.ip().to_string()),
            &query,
            streaming.policy.can_transcode,
        )
        .await?,
    ))
}

/// §5.2's "the whole negotiation must move, not just the URL" logic:
/// `TranscodeOrchestrator`'s documented decision order (`can_direct_play` ->
/// `find_existing_rendition` -> `spawn_on_demand_transcode`) against
/// `media_file`, which must already be local to `state` -- this function
/// never resolves routing itself. [`playback_info_handler`] calls this for
/// a local (`RoutingDecision::ServeLocally`) request; [`peer_playback_info_handler`]
/// calls it after independently re-authorizing a peer-forwarded one (§5.3) --
/// same logic either way, just fed real `StreamingUser`/`ConnectInfo`/
/// `HeaderMap`-derived values on the local path and
/// [`PeerPlaybackInfoRequest`]-derived ones on the forwarded path.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn negotiate_playback(
    state: &AppState,
    media_file: MediaFile,
    user_id: Uuid,
    device_id: Uuid,
    client_platform: ClientPlatform,
    client_version: String,
    ip_address: Option<String>,
    query: &PlaybackQuery,
    can_transcode: bool,
) -> Result<PlaybackInfoResponse, ApiError> {
    let media_file_id = media_file.id;
    // Sonarr/Radarr may report a path from a remote host. Probe the same
    // locally-resolved source path that direct serving and transcoding use.
    let resolved_media_path = playarr_model::resolve_media_path(&media_file.path);
    let duration_ms = match media_file.duration_ms.filter(|duration| *duration > 0) {
        Some(duration_ms) => duration_ms,
        None => match crate::media::probe_media_duration_ms(&resolved_media_path).await {
            Ok(duration_ms) => {
                if let Err(error) = state
                    .catalog
                    .cache_media_file_duration(media_file.id, media_file.work_id, duration_ms)
                    .await
                {
                    tracing::warn!(
                        media_file_id = %media_file_id,
                        error = ?error,
                        "fixed source duration was probed but could not be persisted"
                    );
                }
                duration_ms
            }
            Err(error) => {
                tracing::warn!(
                    media_file_id = %media_file_id,
                    path = %resolved_media_path.display(),
                    error = ?error,
                    "could not probe fixed source duration; playback will continue without it"
                );
                0
            }
        },
    };
    let audio_tracks = match crate::media::probe_media_audio_tracks(&resolved_media_path).await {
        Ok(tracks) => tracks
            .into_iter()
            .map(|track| PlaybackAudioTrackOption {
                id: format!("source-audio-{}", track.stream_index),
                stream_index: track.stream_index,
                label: track.label,
                language: track.language,
                codec: track.codec,
                channels: track.channels,
                profile: track.profile,
                codec_label: track.codec_label,
                is_default: track.is_default,
            })
            .collect::<Vec<_>>(),
        Err(error) => {
            tracing::warn!(
                media_file_id = %media_file_id,
                path = %resolved_media_path.display(),
                error = ?error,
                "could not probe source audio tracks; playback will continue with the default stream"
            );
            Vec::new()
        }
    };
    // Dubarr dub tracks are offered as extra audio options after the source
    // streams. Best-effort: lookup failures never affect playback.
    let dub_tracks = crate::dubarr_audio::lookup(
        &state.source_instances,
        &media_file.path.to_string_lossy(),
        &resolved_media_path.to_string_lossy(),
    )
    .await;
    let mut audio_tracks = audio_tracks;
    audio_tracks.extend(dub_tracks.iter().map(|dub| PlaybackAudioTrackOption {
        id: dub.option_id(),
        stream_index: dub.stream_index,
        label: dub.track.title.clone(),
        language: Some(dub.track.language.clone()),
        codec: Some(dub.track.codec.clone()),
        channels: Some(dub.track.channels),
        profile: None,
        codec_label: None,
        is_default: false,
    }));
    let persisted_preferences = if query.ignore_saved_preferences {
        None
    } else {
        state
            .user_repo
            .get_media_playback_preferences(user_id, media_file_id)
            .await
            .map_err(|error| {
                ApiError::internal(format!(
                    "could not load media playback preferences: {error}"
                ))
            })?
    };
    let default_audio_stream_index = audio_tracks
        .iter()
        .find(|track| track.is_default)
        .or_else(|| audio_tracks.first())
        .map(|track| track.stream_index);
    let preferred_audio_language = if query.audio_stream_index.is_none() {
        state
            .user_repo
            .find_by_id(user_id)
            .await
            .ok()
            .flatten()
            .map(|user| user.preferred_audio_language)
    } else {
        None
    };
    let selected_audio_stream_index = match query.audio_stream_index {
        Some(stream_index) => {
            if !audio_tracks
                .iter()
                .any(|track| track.stream_index == stream_index)
            {
                return Err(ApiError::bad_request(format!(
                    "unknown source audio stream index {stream_index}"
                )));
            }
            Some(stream_index)
        }
        None => persisted_preferences
            .as_ref()
            .and_then(|preferences| preferences.audio_track_id.as_deref())
            .and_then(|track_id| {
                audio_tracks
                    .iter()
                    .find(|track| track.id == track_id)
                    .map(|track| track.stream_index)
            })
            .or_else(|| {
                preferred_audio_language.as_deref().and_then(|preferred| {
                    audio_tracks
                        .iter()
                        .find(|track| audio_language_matches(track.language.as_deref(), preferred))
                        .map(|track| track.stream_index)
                })
            })
            .or(default_audio_stream_index),
    };
    let requires_audio_selection = selected_audio_stream_index != default_audio_stream_index;
    let selected_dub = selected_audio_stream_index
        .and_then(|index| dub_tracks.iter().find(|dub| dub.stream_index == index));
    let selected_audio_track_id = match selected_dub {
        Some(dub) => Some(dub.option_id()),
        None => {
            selected_audio_stream_index.map(|stream_index| format!("source-audio-{stream_index}"))
        }
    };
    let source_subtitle_tracks = match crate::media::probe_all_subtitle_tracks(&resolved_media_path)
        .await
    {
        Ok(tracks) => tracks,
        Err(error) => {
            tracing::warn!(
                media_file_id = %media_file_id,
                path = %resolved_media_path.display(),
                error = ?error,
                "could not probe source subtitle tracks; playback will continue without sidecars"
            );
            Vec::new()
        }
    };
    let selected_subtitle_track_id = persisted_preferences
        .as_ref()
        .and_then(|preferences| preferences.subtitle_track_id.as_ref())
        .filter(|track_id| {
            source_subtitle_tracks
                .iter()
                .any(|track| format!("source-subtitle-{}", track.stream_index) == ***track_id)
        })
        .cloned();

    let capabilities: ClientCapabilities = query.into();
    let persisted_quality_id = persisted_preferences
        .as_ref()
        .map(|preferences| preferences.quality_id.as_str())
        .filter(|id| {
            playback_quality_options(media_file.bitrate)
                .iter()
                .any(|option| option.id == *id)
        });
    let force_transcode = query.force_transcode
        || (query.profile.is_none() && persisted_quality_id.is_some_and(|id| id != "original"));
    let profile = query
        .profile
        .clone()
        .or_else(|| {
            persisted_quality_id
                .filter(|id| *id != "original")
                .map(str::to_string)
        })
        .unwrap_or_else(|| DEFAULT_PROFILE.to_string());
    let selected_quality_id = if force_transcode {
        profile.clone()
    } else {
        "original".to_string()
    };

    let seed = SessionSeed {
        user_id,
        device_id,
        media_file_id,
        client_platform,
        client_version,
        ip_address,
        source_codec: media_file.codec.clone(),
        source_container: media_file.container.clone(),
        source_bitrate: media_file.bitrate,
    };

    // Step 1: can the source file be served byte-for-byte?
    if !force_transcode
        && !requires_audio_selection
        && state.transcode.can_direct_play(&media_file, &capabilities)
    {
        // This codebase never produces `DirectStream` -- `can_direct_play`
        // only distinguishes "serve the source file as-is" vs. "transcode",
        // so there's no remux path to represent here.
        let session = seed.into_session(
            None,
            PlayMethod::DirectPlay,
            None,
            media_file.codec.clone(),
            media_file.container.clone(),
            media_file.bitrate,
        );
        let session_id = start_analytics_session(state, session).await;
        state.transcode.expire_playback_session(session_id).await?;
        return Ok(PlaybackInfoResponse {
            mode: PlaybackMode::Direct,
            // Native progressive media loading (`<audio>/<video src>`) cannot
            // attach Shaka's bearer request filter. The active, random
            // playback-session id is therefore a capability scoped to this
            // exact media file. It stops authorising reads as soon as the
            // session leaves the in-memory active registry.
            url: format!("/api/v1/media/{media_file_id}/stream?playback_session_id={session_id}"),
            mime_type: direct_play_mime_type(&media_file.container).to_string(),
            duration_ms,
            source_offset_ms: 0,
            audio_tracks,
            selected_audio_track_id,
            subtitle_tracks: playback_subtitle_options(media_file_id, 0, &source_subtitle_tracks),
            selected_subtitle_track_id,
            quality_options: playback_quality_options(source_bitrate_bps(&media_file, duration_ms)),
            selected_quality_id,
            session_id,
        });
    }

    // Mirrors the inline `if !streaming.policy.can_transcode` check this
    // negotiation used to run directly against a live `StreamingUser` --
    // `can_transcode` is that exact same `Policy` field, just passed in by
    // the caller (either read straight off `StreamingUser` locally, or
    // independently re-resolved from this node's own synced `Policy` for a
    // peer-forwarded request -- see `peer_playback_info_handler`).
    if !can_transcode {
        return Err(crate::auth_extractor::forbidden(
            "this account does not have transcoding access",
        ));
    }

    let transcode_reason = if requires_audio_selection {
        TranscodeReason::Other("audio_selection".to_string())
    } else if force_transcode {
        TranscodeReason::Other("quality_selection".to_string())
    } else {
        derive_transcode_reason(&media_file, &capabilities)
    };

    // Step 2: is there already a ready rendition (Tdarr or a previous
    // on-demand session)?
    let existing_rendition = if !requires_audio_selection {
        state
            .transcode
            .find_existing_rendition(media_file_id, &profile)
            .await?
    } else {
        None
    };
    if let Some(rendition) = existing_rendition {
        let session = seed.into_session(
            Some(rendition.id),
            PlayMethod::Transcode,
            Some(transcode_reason),
            rendition.codec.clone(),
            rendition.container.clone(),
            rendition.bitrate,
        );
        let session_id = start_analytics_session(state, session).await;
        state.transcode.expire_playback_session(session_id).await?;
        return Ok(PlaybackInfoResponse {
            mode: PlaybackMode::Hls,
            url: format!("/api/v1/media/renditions/{}/playlist.m3u8", rendition.id),
            mime_type: "application/x-mpegURL".to_string(),
            duration_ms,
            source_offset_ms: 0,
            audio_tracks,
            selected_audio_track_id,
            subtitle_tracks: playback_subtitle_options(media_file_id, 0, &source_subtitle_tracks),
            selected_subtitle_track_id,
            quality_options: playback_quality_options(source_bitrate_bps(&media_file, duration_ms)),
            selected_quality_id,
            session_id,
        });
    }

    // Step 3, last resort: spawn a new on-demand transcode.
    //
    // The viewer is replacing their own playback (quality/audio switch, or a
    // retry after a failed attempt). Stop their earlier transcodes for this
    // title and device *before* admission, otherwise the old one keeps the
    // node-local slot and the replacement is refused with
    // `no_transcode_capacity` until the idle reaper catches up.
    release_replaced_transcodes(state, &seed).await;
    let source_offset_ms = if duration_ms > 0 {
        query.start_position_ms.min(duration_ms.saturating_sub(1))
    } else {
        query.start_position_ms
    };
    // An audio switch (a Dubarr dub or another source track) leaves the
    // picture untouched, so when the client can play the source video codec
    // within its bitrate cap and asked for the original quality, copy the
    // video into fragmented-MP4 HLS and only encode the audio. Re-encoding a
    // 4K HEVC remux in real time is not feasible on a node-limited CPU.
    let video_copy = video_copy_for_audio_selection(
        &media_file,
        &capabilities,
        requires_audio_selection,
        force_transcode,
    );
    let source_audio_transcode = || async {
        match video_copy {
            Some(video) => {
                state
                    .transcode
                    .spawn_video_copy_at_with_audio(
                        &media_file,
                        &profile,
                        &state.node_id,
                        source_offset_ms,
                        selected_audio_stream_index,
                        video,
                    )
                    .await
            }
            None => {
                state
                    .transcode
                    .spawn_on_demand_transcode_at_with_audio(
                        &media_file,
                        &profile,
                        &state.node_id,
                        source_offset_ms,
                        selected_audio_stream_index,
                    )
                    .await
            }
        }
    };
    let transcode_session = match selected_dub {
        Some(dub) => {
            // Playarr fetches the dub itself and hands ffmpeg a local file, so
            // the Dubarr API key never appears in ffmpeg's argument list.
            let client = dub.client();
            let track = dub.track.clone();
            let fetch = |path: std::path::PathBuf| async move {
                client
                    .download_to_file(&track, &path)
                    .await
                    .map(|_| ())
                    .map_err(|error| error.to_string())
            };
            let fetched = match video_copy {
                Some(video) => {
                    state
                        .transcode
                        .spawn_video_copy_with_fetched_audio(
                            &media_file,
                            &profile,
                            &state.node_id,
                            source_offset_ms,
                            video,
                            fetch,
                        )
                        .await
                }
                None => {
                    state
                        .transcode
                        .spawn_on_demand_transcode_with_fetched_audio(
                            &media_file,
                            &profile,
                            &state.node_id,
                            source_offset_ms,
                            fetch,
                        )
                        .await
                }
            };
            match fetched {
                Ok(session) => session,
                Err(playarr_transcode::TranscodeError::ExternalAudio(error)) => {
                    tracing::warn!(
                        media_file_id = %media_file_id,
                        %error,
                        "dub track download failed; playing the source audio instead"
                    );
                    source_audio_transcode().await?
                }
                Err(error) => return Err(error.into()),
            }
        }
        None => source_audio_transcode().await?,
    };
    if video_copy.is_some() {
        tracing::info!(
            media_file_id = %media_file_id,
            transcode_session_id = %transcode_session.id,
            source_codec = %media_file.codec,
            dub = selected_dub.is_some(),
            "audio selection served with video copy (no video transcode)"
        );
    }

    let target_profile = playarr_transcode::TranscodeTargetProfile::resolve(&profile);
    let session = if video_copy.is_some() {
        seed.into_session(
            None,
            PlayMethod::DirectStream,
            None,
            media_file.codec.clone(),
            "hls".to_string(),
            media_file.bitrate,
        )
    } else {
        seed.into_session(
            // No durable rendition record for a short-lived on-demand
            // transcode -- see `PlaybackSession::rendition_id`'s own doc
            // comment.
            None,
            PlayMethod::Transcode,
            Some(transcode_reason),
            target_profile.video_codec,
            // What `spawn_on_demand_transcode` actually produces -- HLS-
            // segmented output, per that module's own doc comment.
            "hls".to_string(),
            target_profile
                .video_bitrate_kbps
                .map(|kbps| kbps as u64 * 1000),
        )
    };
    let session_id = start_analytics_session(state, session).await;
    state
        .transcode
        .associate_playback_session(session_id, transcode_session.id)
        .await?;

    Ok(PlaybackInfoResponse {
        mode: PlaybackMode::Hls,
        url: format!(
            "/api/v1/media/sessions/{}/playlist.m3u8",
            transcode_session.id
        ),
        mime_type: "application/x-mpegURL".to_string(),
        duration_ms,
        source_offset_ms,
        audio_tracks,
        selected_audio_track_id,
        subtitle_tracks: playback_subtitle_options(
            media_file_id,
            source_offset_ms,
            &source_subtitle_tracks,
        ),
        selected_subtitle_track_id,
        quality_options: playback_quality_options(source_bitrate_bps(&media_file, duration_ms)),
        selected_quality_id,
        session_id,
    })
}

// ---------------------------------------------------------------------
// §5.2/§5.3 (`docs/architecture/peer-groups.md`): routing-context
// gathering, node-to-node negotiation forwarding, and the `by-external-ref`
// entry point.
// ---------------------------------------------------------------------

/// [`resolve_route_for_local_media_file`]'s result -- deliberately its own
/// type rather than [`routing::RoutingDecision`] directly: `Delegate` here
/// additionally carries the [`PeerPlaybackTarget`] to forward, always the
/// *portable* [`PeerPlaybackTarget::ExternalRef`] form (never
/// `MediaFile { media_file_id }`) -- a local `media_file_id` is only ever
/// meaningful on the node that minted it (§4.1/§4.2), so forwarding this
/// node's own id to a *different* node would resolve to nothing there.
/// Computed once by [`resolve_route_for_local_media_file`] (it already has
/// to resolve the leaf's portable identity to run [`routing::resolve_route`]
/// at all) rather than re-derived a second time by its caller.
enum LocalRouteOutcome {
    ServeLocally,
    Delegate {
        peer_node_id: Uuid,
        delivery: DeliveryMode,
        target: PeerPlaybackTarget,
    },
    Unavailable,
}

/// §5.2's routing step for a request that already resolved a *local*
/// `MediaFile` (`playback_info_handler`'s own entry point). The row is local,
/// but its path may not be present or readable on this node, so availability
/// is checked against the node's physical source path before routing. A
/// single, ungrouped node (no `node_identity` row, or
/// one with `group_id: None`) short-circuits to
/// [`LocalRouteOutcome::ServeLocally`] before touching
/// `routing_rule_repo`/`peer_node_repo`/`peer_leaf_availability_repo` at
/// all, and a grouped node with no matching rule (or a matching rule with
/// an empty `preferred_nodes`) short-circuits the same way before paying
/// for the external-ref/`LeafSelector` lookup below -- both cases are
/// byte-for-byte as cheap as today's existing behavior.
async fn resolve_route_for_local_media_file(
    state: &AppState,
    media_file: &MediaFile,
    user_id: Uuid,
) -> Result<LocalRouteOutcome, ApiError> {
    let Some(identity) = state.node_identity_repo.get().await? else {
        return Ok(LocalRouteOutcome::ServeLocally);
    };
    let Some(group_id) = identity.group_id else {
        return Ok(LocalRouteOutcome::ServeLocally);
    };

    let rules = state.routing_rule_repo.list_for_group(group_id).await?;
    let group_library_id = state
        .source_instances
        .get(media_file.source_instance_id)
        .and_then(|instance| instance.group_library_id);
    // Cheap pre-check before paying for the external-ref/leaf-selector
    // lookup below: if no rule would even match, there is no point
    // deriving a `RoutingContext` at all.
    let Some(rule) = routing::select_most_specific_rule(&rules, group_library_id, user_id) else {
        return Ok(LocalRouteOutcome::ServeLocally);
    };
    if rule.preferred_nodes.is_empty() {
        return Ok(LocalRouteOutcome::ServeLocally);
    }

    let Some((provider, external_id, leaf_selector)) =
        resolve_leaf_identity(state, media_file).await?
    else {
        tracing::warn!(
            media_file_id = %media_file.id,
            "a routing rule matched but this leaf has no portable external ref/leaf selector \
             yet; serving locally rather than failing playback"
        );
        return Ok(LocalRouteOutcome::ServeLocally);
    };
    let ctx = routing::RoutingContext {
        group_library_id,
        user_id,
        provider: provider.clone(),
        external_id: external_id.clone(),
        leaf_selector: leaf_selector.clone(),
    };
    let peers = state.peer_node_repo.list_all().await?;
    let availability = state
        .peer_leaf_availability_repo
        .list_by_local_work_ids(&[media_file.work_id])
        .await?;
    Ok(
        match resolve_local_media_route(
            &ctx,
            &rules,
            identity.peer_id,
            local_media_file_is_readable(state, media_file, identity.peer_id).await,
            &peers,
            &availability,
        ) {
            routing::RoutingDecision::ServeLocally => LocalRouteOutcome::ServeLocally,
            routing::RoutingDecision::Unavailable => LocalRouteOutcome::Unavailable,
            routing::RoutingDecision::Delegate {
                peer_node_id,
                delivery,
            } => LocalRouteOutcome::Delegate {
                peer_node_id,
                delivery,
                target: PeerPlaybackTarget::ExternalRef {
                    provider,
                    external_id,
                    leaf_selector,
                },
            },
        },
    )
}

async fn local_media_file_is_readable(
    state: &AppState,
    media_file: &MediaFile,
    peer_id: Uuid,
) -> bool {
    let Some(source) = state.source_instances.get(media_file.source_instance_id) else {
        return false;
    };
    let Some((physical_path, _)) = crate::physical_path::existing_physical_file(
        &source,
        peer_id,
        &media_file.path.to_string_lossy(),
    )
    .await
    else {
        return false;
    };
    tokio::fs::File::open(physical_path).await.is_ok()
}

fn resolve_local_media_route(
    context: &routing::RoutingContext,
    rules: &[playarr_model::RoutingRule],
    self_peer_id: Uuid,
    self_available: bool,
    peers: &[playarr_model::PeerNode],
    availability: &[playarr_model::PeerLeafAvailability],
) -> routing::RoutingDecision {
    routing::resolve_route(
        context,
        rules,
        self_peer_id,
        self_available,
        peers,
        availability,
    )
}

/// Resolves `media_file`'s portable `(ExternalProvider, external_id,
/// LeafSelector)` identity (§4.2) -- `None` when the underlying `Work` has
/// no external ref yet (nothing portable to route on), or this specific
/// leaf isn't found in its own work's resolved tree (shouldn't happen for a
/// `media_file` that resolved locally at all, but degrades to "can't route"
/// rather than panicking).
async fn resolve_leaf_identity(
    state: &AppState,
    media_file: &MediaFile,
) -> Result<Option<(ExternalProvider, String, LeafSelector)>, ApiError> {
    let work = state.work_repo.get(media_file.work_id).await?;
    let Some(external_ref) = work.external_refs.first() else {
        return Ok(None);
    };
    let detail = state.catalog.get_by_id(media_file.work_id, None).await?;
    let leaf_selector = crate::peer::leaf_selectors_for(&detail)
        .into_iter()
        .find(|(id, _)| *id == media_file.id)
        .map(|(_, selector)| selector);
    Ok(leaf_selector.map(|selector| {
        (
            external_ref.provider.clone(),
            external_ref.external_id.clone(),
            selector,
        )
    }))
}

/// Request/response DTOs and the receiving-side handler for §5.2's "the
/// entire negotiation request is forwarded" mechanism, and §5.3's "defense
/// in depth": [`PeerSignedRequest`]-gated (proves the *calling node* is a
/// legitimate, still-active member of this group) but deliberately carries
/// `user_id`/`device_id` explicitly rather than a bearer token -- the
/// receiving (owning) peer independently resolves *that* user's `Policy`
/// from its own synced state ([`resolve_streaming_access`]) before running
/// negotiation, rather than trusting the forwarding peer's assertion of
/// what its caller is allowed.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct PeerPlaybackInfoRequest {
    pub user_id: Uuid,
    pub device_id: Uuid,
    pub client_platform: ClientPlatform,
    pub client_version: String,
    pub target: PeerPlaybackTarget,
    pub query: PlaybackQuery,
}

#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct PeerPlaybackEventRequest {
    pub user_id: Uuid,
    pub kind: PlaybackEventKind,
}

/// Which leaf to negotiate playback for, on the peer actually holding it.
/// `ExternalRef` -- `(provider, external_id, LeafSelector)`, §4.2's
/// portability layer -- is the only variant either of this crate's own
/// callers ([`forward_negotiation_to_peer`], reached from both
/// `playback_info_handler`'s locally-resolved path and
/// [`by_external_ref_playback_info_handler`]'s §4.3 `RemoteOnlyWork` path)
/// ever actually sends: a local `media_file_id` is only ever meaningful on
/// the node that minted it (§4.1), so forwarding one to a *different* node
/// would resolve to nothing there -- see [`LocalRouteOutcome`]'s own doc
/// comment. `MediaFile` is still accepted on the receiving side
/// ([`peer_playback_info_handler`]) for a caller that, unlike this crate's
/// own, already knows it's addressing a media file id meaningful on the
/// *receiving* peer specifically (kept as a documented, valid wire shape
/// rather than removed, even though nothing in this codebase constructs it
/// today).
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PeerPlaybackTarget {
    MediaFile {
        media_file_id: Uuid,
    },
    ExternalRef {
        provider: ExternalProvider,
        external_id: String,
        leaf_selector: LeafSelector,
    },
}

/// `POST /api/v1/peer/playback-info` -- the receiving side of §5.2's
/// negotiation forward: [`PeerSignedRequest`]-gated (only a known, active
/// peer in this group may call this), runs the *exact same*
/// [`negotiate_playback`] this node's own [`playback_info_handler`] runs
/// for a local caller, just fed from [`PeerPlaybackInfoRequest`] instead of
/// a `StreamingUser`/`ConnectInfo`/`HeaderMap`. See this module's own
/// `PeerPlaybackInfoRequest` doc comment for the defense-in-depth reasoning
/// behind resolving the acting user's grant independently here rather than
/// trusting the caller's forwarded claim.
#[utoipa::path(
    post,
    path = "/api/v1/peer/playback-info",
    tag = "peer-groups",
    request_body(content = PeerPlaybackInfoRequest, example = json!({
        "user_id": "3f9c1e2d-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
        "device_id": "7a9d3e1f-8b4c-4d2a-9b3e-5f6a7b8c9d0e",
        "client_platform": "web",
        "client_version": "1.0.0",
        "target": {"kind": "media_file", "media_file_id": "9c8b7a6f-5e4d-3c2b-1a0f-9e8d7c6b5a4f"},
        "query": {"containers": "mp4", "video_codecs": "h264", "audio_codecs": "aac"}
    })),
    responses(
        (status = 200, description = "Playback negotiation resolved against this (the owning) peer's own local media file", body = PlaybackInfoResponse),
        (status = 401, description = "Missing/invalid peer signature, or an unknown/left peer"),
        (status = 403, description = "The forwarded user does not have Playarr streaming access on this peer's own policy, or is outside its own library grant"),
        (status = 404, description = "Unknown media file, or no local leaf resolves the given external ref")
    )
)]
pub async fn peer_playback_info_handler(
    State(state): State<AppState>,
    peer_signed: PeerSignedRequest,
) -> Result<Json<PlaybackInfoResponse>, ApiError> {
    let body: PeerPlaybackInfoRequest =
        serde_json::from_slice(&peer_signed.body).map_err(|err| {
            ApiError::bad_request(format!("invalid peer playback-info request body: {err}"))
        })?;

    // Defense in depth (§5.3): resolve the acting user's policy/allowed
    // libraries from THIS peer's own synced state, never the caller's
    // forwarded assertion of who the user is or what they're allowed.
    let (policy, allowed_libraries) = resolve_streaming_access(&state, body.user_id).await?;

    let media_file = match body.target {
        PeerPlaybackTarget::MediaFile { media_file_id } => state
            .media_files
            .get(media_file_id)
            .await
            .ok_or_else(|| ApiError::not_found(format!("unknown media file {media_file_id}")))?,
        PeerPlaybackTarget::ExternalRef {
            provider,
            external_id,
            leaf_selector,
        } => resolve_local_media_file_for_leaf(&state, &provider, &external_id, &leaf_selector)
            .await?
            .ok_or_else(|| {
                ApiError::not_found(format!(
                    "no local media file resolves external ref {provider:?}:{external_id}"
                ))
            })?,
    };
    ensure_library_allowed(media_file.source_instance_id, allowed_libraries.as_deref())?;
    // The forwarding peer asserts nothing about content rules: re-derive
    // them from this node's own synced policy.
    state
        .household
        .ensure_media_file_allowed(&state, &policy, body.user_id, &media_file)
        .await?;

    let response = negotiate_playback(
        &state,
        media_file,
        body.user_id,
        body.device_id,
        body.client_platform,
        body.client_version,
        None,
        &body.query,
        policy.can_transcode,
    )
    .await?;
    Ok(Json(response))
}

/// The `RemoteOnlyWork` direction of §4.2's portability matching: given an
/// external ref + `LeafSelector` a peer forwarded, finds the local
/// `media_file_id` (if any) that resolves it, by resolving the local `Work`
/// first (`WorkRepo::find_by_external_ref`) and then walking its tree the
/// same way [`resolve_leaf_identity`] does in the opposite direction --
/// [`crate::peer::leaf_selectors_for`] is the single shared algorithm both
/// directions use.
async fn resolve_local_media_file_for_leaf(
    state: &AppState,
    provider: &ExternalProvider,
    external_id: &str,
    leaf_selector: &LeafSelector,
) -> Result<Option<MediaFile>, ApiError> {
    let Some(work) = state
        .work_repo
        .find_by_external_ref(provider, external_id)
        .await?
    else {
        return Ok(None);
    };
    let detail = state.catalog.get_by_id(work.id, None).await?;
    let Some((media_file_id, _)) = crate::peer::leaf_selectors_for(&detail)
        .into_iter()
        .find(|(_, selector)| selector == leaf_selector)
    else {
        return Ok(None);
    };
    Ok(state.media_files.get(media_file_id).await)
}

/// §5.2/§5.3: forwards the ENTIRE negotiation to `peer_node_id` via a
/// signed `POST /api/v1/peer/playback-info` call (never just swapping the
/// final URL -- see this module's own doc comment on why), then rewrites
/// the peer's response `url` for the resolved `delivery` mode (§5.3).
#[allow(clippy::too_many_arguments)]
async fn forward_negotiation_to_peer(
    state: &AppState,
    peer_node_id: Uuid,
    delivery: DeliveryMode,
    target: PeerPlaybackTarget,
    user_id: Uuid,
    device_id: Uuid,
    client_platform: ClientPlatform,
    client_version: String,
    query: &PlaybackQuery,
) -> Result<Json<PlaybackInfoResponse>, ApiError> {
    let peer = state
        .peer_node_repo
        .get(peer_node_id)
        .await?
        .ok_or_else(|| {
            ApiError::no_peer_available(format!("peer {peer_node_id} is no longer known"))
        })?;
    let identity = crate::admin_peer::own_peer_identity(state).await?;
    let client = playarr_peer_sync::PeerClient::new_with_routes(
        state.peer_http.clone(),
        identity,
        state.peer_transport_routes.clone(),
    );

    let body = PeerPlaybackInfoRequest {
        user_id,
        device_id,
        client_platform,
        client_version,
        target,
        query: query.clone(),
    };

    let addresses = client.addresses_for_peer(peer.id, &peer.addresses);
    if addresses.is_empty() {
        return Err(ApiError::no_peer_available(format!(
            "peer {peer_node_id} has no known address"
        )));
    }
    let mut last_error = None;
    for base_url in addresses {
        match client
            .signed_post::<_, PlaybackInfoResponse>(&base_url, "/api/v1/peer/playback-info", &body)
            .await
        {
            Ok(response) => {
                // The client keeps using this entry node for lifecycle
                // events, while the owner created the session in its own
                // registry. Remember the authenticated owner selected by
                // this negotiation so later events can be forwarded over
                // the same signed peer transport.
                let rewritten = rewrite_for_delivery(response, &peer, delivery)?;
                remember_playback_session_route(state, rewritten.session_id, peer_node_id, user_id);
                return Ok(Json(rewritten));
            }
            Err(err) => {
                tracing::warn!(
                    peer_node_id = %peer_node_id,
                    %base_url,
                    error = %err,
                    "peer playback negotiation forward failed; trying next known address"
                );
                last_error = Some(err.to_string());
            }
        }
    }
    Err(ApiError::no_peer_available(format!(
        "could not reach peer {peer_node_id} for playback negotiation: {}",
        last_error.unwrap_or_default()
    )))
}

/// §5.3: rewrites a peer's own `PlaybackInfoResponse.url` (a path relative
/// to *that* peer's own API) into what THIS (the entry) node's client
/// should actually call. `Redirect` becomes an absolute URL at one of
/// `peer`'s own `client_reachable` addresses (falling back to any known
/// address if an explicit rule override chose `Redirect` despite none
/// being marked reachable -- `compute_delivery_mode` only ever *computes*
/// `Redirect` when one exists, but an operator's explicit override can
/// still name it regardless). `Proxy` becomes this node's own
/// `/api/v1/media/proxy/{peer_node_id}/...` passthrough path
/// (`media::proxy_stream_media_handler`) so the client never needs to
/// reach `peer` directly.
fn rewrite_for_delivery(
    mut response: PlaybackInfoResponse,
    peer: &PeerNode,
    delivery: DeliveryMode,
) -> Result<PlaybackInfoResponse, ApiError> {
    // An HLS manifest names its segments relative to itself, so a redirected
    // client loses the `playback_session_id` capability on every segment, and
    // clients only send their bearer token to their own server origin. The
    // peer then answers 401 (TASKS 260). HLS is therefore always proxied
    // through this node, which rewrites the manifest to carry the capability
    // (`media::proxy_*`); only a direct-play URL, which carries the
    // capability itself, can be redirected.
    let delivery = match (delivery, &response.mode) {
        (DeliveryMode::Redirect, PlaybackMode::Hls) => DeliveryMode::Proxy,
        (other, _) => other,
    };
    match delivery {
        DeliveryMode::Redirect => {
            let mut reachable: Vec<&playarr_model::PeerAddress> = peer
                .addresses
                .iter()
                .filter(|address| address.client_reachable)
                .collect();
            reachable.sort_by_key(|address| address.priority);
            let base = reachable
                .first()
                .map(|address| address.url.as_str())
                .or_else(|| {
                    playarr_peer_sync::peer_client::addresses_by_priority(&peer.addresses)
                        .into_iter()
                        .next()
                })
                .ok_or_else(|| {
                    ApiError::no_peer_available(format!(
                        "peer {} has no address to redirect playback to",
                        peer.id
                    ))
                })?;
            response.url = format!("{}{}", base.trim_end_matches('/'), response.url);
            Ok(response)
        }
        DeliveryMode::Proxy => {
            if let Some(rest) = response.url.strip_prefix("/api/v1/media/") {
                let mut proxied = format!("/api/v1/media/proxy/{}/{}", peer.id, rest);
                if !proxied.contains("playback_session_id=") {
                    let separator = if proxied.contains('?') { '&' } else { '?' };
                    proxied.push(separator);
                    proxied.push_str("playback_session_id=");
                    proxied.push_str(&response.session_id.to_string());
                }
                response.url = proxied;
            } else {
                tracing::warn!(
                    peer_id = %peer.id,
                    url = %response.url,
                    "peer playback response url did not have the expected /api/v1/media/ \
                     prefix; proxy passthrough rewrite skipped, url left as-is"
                );
            }
            Ok(response)
        }
        // `resolve_route`/`compute_delivery_mode` never hand `Delegate` back
        // with `delivery: DeliveryMode::Auto` itself (see
        // `RoutingDecision::Delegate`'s own doc comment) -- kept exhaustive
        // rather than `unreachable!()` so this stays a plain, panic-free
        // fallback if that guarantee is ever loosened.
        DeliveryMode::Auto => Ok(response),
    }
}

/// Request body for [`by_external_ref_playback_info_handler`] -- §4.3/§5.2:
/// the `RemoteOnlyWork` entry point, used when the client's starting point
/// was a title it can browse (via cross-peer availability, §4.3) but has no
/// local `media_file_id` to call [`playback_info_handler`] with at all.
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct PlaybackByExternalRefRequest {
    pub provider: ExternalProvider,
    pub external_id: String,
    pub leaf_selector: LeafSelector,
    pub group_library_id: Option<Uuid>,
}

/// `POST /api/v1/playback/by-external-ref` -- §4.3/§5.2's dedicated entry
/// point for a `RemoteOnlyWork` with no local `media_file_id`: runs the
/// identical routing evaluation [`playback_info_handler`] does, from a
/// [`routing::RoutingContext`] built directly from the request body instead
/// of a resolved local `MediaFile`. Negotiation capabilities
/// (`containers`/`video_codecs`/...) are accepted the same way
/// `playback_info_handler`'s own `GET` does, as a [`PlaybackQuery`] query
/// string -- they don't fit naturally into a JSON body alongside a nested
/// `LeafSelector`, and reusing the identical query-parameter convention
/// keeps this endpoint's negotiation inputs consistent with the one it
/// mirrors rather than introducing a second shape for the same thing.
///
/// This node's own copy is deliberately never consulted for
/// `self_available` (`resolve_route` is always called with
/// `self_available = false`): a caller only ever reaches for this endpoint
/// because it has zero local record of the title, so this always resolves
/// to [`routing::RoutingDecision::Delegate`] or
/// [`routing::RoutingDecision::Unavailable`], never `ServeLocally` -- see
/// `docs/architecture/peer-groups.md` §5.2's own note on this.
#[utoipa::path(
    post,
    path = "/api/v1/playback/by-external-ref",
    tag = "playback",
    params(PlaybackQuery),
    request_body(content = PlaybackByExternalRefRequest, example = json!({
        "provider": "tmdb",
        "external_id": "603",
        "leaf_selector": {"kind": "movie"},
        "group_library_id": "b6a1c2d3-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
    })),
    responses(
        (status = 200, description = "Playback negotiation resolved on the peer that actually holds this title", body = PlaybackInfoResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller does not have Playarr streaming access"),
        (status = 503, description = "No peer in the group currently reports this title available")
    )
)]
pub async fn by_external_ref_playback_info_handler(
    State(state): State<AppState>,
    streaming: StreamingUser,
    Query(query): Query<PlaybackQuery>,
    headers: HeaderMap,
    Json(body): Json<PlaybackByExternalRefRequest>,
) -> Result<Json<PlaybackInfoResponse>, ApiError> {
    let client_platform = headers
        .get(CLIENT_PLATFORM_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(ClientPlatform::from_wire_name)
        .unwrap_or(ClientPlatform::Web);
    let client_version = headers
        .get(CLIENT_VERSION_HEADER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("unknown")
        .to_string();

    let self_context = state.node_identity_repo.get().await?.and_then(|identity| {
        identity
            .group_id
            .map(|group_id| (identity.peer_id, group_id))
    });
    let Some((self_peer_id, group_id)) = self_context else {
        return Err(ApiError::no_peer_available(
            "this node is not part of any peer group",
        ));
    };

    let rules = state.routing_rule_repo.list_for_group(group_id).await?;
    let ctx = routing::RoutingContext {
        group_library_id: body.group_library_id,
        user_id: streaming.user_id,
        provider: body.provider,
        external_id: body.external_id,
        leaf_selector: body.leaf_selector,
    };
    let peers = state.peer_node_repo.list_all().await?;
    let availability = state
        .peer_leaf_availability_repo
        .list_for_leaf(&ctx.provider, &ctx.external_id, &ctx.leaf_selector)
        .await?;

    match routing::resolve_route(&ctx, &rules, self_peer_id, false, &peers, &availability) {
        routing::RoutingDecision::Delegate {
            peer_node_id,
            delivery,
        } => {
            forward_negotiation_to_peer(
                &state,
                peer_node_id,
                delivery,
                PeerPlaybackTarget::ExternalRef {
                    provider: ctx.provider,
                    external_id: ctx.external_id,
                    leaf_selector: ctx.leaf_selector,
                },
                streaming.user_id,
                streaming.claims.device_id,
                client_platform,
                client_version,
                &query,
            )
            .await
        }
        // A node with zero local record of this title can never serve it
        // itself -- `ServeLocally` (no matching rule, or one with an empty
        // `preferred_nodes`) collapses to the same "nowhere to send this"
        // outcome as `Unavailable` here, see this handler's own doc
        // comment.
        routing::RoutingDecision::ServeLocally | routing::RoutingDecision::Unavailable => {
            Err(ApiError::no_peer_available(
                "no peer in this group currently reports this title available",
            ))
        }
    }
}

#[utoipa::path(
    post,
    path = "/api/v1/playback/sessions/{session_id}/events",
    tag = "playback",
    params(("session_id" = Uuid, Path, description = "PlaybackSession id, from PlaybackInfoResponse.session_id")),
    request_body(content = PlaybackEventKind, example = json!({
        "kind": "heartbeat",
        "position_ms": 125_000,
        "bytes_streamed_total": 52_428_800
    })),
    responses(
        (status = 204, description = "Event recorded"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "session_id does not belong to the caller"),
        (status = 404, description = "Unknown or already-closed session_id")
    )
)]
pub async fn record_playback_event_handler(
    State(state): State<AppState>,
    streaming: StreamingUser,
    Path(session_id): Path<Uuid>,
    Json(kind): Json<PlaybackEventKind>,
) -> Result<StatusCode, ApiError> {
    let Some(session) = state.session_registry.get(session_id) else {
        let Some((peer_node_id, negotiated_user_id)) = playback_session_route(&state, session_id)
        else {
            return Err(ApiError::not_found(format!(
                "unknown or closed session {session_id}"
            )));
        };
        if negotiated_user_id != streaming.user_id {
            return Err(forbidden("session does not belong to this account"));
        }

        forward_playback_event_to_peer(&state, peer_node_id, session_id, streaming.user_id, kind)
            .await?;
        return Ok(StatusCode::NO_CONTENT);
    };
    if session.user_id != streaming.user_id {
        return Err(forbidden("session does not belong to this account"));
    }

    apply_playback_event(&state, session_id, kind).await?;
    Ok(StatusCode::NO_CONTENT)
}

const PLAYBACK_SESSION_ROUTE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_PLAYBACK_SESSION_ROUTES: usize = 10_000;

fn remember_playback_session_route(
    state: &AppState,
    session_id: Uuid,
    peer_node_id: Uuid,
    user_id: Uuid,
) {
    let now = Instant::now();
    let mut routes = state
        .playback_session_routes
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    routes.retain(|_, (_, _, created_at)| {
        now.duration_since(*created_at) <= PLAYBACK_SESSION_ROUTE_TTL
    });
    routes.insert(session_id, (peer_node_id, user_id, now));
    while routes.len() > MAX_PLAYBACK_SESSION_ROUTES {
        let Some(oldest_session_id) = routes
            .iter()
            .min_by_key(|(_, (_, _, created_at))| *created_at)
            .map(|(session_id, _)| *session_id)
        else {
            break;
        };
        routes.remove(&oldest_session_id);
    }
}

fn playback_session_route(state: &AppState, session_id: Uuid) -> Option<(Uuid, Uuid)> {
    let now = Instant::now();
    let mut routes = state
        .playback_session_routes
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    routes.retain(|_, (_, _, created_at)| {
        now.duration_since(*created_at) <= PLAYBACK_SESSION_ROUTE_TTL
    });
    routes
        .get(&session_id)
        .map(|(peer_node_id, user_id, _)| (*peer_node_id, *user_id))
}

fn forget_playback_session_route(state: &AppState, session_id: Uuid) {
    state
        .playback_session_routes
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(&session_id);
}

/// The signed peer-to-peer equivalent of [`record_playback_event_handler`].
/// The entry node has already authenticated the viewer's JWT, but the owner
/// still checks the session and forwarded user id against its own registry
/// before recording anything.
#[utoipa::path(
    post,
    path = "/api/v1/peer/playback/sessions/{session_id}/events",
    tag = "peer-groups",
    params(("session_id" = Uuid, Path, description = "Owner-local PlaybackSession id")),
    request_body(content = PeerPlaybackEventRequest),
    responses(
        (status = 204, description = "Event recorded"),
        (status = 401, description = "Missing or invalid peer signature"),
        (status = 403, description = "The forwarded user does not own the session"),
        (status = 404, description = "Unknown or already-closed session")
    )
)]
pub async fn peer_playback_event_handler(
    State(state): State<AppState>,
    Path(session_id): Path<Uuid>,
    peer_signed: PeerSignedRequest,
) -> Result<StatusCode, ApiError> {
    let body: PeerPlaybackEventRequest =
        serde_json::from_slice(&peer_signed.body).map_err(|err| {
            ApiError::bad_request(format!("invalid peer playback event request body: {err}"))
        })?;
    let session = state
        .session_registry
        .get(session_id)
        .ok_or_else(|| ApiError::not_found(format!("unknown or closed session {session_id}")))?;
    if session.user_id != body.user_id {
        return Err(forbidden(
            "session does not belong to the forwarded account",
        ));
    }
    apply_playback_event(&state, session_id, body.kind).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn apply_playback_event(
    state: &AppState,
    session_id: Uuid,
    kind: PlaybackEventKind,
) -> Result<(), ApiError> {
    // Server clock, never client-supplied -- avoids clock-skew abuse.
    let event = PlaybackEvent {
        id: Uuid::new_v4(),
        session_id,
        occurred_at: Utc::now(),
        kind: kind.clone(),
    };
    state.analytics.on_event(session_id, event).await?;

    // A clean stop or terminal player error closes analytics and kills any
    // associated on-demand ffmpeg process immediately rather than waiting
    // for independent idle reapers. Reading `final_state` after `on_event`
    // means it already reflects every buffering/byte counter accumulated
    // over the session's lifetime.
    let stop_reason = match kind {
        PlaybackEventKind::Stop { reason, .. } => Some(reason),
        PlaybackEventKind::Error { .. } => Some(playarr_model::StopReason::Error),
        _ => None,
    };
    if let Some(reason) = stop_reason {
        let mut analytics_result = Ok(());
        if let Some(final_state) = state.session_registry.get(session_id) {
            analytics_result = state
                .analytics
                .on_session_end(session_id, &final_state, reason)
                .await;
        }
        let transcode_result = state.transcode.expire_playback_session(session_id).await;

        // Process cleanup must still happen if analytics persistence fails,
        // hence both operations run before either error is returned.
        analytics_result?;
        transcode_result?;
    }
    Ok(())
}

async fn forward_playback_event_to_peer(
    state: &AppState,
    peer_node_id: Uuid,
    session_id: Uuid,
    user_id: Uuid,
    kind: PlaybackEventKind,
) -> Result<(), ApiError> {
    let peer = state
        .peer_node_repo
        .get(peer_node_id)
        .await?
        .ok_or_else(|| ApiError::not_found(format!("unknown playback session {session_id}")))?;
    let identity = crate::admin_peer::own_peer_identity(state).await?;
    let client = playarr_peer_sync::PeerClient::new_with_routes(
        state.peer_http.clone(),
        identity,
        state.peer_transport_routes.clone(),
    );
    let addresses = client.addresses_for_peer(peer.id, &peer.addresses);
    if addresses.is_empty() {
        return Err(ApiError::no_peer_available(format!(
            "peer {peer_node_id} has no known address"
        )));
    }
    let path = format!("/api/v1/peer/playback/sessions/{session_id}/events");
    let body = PeerPlaybackEventRequest { user_id, kind };
    let terminal = is_terminal_playback_event(&body.kind);
    let mut last_error = None;
    for base_url in addresses {
        match client.signed_post_no_content(&base_url, &path, &body).await {
            Ok(()) => {
                if terminal {
                    forget_playback_session_route(state, session_id);
                }
                return Ok(());
            }
            Err(playarr_peer_sync::peer_client::PeerClientError::Status { status, .. })
                if status == StatusCode::NOT_FOUND =>
            {
                forget_playback_session_route(state, session_id);
                return Err(ApiError::not_found(format!(
                    "unknown or closed session {session_id}"
                )));
            }
            Err(playarr_peer_sync::peer_client::PeerClientError::Status {
                status, body, ..
            }) if status == StatusCode::FORBIDDEN => {
                return Err(forbidden(body));
            }
            Err(err) => {
                tracing::warn!(
                    peer_node_id = %peer_node_id,
                    %base_url,
                    error = %err,
                    "peer playback event forward failed; trying next known address"
                );
                last_error = Some(err.to_string());
            }
        }
    }
    Err(ApiError::no_peer_available(format!(
        "could not reach peer {peer_node_id} for playback event: {}",
        last_error.unwrap_or_default()
    )))
}

fn is_terminal_playback_event(kind: &PlaybackEventKind) -> bool {
    matches!(
        kind,
        PlaybackEventKind::Stop { .. } | PlaybackEventKind::Error { .. }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_switch_copies_video_only_when_the_client_can_play_it() {
        let caps = |codecs: &[&str], max: Option<u64>| ClientCapabilities {
            supported_containers: vec!["mp4".to_string()],
            supported_video_codecs: codecs.iter().map(|c| c.to_string()).collect(),
            supported_audio_codecs: vec![],
            max_bitrate_bps: max,
        };
        let mut remux = media_file();
        remux.codec = "hevc".to_string();
        remux.bitrate = Some(64_000_000);

        // A 4K HEVC remux and an HEVC-capable client: copy, whatever the container.
        let video =
            video_copy_for_audio_selection(&remux, &caps(&["h264", "h265"], None), true, false);
        assert_eq!(video, Some(playarr_transcode::VideoCopy { hevc: true }));
        // The client's cap is above the file's bitrate: still a copy.
        assert!(video_copy_for_audio_selection(
            &remux,
            &caps(&["hevc"], Some(80_000_000)),
            true,
            false
        )
        .is_some());

        // No audio switch, or an explicit quality: no copy.
        assert!(
            video_copy_for_audio_selection(&remux, &caps(&["hevc"], None), false, false).is_none()
        );
        assert!(
            video_copy_for_audio_selection(&remux, &caps(&["hevc"], None), true, true).is_none()
        );
        // Client cannot play HEVC, reports nothing, or the file exceeds its cap: transcode.
        assert!(
            video_copy_for_audio_selection(&remux, &caps(&["h264"], None), true, false).is_none()
        );
        assert!(video_copy_for_audio_selection(&remux, &caps(&[], None), true, false).is_none());
        assert!(video_copy_for_audio_selection(
            &remux,
            &caps(&["hevc"], Some(8_000_000)),
            true,
            false
        )
        .is_none());
        // A codec the fragmented-MP4 path does not carry is transcoded.
        let mut other = media_file();
        other.codec = "vc1".to_string();
        assert!(
            video_copy_for_audio_selection(&other, &caps(&["vc1"], None), true, false).is_none()
        );
    }

    #[test]
    fn direct_play_mime_type_maps_video_containers() {
        assert_eq!(direct_play_mime_type("mkv"), "video/x-matroska");
        assert_eq!(direct_play_mime_type("MKV"), "video/x-matroska");
        assert_eq!(direct_play_mime_type("webm"), "video/webm");
        assert_eq!(direct_play_mime_type("mp4"), "video/mp4");
    }

    #[test]
    fn transcode_reason_treats_hevc_and_h265_as_same_codec() {
        let caps = ClientCapabilities {
            supported_containers: vec!["mkv".to_string()],
            supported_video_codecs: vec!["h265".to_string()],
            supported_audio_codecs: vec![],
            max_bitrate_bps: Some(1),
        };
        let mut file = media_file();
        file.codec = "hevc".to_string();
        file.bitrate = Some(10);
        assert!(matches!(
            derive_transcode_reason(&file, &caps),
            TranscodeReason::VideoBitrateExceedsLimit
        ));
    }
    use crate::test_support::{
        bearer_header, mint_access_token, seed_movie, seed_streaming_user,
        seed_streaming_user_with_library_allow, test_state,
    };
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use base64::Engine;
    use chrono::Utc;
    use ed25519_dalek::{Signer, SigningKey};
    use playarr_model::media::LeafRef;
    use playarr_model::{
        Availability, DeliveryMode, ExternalProvider, LeafSelector, PeerAddress,
        PeerLeafAvailability, PeerNode, PeerNodeStatus, RoutingRule, Sensitive, SourceInstance,
        SourceKind, WorkKind,
    };
    use sha2::{Digest, Sha256};
    use std::collections::BTreeMap;
    use std::path::PathBuf;
    use tower::ServiceExt;
    use wiremock::matchers::{body_json, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    /// `playback_info_handler` now takes `ConnectInfo<SocketAddr>` (mirrors
    /// `login.rs`'s own tests, which hit the same requirement first) --
    /// `oneshot`-driven tests never go through
    /// `into_make_service_with_connect_info`, so the extension has to be
    /// inserted onto the request directly.
    fn get_with_connect_info(uri: impl AsRef<str>, token: &str) -> Request<Body> {
        let mut request = Request::builder()
            .uri(uri.as_ref())
            .header("Authorization", bearer_header(token))
            .body(Body::empty())
            .unwrap();
        request
            .extensions_mut()
            .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 51234))));
        request
    }

    fn post_with_connect_info(
        uri: impl AsRef<str>,
        token: &str,
        body: serde_json::Value,
    ) -> Request<Body> {
        let mut request = Request::builder()
            .method("POST")
            .uri(uri.as_ref())
            .header("Authorization", bearer_header(token))
            .header("Content-Type", "application/json")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap();
        request
            .extensions_mut()
            .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 51234))));
        request
    }

    fn signed_peer_post(path: &str, body: &[u8], peer_id: Uuid, key: &SigningKey) -> Request<Body> {
        let timestamp = Utc::now().timestamp();
        let nonce = Uuid::new_v4().to_string();
        let body_hash = hex::encode(Sha256::digest(body));
        let canonical = format!("POST|{path}|{body_hash}|{timestamp}|{nonce}");
        let signature = key.sign(canonical.as_bytes());
        Request::builder()
            .method("POST")
            .uri(path)
            .header(crate::peer_extractor::PEER_ID_HEADER, peer_id.to_string())
            .header(
                crate::peer_extractor::SIGNATURE_HEADER,
                base64::engine::general_purpose::STANDARD.encode(signature.to_bytes()),
            )
            .header(
                crate::peer_extractor::TIMESTAMP_HEADER,
                timestamp.to_string(),
            )
            .header(crate::peer_extractor::NONCE_HEADER, nonce)
            .header("Content-Type", "application/json")
            .body(Body::from(body.to_vec()))
            .unwrap()
    }

    async fn seed_signed_peer(
        state: &crate::test_support::TestState,
        peer_id: Uuid,
        key: &SigningKey,
        address: String,
    ) {
        let group = playarr_model::PeerGroup {
            id: Uuid::new_v4(),
            name: "playback event test group".to_string(),
            created_at: Utc::now(),
        };
        state.app.peer_group_repo.create(&group).await.unwrap();
        let now = Utc::now();
        state
            .app
            .peer_node_repo
            .upsert(&PeerNode {
                id: peer_id,
                group_id: group.id,
                name: "playback owner".to_string(),
                addresses: vec![playarr_model::PeerAddress {
                    url: address,
                    priority: 0,
                    label: "test".to_string(),
                    client_reachable: true,
                }],
                public_key: base64::engine::general_purpose::STANDARD
                    .encode(key.verifying_key().to_bytes()),
                is_self: false,
                status: playarr_model::PeerNodeStatus::Active,
                last_seen_at: Some(now),
                last_sync_error: None,
                joined_at: now,
                updated_at: now,
            })
            .await
            .unwrap();
    }

    fn playback_session(user_id: Uuid, id: Uuid) -> PlaybackSession {
        PlaybackSession {
            id,
            user_id,
            device_id: Uuid::new_v4(),
            media_file_id: Uuid::new_v4(),
            rendition_id: None,
            started_at: Utc::now(),
            ended_at: None,
            play_method: PlayMethod::DirectPlay,
            transcode_reason: None,
            source_codec: "h264".to_string(),
            source_container: "mp4".to_string(),
            source_bitrate: Some(1_000_000),
            target_codec: "h264".to_string(),
            target_container: "mp4".to_string(),
            target_bitrate: Some(1_000_000),
            client_platform: ClientPlatform::Web,
            client_version: "test".to_string(),
            ip_address: None,
            bytes_streamed: 0,
            buffering_events: 0,
            buffering_ms_total: 0,
            stop_reason: None,
        }
    }

    fn media_file() -> MediaFile {
        MediaFile {
            id: Uuid::new_v4(),
            work_id: Uuid::new_v4(),
            leaf_ref: LeafRef::Work,
            path: PathBuf::from("/media/movies/Sample.mkv"),
            container: "mkv".to_string(),
            codec: "hevc".to_string(),
            bitrate: Some(15_000_000),
            duration_ms: None,
            size_bytes: 4_000_000_000,
            source_instance_id: Uuid::new_v4(),
            source_file_id: Some("1".to_string()),
        }
    }

    #[tokio::test]
    async fn local_db_media_row_is_available_only_when_its_mapped_file_is_readable() {
        let (_, state) = test_state().await;
        let temp = tempfile::tempdir().unwrap();
        let peer_id = Uuid::new_v4();
        let source_id = Uuid::new_v4();
        let source = SourceInstance {
            id: source_id,
            kind: SourceKind::Radarr,
            name: "test source".to_string(),
            base_url: "https://example.invalid".to_string(),
            api_key_encrypted: Sensitive::new("test".to_string()),
            priority: 0,
            default_root_folder_id: Some("/source".to_string()),
            folder_mappings: BTreeMap::from([(
                peer_id,
                temp.path().to_string_lossy().into_owned(),
            )]),
            default_quality_profile_id: None,
            best_effort: false,
            group_library_id: None,
        };
        state.source_instances.upsert(source);
        let mut row = media_file();
        row.source_instance_id = source_id;
        row.path = PathBuf::from("/source/movie.mkv");

        let context = routing::RoutingContext {
            group_library_id: None,
            user_id: Uuid::new_v4(),
            provider: ExternalProvider::Tmdb,
            external_id: "603".to_string(),
            leaf_selector: LeafSelector::Movie,
        };
        let now = Utc::now();
        let rule = RoutingRule {
            id: Uuid::new_v4(),
            group_id: Uuid::new_v4(),
            group_library_id: None,
            user_id: None,
            priority: 0,
            preferred_nodes: vec![Uuid::new_v4()],
            delivery_mode: DeliveryMode::Auto,
            created_at: now,
            updated_at: now,
        };
        let remote_id = Uuid::new_v4();
        let remote = PeerNode {
            id: remote_id,
            group_id: rule.group_id,
            name: "remote".to_string(),
            addresses: vec![PeerAddress {
                url: "https://peer.invalid".to_string(),
                priority: 0,
                label: "wan".to_string(),
                client_reachable: true,
            }],
            public_key: "test".to_string(),
            is_self: false,
            status: PeerNodeStatus::Active,
            last_seen_at: Some(now),
            last_sync_error: None,
            joined_at: now,
            updated_at: now,
        };
        let remote_file = PeerLeafAvailability {
            peer_node_id: remote_id,
            media_file_id: Uuid::new_v4(),
            source_instance_id: source_id,
            path: "/peer/movie.mkv".to_string(),
            provider: context.provider.clone(),
            external_id: context.external_id.clone(),
            leaf_selector: context.leaf_selector.clone(),
            group_library_id: None,
            availability: Availability::Available,
            container: Some("mkv".to_string()),
            codec: Some("h264".to_string()),
            bitrate: Some(1_000_000),
            size_bytes: Some(10),
            duration_ms: Some(1000),
            local_work_id: None,
            title: "Sample".to_string(),
            kind: WorkKind::Movie,
            release_date: None,
            updated_at: now,
        };

        let local_available = local_media_file_is_readable(&state.app, &row, peer_id).await;
        assert!(!local_available);
        assert_eq!(
            resolve_local_media_route(
                &context,
                std::slice::from_ref(&rule),
                peer_id,
                local_available,
                std::slice::from_ref(&remote),
                std::slice::from_ref(&remote_file),
            ),
            routing::RoutingDecision::Delegate {
                peer_node_id: remote_id,
                delivery: DeliveryMode::Redirect,
            }
        );
        assert_eq!(
            resolve_local_media_route(
                &context,
                std::slice::from_ref(&rule),
                peer_id,
                local_available,
                std::slice::from_ref(&remote),
                &[],
            ),
            routing::RoutingDecision::Unavailable
        );
        let physical_file = temp.path().join("movie.mkv");
        std::fs::write(&physical_file, b"readable media").unwrap();
        let local_available = local_media_file_is_readable(&state.app, &row, peer_id).await;
        assert!(local_available);
        assert_eq!(
            resolve_local_media_route(
                &context,
                &[rule],
                peer_id,
                local_available,
                &[remote],
                &[remote_file],
            ),
            routing::RoutingDecision::ServeLocally
        );
    }

    #[test]
    fn preferred_audio_language_matches_two_and_three_letter_tags() {
        assert!(audio_language_matches(Some("eng"), "en"));
        assert!(audio_language_matches(Some("FR-ca"), "fra"));
        assert!(audio_language_matches(Some("jpn"), "ja-JP"));
        assert!(!audio_language_matches(Some("deu"), "en"));
        assert!(!audio_language_matches(None, "en"));
    }

    #[tokio::test]
    async fn unknown_media_file_is_404() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(get_with_connect_info(
                format!("/api/v1/playback/{}", Uuid::new_v4()),
                &token,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn source_bitrate_rejects_zero_and_derives_from_size_and_duration() {
        let mut file = media_file();
        file.bitrate = Some(24_300_000);
        assert_eq!(source_bitrate_bps(&file, 0), Some(24_300_000));

        file.bitrate = Some(0);
        file.size_bytes = 3_000_000_000;
        // 3 GB over 1000 s is 24 Mbps.
        assert_eq!(source_bitrate_bps(&file, 1_000_000), Some(24_000_000));
        file.bitrate = None;
        file.duration_ms = Some(2_000_000);
        assert_eq!(source_bitrate_bps(&file, 0), Some(12_000_000));

        file.duration_ms = None;
        assert_eq!(source_bitrate_bps(&file, 0), None);
        file.bitrate = Some(0);
        file.size_bytes = 0;
        assert_eq!(source_bitrate_bps(&file, 1_000_000), None);
        assert_eq!(playback_quality_options(None)[0].video_bitrate_bps, None);
    }

    #[tokio::test]
    async fn original_quality_never_reports_a_zero_bitrate() {
        let (router, state) = test_state().await;
        let mut file = media_file();
        file.container = "mp4".to_string();
        file.codec = "h264".to_string();
        file.duration_ms = Some(1_000_000);
        file.bitrate = Some(0);
        file.size_bytes = 3_000_000_000;
        let id = file.id;
        let source_instance_id = file.source_instance_id;
        state.media_files.insert(file);
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance_id]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(get_with_connect_info(
                format!("/api/v1/playback/{id}?containers=mp4&video_codecs=h264"),
                &token,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let info: PlaybackInfoResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(info.quality_options[0].id, "original");
        assert_eq!(info.quality_options[0].video_bitrate_bps, Some(24_000_000));
    }

    #[tokio::test]
    async fn direct_play_when_client_supports_source_format() {
        let (router, state) = test_state().await;
        let mut file = media_file();
        file.container = "mp4".to_string();
        file.codec = "h264".to_string();
        file.duration_ms = Some(3_643_424);
        let id = file.id;
        let source_instance_id = file.source_instance_id;
        state.media_files.insert(file);
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance_id]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(get_with_connect_info(
                format!("/api/v1/playback/{id}?containers=mp4&video_codecs=h264"),
                &token,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let info: PlaybackInfoResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(info.mode, PlaybackMode::Direct);
        assert_eq!(info.duration_ms, 3_643_424);
        assert_eq!(info.source_offset_ms, 0);
        assert_eq!(info.selected_quality_id, "original");
        assert_eq!(info.quality_options[0].label, "Original");
        assert_eq!(info.quality_options[0].video_bitrate_bps, Some(15_000_000));
        assert_eq!(info.quality_options.len(), 13);
        assert_eq!(info.quality_options[1].label, "UHD Low");
        assert_eq!(info.quality_options[5].label, "FHD Medium");
        assert_eq!(
            info.quality_options
                .iter()
                .filter_map(|quality| quality.height)
                .collect::<Vec<_>>(),
            vec![2160, 2160, 2160, 1080, 1080, 1080, 720, 720, 720, 480, 480, 480]
        );
        assert_ne!(info.session_id, Uuid::nil());
        assert_eq!(
            info.url,
            format!(
                "/api/v1/media/{id}/stream?playback_session_id={}",
                info.session_id
            )
        );

        // The session was actually recorded, both durably and in the live
        // registry -- proves `start_analytics_session` really ran, not
        // just that a random id was fabricated for the response.
        let tracked = state.app.session_registry.get(info.session_id);
        assert!(tracked.is_some());
        assert_eq!(tracked.unwrap().play_method, PlayMethod::DirectPlay);
    }

    #[tokio::test]
    async fn explicit_quality_forces_its_real_profile_even_when_original_can_direct_play() {
        let (router, state) = test_state().await;
        let mut file = media_file();
        file.container = "mp4".to_string();
        file.codec = "h264".to_string();
        let id = file.id;
        let source_instance_id = file.source_instance_id;
        state.media_files.insert(file);
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance_id]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(get_with_connect_info(
                format!(
                    "/api/v1/playback/{id}?containers=mp4&video_codecs=h264&force_transcode=true&profile=h264-480p-2mbps"
                ),
                &token,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let info: PlaybackInfoResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(info.mode, PlaybackMode::Hls);
        assert_eq!(info.selected_quality_id, "h264-480p-2mbps");
        assert!(info.url.contains("/sessions/"));

        let tracked = state
            .app
            .session_registry
            .get(info.session_id)
            .expect("quality-selected session should be recorded");
        assert_eq!(tracked.play_method, PlayMethod::Transcode);
        assert_eq!(tracked.target_bitrate, Some(2_000_000));
        assert_eq!(
            tracked.transcode_reason,
            Some(TranscodeReason::Other("quality_selection".to_string()))
        );
    }

    #[tokio::test]
    async fn spawns_on_demand_transcode_when_incompatible_and_no_rendition() {
        let (router, state) = test_state().await;
        let file = media_file(); // mkv/hevc, incompatible with mp4/h264 client
        let id = file.id;
        let source_instance_id = file.source_instance_id;
        state.media_files.insert(file);
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance_id]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(get_with_connect_info(
                format!(
                    "/api/v1/playback/{id}?containers=mp4&video_codecs=h264&start_position_ms=1234567"
                ),
                &token,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let info: PlaybackInfoResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(info.mode, PlaybackMode::Hls);
        assert!(info.url.contains("/sessions/"));
        assert_eq!(info.source_offset_ms, 1_234_567);

        let tracked = state
            .app
            .session_registry
            .get(info.session_id)
            .expect("on-demand session should be recorded");
        assert_eq!(tracked.play_method, PlayMethod::Transcode);
        assert_eq!(tracked.rendition_id, None);
        assert!(tracked.transcode_reason.is_some());
    }

    #[tokio::test]
    async fn existing_rendition_session_carries_the_rendition_id_and_play_method() {
        use playarr_model::{ProducedBy, Rendition, RenditionStatus};

        let (router, state) = test_state().await;
        let file = media_file(); // mkv/hevc, incompatible with mp4/h264 client
        let id = file.id;
        let source_instance_id = file.source_instance_id;
        state.media_files.insert(file);
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance_id]).await;
        let token = mint_access_token(&state, user_id);

        let rendition = Rendition {
            id: Uuid::new_v4(),
            media_file_id: id,
            profile: DEFAULT_PROFILE.to_string(),
            container: "hls".to_string(),
            codec: "h264".to_string(),
            bitrate: Some(4_000_000),
            output_path: PathBuf::from("/renditions/out/playlist.m3u8"),
            produced_by: ProducedBy::Tdarr,
            produced_at: Utc::now(),
            status: RenditionStatus::Ready,
        };
        state.rendition_repo.upsert(&rendition).await.unwrap();

        let response = router
            .oneshot(get_with_connect_info(
                format!("/api/v1/playback/{id}?containers=mp4&video_codecs=h264"),
                &token,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let info: PlaybackInfoResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(info.mode, PlaybackMode::Hls);

        let tracked = state
            .app
            .session_registry
            .get(info.session_id)
            .expect("rendition-backed session should be recorded");
        assert_eq!(tracked.play_method, PlayMethod::Transcode);
        assert_eq!(tracked.rendition_id, Some(rendition.id));
        assert_eq!(tracked.target_codec, "h264");
    }

    /// Full flow: negotiate playback (getting a `session_id`), post a
    /// heartbeat and a buffer start/end pair, then a clean `Stop` -- proves
    /// the registry's buffering counters update in real time and the
    /// session is force-closed (removed from the live registry, durably
    /// closed) the moment `Stop` arrives.
    #[tokio::test]
    async fn event_endpoint_updates_registry_and_stop_closes_the_session() {
        let (router, state) = test_state().await;
        let mut file = media_file();
        file.container = "mp4".to_string();
        file.codec = "h264".to_string();
        let id = file.id;
        let source_instance_id = file.source_instance_id;
        state.media_files.insert(file);
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance_id]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .clone()
            .oneshot(get_with_connect_info(
                format!("/api/v1/playback/{id}?containers=mp4&video_codecs=h264"),
                &token,
            ))
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let info: PlaybackInfoResponse = serde_json::from_slice(&bytes).unwrap();

        let events_uri = format!("/api/v1/playback/sessions/{}/events", info.session_id);

        let heartbeat = router
            .clone()
            .oneshot(post_with_connect_info(
                &events_uri,
                &token,
                serde_json::json!({"kind": "heartbeat", "position_ms": 1000, "bytes_streamed_total": 5000}),
            ))
            .await
            .unwrap();
        assert_eq!(heartbeat.status(), StatusCode::NO_CONTENT);

        let buffer_start = router
            .clone()
            .oneshot(post_with_connect_info(
                &events_uri,
                &token,
                serde_json::json!({"kind": "buffer_start", "position_ms": 1200}),
            ))
            .await
            .unwrap();
        assert_eq!(buffer_start.status(), StatusCode::NO_CONTENT);

        let buffer_end = router
            .clone()
            .oneshot(post_with_connect_info(
                &events_uri,
                &token,
                serde_json::json!({"kind": "buffer_end", "duration_ms": 300}),
            ))
            .await
            .unwrap();
        assert_eq!(buffer_end.status(), StatusCode::NO_CONTENT);

        let tracked = state
            .app
            .session_registry
            .get(info.session_id)
            .expect("session should still be tracked before stop");
        assert_eq!(tracked.bytes_streamed, 5000);
        assert_eq!(tracked.buffering_events, 1);
        assert_eq!(tracked.buffering_ms_total, 300);

        let stop = router
            .clone()
            .oneshot(post_with_connect_info(
                &events_uri,
                &token,
                serde_json::json!({"kind": "stop", "reason": "user_stopped", "position_ms": 9000}),
            ))
            .await
            .unwrap();
        assert_eq!(stop.status(), StatusCode::NO_CONTENT);

        // Force-closed: removed from the live registry, and durably closed
        // with the counters accumulated above intact.
        assert!(state.app.session_registry.get(info.session_id).is_none());
        let history = state
            .app
            .analytics_store
            .list_sessions(&playarr_db::analytics::SessionFilter {
                user_ids: vec![user_id],
                limit: 10,
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].bytes_streamed, 5000);
        assert_eq!(
            history[0].stop_reason,
            Some(playarr_model::StopReason::UserStopped)
        );
    }

    #[tokio::test]
    async fn stop_event_expires_the_associated_on_demand_transcode() {
        let (router, state) = test_state().await;
        let file = media_file();
        let id = file.id;
        let source_instance_id = file.source_instance_id;
        state.media_files.insert(file);
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance_id]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .clone()
            .oneshot(get_with_connect_info(
                format!("/api/v1/playback/{id}?containers=mp4&video_codecs=h264"),
                &token,
            ))
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let info: PlaybackInfoResponse = serde_json::from_slice(&bytes).unwrap();
        let transcode_session_id = info
            .url
            .split("/sessions/")
            .nth(1)
            .and_then(|suffix| suffix.split('/').next())
            .and_then(|id| Uuid::parse_str(id).ok())
            .expect("on-demand URL should carry a transcode session id");
        assert!(state
            .app
            .transcode
            .lookup_session(transcode_session_id)
            .await
            .unwrap()
            .is_some());

        let stop = router
            .oneshot(post_with_connect_info(
                format!("/api/v1/playback/sessions/{}/events", info.session_id),
                &token,
                serde_json::json!({
                    "kind": "stop",
                    "reason": "user_stopped",
                    "position_ms": 9000
                }),
            ))
            .await
            .unwrap();

        assert_eq!(stop.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            state
                .app
                .transcode
                .lookup_session(transcode_session_id)
                .await
                .unwrap(),
            None
        );
        assert_eq!(state.app.transcode.active_session_count(), 0);
    }

    #[tokio::test]
    async fn switching_back_to_direct_original_expires_the_previous_transcode() {
        let (router, state) = test_state().await;
        let mut file = media_file();
        file.container = "mp4".to_string();
        file.codec = "h264".to_string();
        let id = file.id;
        let source_instance_id = file.source_instance_id;
        state.media_files.insert(file);
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance_id]).await;
        let token = mint_access_token(&state, user_id);

        let forced = router
            .clone()
            .oneshot(get_with_connect_info(
                format!(
                    "/api/v1/playback/{id}?containers=mp4&video_codecs=h264&force_transcode=true&profile=h264-480p-2mbps"
                ),
                &token,
            ))
            .await
            .unwrap();
        let forced_bytes = axum::body::to_bytes(forced.into_body(), usize::MAX)
            .await
            .unwrap();
        let forced_info: PlaybackInfoResponse = serde_json::from_slice(&forced_bytes).unwrap();
        let transcode_session_id = forced_info
            .url
            .split("/sessions/")
            .nth(1)
            .and_then(|suffix| suffix.split('/').next())
            .and_then(|id| Uuid::parse_str(id).ok())
            .unwrap();

        let original = router
            .oneshot(get_with_connect_info(
                format!("/api/v1/playback/{id}?containers=mp4&video_codecs=h264"),
                &token,
            ))
            .await
            .unwrap();
        let original_bytes = axum::body::to_bytes(original.into_body(), usize::MAX)
            .await
            .unwrap();
        let original_info: PlaybackInfoResponse = serde_json::from_slice(&original_bytes).unwrap();

        assert_eq!(original_info.mode, PlaybackMode::Direct);
        assert_eq!(original_info.session_id, forced_info.session_id);
        assert_eq!(
            state
                .app
                .transcode
                .lookup_session(transcode_session_id)
                .await
                .unwrap(),
            None
        );
        assert_eq!(state.app.transcode.active_session_count(), 0);
    }

    #[tokio::test]
    async fn replacing_playback_after_the_dedupe_window_stops_the_old_transcode() {
        let (router, state) = test_state().await;
        let mut file = media_file();
        file.container = "mp4".to_string();
        file.codec = "h264".to_string();
        let id = file.id;
        let source_instance_id = file.source_instance_id;
        state.media_files.insert(file);
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance_id]).await;
        let token = mint_access_token(&state, user_id);
        let request = |profile: &str| {
            get_with_connect_info(
                format!(
                    "/api/v1/playback/{id}?containers=mp4&video_codecs=h264&force_transcode=true&profile={profile}"
                ),
                &token,
            )
        };
        let session_of = |info: &PlaybackInfoResponse| {
            info.url
                .split("/sessions/")
                .nth(1)
                .and_then(|suffix| suffix.split('/').next())
                .and_then(|id| Uuid::parse_str(id).ok())
                .unwrap()
        };

        let first = router
            .clone()
            .oneshot(request("h264-480p-2mbps"))
            .await
            .unwrap();
        let first: PlaybackInfoResponse = serde_json::from_slice(
            &axum::body::to_bytes(first.into_body(), usize::MAX)
                .await
                .unwrap(),
        )
        .unwrap();
        let first_transcode = session_of(&first);

        // The viewer switches audio/quality well after the dedupe window.
        state.app.session_registry.update(first.session_id, &|s| {
            s.started_at -= chrono::Duration::seconds(60);
        });
        let second = router.oneshot(request("h264-720p-4mbps")).await.unwrap();
        let second: PlaybackInfoResponse = serde_json::from_slice(
            &axum::body::to_bytes(second.into_body(), usize::MAX)
                .await
                .unwrap(),
        )
        .unwrap();

        assert_ne!(second.session_id, first.session_id);
        assert_eq!(
            state
                .app
                .transcode
                .lookup_session(first_transcode)
                .await
                .unwrap(),
            None,
            "the superseded transcode must be stopped"
        );
        assert!(state
            .app
            .transcode
            .lookup_session(session_of(&second))
            .await
            .unwrap()
            .is_some());
        assert_eq!(state.app.transcode.active_session_count(), 1);
    }

    /// Writes a stand-in ffmpeg that stays alive, so a transcode keeps its
    /// admission slot until something stops it.
    #[cfg(unix)]
    fn sleeping_ffmpeg_binary() -> String {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("playarr-slot-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("ffmpeg-sleeper");
        std::fs::write(&path, "#!/bin/sh\nexec /usr/bin/sleep 30\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path.to_string_lossy().into_owned()
    }

    /// With the default single node-local slot, a viewer who replaces their
    /// own playback (quality or audio switch, or a retry after a decoder
    /// failure) must not be refused with `no_transcode_capacity` just because
    /// their previous transcode still holds the slot: it is superseded, so
    /// its slot is handed over before admission. Covers both the case inside
    /// the duplicate-session window and the one after it.
    #[cfg(unix)]
    #[tokio::test]
    async fn replacing_playback_hands_the_single_slot_to_the_new_transcode() {
        for age_seconds in [0, 60] {
            let (router, state) =
                crate::test_support::test_state_with_ffmpeg(&sleeping_ffmpeg_binary(), 1).await;
            let mut file = media_file();
            file.container = "mp4".to_string();
            file.codec = "h264".to_string();
            let id = file.id;
            let source_instance_id = file.source_instance_id;
            state.media_files.insert(file);
            let user_id = Uuid::new_v4();
            seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance_id]).await;
            let token = mint_access_token(&state, user_id);
            let request = |profile: &str| {
                get_with_connect_info(
                    format!(
                        "/api/v1/playback/{id}?containers=mp4&video_codecs=h264&force_transcode=true&profile={profile}"
                    ),
                    &token,
                )
            };

            let first = router
                .clone()
                .oneshot(request("h264-480p-2mbps"))
                .await
                .unwrap();
            assert_eq!(first.status(), StatusCode::OK);
            let first: PlaybackInfoResponse = serde_json::from_slice(
                &axum::body::to_bytes(first.into_body(), usize::MAX)
                    .await
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(state.app.transcode.active_session_count(), 1);

            state.app.session_registry.update(first.session_id, &|s| {
                s.started_at -= chrono::Duration::seconds(age_seconds);
            });
            let second = router.oneshot(request("h264-720p-4mbps")).await.unwrap();
            assert_eq!(
                second.status(),
                StatusCode::OK,
                "replacement after {age_seconds}s must not hit no_transcode_capacity"
            );
            assert_eq!(state.app.transcode.active_session_count(), 1);
        }
    }

    #[tokio::test]
    async fn terminal_error_closes_analytics_and_expires_on_demand_transcode() {
        let (router, state) = test_state().await;
        let file = media_file();
        let id = file.id;
        let source_instance_id = file.source_instance_id;
        state.media_files.insert(file);
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance_id]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .clone()
            .oneshot(get_with_connect_info(
                format!("/api/v1/playback/{id}?containers=mp4&video_codecs=h264"),
                &token,
            ))
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let info: PlaybackInfoResponse = serde_json::from_slice(&bytes).unwrap();
        let transcode_session_id = info
            .url
            .split("/sessions/")
            .nth(1)
            .and_then(|suffix| suffix.split('/').next())
            .and_then(|id| Uuid::parse_str(id).ok())
            .unwrap();

        let error = router
            .oneshot(post_with_connect_info(
                format!("/api/v1/playback/sessions/{}/events", info.session_id),
                &token,
                serde_json::json!({"kind": "error", "message": "fatal player error"}),
            ))
            .await
            .unwrap();

        assert_eq!(error.status(), StatusCode::NO_CONTENT);
        assert!(state.app.session_registry.get(info.session_id).is_none());
        assert_eq!(
            state
                .app
                .transcode
                .lookup_session(transcode_session_id)
                .await
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn events_for_unknown_session_is_404() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(post_with_connect_info(
                format!("/api/v1/playback/sessions/{}/events", Uuid::new_v4()),
                &token,
                serde_json::json!({"kind": "heartbeat", "position_ms": 1000}),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    /// The ownership check this endpoint needs to exist for at all: without
    /// it, any authenticated streaming user could post events into any
    /// other user's active session id.
    #[tokio::test]
    async fn events_for_someone_elses_session_is_forbidden() {
        let (router, state) = test_state().await;
        let owner = Uuid::new_v4();
        seed_streaming_user(&state, owner).await;
        let intruder = Uuid::new_v4();
        seed_streaming_user(&state, intruder).await;
        let intruder_token = mint_access_token(&state, intruder);

        let session = PlaybackSession {
            id: Uuid::new_v4(),
            user_id: owner,
            device_id: Uuid::new_v4(),
            media_file_id: Uuid::new_v4(),
            rendition_id: None,
            started_at: Utc::now(),
            ended_at: None,
            play_method: PlayMethod::DirectPlay,
            transcode_reason: None,
            source_codec: "h264".to_string(),
            source_container: "mp4".to_string(),
            source_bitrate: Some(8_000_000),
            target_codec: "h264".to_string(),
            target_container: "mp4".to_string(),
            target_bitrate: Some(8_000_000),
            client_platform: ClientPlatform::Web,
            client_version: "1.0.0".to_string(),
            ip_address: None,
            bytes_streamed: 0,
            buffering_events: 0,
            buffering_ms_total: 0,
            stop_reason: None,
        };
        let session_id = session.id;
        state.app.session_registry.insert(session);

        let response = router
            .oneshot(post_with_connect_info(
                format!("/api/v1/playback/sessions/{session_id}/events"),
                &intruder_token,
                serde_json::json!({"kind": "heartbeat", "position_ms": 1000}),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn owner_event_route_requires_a_valid_member_signature_and_session_user() {
        let (router, state) = test_state().await;
        let owner = Uuid::new_v4();
        let wrong_user = Uuid::new_v4();
        let peer_id = Uuid::new_v4();
        let key = SigningKey::from_bytes(&[41u8; 32]);
        seed_signed_peer(&state, peer_id, &key, "https://owner.invalid".to_string()).await;
        let session_id = Uuid::new_v4();
        state
            .app
            .session_registry
            .insert(playback_session(owner, session_id));

        let valid_body = serde_json::to_vec(&PeerPlaybackEventRequest {
            user_id: owner,
            kind: PlaybackEventKind::Heartbeat {
                position_ms: 1_000,
                bytes_streamed_total: Some(12),
            },
        })
        .unwrap();
        let response = router
            .clone()
            .oneshot(signed_peer_post(
                &format!("/api/v1/peer/playback/sessions/{session_id}/events"),
                &valid_body,
                peer_id,
                &key,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        let wrong_user_body = serde_json::to_vec(&PeerPlaybackEventRequest {
            user_id: wrong_user,
            kind: PlaybackEventKind::Heartbeat {
                position_ms: 2_000,
                bytes_streamed_total: None,
            },
        })
        .unwrap();
        let response = router
            .clone()
            .oneshot(signed_peer_post(
                &format!("/api/v1/peer/playback/sessions/{session_id}/events"),
                &wrong_user_body,
                peer_id,
                &key,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);

        let unknown_peer_body = valid_body.clone();
        let response = router
            .clone()
            .oneshot(signed_peer_post(
                &format!("/api/v1/peer/playback/sessions/{session_id}/events"),
                &unknown_peer_body,
                Uuid::new_v4(),
                &key,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        let mut left_peer = state
            .app
            .peer_node_repo
            .get(peer_id)
            .await
            .unwrap()
            .unwrap();
        left_peer.status = PeerNodeStatus::Left;
        state.app.peer_node_repo.upsert(&left_peer).await.unwrap();
        let response = router
            .oneshot(signed_peer_post(
                &format!("/api/v1/peer/playback/sessions/{session_id}/events"),
                &valid_body,
                peer_id,
                &key,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn entry_event_route_forwards_heartbeat_and_stop_and_binds_the_jwt_user() {
        let (router, state) = test_state().await;
        let owner = Uuid::new_v4();
        let intruder = Uuid::new_v4();
        seed_streaming_user(&state, owner).await;
        seed_streaming_user(&state, intruder).await;
        let owner_token = mint_access_token(&state, owner);
        let intruder_token = mint_access_token(&state, intruder);

        let server = MockServer::start().await;
        let peer_id = Uuid::new_v4();
        let peer_key = SigningKey::from_bytes(&[42u8; 32]);
        seed_signed_peer(&state, peer_id, &peer_key, server.uri()).await;
        let session_id = Uuid::new_v4();
        remember_playback_session_route(&state.app, session_id, peer_id, owner);

        let heartbeat = serde_json::json!({
            "kind": "heartbeat",
            "position_ms": 1_000,
            "bytes_streamed_total": 128
        });
        Mock::given(method("POST"))
            .and(path(format!(
                "/api/v1/peer/playback/sessions/{session_id}/events"
            )))
            .and(body_json(serde_json::json!({
                "user_id": owner,
                "kind": {
                    "kind": "heartbeat",
                    "position_ms": 1_000,
                    "bytes_streamed_total": 128
                }
            })))
            .respond_with(ResponseTemplate::new(204))
            .expect(1)
            .mount(&server)
            .await;

        let response = router
            .clone()
            .oneshot(post_with_connect_info(
                format!("/api/v1/playback/sessions/{session_id}/events"),
                &intruder_token,
                heartbeat.clone(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(playback_session_route(&state.app, session_id).is_some());

        let response = router
            .clone()
            .oneshot(post_with_connect_info(
                format!("/api/v1/playback/sessions/{session_id}/events"),
                &owner_token,
                heartbeat,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        let error_session_id = Uuid::new_v4();
        remember_playback_session_route(&state.app, error_session_id, peer_id, owner);
        Mock::given(method("POST"))
            .and(path(format!(
                "/api/v1/peer/playback/sessions/{error_session_id}/events"
            )))
            .and(body_json(serde_json::json!({
                "user_id": owner,
                "kind": {
                    "kind": "error",
                    "message": "decoder failed"
                }
            })))
            .respond_with(ResponseTemplate::new(204))
            .expect(1)
            .mount(&server)
            .await;
        let response = router
            .clone()
            .oneshot(post_with_connect_info(
                format!("/api/v1/playback/sessions/{error_session_id}/events"),
                &owner_token,
                serde_json::json!({
                    "kind": "error",
                    "message": "decoder failed"
                }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert!(playback_session_route(&state.app, error_session_id).is_none());

        let stop = serde_json::json!({
            "kind": "stop",
            "reason": "user_stopped",
            "position_ms": 1_250
        });
        Mock::given(method("POST"))
            .and(path(format!(
                "/api/v1/peer/playback/sessions/{session_id}/events"
            )))
            .and(body_json(serde_json::json!({
                "user_id": owner,
                "kind": {
                    "kind": "stop",
                    "reason": "user_stopped",
                    "position_ms": 1_250
                }
            })))
            .respond_with(ResponseTemplate::new(204))
            .expect(1)
            .mount(&server)
            .await;

        let response = router
            .oneshot(post_with_connect_info(
                format!("/api/v1/playback/sessions/{session_id}/events"),
                &owner_token,
                stop,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert!(playback_session_route(&state.app, session_id).is_none());
    }

    #[tokio::test]
    async fn progress_is_durable_scoped_to_user_and_completes_near_the_end() {
        let (router, state) = test_state().await;
        let work_id = seed_movie(&state, "Progress Movie").await;
        let mut file = media_file();
        file.work_id = work_id;
        let source_instance_id = file.source_instance_id;
        state.media_file_repo.create(&file).await.unwrap();
        state.media_files.insert(file.clone());

        let first_user = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, first_user, vec![source_instance_id]).await;
        let first_token = mint_access_token(&state, first_user);

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/api/v1/playback/{}/progress", file.id))
                    .header("Authorization", bearer_header(&first_token))
                    .header("Content-Type", "application/json")
                    .body(Body::from(r#"{"position_ms":50000,"duration_ms":100000}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let saved: WatchProgress = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(saved.state, playarr_model::WatchState::PartWatched);

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/playback/progress")
                    .header("Authorization", bearer_header(&first_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let on_deck: Vec<WatchProgress> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(on_deck.len(), 1);
        assert_eq!(on_deck[0].work_id, work_id);
        assert_eq!(on_deck[0].media_file_id, file.id);

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/playback/{}/progress", file.id))
                    .header("Authorization", bearer_header(&first_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let resumed: WatchProgress = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(resumed.position_ms, 50_000);

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/api/v1/playback/{}/progress", file.id))
                    .header("Authorization", bearer_header(&first_token))
                    .header("Content-Type", "application/json")
                    .body(Body::from(r#"{"position_ms":91000,"duration_ms":100000}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let completed: WatchProgress = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(completed.state, playarr_model::WatchState::Watched);

        let second_user = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, second_user, vec![source_instance_id]).await;
        let second_token = mint_access_token(&state, second_user);
        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/playback/{}/progress", file.id))
                    .header("Authorization", bearer_header(&second_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let unseen: WatchProgress = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(unseen.state, playarr_model::WatchState::Unseen);
        assert_eq!(unseen.updated_at, None);
    }

    /// Per-user library access control end-to-end for playback negotiation:
    /// a caller whose `Policy::library_allow` doesn't include the media
    /// file's `source_instance_id` is forbidden from negotiating playback
    /// for it at all, even though the file itself genuinely exists.
    #[tokio::test]
    async fn playback_info_is_forbidden_outside_the_callers_allowed_libraries() {
        let (router, state) = test_state().await;
        let mut file = media_file();
        file.container = "mp4".to_string();
        file.codec = "h264".to_string();
        let owning_instance = file.source_instance_id;
        let id = file.id;
        state.media_files.insert(file);

        let user_id = Uuid::new_v4();
        // Allowed for a *different* source instance, not this file's own.
        seed_streaming_user_with_library_allow(&state, user_id, vec![Uuid::new_v4()]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .clone()
            .oneshot(get_with_connect_info(
                format!("/api/v1/playback/{id}?containers=mp4&video_codecs=h264"),
                &token,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);

        // Sanity: the same file negotiates fine for a caller who *is*
        // allowed the owning instance, proving the 403 above is really
        // about the library check and not some other break.
        let allowed_user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, allowed_user_id, vec![owning_instance])
            .await;
        let allowed_token = mint_access_token(&state, allowed_user_id);
        let allowed_response = router
            .oneshot(get_with_connect_info(
                format!("/api/v1/playback/{id}?containers=mp4&video_codecs=h264"),
                &allowed_token,
            ))
            .await
            .unwrap();
        assert_eq!(allowed_response.status(), StatusCode::OK);
    }

    /// Same enforcement, for the watch-progress read/write endpoints
    /// instead of playback negotiation.
    #[tokio::test]
    async fn watch_progress_is_forbidden_outside_the_callers_allowed_libraries() {
        let (router, state) = test_state().await;
        let work_id = seed_movie(&state, "Restricted Progress Movie").await;
        let mut file = media_file();
        file.work_id = work_id;
        let id = file.id;
        state.media_file_repo.create(&file).await.unwrap();
        state.media_files.insert(file);

        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![Uuid::new_v4()]).await;
        let token = mint_access_token(&state, user_id);

        let get_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/playback/{id}/progress"))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(get_response.status(), StatusCode::FORBIDDEN);

        let put_response = router
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/api/v1/playback/{id}/progress"))
                    .header("Authorization", bearer_header(&token))
                    .header("Content-Type", "application/json")
                    .body(Body::from(r#"{"position_ms":1000,"duration_ms":100000}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(put_response.status(), StatusCode::FORBIDDEN);
    }

    /// A player still holding the id of a file the sync has since replaced
    /// gets a clean 404 (its progress moved to the replacement), never a 500.
    #[tokio::test]
    async fn watch_progress_write_for_a_removed_file_is_404() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![]).await;
        let token = mint_access_token(&state, user_id);
        let response = router
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/api/v1/playback/{}/progress", Uuid::new_v4()))
                    .header("Authorization", bearer_header(&token))
                    .header("Content-Type", "application/json")
                    .body(Body::from(r#"{"position_ms":1000,"duration_ms":100000}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    /// The file vanishes between the lookup and the write (the lookup still
    /// has it, the database no longer does): the foreign key rejects the row
    /// and the client sees a 404, not a 500.
    #[tokio::test]
    async fn watch_progress_write_racing_a_prune_is_404_not_500() {
        let (router, state) = test_state().await;
        let work_id = seed_movie(&state, "Raced Movie").await;
        let mut file = media_file();
        file.work_id = work_id;
        let id = file.id;
        let source_instance_id = file.source_instance_id;
        // Known to the lookup, absent from the database.
        state.media_files.insert(file);
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance_id]).await;
        let token = mint_access_token(&state, user_id);
        let response = router
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/api/v1/playback/{id}/progress"))
                    .header("Authorization", bearer_header(&token))
                    .header("Content-Type", "application/json")
                    .body(Body::from(r#"{"position_ms":1000,"duration_ms":100000}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    /// `list_watch_progress_handler` silently omits rows for media outside
    /// the caller's allowed libraries rather than 403ing the whole list --
    /// a caller can have legitimate progress in an allowed library and a
    /// (now-restricted) one at the same time, and only the former should
    /// appear.
    #[tokio::test]
    async fn list_watch_progress_omits_rows_outside_the_callers_allowed_libraries() {
        let (router, state) = test_state().await;
        let allowed_instance = Uuid::new_v4();
        let other_instance = Uuid::new_v4();

        let allowed_work = seed_movie(&state, "Allowed Progress Movie").await;
        let mut allowed_file = media_file();
        allowed_file.work_id = allowed_work;
        allowed_file.source_instance_id = allowed_instance;
        state.media_file_repo.create(&allowed_file).await.unwrap();
        state.media_files.insert(allowed_file.clone());

        let other_work = seed_movie(&state, "Other Progress Movie").await;
        let mut other_file = media_file();
        other_file.work_id = other_work;
        other_file.source_instance_id = other_instance;
        state.media_file_repo.create(&other_file).await.unwrap();
        state.media_files.insert(other_file.clone());

        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![allowed_instance]).await;
        let token = mint_access_token(&state, user_id);

        // Seed progress directly through the repo for both files -- these
        // rows exist regardless of the caller's current library grants
        // (e.g. an admin narrowed `library_allow` after the fact), so the
        // read path is what has to filter, not the write path.
        for (media_file_id, work_id) in
            [(allowed_file.id, allowed_work), (other_file.id, other_work)]
        {
            state
                .app
                .watch_progress
                .upsert(
                    user_id,
                    &WatchProgress {
                        media_file_id,
                        work_id,
                        position_ms: 1000,
                        duration_ms: 100_000,
                        state: playarr_model::WatchState::PartWatched,
                        updated_at: Some(Utc::now()),
                    },
                )
                .await
                .unwrap();
        }

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/playback/progress")
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
        let progress: Vec<WatchProgress> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(progress.len(), 1);
        assert_eq!(progress[0].media_file_id, allowed_file.id);
    }

    /// `RepoBackedMediaFileLookup` is a thin adapter, but it is the one
    /// piece of this fix with no coverage anywhere else: `playarr-db`'s
    /// own tests prove `MediaFileRepo::get_by_id` works, and the handler
    /// tests above only ever exercise `InMemoryMediaFileLookup`. This
    /// proves the two are actually wired together correctly end-to-end
    /// against a real (in-memory) database, not just that each half
    /// compiles.
    #[tokio::test]
    async fn repo_backed_lookup_resolves_a_persisted_media_file() {
        use playarr_db::repo::SqlxMediaFileRepo;
        use playarr_db::{run_migrations, MediaFileRepo};

        // Not `playarr_db::connect` (a 10-connection pool): SQLite's
        // `:memory:` database is private *per connection*, so a pool with
        // more than one connection would run migrations against one
        // connection and this test's queries against another, empty,
        // unmigrated database. `playarr-db`'s own tests hit the same
        // thing and fix it the same way (see its `test_sqlite_pool`
        // helper, `pub(crate)` there so unavailable here).
        sqlx::any::install_default_drivers();
        let pool = sqlx::any::AnyPoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();

        let file = media_file();
        // `media_files.work_id` has a real FK to `works(id)` (SQLite
        // enforces it here), so a parent row must exist first -- seeded
        // directly since `WorkRepo` is a different crate boundary this
        // test has no need to exercise.
        sqlx::query(
            "INSERT INTO works (id, kind, title, sort_title, added_at, availability) \
             VALUES (?, 'movie', 'Test Movie', 'Test Movie', '2026-01-01T00:00:00Z', 'available')",
        )
        .bind(file.work_id.to_string())
        .execute(&pool)
        .await
        .unwrap();

        let repo: std::sync::Arc<dyn MediaFileRepo> =
            std::sync::Arc::new(SqlxMediaFileRepo::new(pool));
        repo.create(&file).await.unwrap();

        let lookup = RepoBackedMediaFileLookup::new(repo);

        let found = lookup.get(file.id).await;
        assert_eq!(found.as_ref().map(|f| f.id), Some(file.id));
        assert_eq!(found.unwrap().path, file.path);

        // A miss must be `None`, not a panic/error surfaced to the caller —
        // this is the behavior the playback handler's 404 depends on.
        assert!(lookup.get(Uuid::new_v4()).await.is_none());
    }

    fn delegated_response(mode: PlaybackMode, url: &str) -> PlaybackInfoResponse {
        PlaybackInfoResponse {
            mode,
            url: url.to_string(),
            mime_type: "application/x-mpegURL".to_string(),
            duration_ms: 0,
            source_offset_ms: 0,
            audio_tracks: Vec::new(),
            selected_audio_track_id: None,
            subtitle_tracks: Vec::new(),
            selected_subtitle_track_id: None,
            quality_options: Vec::new(),
            selected_quality_id: "original".to_string(),
            session_id: Uuid::new_v4(),
        }
    }

    fn reachable_peer() -> PeerNode {
        let now = Utc::now();
        PeerNode {
            id: Uuid::new_v4(),
            group_id: Uuid::new_v4(),
            name: "remote".to_string(),
            addresses: vec![PeerAddress {
                url: "https://peer.invalid".to_string(),
                priority: 0,
                label: "wan".to_string(),
                client_reachable: true,
            }],
            public_key: "test".to_string(),
            is_self: false,
            status: PeerNodeStatus::Active,
            last_seen_at: Some(now),
            last_sync_error: None,
            joined_at: now,
            updated_at: now,
        }
    }

    /// TASKS 260: a redirected HLS URL reached the peer without the
    /// `playback_session_id` capability (manifest segment names are relative
    /// and the client sends its bearer only to its own origin), so the
    /// transcode fallback ended in HTTP 401. HLS must be proxied even when
    /// the rule or the heuristic chose `Redirect`.
    #[test]
    fn delegated_hls_is_proxied_even_when_redirect_was_chosen() {
        let peer = reachable_peer();
        let response = delegated_response(
            PlaybackMode::Hls,
            "/api/v1/media/sessions/6a5e2c3e-2b9a-4b3e-9b7a-8e2f1c3d4a5b/playlist.m3u8",
        );
        let session_id = response.session_id;
        let rewritten = rewrite_for_delivery(response, &peer, DeliveryMode::Redirect).unwrap();
        assert_eq!(
            rewritten.url,
            format!(
                "/api/v1/media/proxy/{}/sessions/6a5e2c3e-2b9a-4b3e-9b7a-8e2f1c3d4a5b/playlist.m3u8?playback_session_id={session_id}",
                peer.id
            )
        );
    }

    /// A direct-play URL already carries the capability, so it can still be
    /// redirected to the peer's own client-reachable address.
    #[test]
    fn delegated_direct_play_is_still_redirected() {
        let peer = reachable_peer();
        let response = delegated_response(
            PlaybackMode::Direct,
            "/api/v1/media/abc/stream?playback_session_id=s1",
        );
        let rewritten = rewrite_for_delivery(response, &peer, DeliveryMode::Redirect).unwrap();
        assert_eq!(
            rewritten.url,
            "https://peer.invalid/api/v1/media/abc/stream?playback_session_id=s1"
        );
    }
}
