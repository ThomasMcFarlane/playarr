//! Media-file delivery and source-container metadata:
//!
//! - [`stream_media_handler`] -- `GET /api/v1/media/{media_file_id}/stream`,
//!   direct-play: the raw [`playarr_model::MediaFile::path`] byte-for-byte.
//! - [`serve_rendition_file_handler`] -- `GET
//!   /api/v1/media/renditions/{rendition_id}/{file_name}`, a durable Tdarr/
//!   on-demand [`playarr_model::Rendition`]'s `playlist.m3u8`/segments.
//! - [`serve_session_file_handler`] -- `GET
//!   /api/v1/media/sessions/{session_id}/{file_name}`, a live on-demand
//!   [`playarr_transcode::TranscodeSession`]'s `playlist.m3u8`/segments,
//!   which may not exist on disk yet (the ffmpeg process writes an `event`
//!   playlist -- see `build_ffmpeg_hls_args` -- so the request briefly waits
//!   for ffmpeg's first write before falling back to a 404).
//! - [`media_chapters_handler`] -- `GET
//!   /api/v1/media/{media_file_id}/chapters`, real chapter metadata read
//!   from the source container with ffprobe.
//! - [`media_metadata_handler`] -- `GET
//!   /api/v1/media/{media_file_id}/metadata`, fixed runtime from persisted
//!   source metadata with a one-file ffprobe fallback for older rows.
//! - [`media_thumbnail_handler`] -- `GET
//!   /api/v1/media/{media_file_id}/thumbnail`, a lazily-generated episode
//!   still cached on this node after the first ffmpeg extraction.
//!
//! All three drive `tower_http::services::ServeFile` directly as a
//! `tower::Service` via `oneshot`, so `Range`/`If-*` byte-range handling
//! (206 Partial Content, seek support) and `Content-Type` sniffing come
//! from tower-http rather than being hand-rolled here.
//!
//! Direct media delivery is gated by
//! [`crate::auth_extractor::StreamingUser`], same as
//! `playback::playback_info_handler` -- a caller who can negotiate a
//! playback URL is exactly the caller who should be able to fetch it. HLS
//! rendition/session files, and [`media_subtitle_handler`], additionally
//! accept the narrowly-scoped `playarr_playback_session` cookie Samsung
//! AVPlay can attach to its native requests, or the equivalent
//! `playback_session_id` [`HlsCapabilityQuery`] fallback for callers --
//! like the Cast receiver's synchronous `PlaybackConfig` request handlers
//! -- that can attach a query param but not a cookie: either one must name
//! a currently-active playback session for the exact underlying media
//! file.
//!
//! Every handler that resolves a [`playarr_model::MediaFile`] (directly,
//! or indirectly via a [`playarr_model::Rendition`]/
//! `playarr_transcode::TranscodeSession`'s own `media_file_id`) checks its
//! `source_instance_id` against [`StreamingUser::allowed_libraries`]
//! immediately afterwards, same per-user library access control enforcement
//! `playback.rs` applies -- see that module's doc comment and
//! `playarr_model::Policy::library_allow`'s. This is the actual content-
//! delivery path, so it's just as security-critical there as it is here.

use std::path::Path as FsPath;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use axum::extract::{Path, Query, Request, State};
use axum::response::{IntoResponse, Response};
use axum::Json;
use dashmap::DashMap;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::process::Command;
use tokio::sync::Mutex;
use tower::ServiceExt;
use tower_http::services::ServeFile;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth_extractor::{ensure_can_download, OptionalStreamingUser, StreamingUser};
use crate::error::ApiError;
use crate::peer_extractor::PeerSignedRequest;
use crate::playback::{
    playback_quality_options, playback_subtitle_options, source_bitrate_bps,
    PlaybackAudioTrackOption, PlaybackQualityOption, PlaybackSubtitleTrackOption,
};
use crate::AppState;

/// One real chapter embedded in a media container, as reported by ffprobe.
/// Untitled chapters remain untitled rather than receiving a fabricated
/// name; Playarr can display their real start time as the label.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct MediaChapter {
    pub index: u32,
    pub title: Option<String>,
    pub start_ms: u64,
    pub end_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct MediaMetadata {
    pub duration_ms: u64,
}

/// One quality `GET /api/v1/media/{media_file_id}/download-options` offers
/// -- the same `id`/`label`/`profile`/`height` shape
/// [`crate::playback::PlaybackQualityOption`] already exposes for playback,
/// plus a download-specific size estimate. `"original"` is always exact
/// (`size_is_estimate: false`, `estimated_size_bytes` is the real
/// `MediaFile::size_bytes`); every named transcode profile is a rough
/// `video_bitrate_bps * duration_ms / 8000` estimate (`size_is_estimate:
/// true`) since nothing has actually encoded it yet.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct DownloadQualityOption {
    pub id: String,
    pub label: String,
    pub profile: Option<String>,
    pub height: Option<u16>,
    pub estimated_size_bytes: Option<u64>,
    pub size_is_estimate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct DownloadOptionsResponse {
    pub media_file_id: Uuid,
    pub container: String,
    pub options: Vec<DownloadQualityOption>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct MediaPlaybackPreferenceResponse {
    pub quality_id: String,
    pub audio_track_id: Option<String>,
    pub subtitle_track_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct MediaPlaybackOptionsResponse {
    pub quality_options: Vec<PlaybackQualityOption>,
    pub audio_tracks: Vec<PlaybackAudioTrackOption>,
    pub subtitle_tracks: Vec<PlaybackSubtitleTrackOption>,
    pub preferences: MediaPlaybackPreferenceResponse,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct UpdateMediaPlaybackPreferencesRequest {
    pub quality_id: String,
    pub audio_track_id: Option<String>,
    pub subtitle_track_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FfprobeChapterList {
    #[serde(default)]
    chapters: Vec<FfprobeChapter>,
}

#[derive(Debug, Deserialize)]
struct FfprobeChapter {
    #[serde(default)]
    start_time: Option<String>,
    #[serde(default)]
    end_time: Option<String>,
    #[serde(default)]
    tags: FfprobeChapterTags,
}

#[derive(Debug, Default, Deserialize)]
struct FfprobeChapterTags {
    #[serde(default)]
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FfprobeDurationOutput {
    #[serde(default)]
    format: Option<FfprobeDuration>,
    #[serde(default)]
    streams: Vec<FfprobeDuration>,
}

#[derive(Debug, Deserialize)]
struct FfprobeDuration {
    #[serde(default)]
    duration: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FfprobeStreamList {
    #[serde(default)]
    streams: Vec<FfprobeMediaStream>,
}

#[derive(Debug, Deserialize)]
struct FfprobeMediaStream {
    index: u32,
    codec_type: String,
    #[serde(default)]
    codec_name: Option<String>,
    #[serde(default)]
    channels: Option<u32>,
    #[serde(default)]
    profile: Option<String>,
    #[serde(default)]
    tags: FfprobeStreamTags,
    #[serde(default)]
    disposition: FfprobeStreamDisposition,
}

#[derive(Debug, Default, Deserialize)]
struct FfprobeStreamTags {
    #[serde(default)]
    language: Option<String>,
    #[serde(default)]
    title: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct FfprobeStreamDisposition {
    #[serde(default)]
    default: u8,
    #[serde(default)]
    forced: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SourceAudioTrack {
    pub stream_index: u32,
    pub label: String,
    pub language: Option<String>,
    pub codec: Option<String>,
    pub channels: Option<u32>,
    /// Raw ffprobe `profile` (e.g. `DTS-HD MA`, `Dolby TrueHD + Dolby Atmos`).
    pub profile: Option<String>,
    /// Human-friendly codec name refined by `profile` (e.g. `DTS-HD MA`,
    /// `TrueHD Atmos`); `None` when the codec is unknown.
    pub codec_label: Option<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SourceSubtitleTrack {
    pub stream_index: u32,
    pub label: String,
    pub language: Option<String>,
    pub codec: String,
    pub is_default: bool,
    pub forced: bool,
    /// Set for external `<video>.<lang>.srt/.ass/.vtt` sidecars; `None` for
    /// streams embedded in the container.
    pub sidecar_path: Option<std::path::PathBuf>,
}

/// Refines a bare ffprobe codec name with its `profile` so clients can say
/// "DTS-HD MA" or "TrueHD Atmos" instead of just "DTS" / "TrueHD".
pub(crate) fn audio_codec_label(codec: Option<&str>, profile: Option<&str>) -> Option<String> {
    let codec = codec?.to_ascii_lowercase();
    let profile_lc = profile.unwrap_or("").to_ascii_lowercase();
    let atmos = profile_lc.contains("atmos");
    let label = match codec.as_str() {
        "dts" => {
            if profile_lc.contains("dts:x") || profile_lc.contains("dts-x") {
                "DTS:X"
            } else if profile_lc.contains("ma") && profile_lc.contains("hd") {
                "DTS-HD MA"
            } else if profile_lc.contains("hra") || profile_lc.contains("high resolution") {
                "DTS-HD HRA"
            } else if profile_lc.contains("es") {
                "DTS-ES"
            } else if profile_lc.contains("96") {
                "DTS 96/24"
            } else {
                "DTS"
            }
        }
        "truehd" => {
            if atmos {
                "TrueHD Atmos"
            } else {
                "TrueHD"
            }
        }
        "eac3" => {
            if atmos {
                "Dolby Digital Plus Atmos"
            } else {
                "Dolby Digital Plus"
            }
        }
        "ac3" => "Dolby Digital",
        "aac" => "AAC",
        "flac" => "FLAC",
        "opus" => "Opus",
        "mp3" => "MP3",
        "vorbis" => "Vorbis",
        "alac" => "ALAC",
        other if other.starts_with("pcm_") => "PCM",
        _ => return None,
    };
    Some(label.to_string())
}

fn channel_layout(channels: u32) -> Option<&'static str> {
    Some(match channels {
        1 => "1.0",
        2 => "2.0",
        3 => "2.1",
        6 => "5.1",
        7 => "6.1",
        8 => "7.1",
        _ => return None,
    })
}

fn is_webvtt_compatible_subtitle_codec(codec: &str) -> bool {
    matches!(
        codec,
        "ass" | "ssa" | "mov_text" | "subrip" | "srt" | "text" | "webvtt"
    )
}

fn seconds_string_to_ms(raw: &str) -> Option<u64> {
    let seconds = raw.parse::<f64>().ok()?;
    if !seconds.is_finite() || seconds < 0.0 {
        return None;
    }
    Some((seconds * 1000.0).round() as u64)
}

fn parse_ffprobe_chapters(stdout: &[u8]) -> Result<Vec<MediaChapter>, ApiError> {
    let parsed: FfprobeChapterList = serde_json::from_slice(stdout)
        .map_err(|error| ApiError::internal(format!("invalid ffprobe chapter output: {error}")))?;

    Ok(parsed
        .chapters
        .into_iter()
        .filter_map(|chapter| {
            let start_ms = seconds_string_to_ms(chapter.start_time.as_deref()?)?;
            let end_ms = chapter
                .end_time
                .as_deref()
                .and_then(seconds_string_to_ms)
                .filter(|end_ms| *end_ms > start_ms);
            let title = chapter
                .tags
                .title
                .map(|title| title.trim().to_string())
                .filter(|title| !title.is_empty());
            Some((title, start_ms, end_ms))
        })
        .enumerate()
        .map(|(index, (title, start_ms, end_ms))| MediaChapter {
            index: index as u32,
            title,
            start_ms,
            end_ms,
        })
        .collect())
}

fn parse_ffprobe_duration_ms(stdout: &[u8]) -> Result<u64, ApiError> {
    let parsed: FfprobeDurationOutput = serde_json::from_slice(stdout)
        .map_err(|error| ApiError::internal(format!("invalid ffprobe duration output: {error}")))?;

    let format_duration_ms = parsed.format.and_then(|entry| {
        entry
            .duration
            .as_deref()
            .and_then(seconds_string_to_ms)
            .filter(|duration_ms| *duration_ms > 0)
    });
    if let Some(duration_ms) = format_duration_ms {
        return Ok(duration_ms);
    }

    parsed
        .streams
        .into_iter()
        .filter_map(|entry| {
            entry
                .duration
                .as_deref()
                .and_then(seconds_string_to_ms)
                .filter(|duration_ms| *duration_ms > 0)
        })
        .max()
        .ok_or_else(|| ApiError::internal("ffprobe did not report a positive source duration"))
}

/// Reads the fixed runtime from the source container itself. Live/event HLS
/// manifests grow while ffmpeg is encoding, so their current seekable edge
/// must never be presented to the player as the title's total duration.
pub(crate) async fn probe_media_duration_ms(path: &FsPath) -> Result<u64, ApiError> {
    let binary = std::env::var("PLAYARR_FFPROBE_BINARY").unwrap_or_else(|_| "ffprobe".to_string());
    let output = tokio::time::timeout(
        Duration::from_secs(5),
        Command::new(&binary)
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=duration",
                "-of",
                "json",
                "-i",
            ])
            .arg(path)
            .output(),
    )
    .await
    .map_err(|_| ApiError::internal("ffprobe duration scan timed out"))?
    .map_err(|error| ApiError::internal(format!("could not start {binary}: {error}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ApiError::internal(format!(
            "ffprobe duration scan failed: {}",
            stderr.trim()
        )));
    }

    parse_ffprobe_duration_ms(&output.stdout)
}

fn parse_ffprobe_audio_tracks(stdout: &[u8]) -> Result<Vec<SourceAudioTrack>, ApiError> {
    let parsed: FfprobeStreamList = serde_json::from_slice(stdout)
        .map_err(|error| ApiError::internal(format!("invalid ffprobe stream output: {error}")))?;

    Ok(parsed
        .streams
        .into_iter()
        .filter(|stream| stream.codec_type == "audio")
        .enumerate()
        .map(|(position, stream)| {
            let language = stream
                .tags
                .language
                .as_deref()
                .map(|language| language.trim().to_string())
                .filter(|language| !language.is_empty() && language != "und");
            let label = stream
                .tags
                .title
                .as_deref()
                .map(|title| title.trim().to_string())
                .filter(|title| !title.is_empty())
                .or_else(|| {
                    // No embedded title: describe the track by language plus
                    // the profile-refined codec and channel layout.
                    let codec_label =
                        audio_codec_label(stream.codec_name.as_deref(), stream.profile.as_deref());
                    let layout = stream.channels.and_then(channel_layout);
                    let detail = match (codec_label.as_deref(), layout) {
                        (Some(codec), Some(layout)) => Some(format!("{codec} {layout}")),
                        (Some(codec), None) => Some(codec.to_string()),
                        (None, _) => None,
                    };
                    match (language.as_deref(), detail) {
                        (Some(lang), Some(detail)) => Some(format!("{lang} \u{b7} {detail}")),
                        (Some(lang), None) => Some(lang.to_string()),
                        (None, Some(detail)) => Some(detail),
                        (None, None) => None,
                    }
                })
                .unwrap_or_else(|| format!("Audio {}", position + 1));
            SourceAudioTrack {
                stream_index: stream.index,
                label,
                language,
                codec_label: audio_codec_label(
                    stream.codec_name.as_deref(),
                    stream.profile.as_deref(),
                ),
                profile: stream.profile.clone(),
                codec: stream.codec_name,
                channels: stream.channels,
                is_default: stream.disposition.default == 1,
            }
        })
        .collect())
}

pub(crate) async fn probe_media_audio_tracks(
    path: &FsPath,
) -> Result<Vec<SourceAudioTrack>, ApiError> {
    let binary = std::env::var("PLAYARR_FFPROBE_BINARY").unwrap_or_else(|_| "ffprobe".to_string());
    let output = tokio::time::timeout(
        Duration::from_secs(5),
        Command::new(&binary)
            .args([
                "-v",
                "error",
                "-select_streams",
                "a",
                "-show_entries",
                "stream=index,codec_type,codec_name,profile,channels:stream_tags=language,title:stream_disposition=default",
                "-of",
                "json",
                "-i",
            ])
            .arg(path)
            .output(),
    )
    .await
    .map_err(|_| ApiError::internal("ffprobe audio stream scan timed out"))?
    .map_err(|error| ApiError::internal(format!("could not start {binary}: {error}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ApiError::internal(format!(
            "ffprobe audio stream scan failed: {}",
            stderr.trim()
        )));
    }

    parse_ffprobe_audio_tracks(&output.stdout)
}

fn parse_ffprobe_subtitle_tracks(stdout: &[u8]) -> Result<Vec<SourceSubtitleTrack>, ApiError> {
    let parsed: FfprobeStreamList = serde_json::from_slice(stdout)
        .map_err(|error| ApiError::internal(format!("invalid ffprobe stream output: {error}")))?;

    Ok(parsed
        .streams
        .into_iter()
        .filter(|stream| stream.codec_type == "subtitle")
        .filter_map(|stream| {
            let codec = stream.codec_name?;
            if !is_webvtt_compatible_subtitle_codec(&codec) {
                return None;
            }
            let language = stream
                .tags
                .language
                .as_deref()
                .map(str::trim)
                .filter(|language| !language.is_empty() && *language != "und")
                .map(str::to_string);
            let label = stream
                .tags
                .title
                .as_deref()
                .map(str::trim)
                .filter(|title| !title.is_empty())
                .map(str::to_string)
                .or_else(|| language.clone())
                .unwrap_or_else(|| format!("Subtitles {}", stream.index));
            Some(SourceSubtitleTrack {
                stream_index: stream.index,
                label,
                language,
                codec,
                is_default: stream.disposition.default == 1,
                forced: stream.disposition.forced == 1,
                sidecar_path: None,
            })
        })
        .collect())
}

pub(crate) async fn probe_media_subtitle_tracks(
    path: &FsPath,
) -> Result<Vec<SourceSubtitleTrack>, ApiError> {
    let binary = std::env::var("PLAYARR_FFPROBE_BINARY").unwrap_or_else(|_| "ffprobe".to_string());
    let output = tokio::time::timeout(
        Duration::from_secs(5),
        Command::new(&binary)
            .args([
                "-v",
                "error",
                "-select_streams",
                "s",
                "-show_entries",
                "stream=index,codec_type,codec_name:stream_tags=language,title:stream_disposition=default,forced",
                "-of",
                "json",
                "-i",
            ])
            .arg(path)
            .output(),
    )
    .await
    .map_err(|_| ApiError::internal("ffprobe subtitle stream scan timed out"))?
    .map_err(|error| ApiError::internal(format!("could not start {binary}: {error}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ApiError::internal(format!(
            "ffprobe subtitle stream scan failed: {}",
            stderr.trim()
        )));
    }

    parse_ffprobe_subtitle_tracks(&output.stdout)
}

/// Embedded text subtitle streams plus `<video>.<lang>[.forced|.sdh].srt/
/// .ass/.vtt` sidecars next to the file. A failed embedded probe still
/// returns the sidecars.
pub(crate) async fn probe_all_subtitle_tracks(
    path: &FsPath,
) -> Result<Vec<SourceSubtitleTrack>, ApiError> {
    let sidecars = crate::sidecar_subtitles::discover_sidecar_subtitles(path).await;
    let mut tracks = match probe_media_subtitle_tracks(path).await {
        Ok(tracks) => tracks,
        Err(error) if !sidecars.is_empty() => {
            tracing::warn!(path = %path.display(), error = ?error, "embedded subtitle probe failed; serving sidecars only");
            Vec::new()
        }
        Err(error) => return Err(error),
    };
    tracks.extend(sidecars);
    Ok(tracks)
}

async fn probe_media_chapters(path: &FsPath) -> Result<Vec<MediaChapter>, ApiError> {
    let binary = std::env::var("PLAYARR_FFPROBE_BINARY").unwrap_or_else(|_| "ffprobe".to_string());
    let output = tokio::time::timeout(
        Duration::from_secs(15),
        Command::new(&binary)
            .args(["-v", "error", "-show_chapters", "-of", "json", "-i"])
            .arg(path)
            .output(),
    )
    .await
    .map_err(|_| ApiError::internal("ffprobe chapter scan timed out"))?
    .map_err(|error| ApiError::internal(format!("could not start {binary}: {error}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ApiError::internal(format!(
            "ffprobe chapter scan failed: {}",
            stderr.trim()
        )));
    }

    parse_ffprobe_chapters(&output.stdout)
}

#[derive(Debug, Default, Deserialize, utoipa::IntoParams)]
pub struct MediaThumbnailQuery {
    /// Absolute source timestamp for the extracted frame. Omitted keeps the
    /// established 30-second episode-thumbnail default.
    pub position_ms: Option<u64>,
}

fn thumbnail_position_ms(requested: Option<u64>) -> u64 {
    requested.unwrap_or(30_000)
}

fn thumbnail_cache_file_name(media_file_id: Uuid, position_ms: u64) -> String {
    if position_ms == 30_000 {
        format!("{media_file_id}.jpg")
    } else {
        format!("{media_file_id}-{position_ms}.jpg")
    }
}

fn thumbnail_cache_path(media_file_id: Uuid, position_ms: u64) -> std::path::PathBuf {
    let file_name = thumbnail_cache_file_name(media_file_id, position_ms);
    if let Some(root) = std::env::var_os("PLAYARR_ARTWORK_CACHE_DIR") {
        return std::path::PathBuf::from(root)
            .join("episode-thumbnails")
            .join(file_name);
    }
    // Keep the earlier, thumbnail-specific override working for operators
    // who already set it. Unlike the new shared artwork root, this legacy
    // value already denotes the thumbnail directory itself.
    if let Some(root) = std::env::var_os("PLAYARR_THUMBNAIL_CACHE_DIR") {
        return std::path::PathBuf::from(root).join(file_name);
    }

    let persistent_root = std::env::var("DATABASE_URL")
        .ok()
        .and_then(|database_url| sqlite_database_parent(&database_url))
        .unwrap_or_else(|| {
            std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
        });
    persistent_root
        .join("artwork-cache")
        .join("episode-thumbnails")
        .join(file_name)
}

fn sqlite_database_parent(database_url: &str) -> Option<std::path::PathBuf> {
    let raw_path = database_url
        .strip_prefix("sqlite://")
        .or_else(|| database_url.strip_prefix("sqlite:"))?
        .split('?')
        .next()?;
    if raw_path.is_empty() || raw_path == ":memory:" {
        return None;
    }
    let path = std::path::PathBuf::from(raw_path);
    match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => Some(parent.to_path_buf()),
        _ => std::env::current_dir().ok(),
    }
}

#[derive(Debug, Default, Deserialize, utoipa::IntoParams)]
pub struct MediaSubtitleQuery {
    /// Absolute source timestamp represented by zero in the current media
    /// timeline. On-demand HLS sessions use this to keep sidecar cues aligned.
    #[serde(default)]
    pub source_offset_ms: u64,
}

fn subtitle_cache_path(
    media_file_id: Uuid,
    stream_index: u32,
    source_offset_ms: u64,
) -> std::path::PathBuf {
    let file_name = format!("{media_file_id}-{stream_index}-{source_offset_ms}.vtt");
    if let Some(root) = std::env::var_os("PLAYARR_SUBTITLE_CACHE_DIR") {
        return std::path::PathBuf::from(root).join(file_name);
    }

    let persistent_root = std::env::var("DATABASE_URL")
        .ok()
        .and_then(|database_url| sqlite_database_parent(&database_url))
        .unwrap_or_else(|| {
            std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
        });
    persistent_root.join("subtitle-cache").join(file_name)
}

fn subtitle_generation_locks() -> &'static DashMap<std::path::PathBuf, Arc<Mutex<()>>> {
    static LOCKS: OnceLock<DashMap<std::path::PathBuf, Arc<Mutex<()>>>> = OnceLock::new();
    LOCKS.get_or_init(DashMap::new)
}

