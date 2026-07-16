//! `GET /api/v1/playback/{media_file_id}` -- the playback negotiation
//! endpoint: runs [`streamarr_transcode::TranscodeOrchestrator`]'s
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
//! path (see `streamarr_model::Policy::library_allow`'s doc comment):
//! `MediaFile` already carries `source_instance_id` directly, so no extra
//! N+1 lookup is needed the way the catalog's `Work`-level checks require.

use std::net::SocketAddr;

use async_trait::async_trait;
use axum::extract::{ConnectInfo, Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use chrono::Utc;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use streamarr_model::{
    ClientPlatform, MediaFile, PlayMethod, PlaybackEvent, PlaybackEventKind, PlaybackSession,
    TranscodeReason, WatchProgress,
};
use streamarr_transcode::ClientCapabilities;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth_extractor::{ensure_library_allowed, forbidden, StreamingUser};
use crate::error::ApiError;
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

/// The real, production [`MediaFileLookup`]: delegates to `streamarr-db`'s
/// [`streamarr_db::MediaFileRepo`], which `arr-sync` now actually populates
/// (see `streamarr_arr_sync::media_sync`). Replaces the once-necessary
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
    repo: std::sync::Arc<dyn streamarr_db::MediaFileRepo>,
}

impl RepoBackedMediaFileLookup {
    pub fn new(repo: std::sync::Arc<dyn streamarr_db::MediaFileRepo>) -> Self {
        Self { repo }
    }
}

#[async_trait]
impl MediaFileLookup for RepoBackedMediaFileLookup {
    async fn get(&self, id: Uuid) -> Option<MediaFile> {
        match self.repo.get_by_id(id).await {
            Ok(media_file) => Some(media_file),
            Err(streamarr_db::DbError::NotFound) => None,
            Err(err) => {
                tracing::warn!(media_file_id = %id, error = %err, "media file lookup failed");
                None
            }
        }
    }
}

#[derive(Debug, Deserialize, ToSchema, utoipa::IntoParams)]
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

