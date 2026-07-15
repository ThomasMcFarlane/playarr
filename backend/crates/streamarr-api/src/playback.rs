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
    use std::path::PathBuf;
    use streamarr_model::media::LeafRef;
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