async fn is_nonempty_file(path: &FsPath) -> bool {
    tokio::fs::metadata(path)
        .await
        .map(|metadata| metadata.is_file() && metadata.len() > 0)
        .unwrap_or(false)
}

async fn ensure_media_subtitle(
    media_file_id: Uuid,
    source_path: &FsPath,
    stream_index: u32,
    source_offset_ms: u64,
) -> Result<std::path::PathBuf, ApiError> {
    let output_path = subtitle_cache_path(media_file_id, stream_index, source_offset_ms);
    let base_path = subtitle_cache_path(media_file_id, stream_index, 0);
    let binary = std::env::var("PLAYARR_FFMPEG_BINARY").unwrap_or_else(|_| "ffmpeg".to_string());
    ensure_media_subtitle_at(
        media_file_id,
        source_path,
        stream_index,
        source_offset_ms,
        base_path,
        output_path,
        &binary,
    )
    .await
}

async fn ensure_media_subtitle_at(
    media_file_id: Uuid,
    source_path: &FsPath,
    stream_index: u32,
    source_offset_ms: u64,
    base_path: std::path::PathBuf,
    output_path: std::path::PathBuf,
    binary: &str,
) -> Result<std::path::PathBuf, ApiError> {
    if is_nonempty_file(&output_path).await {
        return Ok(output_path);
    }

    ensure_base_media_subtitle(
        media_file_id,
        source_path,
        stream_index,
        base_path.clone(),
        binary,
    )
    .await?;
    if source_offset_ms == 0 {
        return Ok(base_path);
    }

    let lock = subtitle_generation_locks()
        .entry(output_path.clone())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone();
    let _guard = lock.lock().await;
    if is_nonempty_file(&output_path).await {
        return Ok(output_path);
    }

    let base_vtt = tokio::fs::read_to_string(&base_path)
        .await
        .map_err(|error| ApiError::internal(format!("could not read cached subtitle: {error}")))?;
    let shifted_vtt = shift_webvtt(&base_vtt, source_offset_ms)?;
    atomic_write_subtitle(&output_path, shifted_vtt.as_bytes()).await?;
    Ok(output_path)
}

async fn ensure_base_media_subtitle(
    media_file_id: Uuid,
    source_path: &FsPath,
    stream_index: u32,
    output_path: std::path::PathBuf,
    binary: &str,
) -> Result<std::path::PathBuf, ApiError> {
    if is_nonempty_file(&output_path).await {
        return Ok(output_path);
    }
    let lock = subtitle_generation_locks()
        .entry(output_path.clone())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone();
    let _guard = lock.lock().await;
    if is_nonempty_file(&output_path).await {
        return Ok(output_path);
    }

    let parent = output_path
        .parent()
        .ok_or_else(|| ApiError::internal("subtitle cache path has no parent directory"))?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|error| ApiError::internal(format!("could not create subtitle cache: {error}")))?;

    let temp_path = parent.join(format!(
        "{media_file_id}-{stream_index}-base-{}.tmp.vtt",
        Uuid::new_v4()
    ));
    let mut command = Command::new(binary);
    command.args(["-hide_banner", "-loglevel", "error", "-y"]);
    command.kill_on_drop(true);
    let output = tokio::time::timeout(
        Duration::from_secs(120),
        {
            if crate::sidecar_subtitles::is_sidecar_subtitle_file(source_path) {
                // External text sidecar: a single subtitle stream; ffmpeg
                // converts srt/ass/ssa/vtt straight to WebVTT.
                command
                    .arg("-i")
                    .arg(source_path)
                    .args(["-map", "0:0", "-c:s", "webvtt", "-f", "webvtt"])
            } else {
                command
                    // Tell the Matroska demuxer it may discard every video/audio
                    // packet immediately. On remote mounts this lets it skip past
                    // large non-subtitle payloads instead of pulling the whole
                    // media file through SSHFS just to reach the text packets.
                    .args(["-discard:v", "all", "-discard:a", "all"])
                    .arg("-i")
                    .arg(source_path)
                    .args([
                        "-map",
                        &format!("0:{stream_index}"),
                        "-c:s",
                        "webvtt",
                        "-f",
                        "webvtt",
                    ])
            }
        }
        .arg(&temp_path)
        .output(),
    )
    .await;
    let output = match output {
        Ok(output) => output,
        Err(_) => {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(ApiError::internal(
                "subtitle conversion timed out after 120 seconds",
            ));
        }
    }
    .map_err(|error| ApiError::internal(format!("could not start {binary}: {error}")))?;

    if !output.status.success() {
        let _ = tokio::fs::remove_file(&temp_path).await;
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ApiError::internal(format!(
            "subtitle conversion failed: {}",
            stderr.trim()
        )));
    }

    match tokio::fs::rename(&temp_path, &output_path).await {
        Ok(()) => {}
        Err(_error) if tokio::fs::try_exists(&output_path).await.unwrap_or(false) => {
            let _ = tokio::fs::remove_file(&temp_path).await;
        }
        Err(error) => {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(ApiError::internal(format!(
                "could not commit generated subtitle: {error}"
            )));
        }
    }

    Ok(output_path)
}

async fn atomic_write_subtitle(path: &FsPath, contents: &[u8]) -> Result<(), ApiError> {
    let parent = path
        .parent()
        .ok_or_else(|| ApiError::internal("subtitle cache path has no parent directory"))?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|error| ApiError::internal(format!("could not create subtitle cache: {error}")))?;
    let temp_path = parent.join(format!("{}.tmp.vtt", Uuid::new_v4()));
    if let Err(error) = tokio::fs::write(&temp_path, contents).await {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(ApiError::internal(format!(
            "could not write shifted subtitle: {error}"
        )));
    }
    match tokio::fs::rename(&temp_path, path).await {
        Ok(()) => Ok(()),
        Err(_) if is_nonempty_file(path).await => {
            let _ = tokio::fs::remove_file(&temp_path).await;
            Ok(())
        }
        Err(error) => {
            let _ = tokio::fs::remove_file(&temp_path).await;
            Err(ApiError::internal(format!(
                "could not commit shifted subtitle: {error}"
            )))
        }
    }
}

fn parse_webvtt_timestamp(raw: &str) -> Option<u64> {
    let parts = raw.split(':').collect::<Vec<_>>();
    let (hours, minutes, seconds) = match parts.as_slice() {
        [minutes, seconds] => (0_u64, minutes.parse::<u64>().ok()?, *seconds),
        [hours, minutes, seconds] => (
            hours.parse::<u64>().ok()?,
            minutes.parse::<u64>().ok()?,
            *seconds,
        ),
        _ => return None,
    };
    let (seconds, millis) = seconds.split_once('.')?;
    let seconds: u64 = seconds.parse().ok()?;
    let millis: u64 = match millis.len() {
        1 => millis.parse::<u64>().ok()? * 100,
        2 => millis.parse::<u64>().ok()? * 10,
        3 => millis.parse().ok()?,
        _ => return None,
    };
    Some((((hours * 60 + minutes) * 60 + seconds) * 1000) + millis)
}

fn format_webvtt_timestamp(timestamp_ms: u64) -> String {
    let hours = timestamp_ms / 3_600_000;
    let minutes = (timestamp_ms / 60_000) % 60;
    let seconds = (timestamp_ms / 1_000) % 60;
    let millis = timestamp_ms % 1_000;
    format!("{hours:02}:{minutes:02}:{seconds:02}.{millis:03}")
}

fn shift_webvtt(input: &str, source_offset_ms: u64) -> Result<String, ApiError> {
    let normalized = input.replace("\r\n", "\n").replace('\r', "\n");
    if !normalized.trim_start().starts_with("WEBVTT") {
        return Err(ApiError::internal(
            "cached subtitle is not a valid WebVTT document",
        ));
    }

    let mut output_blocks = Vec::new();
    for block in normalized.split("\n\n") {
        let mut lines = block.lines().collect::<Vec<_>>();
        let Some(timing_index) = lines.iter().position(|line| line.contains("-->")) else {
            if !block.trim().is_empty() {
                output_blocks.push(block.trim_end().to_string());
            }
            continue;
        };
        let timing = lines[timing_index];
        let Some((start_raw, end_and_settings)) = timing.split_once("-->") else {
            continue;
        };
        let mut end_parts = end_and_settings.trim().splitn(2, char::is_whitespace);
        let Some(end_raw) = end_parts.next() else {
            continue;
        };
        let settings = end_parts.next().unwrap_or("").trim();
        let Some(start_ms) = parse_webvtt_timestamp(start_raw.trim()) else {
            continue;
        };
        let Some(end_ms) = parse_webvtt_timestamp(end_raw) else {
            continue;
        };
        if end_ms <= source_offset_ms {
            continue;
        }
        let shifted_start = start_ms.saturating_sub(source_offset_ms);
        let shifted_end = end_ms.saturating_sub(source_offset_ms);
        lines[timing_index] = "";
        let shifted_timing = if settings.is_empty() {
            format!(
                "{} --> {}",
                format_webvtt_timestamp(shifted_start),
                format_webvtt_timestamp(shifted_end)
            )
        } else {
            format!(
                "{} --> {} {settings}",
                format_webvtt_timestamp(shifted_start),
                format_webvtt_timestamp(shifted_end)
            )
        };
        let mut shifted_block = Vec::with_capacity(lines.len());
        for (index, line) in lines.into_iter().enumerate() {
            if index == timing_index {
                shifted_block.push(shifted_timing.as_str());
            } else {
                shifted_block.push(line);
            }
        }
        output_blocks.push(shifted_block.join("\n"));
    }
    Ok(format!("{}\n", output_blocks.join("\n\n")))
}

/// Maximum simultaneous ffmpeg thumbnail extractions
/// (`PLAYARR_THUMBNAIL_CONCURRENCY`, default 2, minimum 1).
fn thumbnail_permits() -> &'static tokio::sync::Semaphore {
    static PERMITS: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
    PERMITS.get_or_init(|| {
        let limit = std::env::var("PLAYARR_THUMBNAIL_CONCURRENCY")
            .ok()
            .and_then(|value| value.trim().parse::<usize>().ok())
            .unwrap_or(2)
            .max(1);
        tokio::sync::Semaphore::new(limit)
    })
}

/// Error code for a media file that has nothing to extract a thumbnail from.
const THUMBNAIL_UNAVAILABLE: &str = "thumbnail_unavailable";

async fn ensure_media_thumbnail(
    media_file_id: Uuid,
    source_path: &FsPath,
    position_ms: u64,
) -> Result<std::path::PathBuf, ApiError> {
    let output_path = thumbnail_cache_path(media_file_id, position_ms);
    if tokio::fs::try_exists(&output_path).await.unwrap_or(false) {
        return Ok(output_path);
    }
    // Each ffmpeg frame grab of a UHD source holds ~0.5 GiB. A chapter rail
    // asks for a dozen frames at once, so bound the fan-out or the pod's
    // memory cgroup OOM-kills the whole server (observed on a production server: four
    // parallel grabs against a 2 GiB limit). Waiters re-check the cache in
    // `ensure_media_thumbnail_at` once admitted.
    let _permit = thumbnail_permits()
        .acquire()
        .await
        .map_err(|_| ApiError::internal("thumbnail limiter closed"))?;
    let binary = std::env::var("PLAYARR_FFMPEG_BINARY").unwrap_or_else(|_| "ffmpeg".to_string());
    ensure_media_thumbnail_at(
        media_file_id,
        source_path,
        output_path,
        &binary,
        position_ms,
    )
    .await
}

async fn ensure_media_thumbnail_at(
    media_file_id: Uuid,
    source_path: &FsPath,
    output_path: std::path::PathBuf,
    binary: &str,
    position_ms: u64,
) -> Result<std::path::PathBuf, ApiError> {
    if tokio::fs::try_exists(&output_path).await.unwrap_or(false) {
        return Ok(output_path);
    }

    match tokio::fs::metadata(source_path).await {
        Ok(metadata) if metadata.is_file() => {}
        Ok(_) => {
            tracing::warn!(
                media_file_id = %media_file_id,
                source_path = %source_path.display(),
                "thumbnail source exists but is not a regular file"
            );
            return Err(ApiError::new(
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                "media_source_unavailable",
                "the source media file is not reachable on this Playarr Server node",
            ));
        }
        Err(error) => {
            tracing::warn!(
                media_file_id = %media_file_id,
                source_path = %source_path.display(),
                error = %error,
                "thumbnail source is not readable on this node"
            );
            return Err(ApiError::new(
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                "media_source_unavailable",
                "the source media file is not reachable on this Playarr Server node",
            ));
        }
    }

    let parent = output_path
        .parent()
        .ok_or_else(|| ApiError::internal("thumbnail cache path has no parent directory"))?;
    tokio::fs::create_dir_all(parent).await.map_err(|error| {
        ApiError::internal(format!("could not create thumbnail cache: {error}"))
    })?;

    // Keep the `.jpg` suffix on the temporary file so ffmpeg can infer the
    // image muxer without relying on a shell or a hand-built pipe.
    let temp_path = parent.join(format!("{media_file_id}-{}.tmp.jpg", Uuid::new_v4()));
    let mut output = tokio::time::timeout(
        Duration::from_secs(30),
        Command::new(binary)
            .args(["-hide_banner", "-loglevel", "error", "-ss"])
            .arg(format!("{:.3}", position_ms as f64 / 1000.0))
            .arg("-i")
            .arg(source_path)
            .args([
                "-map",
                "0:v:0",
                "-frames:v",
                "1",
                "-vf",
                "scale=640:-2:force_original_aspect_ratio=decrease",
                "-q:v",
                "4",
                "-y",
            ])
            .arg(&temp_path)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| ApiError::internal("ffmpeg thumbnail extraction timed out"))?
    .map_err(|error| ApiError::internal(format!("could not start {binary}: {error}")))?;

    // Audio containers commonly expose cover art as an attached-picture
    // video stream. Seeking before the input can make ffmpeg exit
    // successfully without ever emitting that single static frame. Retry
    // without `-ss` when that exact success-with-no-output case occurs.
    if output.status.success() && !tokio::fs::try_exists(&temp_path).await.unwrap_or(false) {
        output = tokio::time::timeout(
            Duration::from_secs(30),
            Command::new(binary)
                .args(["-hide_banner", "-loglevel", "error", "-i"])
                .arg(source_path)
                .args([
                    "-map",
                    "0:v:0",
                    "-frames:v",
                    "1",
                    "-vf",
                    "scale=640:-2:force_original_aspect_ratio=decrease",
                    "-q:v",
                    "4",
                    "-y",
                ])
                .arg(&temp_path)
                .kill_on_drop(true)
                .output(),
        )
        .await
        .map_err(|_| ApiError::internal("ffmpeg cover-art extraction timed out"))?
        .map_err(|error| ApiError::internal(format!("could not start {binary}: {error}")))?;
    }

    if !output.status.success() || !tokio::fs::try_exists(&temp_path).await.unwrap_or(false) {
        let _ = tokio::fs::remove_file(&temp_path).await;
        let stderr = String::from_utf8_lossy(&output.stderr);
        // An audio file without embedded cover art (or any file with no video
        // stream) has nothing to extract. That is an expected miss, not a
        // server fault: clients fall back to their own placeholder.
        if stderr.contains("matches no streams") {
            return Err(ApiError::new(
                axum::http::StatusCode::NOT_FOUND,
                THUMBNAIL_UNAVAILABLE,
                format!(
                    "media file {media_file_id} has no video frame or cover art to use as a thumbnail"
                ),
            ));
        }
        return Err(ApiError::internal(format!(
            "ffmpeg thumbnail extraction failed: {}",
            stderr.trim()
        )));
    }

    match tokio::fs::rename(&temp_path, &output_path).await {
        Ok(()) => {}
        Err(_error) if tokio::fs::try_exists(&output_path).await.unwrap_or(false) => {
            // A concurrent request won the same cache fill. Its complete
            // file is authoritative; discard this request's temporary copy.
            let _ = tokio::fs::remove_file(&temp_path).await;
        }
        Err(error) => {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(ApiError::internal(format!(
                "could not commit generated thumbnail: {error}"
            )));
        }
    }

    Ok(output_path)
}

