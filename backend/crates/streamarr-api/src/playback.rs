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

use async_trait::async_trait;
use axum::extract::{Path, Query, State};
use axum::Json;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use streamarr_model::MediaFile;
use streamarr_transcode::ClientCapabilities;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::error::ApiError;
use crate::AppState;

/// Resolves a [`MediaFile`] by id. There is no `MediaFileRepo` anywhere in
/// `streamarr-db` yet (`streamarr-transcode`'s own docs note the same gap:
/// "There is no `MediaFileRepo` in `streamarr-db` yet ... dispatch is
/// entirely event-driven") -- no *arr import pipeline populates media files
/// as of this pass. This trait is the seam a follow-up that adds one can
/// implement against, mirroring how `streamarr-requests` defines
/// `SourceInstanceLookup` for the same kind of not-yet-built persistence.
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
}

fn split_csv(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
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
        (status = 200, description = "Direct-play URL or HLS manifest URL", body = PlaybackInfoResponse),
        (status = 404, description = "Unknown media_file_id"),
        (status = 503, description = "No on-demand transcode capacity available on this node")
    )
)]
pub async fn playback_info_handler(
    State(state): State<AppState>,
    Path(media_file_id): Path<Uuid>,
    Query(query): Query<PlaybackQuery>,
) -> Result<Json<PlaybackInfoResponse>, ApiError> {
    let media_file = state
        .media_files
        .get(media_file_id)
        .await
        .ok_or_else(|| ApiError::not_found(format!("unknown media file {media_file_id}")))?;

    let capabilities: ClientCapabilities = (&query).into();
    let profile = query
        .profile
        .clone()
        .unwrap_or_else(|| DEFAULT_PROFILE.to_string());

    // Step 1: can the source file be served byte-for-byte?
    if state.transcode.can_direct_play(&media_file, &capabilities) {
        return Ok(Json(PlaybackInfoResponse {
            mode: PlaybackMode::Direct,
            url: format!("/api/v1/media/{media_file_id}/stream"),
        }));
    }

    // Step 2: is there already a ready rendition (Tdarr or a previous
    // on-demand session)?
    if let Some(rendition) = state
        .transcode
        .find_existing_rendition(media_file_id, &profile)
        .await?
    {
        return Ok(Json(PlaybackInfoResponse {
            mode: PlaybackMode::Hls,
            url: format!("/api/v1/media/renditions/{}/playlist.m3u8", rendition.id),
        }));
    }

    // Step 3, last resort: spawn a new on-demand transcode.
    let session = state
        .transcode
        .spawn_on_demand_transcode(&media_file, &profile, &state.node_id)
        .await?;

    Ok(Json(PlaybackInfoResponse {
        mode: PlaybackMode::Hls,
        url: format!("/api/v1/media/sessions/{}/playlist.m3u8", session.id),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::test_state;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use streamarr_model::media::LeafRef;
    use std::path::PathBuf;
    use tower::ServiceExt;

    fn media_file() -> MediaFile {
        MediaFile {
            id: Uuid::new_v4(),
            work_id: Uuid::new_v4(),
            leaf_ref: LeafRef::Work,
            path: PathBuf::from("/media/movies/Sample.mkv"),
            container: "mkv".to_string(),
            codec: "hevc".to_string(),
            bitrate: Some(15_000_000),
            size_bytes: 4_000_000_000,
            source_instance_id: Uuid::new_v4(),
            source_file_id: Some("1".to_string()),
        }
    }

    #[tokio::test]
    async fn unknown_media_file_is_404() {
        let (router, _state) = test_state().await;
        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/playback/{}", Uuid::new_v4()))
                    .body(Body::empty())
                    .unwrap(),
            )
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
        let id = file.id;
        state.media_files.insert(file);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/v1/playback/{id}?containers=mp4&video_codecs=h264"
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
        let info: PlaybackInfoResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(info.mode, PlaybackMode::Direct);
    }

    #[tokio::test]
    async fn spawns_on_demand_transcode_when_incompatible_and_no_rendition() {
        let (router, state) = test_state().await;
        let file = media_file(); // mkv/hevc, incompatible with mp4/h264 client
        let id = file.id;
        state.media_files.insert(file);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/v1/playback/{id}?containers=mp4&video_codecs=h264"
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
        let info: PlaybackInfoResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(info.mode, PlaybackMode::Hls);
        assert!(info.url.contains("/sessions/"));
    }
}