pub(crate) fn playback_quality_options() -> Vec<PlaybackQualityOption> {
    std::iter::once(PlaybackQualityOption {
        id: "original".to_string(),
        label: "Original".to_string(),
        profile: None,
        height: None,
        video_bitrate_bps: None,
    })
    .chain(
        streamarr_transcode::TranscodeTargetProfile::supported()
            .into_iter()
            .map(|profile| PlaybackQualityOption {
                id: profile.name.clone(),
                label: format!("{}p", profile.height),
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

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateWatchProgressRequest {
    pub position_ms: u64,
    pub duration_ms: u64,
    #[serde(default)]
    pub completed: bool,
}

#[utoipa::path(
    get,
    path = "/api/v1/playback/progress",
    tag = "playback",
    responses(
        (status = 200, description = "Durable progress rows for the signed-in viewer, restricted to this account's allowed libraries", body = [WatchProgress]),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller does not have Playarr streaming access")
    )
)]
pub async fn list_watch_progress_handler(
    State(state): State<AppState>,
    streaming: StreamingUser,
) -> Result<Json<Vec<WatchProgress>>, ApiError> {
    let allowed = streaming.allowed_libraries();
    let all_progress = state
        .watch_progress
        .list_for_user(streaming.user_id)
        .await?;

    // Unrestricted (`None`) is the common case and needs no per-row
    // `MediaFile` resolution at all. A restricted caller's "continue
    // watching"/history list must not surface rows for media outside their
    // current `Policy::library_allow` -- e.g. after an admin narrows a
    // grant, a stale progress row for now-inaccessible content shouldn't
    // keep confirming it exists. A row whose `MediaFile` no longer resolves
    // at all is dropped for a restricted caller too (fail closed -- there's
    // nothing left to check its library against), same as every other gate
    // in this module.
    let Some(allowed) = allowed else {
        return Ok(Json(all_progress));
    };
    let mut visible = Vec::with_capacity(all_progress.len());
    for progress in all_progress {
        if let Some(media_file) = state.media_files.get(progress.media_file_id).await {
            if ensure_library_allowed(media_file.source_instance_id, Some(&allowed)).is_ok() {
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
        (status = 200, description = "Viewer progress, including a synthetic unseen state when no row exists", body = WatchProgress),
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
    ensure_library_allowed(
        media_file.source_instance_id,
        streaming.allowed_libraries().as_deref(),
    )?;
    let progress = state
        .watch_progress
        .get(streaming.user_id, media_file_id)
        .await?
        .unwrap_or(WatchProgress {
            media_file_id,
            work_id: media_file.work_id,
            position_ms: 0,
            duration_ms: 0,
            state: streamarr_model::WatchState::Unseen,
            updated_at: None,
        });
    Ok(Json(progress))
}

#[utoipa::path(
    put,
    path = "/api/v1/playback/{media_file_id}/progress",
    tag = "playback",
    params(("media_file_id" = Uuid, Path, description = "MediaFile id")),
    request_body = UpdateWatchProgressRequest,
    responses(
        (status = 200, description = "Persisted viewer progress", body = WatchProgress),
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
    ensure_library_allowed(
        media_file.source_instance_id,
        streaming.allowed_libraries().as_deref(),
    )?;
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
        state: streamarr_model::WatchProgress::state_for(
            position_ms,
            body.duration_ms,
            body.completed,
        ),
        updated_at: Some(chrono::Utc::now()),
    };
    state
        .watch_progress
        .upsert(streaming.user_id, &progress)
        .await?;
    Ok(Json(progress))
}

/// Compares `media_file` against `capabilities` the same three ways
/// `TranscodeOrchestrator::can_direct_play` does (container/video-codec/
/// bitrate), but reports *which* check failed instead of collapsing to a
/// bare `bool` -- `can_direct_play` itself has no room in its signature for
/// this, and extending it would risk touching shared transcode logic
/// another in-flight effort might also be near, so this stays local to
/// `streamarr-api` and is only ever called once `can_direct_play` has
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
        .any(|c| c.eq_ignore_ascii_case(&media_file.codec));
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
/// `ApiError` -- this matches `streamarr_db::analytics`'s own stated
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
        (status = 200, description = "Direct-play URL or HLS manifest URL, plus the new PlaybackSession id", body = PlaybackInfoResponse),
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
    ensure_library_allowed(
        media_file.source_instance_id,
        streaming.allowed_libraries().as_deref(),
    )?;
    // Sonarr/Radarr may report a path from a remote host. Probe the same
    // locally-resolved source path that direct serving and transcoding use.
    let resolved_media_path = streamarr_model::resolve_media_path(&media_file.path);
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
    let persisted_preferences = if query.ignore_saved_preferences {
        None
    } else {
        state
            .user_repo
            .get_media_playback_preferences(streaming.user_id, media_file_id)
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
            .find_by_id(streaming.user_id)
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
    let selected_audio_track_id =
        selected_audio_stream_index.map(|stream_index| format!("source-audio-{stream_index}"));
    let source_subtitle_tracks = match crate::media::probe_media_subtitle_tracks(
        &resolved_media_path,
    )
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

    let capabilities: ClientCapabilities = (&query).into();
    let persisted_quality_id = persisted_preferences
        .as_ref()
        .map(|preferences| preferences.quality_id.as_str())
        .filter(|id| {
            playback_quality_options()
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

    // Clients already send these on every request -- see
    // `crate::version_gate`'s own doc comment -- so deriving session
    // metadata from them is zero extra client work.
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

    let seed = SessionSeed {
        user_id: streaming.user_id,
        // Already present on every access token -- see
        // `AccessTokenClaims::device_id`'s doc comment.
        device_id: streaming.claims.device_id,
        media_file_id,
        client_platform,
        client_version,
        ip_address: Some(remote_addr.ip().to_string()),
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
        let session_id = start_analytics_session(&state, session).await;
        state.transcode.expire_playback_session(session_id).await?;
        return Ok(Json(PlaybackInfoResponse {
            mode: PlaybackMode::Direct,
            url: format!("/api/v1/media/{media_file_id}/stream"),
            duration_ms,
            source_offset_ms: 0,
            audio_tracks,
            selected_audio_track_id,
            subtitle_tracks: playback_subtitle_options(media_file_id, 0, &source_subtitle_tracks),
            selected_subtitle_track_id,
            quality_options: playback_quality_options(),
            selected_quality_id,
            session_id,
        }));
    }

    // `streaming.policy` is the exact same `Policy` a second
    // `resolve_policy("transcode", ...)` round trip used to fetch here --
    // `StreamingUser` already resolved and carries it (see
    // `auth_extractor::StreamingUser`'s doc comment), so reading the field
    // directly is zero extra database work instead of one.
    if !streaming.policy.can_transcode {
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
        let session_id = start_analytics_session(&state, session).await;
        state.transcode.expire_playback_session(session_id).await?;
        return Ok(Json(PlaybackInfoResponse {
            mode: PlaybackMode::Hls,
            url: format!("/api/v1/media/renditions/{}/playlist.m3u8", rendition.id),
            duration_ms,
            source_offset_ms: 0,
            audio_tracks,
            selected_audio_track_id,
            subtitle_tracks: playback_subtitle_options(media_file_id, 0, &source_subtitle_tracks),
            selected_subtitle_track_id,
            quality_options: playback_quality_options(),
            selected_quality_id,
            session_id,
        }));
    }

    // Step 3, last resort: spawn a new on-demand transcode.
    let source_offset_ms = if duration_ms > 0 {
        query.start_position_ms.min(duration_ms.saturating_sub(1))
    } else {
        query.start_position_ms
    };
    let transcode_session = state
        .transcode
        .spawn_on_demand_transcode_at_with_audio(
            &media_file,
            &profile,
            &state.node_id,
            source_offset_ms,
            selected_audio_stream_index,
        )
        .await?;

    let target_profile = streamarr_transcode::TranscodeTargetProfile::resolve(&profile);
    let session = seed.into_session(
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
    );
    let session_id = start_analytics_session(&state, session).await;
    state
        .transcode
        .associate_playback_session(session_id, transcode_session.id)
        .await?;

    Ok(Json(PlaybackInfoResponse {
        mode: PlaybackMode::Hls,
        url: format!(
            "/api/v1/media/sessions/{}/playlist.m3u8",
            transcode_session.id
        ),
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
        quality_options: playback_quality_options(),
        selected_quality_id,
        session_id,
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/playback/sessions/{session_id}/events",
    tag = "playback",
    params(("session_id" = Uuid, Path, description = "PlaybackSession id, from PlaybackInfoResponse.session_id")),
    request_body = PlaybackEventKind,
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
    let session = state
        .session_registry
        .get(session_id)
        .ok_or_else(|| ApiError::not_found(format!("unknown or closed session {session_id}")))?;
    if session.user_id != streaming.user_id {
        return Err(forbidden("session does not belong to this account"));
    }

    // Server clock, never client-supplied -- avoids clock-skew abuse.
    let occurred_at = Utc::now();
    let event = PlaybackEvent {
        id: Uuid::new_v4(),
        session_id,
        occurred_at,
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
        PlaybackEventKind::Error { .. } => Some(streamarr_model::StopReason::Error),
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

    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        bearer_header, mint_access_token, seed_movie, seed_streaming_user,
        seed_streaming_user_with_library_allow, test_state,
    };
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use std::path::PathBuf;
    use streamarr_model::media::LeafRef;
    use tower::ServiceExt;

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
        assert_eq!(
            info.quality_options
                .iter()
                .filter_map(|quality| quality.height)
                .collect::<Vec<_>>(),
            vec![1080, 720, 480]
        );
        assert_ne!(info.session_id, Uuid::nil());

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
        use streamarr_model::{ProducedBy, Rendition, RenditionStatus};

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
            .list_sessions(&streamarr_db::analytics::SessionFilter {
                user_id: Some(user_id),
                from: None,
                to: None,
                limit: 10,
                offset: 0,
            })
            .await
            .unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].bytes_streamed, 5000);
        assert_eq!(
            history[0].stop_reason,
            Some(streamarr_model::StopReason::UserStopped)
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
        assert_eq!(saved.state, streamarr_model::WatchState::PartWatched);

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
        assert_eq!(completed.state, streamarr_model::WatchState::Watched);

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
        assert_eq!(unseen.state, streamarr_model::WatchState::Unseen);
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
                        state: streamarr_model::WatchState::PartWatched,
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
    /// piece of this fix with no coverage anywhere else: `streamarr-db`'s
    /// own tests prove `MediaFileRepo::get_by_id` works, and the handler
    /// tests above only ever exercise `InMemoryMediaFileLookup`. This
    /// proves the two are actually wired together correctly end-to-end
    /// against a real (in-memory) database, not just that each half
    /// compiles.
    #[tokio::test]
    async fn repo_backed_lookup_resolves_a_persisted_media_file() {
        use streamarr_db::repo::SqlxMediaFileRepo;
        use streamarr_db::{run_migrations, MediaFileRepo};

        // Not `streamarr_db::connect` (a 10-connection pool): SQLite's
        // `:memory:` database is private *per connection*, so a pool with
        // more than one connection would run migrations against one
        // connection and this test's queries against another, empty,
        // unmigrated database. `streamarr-db`'s own tests hit the same
        // thing and fix it the same way (see its `test_sqlite_pool`
        // helper, `pub(crate)` there so unavailable here).
        sqlx::any::install_default_drivers();
        let pool = sqlx::any::AnyPoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool, false).await.unwrap();

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
}