/// Rejects any `file_name` path segment that could escape the directory
/// it's about to be joined onto: a literal path separator (`/`; `\` too,
/// defensively, even though this server doesn't target Windows) or a `..`
/// component anywhere in the string. Deliberately a small pure function
/// (no I/O, no `AppState`) so it's unit-testable on its own and shared by
/// both [`serve_rendition_file_handler`] and [`serve_session_file_handler`]
/// rather than re-implemented per handler.
fn validate_segment_file_name(name: &str) -> Result<(), ApiError> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        Err(ApiError::bad_request(format!(
            "invalid file name: {name:?}"
        )))
    } else {
        Ok(())
    }
}

/// Drives a fresh [`ServeFile`] for `path` against the raw incoming
/// `request` as a `tower::Service`, via `oneshot`. `ServeFile`'s
/// `Service::Error` is `Infallible` in this tower-http version (it has no
/// error branch to map) -- a missing file, an unreadable file, or a real
/// `Range` request all resolve to a *response* (404/500/200/206
/// respectively) that `ServeDir` builds internally, never a `Service`
/// error. That response's body (`UnsyncBoxBody<Bytes, io::Error>`) is
/// re-wrapped into `axum::body::Body` so this can return a plain
/// `axum::response::Response`.
pub(crate) async fn serve_file(
    path: &std::path::Path,
    request: Request,
) -> Result<Response, ApiError> {
    let service = ServeFile::new(path);
    let response = match service.oneshot(request).await {
        Ok(response) => response,
        Err(infallible) => match infallible {},
    };
    Ok(response.map(axum::body::Body::new))
}

/// Counts only response-body chunks that Axum actually pulls from the file
/// stream. This keeps a playback session's byte total aligned with the
/// ranges delivered to the player instead of guessing from runtime or the
/// source file's full size.
fn track_streamed_bytes(
    response: Response,
    session_registry: Arc<dyn playarr_telemetry::analytics::SessionRegistry>,
    session_id: Uuid,
) -> Response {
    if !response.status().is_success() {
        return response;
    }

    let (parts, body) = response.into_parts();
    let stream = body.into_data_stream().map(move |result| {
        if let Ok(chunk) = &result {
            let chunk_len = chunk.len() as u64;
            session_registry.update(session_id, &|session| {
                session.bytes_streamed = session.bytes_streamed.saturating_add(chunk_len);
            });
        }
        result
    });
    Response::from_parts(parts, axum::body::Body::from_stream(stream))
}

const PLAYBACK_SESSION_COOKIE_NAME: &str = "playarr_playback_session";

fn hls_cookie_unauthorized() -> ApiError {
    ApiError::new(
        axum::http::StatusCode::UNAUTHORIZED,
        "unauthorized",
        "missing, invalid, or expired playback session cookie",
    )
}

/// Resolves Samsung AVPlay's HLS-only cookie capability, or the
/// [`HlsCapabilityQuery`] `playback_session_id` fallback for callers (like
/// the Cast receiver) that can't attach the cookie. A valid bearer remains
/// authoritative and bypasses both entirely, preserving the existing
/// bearer-token behavior (including its normal per-library authorization
/// below). Without a bearer, the resolved id -- cookie first, query second
/// -- must name a session that is still present in this node's active
/// registry.
fn hls_cookie_playback_session(
    state: &AppState,
    streaming: Option<&StreamingUser>,
    capability: &HlsCapabilityQuery,
    request: &Request,
) -> Result<Option<playarr_model::PlaybackSession>, ApiError> {
    if streaming.is_some() {
        return Ok(None);
    }

    let cookie_session_id = request
        .headers()
        .get_all(axum::http::header::COOKIE)
        .iter()
        .filter_map(|header| header.to_str().ok())
        .flat_map(|header| header.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find_map(|(name, value)| {
            (name.trim() == PLAYBACK_SESSION_COOKIE_NAME).then(|| value.trim())
        })
        .and_then(|value| value.parse::<Uuid>().ok());

    let session_id = cookie_session_id
        .or(capability.playback_session_id)
        .ok_or_else(hls_cookie_unauthorized)?;

    state
        .session_registry
        .get(session_id)
        .map(Some)
        .ok_or_else(hls_cookie_unauthorized)
}

/// Limits cookie callers to the exact media file recorded when their
/// active playback session was negotiated. Bearer callers continue into
/// the handlers' existing per-library checks unchanged. The cookie's
/// session id is returned so response bytes can refresh/account the
/// capability.
fn hls_tracking_session_id(
    streaming: Option<&StreamingUser>,
    cookie_session: Option<&playarr_model::PlaybackSession>,
    media_file_id: Uuid,
) -> Result<Option<Uuid>, ApiError> {
    if streaming.is_some() {
        return Ok(None);
    }

    let session = cookie_session.ok_or_else(hls_cookie_unauthorized)?;
    if session.media_file_id != media_file_id {
        return Err(hls_cookie_unauthorized());
    }

    Ok(Some(session.id))
}

/// Cold on-demand transcodes can take several seconds before ffmpeg writes
/// the first manifest/segment. Holding the already-authenticated request
/// briefly is both cheaper and more reliable than forcing every TV client
/// to burn through a stack of visible 404 retries.
async fn wait_for_live_hls_file(path: &std::path::Path) {
    const MAX_WAIT: Duration = Duration::from_secs(15);
    const POLL_INTERVAL: Duration = Duration::from_millis(100);

    let deadline = tokio::time::Instant::now() + MAX_WAIT;
    while tokio::fs::metadata(path).await.is_err() && tokio::time::Instant::now() < deadline {
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct DirectStreamQuery {
    playback_session_id: Option<Uuid>,
}

/// The same `playback_session_id` capability [`DirectStreamQuery`] gives
/// direct-play, widened to the HLS rendition/session/subtitle routes (see
/// [`hls_cookie_playback_session`]). Segment URIs inside a generated HLS
/// playlist are bare relative filenames the receiving player fetches on
/// its own -- a Cast Custom Web Receiver's `PlaybackConfig`
/// `segmentRequestHandler` can append a query param to those URIs
/// synchronously, but cannot attach the `playarr_playback_session`
/// cookie the way Samsung AVPlay's native player does. This gives that
/// caller an equivalent, cookie-free way to prove the same capability.
#[derive(Debug, Clone, Default, Deserialize, utoipa::IntoParams)]
pub struct HlsCapabilityQuery {
    pub playback_session_id: Option<Uuid>,
}

#[utoipa::path(
    get,
    path = "/api/v1/media/{media_file_id}/stream",
    tag = "playback",
    params(("media_file_id" = Uuid, Path, description = "MediaFile id")),
    responses(
        (status = 200, description = "Full file content (direct play)"),
        (status = 206, description = "Partial content for a `Range` request"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller does not have Playarr streaming access"),
        (status = 404, description = "Unknown media_file_id, or the file no longer exists on disk")
    )
)]
pub async fn stream_media_handler(
    State(state): State<AppState>,
    OptionalStreamingUser(streaming): OptionalStreamingUser,
    Path(media_file_id): Path<Uuid>,
    Query(query): Query<DirectStreamQuery>,
    request: Request,
) -> Result<Response, ApiError> {
    let media_file = state
        .media_files
        .get(media_file_id)
        .await
        .ok_or_else(|| ApiError::not_found(format!("unknown media file {media_file_id}")))?;

    let candidate_session = query
        .playback_session_id
        .and_then(|session_id| state.session_registry.get(session_id));
    let tracking_session_id = if let Some(streaming) = streaming {
        crate::auth_extractor::ensure_media_access(&state, &streaming, &media_file).await?;
        state
            .household
            .record_served(&streaming.policy, streaming.user_id)
            .await;

        candidate_session
            .filter(|session| {
                session.user_id == streaming.user_id && session.media_file_id == media_file_id
            })
            .map(|session| session.id)
    } else {
        let session_id = query.playback_session_id.ok_or_else(|| {
            ApiError::new(
                axum::http::StatusCode::UNAUTHORIZED,
                "unauthorized",
                "missing playback authorisation",
            )
        })?;
        let session = candidate_session.ok_or_else(|| {
            ApiError::new(
                axum::http::StatusCode::UNAUTHORIZED,
                "unauthorized",
                "invalid or expired playback session",
            )
        })?;
        if session.media_file_id != media_file_id {
            return Err(ApiError::new(
                axum::http::StatusCode::UNAUTHORIZED,
                "unauthorized",
                "playback session does not authorise this media file",
            ));
        }
        // The capability URL carries no bearer: re-resolve the session
        // owner's current policy (schedule, budget, rating, library).
        let policy = crate::auth_extractor::ensure_session_media_access(
            &state,
            session.user_id,
            &media_file,
        )
        .await?;
        state
            .household
            .record_served(&policy, session.user_id)
            .await;
        Some(session_id)
    };

    let resolved_path = playarr_model::resolve_media_path(&media_file.path);
    let response = serve_file(&resolved_path, request).await?;
    Ok(match tracking_session_id {
        Some(session_id) => {
            track_streamed_bytes(response, state.session_registry.clone(), session_id)
        }
        None => response,
    })
}

// ---------------------------------------------------------------------
// §5.3 (`docs/architecture/peer-groups.md`): `DeliveryMode::Proxy`
// passthrough. [`proxy_stream_media_handler`] is what THIS (the entry)
// node's client actually calls -- `playback::rewrite_for_delivery` rewrites
// a delegated `PlaybackInfoResponse.url` into this route's shape.
// [`peer_stream_media_handler`] is the OWNING peer's own side: `Peer
// SignedRequest`-gated, so only a legitimate, still-active member of this
// group may call it, and it independently re-derives the acting user's
// grant from `playback_session_id` (its OWN `session_registry`, populated
// only by its OWN negotiation -- never anything the calling node asserts)
// before serving a single byte -- see that handler's own doc comment for
// the full "defense in depth" reasoning.
//
// HLS session and rendition files follow the same signed-peer boundary as
// direct streams. The owning peer looks up the caller's playback session in
// its own registry and re-checks that user's current library grant before
// serving either a manifest or segment.
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct ProxyStreamQuery {
    playback_session_id: Uuid,
}

/// Copies just the response-shape headers a byte-range file response
/// actually needs (`Content-Type`/`-Length`/`-Range`, `Accept-Ranges`,
/// caching validators) from `upstream` onto the response this node hands
/// its own client, and pipes the body straight through
/// (`axum::body::Body::from_stream`) rather than buffering it -- the
/// `Range`-preserving, streamed-not-buffered passthrough §5.3 flags as this
/// whole design's highest-risk new runtime behavior.
fn proxy_response_from(upstream: reqwest::Response) -> Response {
    let status = upstream.status();
    let mut builder = Response::builder().status(status);
    for name in [
        axum::http::header::CONTENT_TYPE,
        axum::http::header::CONTENT_LENGTH,
        axum::http::header::CONTENT_RANGE,
        axum::http::header::ACCEPT_RANGES,
        axum::http::header::ETAG,
        axum::http::header::LAST_MODIFIED,
    ] {
        if let Some(value) = upstream.headers().get(&name) {
            builder = builder.header(name, value.clone());
        }
    }
    let stream = upstream
        .bytes_stream()
        .map(|chunk| chunk.map_err(std::io::Error::other));
    match builder.body(axum::body::Body::from_stream(stream)) {
        Ok(response) => response,
        Err(err) => {
            ApiError::internal(format!("failed to build proxied response: {err}")).into_response()
        }
    }
}

/// `GET /api/v1/media/proxy/{peer_node_id}/{media_file_id}/stream` -- this
/// node's own client hits exactly this shape for a `DeliveryMode::Proxy`
/// delegated stream (`playback::rewrite_for_delivery` rewrote the owning
/// peer's own `.../{media_file_id}/stream` response `url` into this one).
/// `media_file_id` is the OWNING peer's own local id -- meaningless on this
/// node, only ever used to build the outbound request path. This node signs
/// its OWN outbound request with its own peer identity (proving to the
/// owning peer "a legitimate member of this group is asking"), and forwards
/// `playback_session_id` unvalidated: this node has no way to check it (that
/// session lives on the owning peer, not here) -- the owning peer's own
/// `peer_stream_media_handler` is the real authorization boundary, exactly
/// per §5.3's "defense in depth" -- never trusting this node's mere say-so.
#[utoipa::path(
    get,
    path = "/api/v1/media/proxy/{peer_node_id}/{media_file_id}/stream",
    tag = "playback",
    params(
        ("peer_node_id" = Uuid, Path, description = "The PeerNode a routing decision resolved to"),
        ("media_file_id" = Uuid, Path, description = "The OWNING peer's own local MediaFile id (meaningless on this node)"),
        ("playback_session_id" = Uuid, Query, description = "The owning peer's own PlaybackSession id, from its PlaybackInfoResponse")
    ),
    responses(
        (status = 200, description = "Full file content, proxied from the owning peer"),
        (status = 206, description = "Partial content for a Range request, proxied from the owning peer"),
        (status = 502, description = "The owning peer could not be reached, or refused the request"),
        (status = 503, description = "peer_node_id is not currently a known, active peer")
    )
)]
pub async fn proxy_stream_media_handler(
    State(state): State<AppState>,
    Path((peer_node_id, media_file_id)): Path<(Uuid, Uuid)>,
    Query(query): Query<ProxyStreamQuery>,
    headers: axum::http::HeaderMap,
) -> Result<Response, ApiError> {
    let peer = state
        .peer_node_repo
        .get(peer_node_id)
        .await?
        .filter(|peer| peer.status == playarr_model::PeerNodeStatus::Active)
        .ok_or_else(|| {
            ApiError::no_peer_available(format!(
                "peer {peer_node_id} is not currently a known, active peer"
            ))
        })?;
    let identity = crate::admin_peer::own_peer_identity(&state).await?;

    let addresses = state
        .peer_transport_routes
        .outbound_url(peer.id)
        .map(|url| vec![url])
        .unwrap_or_else(|| {
            playarr_peer_sync::peer_client::addresses_by_priority(&peer.addresses)
                .into_iter()
                .map(str::to_owned)
                .collect()
        });
    if addresses.is_empty() {
        return Err(ApiError::no_peer_available(format!(
            "peer {peer_node_id} has no known address"
        )));
    }

    let range = headers.get(axum::http::header::RANGE).cloned();
    let path = format!(
        "/api/v1/peer/stream/{media_file_id}?playback_session_id={}",
        query.playback_session_id
    );

    let mut last_error = None;
    for base_url in addresses {
        let signed = identity.sign_request("GET", &path, &[]);
        let mut request = state
            .peer_http
            .get(format!("{}{path}", base_url.trim_end_matches('/')))
            .header(
                playarr_peer_sync::peer_client::PEER_ID_HEADER,
                signed.peer_id.to_string(),
            )
            .header(
                playarr_peer_sync::peer_client::SIGNATURE_HEADER,
                signed.signature_b64,
            )
            .header(
                playarr_peer_sync::peer_client::TIMESTAMP_HEADER,
                signed.timestamp.to_string(),
            )
            .header(playarr_peer_sync::peer_client::NONCE_HEADER, signed.nonce);
        if let Some(range) = &range {
            request = request.header(axum::http::header::RANGE, range.clone());
        }

        match request.send().await {
            Ok(upstream) if upstream.status().is_success() => {
                return Ok(proxy_response_from(upstream));
            }
            Ok(upstream) => {
                let status = upstream.status();
                let body = upstream.text().await.unwrap_or_default();
                tracing::warn!(
                    peer_node_id = %peer_node_id,
                    %base_url,
                    %status,
                    %body,
                    "owning peer refused a proxied stream request"
                );
                last_error = Some(format!("{status}: {body}"));
            }
            Err(err) => {
                tracing::warn!(
                    peer_node_id = %peer_node_id,
                    %base_url,
                    error = %err,
                    "proxied stream fetch failed; trying next known address"
                );
                last_error = Some(err.to_string());
            }
        }
    }
    Err(ApiError::bad_gateway(format!(
        "could not reach peer {peer_node_id} to proxy a stream: {}",
        last_error.unwrap_or_default()
    )))
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProxyHlsQuery {
    playback_session_id: Uuid,
}

async fn proxy_peer_hls_file(
    state: AppState,
    peer_node_id: Uuid,
    owner_path: String,
    playback_session_id: Uuid,
    method: axum::http::Method,
    headers: axum::http::HeaderMap,
    file_name: &str,
) -> Result<Response, ApiError> {
    let peer = state
        .peer_node_repo
        .get(peer_node_id)
        .await?
        .filter(|peer| peer.status == playarr_model::PeerNodeStatus::Active)
        .ok_or_else(|| {
            ApiError::no_peer_available(format!(
                "peer {peer_node_id} is not currently a known, active peer"
            ))
        })?;
    let identity = crate::admin_peer::own_peer_identity(&state).await?;
    let addresses = state
        .peer_transport_routes
        .outbound_url(peer.id)
        .map(|url| vec![url])
        .unwrap_or_else(|| {
            playarr_peer_sync::peer_client::addresses_by_priority(&peer.addresses)
                .into_iter()
                .map(str::to_owned)
                .collect()
        });
    if addresses.is_empty() {
        return Err(ApiError::no_peer_available(format!(
            "peer {peer_node_id} has no known address"
        )));
    }

    let path = format!("/api/v1/peer/hls/{owner_path}?playback_session_id={playback_session_id}");
    let range = headers.get(axum::http::header::RANGE).cloned();
    let mut last_error = None;
    for base_url in addresses {
        // Each address attempt is a separate authenticated request. Reusing
        // a nonce after a failed connection can be rejected as a replay by
        // an owner that received the first attempt before the connection
        // failed locally.
        let signed = identity.sign_request(method.as_str(), &path, &[]);
        let mut request = state
            .peer_http
            .request(
                method.clone(),
                format!("{}{path}", base_url.trim_end_matches('/')),
            )
            .header(
                playarr_peer_sync::peer_client::PEER_ID_HEADER,
                signed.peer_id.to_string(),
            )
            .header(
                playarr_peer_sync::peer_client::SIGNATURE_HEADER,
                signed.signature_b64.clone(),
            )
            .header(
                playarr_peer_sync::peer_client::TIMESTAMP_HEADER,
                signed.timestamp.to_string(),
            )
            .header(
                playarr_peer_sync::peer_client::NONCE_HEADER,
                signed.nonce.clone(),
            );
        if let Some(range) = &range {
            request = request.header(axum::http::header::RANGE, range.clone());
        }
        match request.send().await {
            Ok(upstream) if upstream.status().is_success() => {
                let owner_resource_path = owner_path
                    .strip_suffix(&format!("/{file_name}"))
                    .unwrap_or(&owner_path);
                return proxy_hls_response_from(
                    upstream,
                    peer_node_id,
                    owner_resource_path,
                    playback_session_id,
                    file_name,
                    method == axum::http::Method::GET && range.is_none(),
                )
                .await;
            }
            Ok(upstream) => {
                let status = upstream.status();
                tracing::warn!(peer_node_id = %peer_node_id, %status,
                    "owning peer refused a proxied HLS request");
                last_error = Some(status.to_string());
            }
            Err(err) => {
                let reason = if err.is_timeout() {
                    "upstream timeout"
                } else if err.is_connect() {
                    "upstream connection failure"
                } else {
                    "upstream transport failure"
                };
                tracing::warn!(peer_node_id = %peer_node_id, reason,
                    "could not fetch a proxied HLS resource from the owning peer");
                last_error = Some(reason.to_owned());
            }
        }
    }
    Err(ApiError::bad_gateway(format!(
        "could not reach peer {peer_node_id} to proxy HLS: {}",
        last_error.unwrap_or_default()
    )))
}

async fn proxy_hls_response_from(
    upstream: reqwest::Response,
    peer_node_id: Uuid,
    owner_path: &str,
    playback_session_id: Uuid,
    file_name: &str,
    rewrite_manifest: bool,
) -> Result<Response, ApiError> {
    if !rewrite_manifest
        || !file_name.to_ascii_lowercase().ends_with(".m3u8")
        || upstream.status() != axum::http::StatusCode::OK
    {
        return Ok(proxy_response_from(upstream));
    }

    const MAX_PLAYLIST_BYTES: usize = 1024 * 1024;
    if upstream
        .content_length()
        .is_some_and(|length| length > MAX_PLAYLIST_BYTES as u64)
    {
        return Err(ApiError::bad_gateway(
            "proxied HLS playlist exceeds size limit",
        ));
    }
    let status = upstream.status();
    let content_type = upstream
        .headers()
        .get(axum::http::header::CONTENT_TYPE)
        .cloned();
    let mut bytes = Vec::new();
    let mut stream = upstream.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|_| ApiError::bad_gateway("failed reading proxied HLS playlist"))?;
        if bytes.len().saturating_add(chunk.len()) > MAX_PLAYLIST_BYTES {
            return Err(ApiError::bad_gateway(
                "proxied HLS playlist exceeds size limit",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    let manifest = std::str::from_utf8(&bytes)
        .map_err(|_| ApiError::bad_gateway("proxied HLS playlist is not UTF-8"))?;
    let body =
        rewrite_hls_playlist_capability(manifest, peer_node_id, owner_path, playback_session_id)?;
    let content_length = body.len();
    let mut builder = Response::builder().status(status);
    if let Some(content_type) = content_type {
        builder = builder.header(axum::http::header::CONTENT_TYPE, content_type);
    }
    builder
        .header(axum::http::header::CONTENT_LENGTH, content_length)
        .header(axum::http::header::CACHE_CONTROL, "no-store")
        .body(axum::body::Body::from(body))
        .map_err(|err| ApiError::internal(format!("failed to build proxied HLS playlist: {err}")))
}

fn rewrite_hls_playlist_capability(
    manifest: &str,
    peer_node_id: Uuid,
    owner_path: &str,
    playback_session_id: Uuid,
) -> Result<String, ApiError> {
    fn with_capability(
        uri: &str,
        peer_node_id: Uuid,
        owner_path: &str,
        playback_session_id: Uuid,
    ) -> Result<String, ApiError> {
        let uri = uri.trim();
        if uri.is_empty() || uri.starts_with('#') || uri.starts_with("data:") {
            return Ok(uri.to_owned());
        }

        let (without_fragment, fragment) = uri
            .split_once('#')
            .map_or((uri, ""), |(before, after)| (before, after));
        let (uri_path, query) = without_fragment
            .split_once('?')
            .map_or((without_fragment, ""), |(path, query)| (path, query));

        // Absolute and root-relative references are reduced to a file name
        // inside an owner resource. A canonical session/rendition route can
        // select another HLS output only because the owner handler performs
        // the same-session media and current-policy checks on every request.
        let path = if let Some(rest) = uri_path.strip_prefix("//") {
            rest.split_once('/').map(|(_, path)| path).unwrap_or("")
        } else if let Some((_, rest)) = uri_path.split_once("://") {
            rest.split_once('/').map(|(_, path)| path).unwrap_or("")
        } else {
            uri_path
        };
        let path = path.trim_start_matches('/');
        let mut target_owner_path = owner_path.to_owned();
        let relative = if let Some(media_path) = path.strip_prefix("api/v1/media/") {
            let parts = media_path.split('/').collect::<Vec<_>>();
            match parts.as_slice() {
                [kind @ ("sessions" | "renditions"), id, file_name]
                    if Uuid::parse_str(id).is_ok() =>
                {
                    target_owner_path = format!("{kind}/{id}");
                    *file_name
                }
                _ => {
                    return Err(ApiError::bad_request(
                        "HLS playlist references an unsupported media route",
                    ));
                }
            }
        } else {
            let relative = path
                .strip_prefix(&format!("{owner_path}/"))
                .unwrap_or(path)
                .strip_prefix("./")
                .unwrap_or_else(|| path.strip_prefix(&format!("{owner_path}/")).unwrap_or(path));
            if relative.contains('/') {
                let absolute_reference = uri_path.starts_with('/')
                    || uri_path.starts_with("//")
                    || uri_path.contains("://");
                if !absolute_reference
                    || relative.split('/').any(|part| part == ".." || part == ".")
                {
                    return Err(ApiError::bad_request(
                        "HLS playlist contains an unsafe or unsupported child path",
                    ));
                }
                relative.rsplit('/').next().unwrap_or("")
            } else {
                relative
            }
        };
        if relative.contains('%') {
            return Err(ApiError::bad_request(
                "HLS playlist contains an unsafe or unsupported child path",
            ));
        }
        validate_segment_file_name(relative)?;

        let mut rewritten =
            format!("/api/v1/media/proxy/{peer_node_id}/{target_owner_path}/{relative}");
        let retained_query = query
            .split('&')
            .filter(|pair| !pair.is_empty() && !pair.starts_with("playback_session_id="))
            .collect::<Vec<_>>();
        if !retained_query.is_empty() {
            rewritten.push('?');
            rewritten.push_str(&retained_query.join("&"));
            rewritten.push('&');
        } else {
            rewritten.push('?');
        }
        rewritten.push_str("playback_session_id=");
        rewritten.push_str(&playback_session_id.to_string());
        if !fragment.is_empty() {
            rewritten.push('#');
            rewritten.push_str(fragment);
        }
        Ok(rewritten)
    }

    let mut output = String::with_capacity(manifest.len() + 64);
    for line in manifest.split_inclusive('\n') {
        let (content, ending) = line
            .strip_suffix('\n')
            .map(|content| (content.strip_suffix('\r').unwrap_or(content), "\n"))
            .unwrap_or((line, ""));
        if content.starts_with('#') {
            let mut rewritten = content.to_owned();
            let mut offset = 0;
            while let Some(found) = rewritten[offset..].find("URI=\"") {
                let start = offset + found + 5;
                let Some(relative_end) = rewritten[start..].find('\"') else {
                    break;
                };
                let end = start + relative_end;
                let uri = &rewritten[start..end];
                let replacement =
                    with_capability(uri, peer_node_id, owner_path, playback_session_id)?;
                rewritten.replace_range(start..end, &replacement);
                offset = start + replacement.len() + 1;
            }
            output.push_str(&rewritten);
        } else if !content.trim().is_empty() {
            output.push_str(&with_capability(
                content,
                peer_node_id,
                owner_path,
                playback_session_id,
            )?);
        } else {
            output.push_str(content);
        }
        output.push_str(ending);
    }
    Ok(output)
}

#[utoipa::path(
    get,
    path = "/api/v1/media/proxy/{peer_node_id}/sessions/{session_id}/{file_name}",
    tag = "playback",
    params(("peer_node_id" = Uuid, Path), ("session_id" = Uuid, Path), ("file_name" = String, Path), ("playback_session_id" = Uuid, Query)),
    responses((status = 200, description = "Proxied HLS playlist or segment"), (status = 206, description = "Proxied HLS byte range"))
)]
pub async fn proxy_session_hls_file_handler(
    State(state): State<AppState>,
    Path((peer_node_id, session_id, file_name)): Path<(Uuid, Uuid, String)>,
    Query(query): Query<ProxyHlsQuery>,
    request: Request,
) -> Result<Response, ApiError> {
    validate_segment_file_name(&file_name)?;
    proxy_peer_hls_file(
        state,
        peer_node_id,
        format!("sessions/{session_id}/{file_name}"),
        query.playback_session_id,
        request.method().clone(),
        request.headers().clone(),
        &file_name,
    )
    .await
}

#[utoipa::path(
    get,
    path = "/api/v1/media/proxy/{peer_node_id}/renditions/{rendition_id}/{file_name}",
    tag = "playback",
    params(("peer_node_id" = Uuid, Path), ("rendition_id" = Uuid, Path), ("file_name" = String, Path), ("playback_session_id" = Uuid, Query)),
    responses((status = 200, description = "Proxied HLS playlist or segment"), (status = 206, description = "Proxied HLS byte range"))
)]
pub async fn proxy_rendition_hls_file_handler(
    State(state): State<AppState>,
    Path((peer_node_id, rendition_id, file_name)): Path<(Uuid, Uuid, String)>,
    Query(query): Query<ProxyHlsQuery>,
    request: Request,
) -> Result<Response, ApiError> {
    validate_segment_file_name(&file_name)?;
    proxy_peer_hls_file(
        state,
        peer_node_id,
        format!("renditions/{rendition_id}/{file_name}"),
        query.playback_session_id,
        request.method().clone(),
        request.headers().clone(),
        &file_name,
    )
    .await
}

#[derive(Debug, Clone, Deserialize)]
pub struct PeerStreamQuery {
    playback_session_id: Uuid,
}

/// `GET /api/v1/peer/stream/{media_file_id}` -- the OWNING peer's side of
/// `Proxy` delivery (§5.3). [`PeerSignedRequest`]-gated (only a known,
/// active peer may call this at all), but the *real* authorization check is
/// independent of that signature: `playback_session_id` must resolve to a
/// still-open [`playarr_model::PlaybackSession`] in THIS node's own
/// `session_registry` -- populated only by THIS node's own
/// [`crate::playback::negotiate_playback`] run (either for a local caller,
/// or for a request this same node received via `peer_playback_info_handler`)
/// and never by anything the calling node merely asserts. This mirrors
/// `stream_media_handler`'s own established anonymous-capability trust
/// model exactly (a live `session_registry` entry, minted only after a real
/// negotiation-time grant check, is itself sufficient authorization for the
/// byte-range reads that follow) -- just checked here against THIS peer's
/// own authoritative session data instead of a forwarding node's say-so.
/// Additionally re-resolves the session owner's *current* `Policy` (never
/// merely trusting that the session still reflects it): a policy change
/// after negotiation (e.g. an admin revoking a library grant mid-stream)
/// takes effect on the very next byte request, not just the next
/// negotiation.
#[utoipa::path(
    get,
    path = "/api/v1/peer/stream/{media_file_id}",
    tag = "peer-groups",
    params(
        ("media_file_id" = Uuid, Path, description = "This peer's own local MediaFile id"),
        ("playback_session_id" = Uuid, Query, description = "This peer's own PlaybackSession id, minted by its own prior negotiation")
    ),
    responses(
        (status = 200, description = "Full file content"),
        (status = 206, description = "Partial content for a Range request"),
        (status = 401, description = "Missing/invalid peer signature, an unknown/left peer, or an unknown/expired playback session"),
        (status = 403, description = "The session owner's current policy no longer grants access to this library"),
        (status = 404, description = "Unknown media_file_id, or the file no longer exists on disk")
    )
)]
pub async fn peer_stream_media_handler(
    State(state): State<AppState>,
    Path(media_file_id): Path<Uuid>,
    Query(query): Query<PeerStreamQuery>,
    headers: axum::http::HeaderMap,
    _peer: PeerSignedRequest,
) -> Result<Response, ApiError> {
    let session = state
        .session_registry
        .get(query.playback_session_id)
        .ok_or_else(|| {
            ApiError::new(
                axum::http::StatusCode::UNAUTHORIZED,
                "unauthorized",
                "unknown or expired playback session",
            )
        })?;
    if session.media_file_id != media_file_id {
        return Err(ApiError::new(
            axum::http::StatusCode::UNAUTHORIZED,
            "unauthorized",
            "playback session does not authorise this media file",
        ));
    }

    // Defense in depth (§5.3): re-check the session owner's CURRENT policy
    // against this peer's own state, not just trust that a session existing
    // is still sufficient on its own.
    let media_file = state
        .media_files
        .get(media_file_id)
        .await
        .ok_or_else(|| ApiError::not_found(format!("unknown media file {media_file_id}")))?;
    let policy =
        crate::auth_extractor::ensure_session_media_access(&state, session.user_id, &media_file)
            .await?;
    state
        .household
        .record_served(&policy, session.user_id)
        .await;

    let resolved_path = playarr_model::resolve_media_path(&media_file.path);
    let mut synthetic_request = Request::builder()
        .method(axum::http::Method::GET)
        .uri("/proxied-stream");
    if let Some(range) = headers.get(axum::http::header::RANGE) {
        synthetic_request = synthetic_request.header(axum::http::header::RANGE, range.clone());
    }
    let synthetic_request = synthetic_request
        .body(axum::body::Body::empty())
        .map_err(|err| {
            ApiError::internal(format!("failed to build proxied file request: {err}"))
        })?;

    let response = serve_file(&resolved_path, synthetic_request).await?;
    Ok(track_streamed_bytes(
        response,
        state.session_registry.clone(),
        session.id,
    ))
}

#[derive(Debug, Clone, Deserialize)]
pub struct PeerHlsQuery {
    playback_session_id: Uuid,
}

async fn peer_hls_file(
    state: AppState,
    resource: PeerHlsResource,
    resource_id: Uuid,
    file_name: String,
    playback_session_id: Uuid,
    method: axum::http::Method,
    range: Option<axum::http::HeaderValue>,
) -> Result<Response, ApiError> {
    validate_segment_file_name(&file_name)?;
    let playback_session = state
        .session_registry
        .get(playback_session_id)
        .ok_or_else(|| {
            ApiError::new(
                axum::http::StatusCode::UNAUTHORIZED,
                "unauthorized",
                "unknown or expired playback session",
            )
        })?;

    let (media_file_id, path) = match resource {
        PeerHlsResource::Rendition => {
            let rendition = state.transcode.get_rendition(resource_id).await?;
            (
                rendition.media_file_id,
                rendition.output_path.join(&file_name),
            )
        }
        PeerHlsResource::Session => {
            let session = state
                .transcode
                .lookup_session(resource_id)
                .await?
                .ok_or_else(|| {
                    ApiError::not_found(format!("unknown or expired session {resource_id}"))
                })?;
            if session.owning_node_id != state.node_id {
                return Err(ApiError::not_found(format!(
                    "session {resource_id} is not owned by this peer"
                )));
            }
            let path = state
                .transcode
                .session_output_dir(resource_id)
                .join(&file_name);
            (session.media_file_id, path)
        }
    };
    if playback_session.media_file_id != media_file_id {
        return Err(ApiError::new(
            axum::http::StatusCode::UNAUTHORIZED,
            "unauthorized",
            "playback session does not authorise this media file",
        ));
    }
    let media_file = state
        .media_files
        .get(media_file_id)
        .await
        .ok_or_else(|| ApiError::not_found(format!("unknown media file {media_file_id}")))?;
    let policy = crate::auth_extractor::ensure_session_media_access(
        &state,
        playback_session.user_id,
        &media_file,
    )
    .await?;
    state
        .household
        .record_served(&policy, playback_session.user_id)
        .await;

    // Refresh the owner's playback capability before waiting for ffmpeg to
    // write a live output and on every durable rendition/segment request.
    state.session_registry.update(playback_session.id, &|_| {});
    if matches!(resource, PeerHlsResource::Session) {
        wait_for_live_hls_file(&path).await;
    }
    let mut request = Request::builder().method(method).uri("/proxied-hls-file");
    if let Some(range) = range {
        request = request.header(axum::http::header::RANGE, range);
    }
    let request = request
        .body(axum::body::Body::empty())
        .map_err(|err| ApiError::internal(format!("failed to build proxied HLS request: {err}")))?;
    let response = serve_file(&path, request).await?;
    Ok(track_streamed_bytes(
        response,
        state.session_registry.clone(),
        playback_session.id,
    ))
}

#[derive(Debug, Clone, Copy)]
enum PeerHlsResource {
    Session,
    Rendition,
}

#[utoipa::path(
    get,
    path = "/api/v1/peer/hls/sessions/{session_id}/{file_name}",
    tag = "peer-groups",
    params(("session_id" = Uuid, Path), ("file_name" = String, Path), ("playback_session_id" = Uuid, Query)),
    responses((status = 200, description = "HLS playlist or segment"), (status = 206, description = "HLS byte range"), (status = 401, description = "Unknown playback session or session does not authorise the media"), (status = 403, description = "Current policy does not grant access"))
)]
pub async fn peer_session_hls_file_handler(
    State(state): State<AppState>,
    Path((session_id, file_name)): Path<(Uuid, String)>,
    Query(query): Query<PeerHlsQuery>,
    method: axum::http::Method,
    headers: axum::http::HeaderMap,
    _peer: PeerSignedRequest,
) -> Result<Response, ApiError> {
    peer_hls_file(
        state,
        PeerHlsResource::Session,
        session_id,
        file_name,
        query.playback_session_id,
        method,
        headers.get(axum::http::header::RANGE).cloned(),
    )
    .await
}

#[utoipa::path(
    get,
    path = "/api/v1/peer/hls/renditions/{rendition_id}/{file_name}",
    tag = "peer-groups",
    params(("rendition_id" = Uuid, Path), ("file_name" = String, Path), ("playback_session_id" = Uuid, Query)),
    responses((status = 200, description = "HLS playlist or segment"), (status = 206, description = "HLS byte range"), (status = 401, description = "Unknown playback session or session does not authorise the media"), (status = 403, description = "Current policy does not grant access"))
)]
pub async fn peer_rendition_hls_file_handler(
    State(state): State<AppState>,
    Path((rendition_id, file_name)): Path<(Uuid, String)>,
    Query(query): Query<PeerHlsQuery>,
    method: axum::http::Method,
    headers: axum::http::HeaderMap,
    _peer: PeerSignedRequest,
) -> Result<Response, ApiError> {
    peer_hls_file(
        state,
        PeerHlsResource::Rendition,
        rendition_id,
        file_name,
        query.playback_session_id,
        method,
        headers.get(axum::http::header::RANGE).cloned(),
    )
    .await
}

#[utoipa::path(
    get,
    path = "/api/v1/media/{media_file_id}/chapters",
    tag = "playback",
    params(("media_file_id" = Uuid, Path, description = "MediaFile id")),
    responses(
        (status = 200, description = "Real chapters embedded in the source media container", body = Vec<MediaChapter>, example = json!([
            {
                "index": 0,
                "title": "Opening Titles",
                "start_ms": 0,
                "end_ms": 65432
            },
            {
                "index": 1,
                "title": null,
                "start_ms": 65432,
                "end_ms": 620000
            }
        ])),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller does not have Playarr streaming access"),
        (status = 404, description = "Unknown media_file_id"),
        (status = 500, description = "The source file could not be probed")
    )
)]
pub async fn media_chapters_handler(
    State(state): State<AppState>,
    streaming: StreamingUser,
    Path(media_file_id): Path<Uuid>,
) -> Result<Json<Vec<MediaChapter>>, ApiError> {
    let media_file = state
        .media_files
        .get(media_file_id)
        .await
        .ok_or_else(|| ApiError::not_found(format!("unknown media file {media_file_id}")))?;
    crate::auth_extractor::ensure_media_access(&state, &streaming, &media_file).await?;
    let resolved_path = playarr_model::resolve_media_path(&media_file.path);
    Ok(Json(probe_media_chapters(&resolved_path).await?))
}

#[utoipa::path(
    get,
    path = "/api/v1/media/{media_file_id}/metadata",
    tag = "playback",
    params(("media_file_id" = Uuid, Path, description = "MediaFile id")),
    responses(
        (status = 200, description = "Persisted fixed source-container metadata", body = MediaMetadata, example = json!({
            "duration_ms": 3643424
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller does not have Playarr streaming access"),
        (status = 404, description = "Unknown media_file_id"),
        (status = 500, description = "The source file could not be probed")
    )
)]
pub async fn media_metadata_handler(
    State(state): State<AppState>,
    streaming: StreamingUser,
    Path(media_file_id): Path<Uuid>,
) -> Result<Json<MediaMetadata>, ApiError> {
    let media_file = state
        .media_files
        .get(media_file_id)
        .await
        .ok_or_else(|| ApiError::not_found(format!("unknown media file {media_file_id}")))?;
    crate::auth_extractor::ensure_media_access(&state, &streaming, &media_file).await?;

    let duration_ms = match media_file.duration_ms.filter(|duration| *duration > 0) {
        Some(duration_ms) => duration_ms,
        None => {
            let resolved_path = playarr_model::resolve_media_path(&media_file.path);
            let duration_ms = probe_media_duration_ms(&resolved_path).await?;
            state
                .catalog
                .cache_media_file_duration(media_file.id, media_file.work_id, duration_ms)
                .await?;
            duration_ms
        }
    };

    Ok(Json(MediaMetadata { duration_ms }))
}

#[utoipa::path(
    get,
    path = "/api/v1/media/{media_file_id}/download-options",
    tag = "downloads",
    params(("media_file_id" = Uuid, Path, description = "MediaFile id")),
    responses(
        (status = 200, description = "Download qualities this server can produce for this media file", body = DownloadOptionsResponse, example = json!({
            "media_file_id": "3f9c1e2d-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
            "container": "mkv",
            "options": [
                {
                    "id": "original",
                    "label": "Original",
                    "profile": null,
                    "height": null,
                    "estimated_size_bytes": 4_000_000_000_u64,
                    "size_is_estimate": false
                },
                {
                    "id": "h264-1080p-8mbps",
                    "label": "FHD Medium",
                    "profile": "h264-1080p-8mbps",
                    "height": 1080,
                    "estimated_size_bytes": 1_200_000_000_u64,
                    "size_is_estimate": true
                }
            ]
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller lacks Playarr streaming access, download access, or access to this library"),
        (status = 404, description = "Unknown media_file_id"),
        (status = 500, description = "The source file could not be probed for its duration")
    )
)]
pub async fn media_download_options_handler(
    State(state): State<AppState>,
    streaming: StreamingUser,
    Path(media_file_id): Path<Uuid>,
) -> Result<Json<DownloadOptionsResponse>, ApiError> {
    let media_file = state
        .media_files
        .get(media_file_id)
        .await
        .ok_or_else(|| ApiError::not_found(format!("unknown media file {media_file_id}")))?;
    crate::auth_extractor::ensure_media_access(&state, &streaming, &media_file).await?;
    ensure_can_download(&streaming.policy)?;

    // Same lazy-probe-and-cache pattern `media_metadata_handler` above
    // uses: an accurate size estimate for a non-Original quality needs a
    // real fixed duration, and older catalogue rows may not have one
    // persisted yet.
    let duration_ms = match media_file.duration_ms.filter(|duration| *duration > 0) {
        Some(duration_ms) => duration_ms,
        None => {
            let resolved_path = playarr_model::resolve_media_path(&media_file.path);
            let duration_ms = probe_media_duration_ms(&resolved_path).await?;
            state
                .catalog
                .cache_media_file_duration(media_file.id, media_file.work_id, duration_ms)
                .await?;
            duration_ms
        }
    };

    let options = playback_quality_options(source_bitrate_bps(&media_file, duration_ms))
        .into_iter()
        .map(|option| {
            if option.id == "original" {
                DownloadQualityOption {
                    id: option.id,
                    label: option.label,
                    profile: option.profile,
                    height: option.height,
                    estimated_size_bytes: Some(media_file.size_bytes),
                    size_is_estimate: false,
                }
            } else {
                let estimated_size_bytes = option
                    .video_bitrate_bps
                    .map(|video_bitrate_bps| video_bitrate_bps.saturating_mul(duration_ms) / 8000);
                DownloadQualityOption {
                    id: option.id,
                    label: option.label,
                    profile: option.profile,
                    height: option.height,
                    estimated_size_bytes,
                    size_is_estimate: true,
                }
            }
        })
        .collect();

    Ok(Json(DownloadOptionsResponse {
        media_file_id,
        container: media_file.container.clone(),
        options,
    }))
}

async fn media_playback_options(
    state: &AppState,
    streaming: &StreamingUser,
    media_file_id: Uuid,
) -> Result<MediaPlaybackOptionsResponse, ApiError> {
    let user_id = streaming.user_id;
    let media_file = state
        .media_files
        .get(media_file_id)
        .await
        .ok_or_else(|| ApiError::not_found(format!("unknown media file {media_file_id}")))?;
    crate::auth_extractor::ensure_media_access(state, streaming, &media_file).await?;
    let resolved_path = playarr_model::resolve_media_path(&media_file.path);
    let (audio_result, subtitle_result) = tokio::join!(
        probe_media_audio_tracks(&resolved_path),
        probe_all_subtitle_tracks(&resolved_path)
    );
    let audio_tracks = audio_result
        .unwrap_or_else(|error| {
            tracing::warn!(
                %media_file_id,
                error = ?error,
                "could not probe audio tracks for playback settings"
            );
            Vec::new()
        })
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
        .collect::<Vec<_>>();
    let subtitle_tracks = playback_subtitle_options(
        media_file_id,
        0,
        &subtitle_result.unwrap_or_else(|error| {
            tracing::warn!(
                %media_file_id,
                error = ?error,
                "could not probe subtitle tracks for playback settings"
            );
            Vec::new()
        }),
    );
    let quality_options = playback_quality_options(source_bitrate_bps(
        &media_file,
        media_file.duration_ms.unwrap_or(0),
    ));
    let stored = state
        .user_repo
        .get_media_playback_preferences(user_id, media_file_id)
        .await
        .map_err(|error| {
            ApiError::internal(format!(
                "could not load media playback preferences: {error}"
            ))
        })?;
    let quality_id = stored
        .as_ref()
        .map(|preferences| preferences.quality_id.as_str())
        .filter(|id| quality_options.iter().any(|option| option.id == *id))
        .unwrap_or("original")
        .to_string();
    let audio_track_id = stored
        .as_ref()
        .and_then(|preferences| preferences.audio_track_id.as_ref())
        .filter(|id| audio_tracks.iter().any(|track| track.id == **id))
        .cloned();
    let subtitle_track_id = stored
        .as_ref()
        .and_then(|preferences| preferences.subtitle_track_id.as_ref())
        .filter(|id| subtitle_tracks.iter().any(|track| track.id == **id))
        .cloned();

    Ok(MediaPlaybackOptionsResponse {
        quality_options,
        audio_tracks,
        subtitle_tracks,
        preferences: MediaPlaybackPreferenceResponse {
            quality_id,
            audio_track_id,
            subtitle_track_id,
        },
    })
}

#[utoipa::path(
    get,
    path = "/api/v1/media/{media_file_id}/playback-options",
    tag = "playback",
    params(("media_file_id" = Uuid, Path, description = "MediaFile id")),
    responses(
        (status = 200, description = "Playback choices and this viewer's remembered selections", body = MediaPlaybackOptionsResponse, example = json!({
            "quality_options": [
                {
                    "id": "original",
                    "label": "Original",
                    "profile": null,
                    "height": null,
                    "video_bitrate_bps": 8500000
                },
                {
                    "id": "h264-1080p-8mbps",
                    "label": "FHD Medium",
                    "profile": "h264-1080p-8mbps",
                    "height": 1080,
                    "video_bitrate_bps": 8000000
                },
                {
                    "id": "h264-720p-4mbps",
                    "label": "HD Medium",
                    "profile": "h264-720p-4mbps",
                    "height": 720,
                    "video_bitrate_bps": 4000000
                }
            ],
            "audio_tracks": [
                {
                    "id": "source-audio-1",
                    "stream_index": 1,
                    "label": "English Stereo",
                    "language": "eng",
                    "codec": "aac",
                    "channels": 2,
                    "is_default": true
                }
            ],
            "subtitle_tracks": [
                {
                    "id": "source-subtitle-3",
                    "stream_index": 3,
                    "label": "English SDH",
                    "language": "eng",
                    "codec": "subrip",
                    "is_default": true,
                    "forced": false,
                    "url": "/api/v1/media/8f14e45f-ceea-467e-bd42-9f7f6a0e6f8f/subtitles/3?source_offset_ms=0"
                }
            ],
            "preferences": {
                "quality_id": "original",
                "audio_track_id": "source-audio-1",
                "subtitle_track_id": "source-subtitle-3"
            }
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller does not have Playarr streaming access"),
        (status = 404, description = "Unknown media_file_id")
    )
)]
pub async fn media_playback_options_handler(
    State(state): State<AppState>,
    streaming: StreamingUser,
    Path(media_file_id): Path<Uuid>,
) -> Result<Json<MediaPlaybackOptionsResponse>, ApiError> {
    Ok(Json(
        media_playback_options(&state, &streaming, media_file_id).await?,
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v1/media/{media_file_id}/playback-options",
    tag = "playback",
    params(("media_file_id" = Uuid, Path, description = "MediaFile id")),
    request_body(content = UpdateMediaPlaybackPreferencesRequest, example = json!({
        "quality_id": "h264-1080p-8mbps",
        "audio_track_id": "source-audio-1",
        "subtitle_track_id": "source-subtitle-3"
    })),
    responses(
        (status = 200, description = "Remembered selections updated", body = MediaPlaybackOptionsResponse, example = json!({
            "quality_options": [
                {
                    "id": "original",
                    "label": "Original",
                    "profile": null,
                    "height": null,
                    "video_bitrate_bps": 8500000
                },
                {
                    "id": "h264-1080p-8mbps",
                    "label": "FHD Medium",
                    "profile": "h264-1080p-8mbps",
                    "height": 1080,
                    "video_bitrate_bps": 8000000
                },
                {
                    "id": "h264-720p-4mbps",
                    "label": "HD Medium",
                    "profile": "h264-720p-4mbps",
                    "height": 720,
                    "video_bitrate_bps": 4000000
                }
            ],
            "audio_tracks": [
                {
                    "id": "source-audio-1",
                    "stream_index": 1,
                    "label": "English Stereo",
                    "language": "eng",
                    "codec": "aac",
                    "channels": 2,
                    "is_default": true
                }
            ],
            "subtitle_tracks": [
                {
                    "id": "source-subtitle-3",
                    "stream_index": 3,
                    "label": "English SDH",
                    "language": "eng",
                    "codec": "subrip",
                    "is_default": true,
                    "forced": false,
                    "url": "/api/v1/media/8f14e45f-ceea-467e-bd42-9f7f6a0e6f8f/subtitles/3?source_offset_ms=0"
                }
            ],
            "preferences": {
                "quality_id": "h264-1080p-8mbps",
                "audio_track_id": "source-audio-1",
                "subtitle_track_id": "source-subtitle-3"
            }
        })),
        (status = 400, description = "A requested option is not available for this media file"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller does not have Playarr streaming access"),
        (status = 404, description = "Unknown media_file_id")
    )
)]
pub async fn update_media_playback_options_handler(
    State(state): State<AppState>,
    streaming: StreamingUser,
    Path(media_file_id): Path<Uuid>,
    Json(body): Json<UpdateMediaPlaybackPreferencesRequest>,
) -> Result<Json<MediaPlaybackOptionsResponse>, ApiError> {
    let current = media_playback_options(&state, &streaming, media_file_id).await?;
    if !current
        .quality_options
        .iter()
        .any(|option| option.id == body.quality_id)
    {
        return Err(ApiError::bad_request(format!(
            "unknown playback quality {}",
            body.quality_id
        )));
    }
    if body
        .audio_track_id
        .as_ref()
        .is_some_and(|id| !current.audio_tracks.iter().any(|track| track.id == *id))
    {
        return Err(ApiError::bad_request("unknown playback audio track"));
    }
    if body
        .subtitle_track_id
        .as_ref()
        .is_some_and(|id| !current.subtitle_tracks.iter().any(|track| track.id == *id))
    {
        return Err(ApiError::bad_request("unknown playback subtitle track"));
    }

    state
        .user_repo
        .upsert_media_playback_preferences(
            streaming.user_id,
            &playarr_model::MediaPlaybackPreferences {
                media_file_id,
                quality_id: body.quality_id,
                audio_track_id: body.audio_track_id,
                subtitle_track_id: body.subtitle_track_id,
            },
        )
        .await
        .map_err(|error| {
            ApiError::internal(format!(
                "could not save media playback preferences: {error}"
            ))
        })?;

    Ok(Json(
        media_playback_options(&state, &streaming, media_file_id).await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/media/{media_file_id}/subtitles/{stream_index}",
    tag = "playback",
    params(
        ("media_file_id" = Uuid, Path, description = "MediaFile id"),
        ("stream_index" = u32, Path, description = "Global ffprobe stream index"),
        MediaSubtitleQuery,
        HlsCapabilityQuery
    ),
    responses(
        (status = 200, description = "Embedded text subtitle converted to WebVTT", content_type = "text/vtt"),
        (status = 401, description = "Missing or invalid bearer token, playback-session cookie, or playback_session_id capability query"),
        (status = 403, description = "Caller does not have Playarr streaming access"),
        (status = 404, description = "Unknown media file or unsupported/nonexistent subtitle stream"),
        (status = 500, description = "Subtitle conversion failed")
    )
)]
pub async fn media_subtitle_handler(
    State(state): State<AppState>,
    OptionalStreamingUser(streaming): OptionalStreamingUser,
    Path((media_file_id, stream_index)): Path<(Uuid, u32)>,
    Query(query): Query<MediaSubtitleQuery>,
    Query(capability): Query<HlsCapabilityQuery>,
    request: Request,
) -> Result<Response, ApiError> {
    let cookie_session =
        hls_cookie_playback_session(&state, streaming.as_ref(), &capability, &request)?;
    let tracking_session_id =
        hls_tracking_session_id(streaming.as_ref(), cookie_session.as_ref(), media_file_id)?;

    let media_file = state
        .media_files
        .get(media_file_id)
        .await
        .ok_or_else(|| ApiError::not_found(format!("unknown media file {media_file_id}")))?;
    if let Some(streaming) = streaming.as_ref() {
        crate::auth_extractor::ensure_media_access(&state, streaming, &media_file).await?;
    }
    if let Some(session) = cookie_session.as_ref() {
        // Capability URL: re-resolve the session owner's current policy.
        crate::auth_extractor::ensure_session_media_access(&state, session.user_id, &media_file)
            .await?;
    }
    let resolved_path = playarr_model::resolve_media_path(&media_file.path);
    let supported_tracks = probe_all_subtitle_tracks(&resolved_path).await?;
    let Some(track) = supported_tracks
        .iter()
        .find(|track| track.stream_index == stream_index)
    else {
        return Err(ApiError::not_found(format!(
            "unknown or unsupported subtitle stream {stream_index}"
        )));
    };
    let subtitle_source = track
        .sidecar_path
        .clone()
        .unwrap_or_else(|| resolved_path.clone());

    let subtitle_path = ensure_media_subtitle(
        media_file_id,
        &subtitle_source,
        stream_index,
        query.source_offset_ms,
    )
    .await?;
    let mut response = serve_file(&subtitle_path, request).await?;
    response.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        axum::http::HeaderValue::from_static("text/vtt; charset=utf-8"),
    );
    response.headers_mut().insert(
        axum::http::header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("private, max-age=604800, immutable"),
    );
    Ok(match tracking_session_id {
        Some(session_id) => {
            track_streamed_bytes(response, state.session_registry.clone(), session_id)
        }
        None => response,
    })
}

#[utoipa::path(
    get,
    path = "/api/v1/media/{media_file_id}/thumbnail",
    tag = "playback",
    params(
        ("media_file_id" = Uuid, Path, description = "MediaFile id"),
        MediaThumbnailQuery
    ),
    responses(
        (status = 200, description = "A real JPEG frame extracted from the source media file", content_type = "image/jpeg"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller does not have Playarr streaming access"),
        (status = 204, description = "The file has no video frame or cover art to extract; use a placeholder"),
        (status = 404, description = "Unknown media_file_id"),
        (status = 503, description = "The source media path is not reachable on this Playarr Server node"),
        (status = 500, description = "The source file could not be decoded")
    )
)]
pub async fn media_thumbnail_handler(
    State(state): State<AppState>,
    streaming: StreamingUser,
    Path(media_file_id): Path<Uuid>,
    Query(query): Query<MediaThumbnailQuery>,
    request: Request,
) -> Result<Response, ApiError> {
    let media_file = state
        .media_files
        .get(media_file_id)
        .await
        .ok_or_else(|| ApiError::not_found(format!("unknown media file {media_file_id}")))?;
    crate::auth_extractor::ensure_media_access(&state, &streaming, &media_file).await?;
    let resolved_path = playarr_model::resolve_media_path(&media_file.path);
    let position_ms = thumbnail_position_ms(query.position_ms);
    let thumbnail_path =
        match ensure_media_thumbnail(media_file_id, &resolved_path, position_ms).await {
            Ok(path) => path,
            // Expected miss (audio without cover art): 204 so browsers do not log a failed
            // resource load for every track. The result is stable, so let clients cache it.
            Err(error) if error.body.error == THUMBNAIL_UNAVAILABLE => {
                let mut response = axum::http::StatusCode::NO_CONTENT.into_response();
                response.headers_mut().insert(
                    axum::http::header::CACHE_CONTROL,
                    axum::http::HeaderValue::from_static("private, max-age=3600"),
                );
                return Ok(response);
            }
            Err(error) => return Err(error),
        };
    let mut response = serve_file(&thumbnail_path, request).await?;
    response.headers_mut().insert(
        axum::http::header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("private, max-age=604800, immutable"),
    );
    Ok(response)
}

#[utoipa::path(
    get,
    path = "/api/v1/media/renditions/{rendition_id}/{file_name}",
    tag = "playback",
    params(
        ("rendition_id" = Uuid, Path, description = "Rendition id"),
        ("file_name" = String, Path, description = "playlist.m3u8 or a segment file name within the rendition's output directory"),
        HlsCapabilityQuery
    ),
    responses(
        (status = 200, description = "Full file content"),
        (status = 206, description = "Partial content for a `Range` request"),
        (status = 400, description = "file_name contains a path separator or `..`"),
        (status = 401, description = "Missing or invalid bearer token, playback-session cookie, or playback_session_id capability query"),
        (status = 403, description = "Caller does not have Playarr streaming access"),
        (status = 404, description = "Unknown rendition_id, or the file does not exist in its output directory")
    )
)]
pub async fn serve_rendition_file_handler(
    State(state): State<AppState>,
    OptionalStreamingUser(streaming): OptionalStreamingUser,
    Path((rendition_id, file_name)): Path<(Uuid, String)>,
    Query(capability): Query<HlsCapabilityQuery>,
    request: Request,
) -> Result<Response, ApiError> {
    let cookie_session =
        hls_cookie_playback_session(&state, streaming.as_ref(), &capability, &request)?;
    validate_segment_file_name(&file_name)?;
    let rendition = state.transcode.get_rendition(rendition_id).await?;
    let tracking_session_id = hls_tracking_session_id(
        streaming.as_ref(),
        cookie_session.as_ref(),
        rendition.media_file_id,
    )?;
    // A `Rendition` doesn't carry `source_instance_id` itself -- only its
    // owning `media_file_id` (see `playarr_model::Rendition`'s doc
    // comment) -- so the underlying `MediaFile` is resolved once here
    // purely to read that field off it before falling through to the
    // actual file serve below.
    let media_file = state
        .media_files
        .get(rendition.media_file_id)
        .await
        .ok_or_else(|| {
            ApiError::not_found(format!("unknown media file {}", rendition.media_file_id))
        })?;
    if let Some(streaming) = streaming.as_ref() {
        crate::auth_extractor::ensure_media_access(&state, streaming, &media_file).await?;
        state
            .household
            .record_served(&streaming.policy, streaming.user_id)
            .await;
    }
    if let Some(session) = cookie_session.as_ref() {
        // Capability URL: re-resolve the session owner's current policy.
        let policy = crate::auth_extractor::ensure_session_media_access(
            &state,
            session.user_id,
            &media_file,
        )
        .await?;
        state
            .household
            .record_served(&policy, session.user_id)
            .await;
    }
    let response = serve_file(&rendition.output_path.join(&file_name), request).await?;
    Ok(match tracking_session_id {
        Some(session_id) => {
            track_streamed_bytes(response, state.session_registry.clone(), session_id)
        }
        None => response,
    })
}

#[utoipa::path(
    get,
    path = "/api/v1/media/sessions/{session_id}/{file_name}",
    tag = "playback",
    params(
        ("session_id" = Uuid, Path, description = "On-demand TranscodeSession id"),
        ("file_name" = String, Path, description = "playlist.m3u8 or a segment file name within the session's output directory"),
        HlsCapabilityQuery
    ),
    responses(
        (status = 200, description = "Full file content"),
        (status = 206, description = "Partial content for a `Range` request"),
        (status = 400, description = "file_name contains a path separator or `..`"),
        (status = 401, description = "Missing or invalid bearer token, playback-session cookie, or playback_session_id capability query"),
        (status = 403, description = "Caller does not have Playarr streaming access"),
        (status = 404, description = "Unknown or expired session_id, or the file hasn't been written yet")
    )
)]
pub async fn serve_session_file_handler(
    State(state): State<AppState>,
    OptionalStreamingUser(streaming): OptionalStreamingUser,
    Path((session_id, file_name)): Path<(Uuid, String)>,
    Query(capability): Query<HlsCapabilityQuery>,
    request: Request,
) -> Result<Response, ApiError> {
    let cookie_session =
        hls_cookie_playback_session(&state, streaming.as_ref(), &capability, &request)?;
    validate_segment_file_name(&file_name)?;

    let session = state
        .transcode
        .lookup_session(session_id)
        .await?
        .ok_or_else(|| ApiError::not_found(format!("unknown or expired session {session_id}")))?;
    let tracking_session_id = hls_tracking_session_id(
        streaming.as_ref(),
        cookie_session.as_ref(),
        session.media_file_id,
    )?;
    // Same "resolve the owning MediaFile just to read its
    // source_instance_id" pattern as `serve_rendition_file_handler` --
    // `TranscodeSession` doesn't carry it directly either (see
    // `playarr_transcode::TranscodeSession`'s doc comment), only its
    // `media_file_id`.
    let media_file = state
        .media_files
        .get(session.media_file_id)
        .await
        .ok_or_else(|| {
            ApiError::not_found(format!("unknown media file {}", session.media_file_id))
        })?;
    if let Some(streaming) = streaming.as_ref() {
        crate::auth_extractor::ensure_media_access(&state, streaming, &media_file).await?;
        state
            .household
            .record_served(&streaming.policy, streaming.user_id)
            .await;
    }
    if let Some(session) = cookie_session.as_ref() {
        // Capability URL: re-resolve the session owner's current policy.
        let policy = crate::auth_extractor::ensure_session_media_access(
            &state,
            session.user_id,
            &media_file,
        )
        .await?;
        state
            .household
            .record_served(&policy, session.user_id)
            .await;
    }

    let dir = state.transcode.session_output_dir(session_id);
    let path = dir.join(&file_name);
    wait_for_live_hls_file(&path).await;
    let response = serve_file(&path, request).await?;
    Ok(match tracking_session_id {
        Some(playback_session_id) => track_streamed_bytes(
            response,
            state.session_registry.clone(),
            playback_session_id,
        ),
        None => response,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        bearer_header, mint_access_token, seed_streaming_user,
        seed_streaming_user_with_library_allow, test_state, TestState,
    };
    use axum::body::Body;
    use axum::extract::ConnectInfo;
    use axum::http::{Request as HttpRequest, StatusCode};
    use playarr_model::media::LeafRef;
    use playarr_model::{
        ClientPlatform, MediaFile, PlayMethod, PlaybackSession, ProducedBy, Rendition,
        RenditionStatus,
    };
    use std::net::SocketAddr;
    use std::path::PathBuf;

    fn write_temp_file(contents: &[u8]) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("playarr-api-media-test-{}.mp4", Uuid::new_v4()));
        std::fs::write(&path, contents).expect("write temp fixture file");
        path
    }

    fn media_file_at(path: PathBuf) -> MediaFile {
        MediaFile {
            id: Uuid::new_v4(),
            work_id: Uuid::new_v4(),
            leaf_ref: LeafRef::Work,
            path,
            container: "mp4".to_string(),
            codec: "h264".to_string(),
            bitrate: Some(4_000_000),
            duration_ms: None,
            size_bytes: 1024,
            source_instance_id: Uuid::new_v4(),
            source_file_id: Some("1".to_string()),
        }
    }

    /// Capability URLs now re-resolve the session owner's account on every
    /// request, so a session must belong to a real streaming user who may
    /// read the media file's library.
    async fn seed_session_owner(state: &TestState, session: &PlaybackSession, media_file_id: Uuid) {
        use crate::playback::MediaFileLookup;
        let source = state
            .media_files
            .get(media_file_id)
            .await
            .map(|file| file.source_instance_id)
            .unwrap_or_else(Uuid::new_v4);
        seed_streaming_user_with_library_allow(state, session.user_id, vec![source]).await;
    }

    fn active_playback_session(media_file_id: Uuid) -> PlaybackSession {
        PlaybackSession {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            device_id: Uuid::new_v4(),
            media_file_id,
            rendition_id: None,
            started_at: chrono::Utc::now(),
            ended_at: None,
            play_method: PlayMethod::Transcode,
            transcode_reason: None,
            source_codec: "h264".to_string(),
            source_container: "mp4".to_string(),
            source_bitrate: Some(4_000_000),
            target_codec: "h264".to_string(),
            target_container: "hls".to_string(),
            target_bitrate: Some(4_000_000),
            client_platform: ClientPlatform::TvTizen,
            client_version: "test".to_string(),
            ip_address: None,
            bytes_streamed: 0,
            buffering_events: 0,
            buffering_ms_total: 0,
            stop_reason: None,
        }
    }

    #[tokio::test]
    async fn download_options_mark_original_exact_and_profiles_as_estimated() {
        let (router, state) = test_state().await;
        let mut file = media_file_at(write_temp_file(b"source"));
        // Explicit, non-zero duration avoids this handler's lazy ffprobe
        // fallback (`probe_media_duration_ms`), which would otherwise try
        // to spawn a real `ffprobe` binary this test environment may not
        // have.
        file.duration_ms = Some(3_600_000);
        file.bitrate = Some(8_000_000);
        file.size_bytes = 5_000_000_000;
        let id = file.id;
        let source_instance_id = file.source_instance_id;
        state.media_files.insert(file);
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance_id]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!("/api/v1/media/{id}/download-options"))
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
        let options: DownloadOptionsResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(options.media_file_id, id);

        let original = options
            .options
            .iter()
            .find(|option| option.id == "original")
            .expect("original option present");
        assert!(!original.size_is_estimate);
        assert_eq!(original.estimated_size_bytes, Some(5_000_000_000));

        let profile = options
            .options
            .iter()
            .find(|option| option.id == "h264-1080p-8mbps")
            .expect("1080p profile option present");
        assert!(profile.size_is_estimate);
        // 8_000_000 bps video bitrate * 3_600_000 ms / 8000 = 3_600_000_000
        // bytes -- see `media_download_options_handler`'s own estimate math.
        assert_eq!(profile.estimated_size_bytes, Some(3_600_000_000));
    }

    #[tokio::test]
    async fn download_options_requires_can_download_policy() {
        let (router, state) = test_state().await;
        let mut file = media_file_at(write_temp_file(b"source"));
        file.duration_ms = Some(3_600_000);
        let id = file.id;
        let source_instance_id = file.source_instance_id;
        state.media_files.insert(file);
        let user_id = Uuid::new_v4();
        crate::test_support::seed_streaming_user_without_download_access(
            &state,
            user_id,
            vec![source_instance_id],
        )
        .await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!("/api/v1/media/{id}/download-options"))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[test]
    fn parses_only_real_ffprobe_chapters_without_inventing_titles() {
        let chapters = parse_ffprobe_chapters(
            br#"{
                "chapters": [
                    {
                        "start_time": "0.000000",
                        "end_time": "65.432000",
                        "tags": { "title": "Opening" }
                    },
                    {
                        "start_time": "65.432000",
                        "end_time": "120.000000",
                        "tags": {}
                    },
                    {
                        "start_time": "-1.000000",
                        "end_time": "4.000000",
                        "tags": { "title": "Invalid" }
                    }
                ]
            }"#,
        )
        .unwrap();

        assert_eq!(
            chapters,
            vec![
                MediaChapter {
                    index: 0,
                    title: Some("Opening".to_string()),
                    start_ms: 0,
                    end_ms: Some(65_432),
                },
                MediaChapter {
                    index: 1,
                    title: None,
                    start_ms: 65_432,
                    end_ms: Some(120_000),
                },
            ]
        );
    }

    #[test]
    fn parses_fixed_container_duration_and_falls_back_to_longest_stream() {
        assert_eq!(
            parse_ffprobe_duration_ms(
                br#"{
                    "streams": [
                        { "duration": "120.250000" },
                        { "duration": "121.000000" }
                    ],
                    "format": { "duration": "3643.424000" }
                }"#,
            )
            .unwrap(),
            3_643_424
        );

        assert_eq!(
            parse_ffprobe_duration_ms(
                br#"{
                    "streams": [
                        { "duration": "120.250000" },
                        { "duration": "121.000000" }
                    ],
                    "format": {}
                }"#,
            )
            .unwrap(),
            121_000
        );
    }

    #[test]
    fn rejects_missing_or_non_positive_source_duration() {
        assert!(parse_ffprobe_duration_ms(
            br#"{
                "streams": [
                    { "duration": "N/A" },
                    { "duration": "-1.000000" }
                ],
                "format": { "duration": "0.000000" }
            }"#,
        )
        .is_err());
    }

    #[test]
    fn parses_source_audio_streams_with_real_indices_and_labels() {
        let tracks = parse_ffprobe_audio_tracks(
            br#"{
                "streams": [
                    {
                        "index": 1,
                        "codec_type": "audio",
                        "codec_name": "aac",
                        "channels": 2,
                        "tags": {"language": "eng", "title": "English Stereo"},
                        "disposition": {"default": 1}
                    },
                    {
                        "index": 4,
                        "codec_type": "audio",
                        "codec_name": "ac3",
                        "channels": 6,
                        "tags": {"language": "fra"},
                        "disposition": {"default": 0}
                    }
                ]
            }"#,
        )
        .unwrap();

        assert_eq!(
            tracks,
            vec![
                SourceAudioTrack {
                    stream_index: 1,
                    label: "English Stereo".to_string(),
                    language: Some("eng".to_string()),
                    codec: Some("aac".to_string()),
                    channels: Some(2),
                    profile: None,
                    codec_label: Some("AAC".to_string()),
                    is_default: true,
                },
                SourceAudioTrack {
                    stream_index: 4,
                    label: "fra \u{b7} Dolby Digital 5.1".to_string(),
                    language: Some("fra".to_string()),
                    codec: Some("ac3".to_string()),
                    channels: Some(6),
                    profile: None,
                    codec_label: Some("Dolby Digital".to_string()),
                    is_default: false,
                },
            ]
        );
    }

    #[test]
    fn exposes_text_subtitles_and_skips_bitmap_codecs() {
        let tracks = parse_ffprobe_subtitle_tracks(
            br#"{
                "streams": [
                    {
                        "index": 3,
                        "codec_type": "subtitle",
                        "codec_name": "subrip",
                        "tags": {"language": "eng", "title": "English SDH"},
                        "disposition": {"default": 1, "forced": 0}
                    },
                    {
                        "index": 4,
                        "codec_type": "subtitle",
                        "codec_name": "hdmv_pgs_subtitle",
                        "tags": {"language": "eng", "title": "English PGS"},
                        "disposition": {"default": 0, "forced": 0}
                    }
                ]
            }"#,
        )
        .unwrap();

        assert_eq!(
            tracks,
            vec![SourceSubtitleTrack {
                stream_index: 3,
                label: "English SDH".to_string(),
                language: Some("eng".to_string()),
                codec: "subrip".to_string(),
                is_default: true,
                forced: false,
                sidecar_path: None,
            }]
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn subtitle_generation_maps_the_global_stream_and_caches_webvtt() {
        use std::os::unix::fs::PermissionsExt;

        let test_root =
            std::env::temp_dir().join(format!("playarr-subtitle-test-{}", Uuid::new_v4()));
        let source_path = test_root.join("movie.mkv");
        let base_path = test_root.join("cache").join("english-base.vtt");
        let output_path = test_root.join("cache").join("english-offset.vtt");
        let fake_ffmpeg = test_root.join("fake-ffmpeg.sh");
        std::fs::create_dir_all(&test_root).unwrap();
        std::fs::write(&source_path, b"source bytes").unwrap();
        std::fs::write(
            &fake_ffmpeg,
            b"#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$(dirname \"$0\")/args.log\"\nfor output_path; do :; done\nprintf 'WEBVTT\\n\\n1\\n00:00:10.000 --> 00:00:20.000\\nOld\\n\\n2\\n00:01:00.000 --> 00:01:10.000 align:start\\nOverlap\\n\\n3\\n00:01:10.000 --> 00:01:12.000\\nFuture\\n' > \"$output_path\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&fake_ffmpeg, std::fs::Permissions::from_mode(0o755)).unwrap();

        let media_file_id = Uuid::new_v4();
        let generated = ensure_media_subtitle_at(
            media_file_id,
            &source_path,
            3,
            65_432,
            base_path.clone(),
            output_path.clone(),
            fake_ffmpeg.to_str().unwrap(),
        )
        .await
        .unwrap();

        assert_eq!(generated, output_path);
        let shifted = std::fs::read_to_string(&generated).unwrap();
        assert!(shifted.starts_with("WEBVTT"));
        assert!(!shifted.contains("Old"));
        assert!(shifted.contains("00:00:00.000 --> 00:00:04.568 align:start"));
        assert!(shifted.contains("00:00:04.568 --> 00:00:06.568"));
        let args = std::fs::read_to_string(test_root.join("args.log")).unwrap();
        let args = args.lines().collect::<Vec<_>>();
        assert!(
            !args.contains(&"-ss"),
            "subtitle extraction must never seek the remote container"
        );
        assert!(args.windows(2).any(|args| args == ["-discard:v", "all"]));
        assert!(args.windows(2).any(|args| args == ["-discard:a", "all"]));
        let map_index = args.iter().position(|arg| *arg == "-map").unwrap();
        assert_eq!(args[map_index + 1], "0:3");
        assert!(args.windows(2).any(|args| args == ["-c:s", "webvtt"]));
        assert!(base_path.exists());

        std::fs::remove_file(&source_path).unwrap();
        std::fs::remove_file(&fake_ffmpeg).unwrap();
        let cached = ensure_media_subtitle_at(
            media_file_id,
            &source_path,
            3,
            65_432,
            base_path,
            generated.clone(),
            fake_ffmpeg.to_str().unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(cached, generated);

        std::fs::remove_dir_all(&test_root).unwrap();
    }

    #[test]
    fn refines_audio_labels_from_the_ffprobe_profile() {
        assert_eq!(
            audio_codec_label(Some("dts"), Some("DTS-HD MA")).as_deref(),
            Some("DTS-HD MA")
        );
        assert_eq!(
            audio_codec_label(Some("dts"), Some("DTS-HD HRA")).as_deref(),
            Some("DTS-HD HRA")
        );
        assert_eq!(
            audio_codec_label(Some("dts"), Some("DTS")).as_deref(),
            Some("DTS")
        );
        assert_eq!(
            audio_codec_label(Some("truehd"), Some("Dolby TrueHD + Dolby Atmos")).as_deref(),
            Some("TrueHD Atmos")
        );
        assert_eq!(
            audio_codec_label(Some("eac3"), Some("Dolby Digital Plus + Dolby Atmos")).as_deref(),
            Some("Dolby Digital Plus Atmos")
        );
        let tracks = parse_ffprobe_audio_tracks(
            br#"{"streams":[{"index":1,"codec_type":"audio","codec_name":"dts","profile":"DTS-HD MA","channels":8,"tags":{"language":"eng"},"disposition":{"default":1}}]}"#,
        )
        .unwrap();
        assert_eq!(tracks[0].label, "eng \u{b7} DTS-HD MA 7.1");
        assert_eq!(tracks[0].profile.as_deref(), Some("DTS-HD MA"));
        assert_eq!(tracks[0].codec_label.as_deref(), Some("DTS-HD MA"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn sidecar_subtitle_converts_the_external_file_without_stream_discards() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!("playarr-sidecar-conv-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let video = root.join("ep.mkv");
        let srt = root.join("ep.en.srt");
        std::fs::write(&video, b"v").unwrap();
        std::fs::write(&srt, b"1\n00:00:01,000 --> 00:00:02,000\nHi\n").unwrap();
        let fake = root.join("fake-ffmpeg.sh");
        std::fs::write(
            &fake,
            b"#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$(dirname \"$0\")/args.log\"\nfor o; do :; done\nprintf 'WEBVTT\\n\\n00:00:01.000 --> 00:00:02.000\\nHi\\n' > \"$o\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();

        let tracks = crate::sidecar_subtitles::discover_sidecar_subtitles(&video).await;
        assert_eq!(tracks.len(), 1);
        let track = &tracks[0];
        let base = root.join("cache").join("base.vtt");
        let out = ensure_media_subtitle_at(
            Uuid::new_v4(),
            track.sidecar_path.as_ref().unwrap(),
            track.stream_index,
            0,
            base.clone(),
            base.clone(),
            fake.to_str().unwrap(),
        )
        .await
        .unwrap();
        assert!(std::fs::read_to_string(out).unwrap().starts_with("WEBVTT"));
        let args = std::fs::read_to_string(root.join("args.log")).unwrap();
        assert!(args.contains("ep.en.srt"));
        assert!(!args.contains("-discard:v"));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn shifts_webvtt_cues_and_drops_everything_before_the_source_offset() {
        let shifted = shift_webvtt(
            "WEBVTT\r\n\r\nNOTE generated\r\n\r\ncue-id\r\n00:00:01.000 --> 00:00:03.000\r\nOld\r\n\r\n00:00:04.000 --> 00:00:06.500 position:10%\r\nOverlap\r\n\r\n00:00:08.250 --> 00:00:09.000\r\nFuture\r\n",
            5_000,
        )
        .unwrap();

        assert!(shifted.contains("NOTE generated"));
        assert!(!shifted.contains("cue-id"));
        assert!(!shifted.contains("Old"));
        assert!(shifted.contains("00:00:00.000 --> 00:00:01.500 position:10%"));
        assert!(shifted.contains("00:00:03.250 --> 00:00:04.000"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn concurrent_offsets_share_one_base_subtitle_extraction() {
        use std::os::unix::fs::PermissionsExt;

        let test_root =
            std::env::temp_dir().join(format!("playarr-subtitle-dedupe-{}", Uuid::new_v4()));
        let source_path = test_root.join("movie.mkv");
        let base_path = test_root.join("cache").join("english-base.vtt");
        let first_path = test_root.join("cache").join("english-1000.vtt");
        let second_path = test_root.join("cache").join("english-2000.vtt");
        let fake_ffmpeg = test_root.join("fake-ffmpeg.sh");
        std::fs::create_dir_all(&test_root).unwrap();
        std::fs::write(&source_path, b"source bytes").unwrap();
        std::fs::write(
            &fake_ffmpeg,
            b"#!/bin/sh\nprintf 'run\\n' >> \"$(dirname \"$0\")/invocations.log\"\nsleep 0.1\nfor output_path; do :; done\nprintf 'WEBVTT\\n\\n00:00:03.000 --> 00:00:04.000\\nHello\\n' > \"$output_path\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&fake_ffmpeg, std::fs::Permissions::from_mode(0o755)).unwrap();

        let media_file_id = Uuid::new_v4();
        let first = ensure_media_subtitle_at(
            media_file_id,
            &source_path,
            3,
            1_000,
            base_path.clone(),
            first_path,
            fake_ffmpeg.to_str().unwrap(),
        );
        let second = ensure_media_subtitle_at(
            media_file_id,
            &source_path,
            3,
            2_000,
            base_path,
            second_path,
            fake_ffmpeg.to_str().unwrap(),
        );
        let (first, second) = tokio::join!(first, second);
        first.unwrap();
        second.unwrap();

        assert_eq!(
            std::fs::read_to_string(test_root.join("invocations.log"))
                .unwrap()
                .lines()
                .count(),
            1
        );
        assert!(std::fs::read_dir(test_root.join("cache"))
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".tmp.vtt")));
        std::fs::remove_dir_all(&test_root).unwrap();
    }

    #[tokio::test]
    async fn metadata_returns_persisted_runtime_without_reprobing() {
        let (router, state) = test_state().await;
        let mut media_file = media_file_at(PathBuf::from("/path/does/not/need/to/exist.mkv"));
        media_file.duration_ms = Some(3_643_424);
        let media_file_id = media_file.id;
        let source_instance_id = media_file.source_instance_id;
        state.media_files.insert(media_file);

        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance_id]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!("/api/v1/media/{media_file_id}/metadata"))
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
        let metadata: MediaMetadata = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(metadata.duration_ms, 3_643_424);
    }

    #[test]
    fn derives_a_persistent_artwork_root_from_sqlite_database_url() {
        assert_eq!(
            sqlite_database_parent("sqlite:///Users/example/playarr-data/playarr.db?mode=rwc"),
            Some(PathBuf::from("/Users/example/playarr-data"))
        );
        assert_eq!(
            sqlite_database_parent("mysql://playarr@example/playarr"),
            None
        );
        assert_eq!(sqlite_database_parent("sqlite::memory:"), None);
    }

    #[test]
    fn timestamped_thumbnails_have_distinct_cache_keys_and_keep_the_legacy_default() {
        let media_file_id = Uuid::new_v4();
        assert_eq!(thumbnail_position_ms(None), 30_000);
        assert_eq!(thumbnail_position_ms(Some(0)), 0);

        assert_eq!(
            thumbnail_cache_file_name(media_file_id, 30_000),
            format!("{media_file_id}.jpg")
        );
        assert_eq!(
            thumbnail_cache_file_name(media_file_id, 65_432),
            format!("{media_file_id}-65432.jpg")
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn thumbnail_generation_atomically_caches_a_jpeg() {
        use std::os::unix::fs::PermissionsExt;

        let test_root =
            std::env::temp_dir().join(format!("playarr-thumbnail-test-{}", Uuid::new_v4()));
        let source_path = test_root.join("episode.mkv");
        let output_path = test_root.join("cache").join("episode.jpg");
        let fake_ffmpeg = test_root.join("fake-ffmpeg.sh");
        std::fs::create_dir_all(&test_root).unwrap();
        std::fs::write(&source_path, b"source bytes").unwrap();
        std::fs::write(
            &fake_ffmpeg,
            b"#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$(dirname \"$0\")/args.log\"\nfor output_path; do :; done\nprintf '\\377\\330\\377\\331' > \"$output_path\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&fake_ffmpeg, std::fs::Permissions::from_mode(0o755)).unwrap();

        let media_file_id = Uuid::new_v4();
        let generated = ensure_media_thumbnail_at(
            media_file_id,
            &source_path,
            output_path.clone(),
            fake_ffmpeg.to_str().unwrap(),
            65_432,
        )
        .await
        .unwrap();

        assert_eq!(generated, output_path);
        assert_eq!(
            std::fs::read(&generated).unwrap(),
            vec![0xff, 0xd8, 0xff, 0xd9]
        );
        let args = std::fs::read_to_string(test_root.join("args.log")).unwrap();
        let args = args.lines().collect::<Vec<_>>();
        let seek_index = args.iter().position(|arg| *arg == "-ss").unwrap();
        let input_index = args.iter().position(|arg| *arg == "-i").unwrap();
        assert_eq!(args[seek_index + 1], "65.432");
        assert!(seek_index < input_index);
        assert!(
            std::fs::read_dir(generated.parent().unwrap())
                .unwrap()
                .all(|entry| !entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .contains(".tmp.jpg")),
            "atomic cache fill must not leave temporary files behind"
        );

        // Once cached, the source and ffmpeg executable are no longer
        // required. This is what makes the cache useful across a transient
        // media-mount outage or backend restart.
        std::fs::remove_file(&source_path).unwrap();
        std::fs::remove_file(&fake_ffmpeg).unwrap();
        let cached = ensure_media_thumbnail_at(
            media_file_id,
            &source_path,
            generated.clone(),
            fake_ffmpeg.to_str().unwrap(),
            65_432,
        )
        .await
        .unwrap();
        assert_eq!(cached, generated);

        std::fs::remove_dir_all(&test_root).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn thumbnail_of_a_file_without_a_video_stream_is_an_expected_miss_not_a_500() {
        use std::os::unix::fs::PermissionsExt;

        let test_root =
            std::env::temp_dir().join(format!("playarr-thumbnail-test-{}", Uuid::new_v4()));
        let source_path = test_root.join("track.flac");
        let fake_ffmpeg = test_root.join("fake-ffmpeg.sh");
        std::fs::create_dir_all(&test_root).unwrap();
        std::fs::write(&source_path, b"source bytes").unwrap();
        std::fs::write(
            &fake_ffmpeg,
            b"#!/bin/sh\necho \"Stream map '' matches no streams.\" >&2\nexit 1\n",
        )
        .unwrap();
        std::fs::set_permissions(&fake_ffmpeg, std::fs::Permissions::from_mode(0o755)).unwrap();

        let error = ensure_media_thumbnail_at(
            Uuid::new_v4(),
            &source_path,
            test_root.join("cache").join("track.jpg"),
            fake_ffmpeg.to_str().unwrap(),
            0,
        )
        .await
        .unwrap_err();
        assert_eq!(error.body.error, THUMBNAIL_UNAVAILABLE);
        assert_ne!(error.status, axum::http::StatusCode::INTERNAL_SERVER_ERROR);

        std::fs::remove_dir_all(&test_root).unwrap();
    }

    #[tokio::test]
    async fn thumbnail_generation_reports_an_unreachable_media_source() {
        let media_file_id = Uuid::new_v4();
        let test_root =
            std::env::temp_dir().join(format!("playarr-thumbnail-test-{}", Uuid::new_v4()));
        let error = ensure_media_thumbnail_at(
            media_file_id,
            &test_root.join("missing.mkv"),
            test_root.join("cache").join("episode.jpg"),
            "ffmpeg",
            30_000,
        )
        .await
        .unwrap_err();

        assert_eq!(error.status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(error.body.error, "media_source_unavailable");
    }

    #[tokio::test]
    async fn chapters_endpoint_returns_404_for_unknown_media_file() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!("/api/v1/media/{}/chapters", Uuid::new_v4()))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn thumbnail_endpoint_returns_404_for_unknown_media_file() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!("/api/v1/media/{}/thumbnail", Uuid::new_v4()))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn thumbnail_endpoint_requires_a_bearer_token() {
        let (router, _state) = test_state().await;
        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!("/api/v1/media/{}/thumbnail", Uuid::new_v4()))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn subtitle_endpoint_returns_404_for_unknown_media_file() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!(
                        "/api/v1/media/{}/subtitles/3?source_offset_ms=65432",
                        Uuid::new_v4()
                    ))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    /// Still true now that this handler also accepts a cookie/capability
    /// query in place of a bearer (see [`hls_cookie_playback_session`]):
    /// with genuinely no credentials at all -- no header, no cookie, no
    /// `playback_session_id` -- there is nothing to authorise off of.
    #[tokio::test]
    async fn subtitle_endpoint_requires_a_bearer_token() {
        let (router, _state) = test_state().await;
        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!("/api/v1/media/{}/subtitles/3", Uuid::new_v4()))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn subtitle_endpoint_authorises_via_playback_session_query_param_without_a_bearer_token()
    {
        let (router, state) = test_state().await;
        let media_file_id = Uuid::new_v4();
        let playback_session = active_playback_session(media_file_id);
        seed_session_owner(&state, &playback_session, media_file_id).await;
        let playback_session_id = playback_session.id;
        state.app.session_registry.insert(playback_session);

        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!(
                        "/api/v1/media/{media_file_id}/subtitles/3?playback_session_id={playback_session_id}"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        // No bearer token and no cookie were sent at all. If the capability
        // query param had been ignored, `OptionalStreamingUser` would
        // resolve to `None` and `hls_cookie_playback_session` would 401
        // before the handler ever looked at `media_file_id`. Reaching the
        // handler's own "unknown media file" branch instead (this
        // `media_file_id` was never inserted into `state.media_files`)
        // proves the query param alone satisfied authorisation.
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn direct_play_stream_returns_full_file_bytes() {
        let (router, state) = test_state().await;
        let contents = b"hello playarr direct play bytes".to_vec();
        let path = write_temp_file(&contents);
        let file = media_file_at(path.clone());
        let id = file.id;
        let source_instance_id = file.source_instance_id;
        state.media_files.insert(file);
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance_id]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!("/api/v1/media/{id}/stream"))
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
        assert_eq!(bytes.as_ref(), contents.as_slice());

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn direct_play_stream_honors_range_requests() {
        let (router, state) = test_state().await;
        let contents = b"0123456789abcdefghij".to_vec();
        let path = write_temp_file(&contents);
        let file = media_file_at(path.clone());
        let id = file.id;
        let source_instance_id = file.source_instance_id;
        state.media_files.insert(file);
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance_id]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!("/api/v1/media/{id}/stream"))
                    .header("Authorization", bearer_header(&token))
                    .header("Range", "bytes=0-4")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        let content_range = response
            .headers()
            .get("content-range")
            .expect("Content-Range header on a 206 response")
            .to_str()
            .unwrap()
            .to_string();
        assert_eq!(content_range, "bytes 0-4/20");
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(bytes.as_ref(), b"01234");

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn active_playback_session_authorises_native_range_requests() {
        let (router, state) = test_state().await;
        let contents = b"0123456789abcdefghij".to_vec();
        let path = write_temp_file(&contents);
        let mut file = media_file_at(path.clone());
        file.duration_ms = Some(180_000);
        let id = file.id;
        let source_instance_id = file.source_instance_id;
        state.media_files.insert(file);
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance_id]).await;
        let token = mint_access_token(&state, user_id);

        let mut negotiation_request = HttpRequest::builder()
            .uri(format!(
                "/api/v1/playback/{id}?containers=mp4&video_codecs=h264"
            ))
            .header("Authorization", bearer_header(&token))
            .body(Body::empty())
            .unwrap();
        negotiation_request
            .extensions_mut()
            .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 51234))));
        let negotiation_response = router.clone().oneshot(negotiation_request).await.unwrap();
        assert_eq!(negotiation_response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(negotiation_response.into_body(), usize::MAX)
            .await
            .unwrap();
        let info: crate::playback::PlaybackInfoResponse = serde_json::from_slice(&body).unwrap();

        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(info.url)
                    .header("Range", "bytes=5-9")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(bytes.as_ref(), b"56789");
        assert_eq!(
            state
                .app
                .session_registry
                .get(info.session_id)
                .expect("negotiated session should remain active")
                .bytes_streamed,
            5
        );

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn stream_unknown_media_file_is_404() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!("/api/v1/media/{}/stream", Uuid::new_v4()))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn stream_without_bearer_token_is_401() {
        let (router, state) = test_state().await;
        let contents = b"irrelevant".to_vec();
        let path = write_temp_file(&contents);
        let file = media_file_at(path.clone());
        let id = file.id;
        state.media_files.insert(file);

        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!("/api/v1/media/{id}/stream"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        let _ = std::fs::remove_file(&path);
    }

    /// Per-user library access control end-to-end for direct-play
    /// streaming: a caller whose `Policy::library_allow` doesn't include
    /// the file's `source_instance_id` is forbidden, even though the file
    /// genuinely exists and is otherwise servable.
    #[tokio::test]
    async fn stream_is_forbidden_outside_the_callers_allowed_libraries() {
        let (router, state) = test_state().await;
        let contents = b"restricted bytes".to_vec();
        let path = write_temp_file(&contents);
        let file = media_file_at(path.clone());
        let id = file.id;
        state.media_files.insert(file);

        let user_id = Uuid::new_v4();
        // Allowed for a source instance other than this file's own.
        seed_streaming_user_with_library_allow(&state, user_id, vec![Uuid::new_v4()]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!("/api/v1/media/{id}/stream"))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn unknown_rendition_id_is_404() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!(
                        "/api/v1/media/renditions/{}/playlist.m3u8",
                        Uuid::new_v4()
                    ))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn unknown_session_id_is_404() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!(
                        "/api/v1/media/sessions/{}/playlist.m3u8",
                        Uuid::new_v4()
                    ))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn active_playback_cookie_authorises_rendition_and_tracks_bytes() {
        let (router, state) = test_state().await;
        let contents = b"#EXTM3U\n#EXT-X-ENDLIST\n".to_vec();
        let output_dir =
            std::env::temp_dir().join(format!("playarr-rendition-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&output_dir).unwrap();
        std::fs::write(output_dir.join("playlist.m3u8"), &contents).unwrap();

        let source = write_temp_file(b"source");
        let media_file = media_file_at(source.clone());
        let media_file_id = media_file.id;
        state.media_files.insert(media_file);
        let rendition = Rendition {
            id: Uuid::new_v4(),
            media_file_id,
            profile: "h264-720p-4mbps".to_string(),
            container: "hls".to_string(),
            codec: "h264".to_string(),
            bitrate: Some(4_000_000),
            output_path: output_dir.clone(),
            produced_by: ProducedBy::Tdarr,
            produced_at: chrono::Utc::now(),
            status: RenditionStatus::Ready,
        };
        state.rendition_repo.upsert(&rendition).await.unwrap();

        let playback_session = active_playback_session(media_file_id);
        seed_session_owner(&state, &playback_session, media_file_id).await;
        let playback_session_id = playback_session.id;
        state.app.session_registry.insert(playback_session);

        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!(
                        "/api/v1/media/renditions/{}/playlist.m3u8",
                        rendition.id
                    ))
                    .header(
                        axum::http::header::COOKIE,
                        format!("display=tv; {PLAYBACK_SESSION_COOKIE_NAME}={playback_session_id}"),
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(bytes.as_ref(), contents.as_slice());
        assert_eq!(
            state
                .app
                .session_registry
                .get(playback_session_id)
                .expect("cookie-authorised playback session remains active")
                .bytes_streamed,
            contents.len() as u64
        );

        let _ = std::fs::remove_file(source);
        let _ = std::fs::remove_dir_all(output_dir);
    }

    #[tokio::test]
    async fn active_playback_query_param_authorises_rendition_and_tracks_bytes() {
        let (router, state) = test_state().await;
        let contents = b"#EXTM3U\n#EXT-X-ENDLIST\n".to_vec();
        let output_dir =
            std::env::temp_dir().join(format!("playarr-rendition-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&output_dir).unwrap();
        std::fs::write(output_dir.join("playlist.m3u8"), &contents).unwrap();

        let source = write_temp_file(b"source");
        let media_file = media_file_at(source.clone());
        let media_file_id = media_file.id;
        state.media_files.insert(media_file);
        let rendition = Rendition {
            id: Uuid::new_v4(),
            media_file_id,
            profile: "h264-720p-4mbps".to_string(),
            container: "hls".to_string(),
            codec: "h264".to_string(),
            bitrate: Some(4_000_000),
            output_path: output_dir.clone(),
            produced_by: ProducedBy::Tdarr,
            produced_at: chrono::Utc::now(),
            status: RenditionStatus::Ready,
        };
        state.rendition_repo.upsert(&rendition).await.unwrap();

        let playback_session = active_playback_session(media_file_id);
        seed_session_owner(&state, &playback_session, media_file_id).await;
        let playback_session_id = playback_session.id;
        state.app.session_registry.insert(playback_session);

        // No Cookie header at all -- this is the Cast receiver's own path:
        // its `PlaybackConfig.segmentRequestHandler` can only append a
        // query param to the (already relative) segment URI, never attach
        // a cookie the way Samsung AVPlay's native player does.
        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!(
                        "/api/v1/media/renditions/{}/playlist.m3u8?playback_session_id={playback_session_id}",
                        rendition.id
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(bytes.as_ref(), contents.as_slice());
        assert_eq!(
            state
                .app
                .session_registry
                .get(playback_session_id)
                .expect("query-param-authorised playback session remains active")
                .bytes_streamed,
            contents.len() as u64
        );

        let _ = std::fs::remove_file(source);
        let _ = std::fs::remove_dir_all(output_dir);
    }

    #[tokio::test]
    async fn rendition_cookie_session_takes_priority_over_a_query_param_session() {
        let (router, state) = test_state().await;
        let output_dir =
            std::env::temp_dir().join(format!("playarr-rendition-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&output_dir).unwrap();
        std::fs::write(output_dir.join("playlist.m3u8"), b"#EXTM3U\n").unwrap();

        let source = write_temp_file(b"source");
        let media_file = media_file_at(source.clone());
        let media_file_id = media_file.id;
        state.media_files.insert(media_file);
        let rendition = Rendition {
            id: Uuid::new_v4(),
            media_file_id,
            profile: "h264-720p-4mbps".to_string(),
            container: "hls".to_string(),
            codec: "h264".to_string(),
            bitrate: Some(4_000_000),
            output_path: output_dir.clone(),
            produced_by: ProducedBy::Tdarr,
            produced_at: chrono::Utc::now(),
            status: RenditionStatus::Ready,
        };
        state.rendition_repo.upsert(&rendition).await.unwrap();

        // Two distinct, independently-valid sessions for the same media
        // file: one named by the cookie, a different one named by the
        // query param. `hls_cookie_playback_session` resolves "cookie
        // first, query second", so only the cookie's session should ever
        // be looked up or tracked.
        let cookie_session = active_playback_session(media_file_id);
        seed_session_owner(&state, &cookie_session, media_file_id).await;
        let cookie_session_id = cookie_session.id;
        state.app.session_registry.insert(cookie_session);
        let query_session = active_playback_session(media_file_id);
        seed_session_owner(&state, &query_session, media_file_id).await;
        let query_session_id = query_session.id;
        state.app.session_registry.insert(query_session);

        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!(
                        "/api/v1/media/renditions/{}/playlist.m3u8?playback_session_id={query_session_id}",
                        rendition.id
                    ))
                    .header(
                        axum::http::header::COOKIE,
                        format!("{PLAYBACK_SESSION_COOKIE_NAME}={cookie_session_id}"),
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        // `track_streamed_bytes` only increments as the body stream is
        // actually polled, so the response body must be drained before
        // `bytes_streamed` reflects anything.
        let _ = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert!(
            state
                .app
                .session_registry
                .get(cookie_session_id)
                .unwrap()
                .bytes_streamed
                > 0,
            "the cookie's session should have been tracked"
        );
        assert_eq!(
            state
                .app
                .session_registry
                .get(query_session_id)
                .unwrap()
                .bytes_streamed,
            0,
            "the query-param session must not be used when a cookie is also present"
        );

        let _ = std::fs::remove_file(source);
        let _ = std::fs::remove_dir_all(output_dir);
    }

    #[tokio::test]
    async fn rendition_cookie_rejects_missing_invalid_expired_and_mismatched_sessions() {
        let (router, state) = test_state().await;
        let output_dir =
            std::env::temp_dir().join(format!("playarr-rendition-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&output_dir).unwrap();
        std::fs::write(output_dir.join("playlist.m3u8"), b"#EXTM3U\n").unwrap();

        let source = write_temp_file(b"source");
        let media_file = media_file_at(source.clone());
        let media_file_id = media_file.id;
        state.media_files.insert(media_file);
        let rendition = Rendition {
            id: Uuid::new_v4(),
            media_file_id,
            profile: "h264-720p-4mbps".to_string(),
            container: "hls".to_string(),
            codec: "h264".to_string(),
            bitrate: Some(4_000_000),
            output_path: output_dir.clone(),
            produced_by: ProducedBy::Tdarr,
            produced_at: chrono::Utc::now(),
            status: RenditionStatus::Ready,
        };
        state.rendition_repo.upsert(&rendition).await.unwrap();
        let uri = format!("/api/v1/media/renditions/{}/playlist.m3u8", rendition.id);

        let missing = router
            .clone()
            .oneshot(
                HttpRequest::builder()
                    .uri(&uri)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);

        let invalid = router
            .clone()
            .oneshot(
                HttpRequest::builder()
                    .uri(&uri)
                    .header(
                        axum::http::header::COOKIE,
                        format!("{PLAYBACK_SESSION_COOKIE_NAME}=not-a-uuid"),
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(invalid.status(), StatusCode::UNAUTHORIZED);

        let expired = router
            .clone()
            .oneshot(
                HttpRequest::builder()
                    .uri(&uri)
                    .header(
                        axum::http::header::COOKIE,
                        format!("{PLAYBACK_SESSION_COOKIE_NAME}={}", Uuid::new_v4()),
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(expired.status(), StatusCode::UNAUTHORIZED);

        let mismatched_session = active_playback_session(Uuid::new_v4());
        let mismatched_session_id = mismatched_session.id;
        state.app.session_registry.insert(mismatched_session);
        let mismatched = router
            .oneshot(
                HttpRequest::builder()
                    .uri(&uri)
                    .header(
                        axum::http::header::COOKIE,
                        format!("{PLAYBACK_SESSION_COOKIE_NAME}={mismatched_session_id}"),
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(mismatched.status(), StatusCode::UNAUTHORIZED);

        let _ = std::fs::remove_file(source);
        let _ = std::fs::remove_dir_all(output_dir);
    }

    #[tokio::test]
    async fn rendition_query_param_rejects_invalid_and_mismatched_sessions() {
        let (router, state) = test_state().await;
        let output_dir =
            std::env::temp_dir().join(format!("playarr-rendition-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&output_dir).unwrap();
        std::fs::write(output_dir.join("playlist.m3u8"), b"#EXTM3U\n").unwrap();

        let source = write_temp_file(b"source");
        let media_file = media_file_at(source.clone());
        let media_file_id = media_file.id;
        state.media_files.insert(media_file);
        let rendition = Rendition {
            id: Uuid::new_v4(),
            media_file_id,
            profile: "h264-720p-4mbps".to_string(),
            container: "hls".to_string(),
            codec: "h264".to_string(),
            bitrate: Some(4_000_000),
            output_path: output_dir.clone(),
            produced_by: ProducedBy::Tdarr,
            produced_at: chrono::Utc::now(),
            status: RenditionStatus::Ready,
        };
        state.rendition_repo.upsert(&rendition).await.unwrap();
        let uri = format!("/api/v1/media/renditions/{}/playlist.m3u8", rendition.id);

        // Malformed: axum's `Query<HlsCapabilityQuery>` extractor itself
        // rejects this before the handler body ever runs, so this is a 400
        // (query deserialization failure), not the 401 an invalid cookie
        // value produces.
        let invalid = router
            .clone()
            .oneshot(
                HttpRequest::builder()
                    .uri(format!("{uri}?playback_session_id=not-a-uuid"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);

        // Well-formed but unknown/expired.
        let expired = router
            .clone()
            .oneshot(
                HttpRequest::builder()
                    .uri(format!("{uri}?playback_session_id={}", Uuid::new_v4()))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(expired.status(), StatusCode::UNAUTHORIZED);

        // Active, but negotiated for a different media file -- the
        // `media_file_id` equality check inside `hls_tracking_session_id`
        // is unchanged and must still scope the query-param path exactly
        // as it already scopes the cookie path.
        let mismatched_session = active_playback_session(Uuid::new_v4());
        let mismatched_session_id = mismatched_session.id;
        state.app.session_registry.insert(mismatched_session);
        let mismatched = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!("{uri}?playback_session_id={mismatched_session_id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(mismatched.status(), StatusCode::UNAUTHORIZED);

        let _ = std::fs::remove_file(source);
        let _ = std::fs::remove_dir_all(output_dir);
    }

    #[tokio::test]
    async fn active_playback_cookie_authorises_live_session_and_tracks_bytes() {
        let (router, state) = test_state().await;
        let contents = b"#EXTM3U\n#EXT-X-VERSION:3\n".to_vec();
        let source = write_temp_file(b"source");
        let media_file = media_file_at(source.clone());
        let media_file_id = media_file.id;
        state.media_files.insert(media_file.clone());
        let transcode_session = state
            .app
            .transcode
            .spawn_on_demand_transcode(&media_file, "h264-720p-4mbps", "test-node")
            .await
            .unwrap();
        let output_dir = state.app.transcode.session_output_dir(transcode_session.id);
        tokio::fs::write(output_dir.join("playlist.m3u8"), &contents)
            .await
            .unwrap();

        let playback_session = active_playback_session(media_file_id);
        seed_session_owner(&state, &playback_session, media_file_id).await;
        let playback_session_id = playback_session.id;
        state.app.session_registry.insert(playback_session);

        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!(
                        "/api/v1/media/sessions/{}/playlist.m3u8",
                        transcode_session.id
                    ))
                    .header(
                        axum::http::header::COOKIE,
                        format!("{PLAYBACK_SESSION_COOKIE_NAME}={playback_session_id}"),
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(bytes.as_ref(), contents.as_slice());
        assert_eq!(
            state
                .app
                .session_registry
                .get(playback_session_id)
                .expect("cookie-authorised playback session remains active")
                .bytes_streamed,
            contents.len() as u64
        );

        state
            .app
            .transcode
            .expire_session(transcode_session.id)
            .await
            .unwrap();
        let _ = std::fs::remove_file(source);
    }

    #[tokio::test]
    async fn active_playback_query_param_authorises_live_session_and_tracks_bytes() {
        let (router, state) = test_state().await;
        let contents = b"#EXTM3U\n#EXT-X-VERSION:3\n".to_vec();
        let source = write_temp_file(b"source");
        let media_file = media_file_at(source.clone());
        let media_file_id = media_file.id;
        state.media_files.insert(media_file.clone());
        let transcode_session = state
            .app
            .transcode
            .spawn_on_demand_transcode(&media_file, "h264-720p-4mbps", "test-node")
            .await
            .unwrap();
        let output_dir = state.app.transcode.session_output_dir(transcode_session.id);
        tokio::fs::write(output_dir.join("playlist.m3u8"), &contents)
            .await
            .unwrap();

        let playback_session = active_playback_session(media_file_id);
        seed_session_owner(&state, &playback_session, media_file_id).await;
        let playback_session_id = playback_session.id;
        state.app.session_registry.insert(playback_session);

        // Same as `active_playback_query_param_authorises_rendition_and_tracks_bytes`,
        // but for the live/on-demand transcode session route -- no Cookie
        // header at all, `playback_session_id` on the URI instead.
        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!(
                        "/api/v1/media/sessions/{}/playlist.m3u8?playback_session_id={playback_session_id}",
                        transcode_session.id
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(bytes.as_ref(), contents.as_slice());
        assert_eq!(
            state
                .app
                .session_registry
                .get(playback_session_id)
                .expect("query-param-authorised playback session remains active")
                .bytes_streamed,
            contents.len() as u64
        );

        state
            .app
            .transcode
            .expire_session(transcode_session.id)
            .await
            .unwrap();
        let _ = std::fs::remove_file(source);
    }

    #[tokio::test]
    async fn live_session_request_waits_for_ffmpeg_to_write_the_manifest() {
        let (router, state) = test_state().await;
        let source = write_temp_file(b"source");
        let media_file = media_file_at(source.clone());
        let source_instance_id = media_file.source_instance_id;
        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![source_instance_id]).await;
        let token = mint_access_token(&state, user_id);
        // `serve_session_file_handler` now resolves the session's owning
        // `MediaFile` to enforce per-user library access control (see the
        // module doc comment) -- it must be registered the same way a real
        // request's `media_file_id` would already be, or the 200 this test
        // asserts on below would 404 instead.
        state.media_files.insert(media_file.clone());
        let session = state
            .app
            .transcode
            .spawn_on_demand_transcode(&media_file, "h264-720p-4mbps", "test-node")
            .await
            .unwrap();
        let output_dir = state.app.transcode.session_output_dir(session.id);
        let playlist_path = output_dir.join("playlist.m3u8");

        let writer = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            tokio::fs::write(&playlist_path, b"#EXTM3U\n")
                .await
                .unwrap();
        });
        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!(
                        "/api/v1/media/sessions/{}/playlist.m3u8",
                        session.id
                    ))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        writer.await.unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        state
            .app
            .transcode
            .expire_session(session.id)
            .await
            .unwrap();
        let _ = std::fs::remove_file(source);
    }

    /// Per-user library access control for a durable rendition: the
    /// underlying `MediaFile` is resolved via `Rendition::media_file_id`
    /// purely to check its `source_instance_id` -- a caller outside the
    /// owning library is forbidden even though the rendition itself
    /// genuinely exists.
    #[tokio::test]
    async fn serve_rendition_is_forbidden_outside_the_callers_allowed_libraries() {
        let (router, state) = test_state().await;
        let contents = b"#EXTM3U\n".to_vec();
        let output_dir =
            std::env::temp_dir().join(format!("playarr-rendition-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&output_dir).unwrap();
        std::fs::write(output_dir.join("playlist.m3u8"), &contents).unwrap();

        let file = media_file_at(write_temp_file(b"source"));
        let media_file_id = file.id;
        state.media_files.insert(file);

        let rendition = Rendition {
            id: Uuid::new_v4(),
            media_file_id,
            profile: "h264-720p-4mbps".to_string(),
            container: "hls".to_string(),
            codec: "h264".to_string(),
            bitrate: Some(4_000_000),
            output_path: output_dir.clone(),
            produced_by: ProducedBy::Tdarr,
            produced_at: chrono::Utc::now(),
            status: RenditionStatus::Ready,
        };
        state.rendition_repo.upsert(&rendition).await.unwrap();

        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![Uuid::new_v4()]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!(
                        "/api/v1/media/renditions/{}/playlist.m3u8",
                        rendition.id
                    ))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);

        let _ = std::fs::remove_dir_all(&output_dir);
    }

    /// Same enforcement as the rendition test above, for a live on-demand
    /// `TranscodeSession` instead.
    #[tokio::test]
    async fn serve_session_file_is_forbidden_outside_the_callers_allowed_libraries() {
        let (router, state) = test_state().await;
        let source = write_temp_file(b"source");
        let media_file = media_file_at(source.clone());
        state.media_files.insert(media_file.clone());
        let session = state
            .app
            .transcode
            .spawn_on_demand_transcode(&media_file, "h264-720p-4mbps", "test-node")
            .await
            .unwrap();

        let user_id = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user_id, vec![Uuid::new_v4()]).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!(
                        "/api/v1/media/sessions/{}/playlist.m3u8",
                        session.id
                    ))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);

        state
            .app
            .transcode
            .expire_session(session.id)
            .await
            .unwrap();
        let _ = std::fs::remove_file(source);
    }

    #[tokio::test]
    async fn rendition_path_traversal_file_name_is_400() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!(
                        "/api/v1/media/renditions/{}/..%2F..%2Fetc%2Fpasswd",
                        Uuid::new_v4()
                    ))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn validate_segment_file_name_accepts_plain_names() {
        assert!(validate_segment_file_name("playlist.m3u8").is_ok());
        assert!(validate_segment_file_name("segment000.ts").is_ok());
        assert!(validate_segment_file_name("segment-12.ts").is_ok());
    }

    #[test]
    fn validate_segment_file_name_rejects_traversal() {
        assert!(validate_segment_file_name("../../etc/passwd").is_err());
        assert!(validate_segment_file_name("foo/bar").is_err());
        assert!(validate_segment_file_name("..").is_err());
        assert!(validate_segment_file_name("foo\\bar").is_err());
        assert!(validate_segment_file_name("..segment.ts").is_err());
        assert!(validate_segment_file_name("").is_err());
    }
}
