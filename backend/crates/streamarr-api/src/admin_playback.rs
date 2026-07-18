//! Admin playback-activity diagnostics: `GET
//! /api/v1/admin/playback/sessions/active` (live "who's watching now"),
//! `GET /api/v1/admin/playback/sessions/history` (filtered/paginated raw
//! session history), and `POST /api/v1/admin/playback/sessions/{id}/stop`
//! (force-stop a live session, e.g. an in-progress transcode an operator
//! wants to cancel) -- mirrors the existing `/api/v1/admin/source-instances*`
//! prefix convention. All three gated by [`AdminUser`].

use axum::extract::{Path, Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use streamarr_catalog::{WorkChildren, WorkDetail};
use streamarr_db::analytics::SessionFilter;
use streamarr_model::media::LeafRef;
use streamarr_model::{ClientPlatform, PlayMethod, PlaybackSession, StopReason, TranscodeReason};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::auth_extractor::AdminUser;
use crate::error::ApiError;
use crate::AppState;

/// One live session, enriched with the labels and route target used by the
/// administrator Activity and Tasks pages.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ActiveSessionView {
    pub session_id: Uuid,
    pub user_id: Uuid,
    /// Best-effort `UserRepo` lookup; `None` on a lookup miss/failure,
    /// never surfaced as an error -- a live-sessions view degrading to
    /// showing a bare id for one row is far better than failing the whole
    /// list over one bad lookup.
    pub user_display_name: Option<String>,
    pub device_id: Uuid,
    pub media_file_id: Uuid,
    /// Best-effort media-file lookup; provides the route target for the
    /// linked item title in Streamarr Admin.
    pub work_id: Option<Uuid>,
    /// Best-effort `CatalogService` lookup. For child media, this names the
    /// actual episode, track, or book rather than only its parent work.
    pub media_title: Option<String>,
    pub play_method: PlayMethod,
    pub target_codec: String,
    pub target_container: String,
    pub client_platform: ClientPlatform,
    pub client_version: String,
    pub started_at: chrono::DateTime<chrono::Utc>,
    pub bytes_streamed: u64,
    pub buffering_events: u32,
    pub buffering_ms_total: u64,
}

/// Historical playback-session fields plus the same best-effort linked
/// user/media context as [`ActiveSessionView`]. The original raw-session
/// fields stay intact so enriching the endpoint remains backwards compatible.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SessionHistoryView {
    pub id: Uuid,
    pub user_id: Uuid,
    pub user_display_name: Option<String>,
    pub device_id: Uuid,
    pub media_file_id: Uuid,
    pub work_id: Option<Uuid>,
    pub media_title: Option<String>,
    pub rendition_id: Option<Uuid>,
    pub started_at: chrono::DateTime<chrono::Utc>,
    pub ended_at: Option<chrono::DateTime<chrono::Utc>>,
    pub play_method: PlayMethod,
    pub transcode_reason: Option<TranscodeReason>,
    pub source_codec: String,
    pub source_container: String,
    pub source_bitrate: Option<u64>,
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

struct SessionContext {
    user_display_name: Option<String>,
    work_id: Option<Uuid>,
    media_title: Option<String>,
}

fn media_title(detail: &WorkDetail, leaf_ref: LeafRef) -> String {
    let child_title = match (&detail.children, leaf_ref) {
        (WorkChildren::Series(seasons), LeafRef::Episode(episode_id)) => seasons
            .iter()
            .flat_map(|season| season.episodes.iter().map(move |episode| (season, episode)))
            .find(|(_, episode)| episode.episode.id == episode_id)
            .map(|(season, episode)| {
                episode.episode.title.clone().unwrap_or_else(|| {
                    format!(
                        "S{:02}E{:02}",
                        season.season.season_number, episode.episode.episode_number
                    )
                })
            }),
        (WorkChildren::Artist(albums), LeafRef::Track(track_id)) => albums
            .iter()
            .flat_map(|album| &album.tracks)
            .find(|track| track.track.id == track_id)
            .map(|track| track.track.title.clone()),
        (WorkChildren::Author(books), LeafRef::Book(book_id)) => books
            .iter()
            .find(|book| book.book.id == book_id)
            .map(|book| book.book.title.clone()),
        _ => None,
    };

    match child_title {
        Some(title) => format!("{} — {title}", detail.work.title),
        None => detail.work.title.clone(),
    }
}

async fn session_context(state: &AppState, session: &PlaybackSession) -> SessionContext {
    let user_display_name = match state.user_repo.find_by_id(session.user_id).await {
        Ok(Some(user)) => Some(user.display_name),
        Ok(None) => None,
        Err(err) => {
            tracing::warn!(
                user_id = %session.user_id,
                error = %err,
                "admin active-sessions: user lookup failed; leaving display name unset"
            );
            None
        }
    };

    let (work_id, media_title) = match state.media_files.get(session.media_file_id).await {
        // `None` (unrestricted): this whole surface is admin-only diagnostics
        // ("every session, every user" per the module doc comment) -- a
        // per-viewer `library_allow` restriction doesn't apply to an admin's
        // global activity view.
        Some(media_file) => match state.catalog.get_by_id(media_file.work_id, None).await {
            Ok(detail) => (
                Some(media_file.work_id),
                Some(media_title(&detail, media_file.leaf_ref)),
            ),
            Err(err) => {
                tracing::warn!(
                    media_file_id = %session.media_file_id,
                    work_id = %media_file.work_id,
                    error = %err,
                    "admin active-sessions: work lookup failed; leaving media title unset"
                );
                (Some(media_file.work_id), None)
            }
        },
        None => (None, None),
    };

    SessionContext {
        user_display_name,
        work_id,
        media_title,
    }
}

async fn enrich_active(state: &AppState, session: PlaybackSession) -> ActiveSessionView {
    let context = session_context(state, &session).await;
    ActiveSessionView {
        session_id: session.id,
        user_id: session.user_id,
        user_display_name: context.user_display_name,
        device_id: session.device_id,
        media_file_id: session.media_file_id,
        work_id: context.work_id,
        media_title: context.media_title,
        play_method: session.play_method,
        target_codec: session.target_codec,
        target_container: session.target_container,
        client_platform: session.client_platform,
        client_version: session.client_version,
        started_at: session.started_at,
        bytes_streamed: session.bytes_streamed,
        buffering_events: session.buffering_events,
        buffering_ms_total: session.buffering_ms_total,
    }
}

async fn enrich_history(state: &AppState, session: PlaybackSession) -> SessionHistoryView {
    let context = session_context(state, &session).await;
    SessionHistoryView {
        id: session.id,
        user_id: session.user_id,
        user_display_name: context.user_display_name,
        device_id: session.device_id,
        media_file_id: session.media_file_id,
        work_id: context.work_id,
        media_title: context.media_title,
        rendition_id: session.rendition_id,
        started_at: session.started_at,
        ended_at: session.ended_at,
        play_method: session.play_method,
        transcode_reason: session.transcode_reason,
        source_codec: session.source_codec,
        source_container: session.source_container,
        source_bitrate: session.source_bitrate,
        target_codec: session.target_codec,
        target_container: session.target_container,
        target_bitrate: session.target_bitrate,
        client_platform: session.client_platform,
        client_version: session.client_version,
        ip_address: session.ip_address,
        bytes_streamed: session.bytes_streamed,
        buffering_events: session.buffering_events,
        buffering_ms_total: session.buffering_ms_total,
        stop_reason: session.stop_reason,
    }
}

/// Every currently-active playback session, newest first -- backs the
/// admin Activity page's "live" section. Concurrently-active sessions are a
/// small set (dozens, not thousands), so the N+1 user/media lookups
/// `enrich_active` does per row are acceptable here.
#[utoipa::path(
    get,
    path = "/api/v1/admin/playback/sessions/active",
    tag = "admin",
    responses(
        (status = 200, description = "Every currently-active playback session", body = Vec<ActiveSessionView>),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn list_active_sessions_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Json<Vec<ActiveSessionView>> {
    let mut sessions = state.session_registry.list_all();
    sessions.sort_by(|a, b| b.started_at.cmp(&a.started_at));

    let mut views = Vec::with_capacity(sessions.len());
    for session in sessions {
        views.push(enrich_active(&state, session).await);
    }

    Json(views)
}

fn default_limit() -> i64 {
    100
}

#[derive(Debug, Deserialize, ToSchema, IntoParams)]
pub struct SessionHistoryQuery {
    pub user_id: Option<Uuid>,
    pub from: Option<chrono::DateTime<chrono::Utc>>,
    pub to: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

/// Filtered, paginated and enriched session history -- backs the admin Activity
/// page's "history" section. `limit` is clamped to 500 server-side
/// regardless of what's requested, matching the two indexes
/// (`idx_playback_sessions_user_id`/`idx_playback_sessions_started_at`)
/// this query is built to actually use.
#[utoipa::path(
    get,
    path = "/api/v1/admin/playback/sessions/history",
    tag = "admin",
    params(SessionHistoryQuery),
    responses(
        (status = 200, description = "Filtered, paginated playback session history, newest first", body = Vec<SessionHistoryView>),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn list_session_history_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Query(query): Query<SessionHistoryQuery>,
) -> Result<Json<Vec<SessionHistoryView>>, ApiError> {
    let filter = SessionFilter {
        user_id: query.user_id,
        from: query.from,
        to: query.to,
        limit: query.limit.min(500),
        offset: query.offset,
    };
    let sessions = state.analytics_store.list_sessions(&filter).await?;
    let mut views = Vec::with_capacity(sessions.len());
    for session in sessions {
        views.push(enrich_history(&state, session).await);
    }
    Ok(Json(views))
}

/// Force-stops a live playback session -- the "let me stop it" half of the
/// admin Activity/Tasks in-progress-transcode view. Kills the underlying
/// ffmpeg process too, if this session has one (`TranscodeOrchestrator::
/// expire_playback_session` is a harmless no-op for direct-play/durable-
/// rendition sessions, which were never associated with a transcode
/// process in the first place -- see that method's own doc comment), then
/// finalizes the durable record with `StopReason::Other("admin_stopped")`
/// (not `UserStopped`, since the *viewer* didn't stop it -- an operator
/// did, from the admin UI, which callers reading session history should be
/// able to tell apart from a normal end-of-playback stop).
#[utoipa::path(
    post,
    path = "/api/v1/admin/playback/sessions/{session_id}/stop",
    tag = "admin",
    params(("session_id" = Uuid, Path, description = "PlaybackSession id (see ActiveSessionView::session_id)")),
    responses(
        (status = 204, description = "Session stopped (or was already gone -- stopping a session that already ended is not an error)"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn stop_session_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(session_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, ApiError> {
    let Some(session) = state.session_registry.get(session_id) else {
        // Already stopped/expired on its own -- stopping a session that's
        // already gone achieves the caller's actual goal (nothing is
        // running), so this is success, not a 404.
        return Ok(axum::http::StatusCode::NO_CONTENT);
    };

    if let Err(err) = state.transcode.expire_playback_session(session_id).await {
        tracing::warn!(
            session_id = %session_id,
            error = %err,
            "admin stop-session: failed to stop the underlying transcode process; \
             still finalizing the playback session record"
        );
    }

    state
        .analytics
        .on_session_end(
            session_id,
            &session,
            StopReason::Other("admin_stopped".to_string()),
        )
        .await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;
    use uuid::Uuid;

    use crate::test_support::{
        bearer_header, mint_access_token, seed_admin_user, seed_streaming_user, test_state,
    };

    #[tokio::test]
    async fn active_sessions_requires_admin() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/playback/sessions/active")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn active_sessions_lists_a_live_registry_entry() {
        use streamarr_model::media::LeafRef;
        use streamarr_model::{ClientPlatform, PlayMethod, PlaybackSession};

        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let work_id = crate::test_support::seed_movie(&state, "Activity Test Movie").await;
        let media_file_id =
            crate::test_support::seed_media_file(&state, work_id, LeafRef::Work, Uuid::new_v4())
                .await;
        let media_file = state
            .media_file_repo
            .get_by_id(media_file_id)
            .await
            .unwrap();
        state.media_files.insert(media_file);

        let session = PlaybackSession {
            id: Uuid::new_v4(),
            user_id: admin_id,
            device_id: Uuid::new_v4(),
            media_file_id,
            rendition_id: None,
            started_at: chrono::Utc::now(),
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
            bytes_streamed: 1_234,
            buffering_events: 0,
            buffering_ms_total: 0,
            stop_reason: None,
        };
        state.app.session_registry.insert(session.clone());

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/playback/sessions/active")
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
        let views: Vec<super::ActiveSessionView> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].session_id, session.id);
        assert_eq!(views[0].bytes_streamed, 1_234);
        assert_eq!(views[0].work_id, Some(work_id));
        assert_eq!(views[0].media_title.as_deref(), Some("Activity Test Movie"));
        // The seeded admin user has a real, persisted display name --
        // proves the enrichment lookup actually ran, not just passed
        // through the bare id.
        assert!(views[0].user_display_name.is_some());
    }

    #[tokio::test]
    async fn session_history_requires_admin() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/playback/sessions/history")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn session_history_filters_by_user_id() {
        use streamarr_model::{ClientPlatform, PlayMethod, PlaybackSession};

        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let target_user = Uuid::new_v4();
        let other_user = Uuid::new_v4();
        seed_streaming_user(&state, target_user).await;
        seed_streaming_user(&state, other_user).await;

        for user_id in [target_user, other_user] {
            let session = PlaybackSession {
                id: Uuid::new_v4(),
                user_id,
                device_id: Uuid::new_v4(),
                media_file_id: Uuid::new_v4(),
                rendition_id: None,
                started_at: chrono::Utc::now(),
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
            state
                .app
                .analytics_store
                .record_session_start(&session)
                .await
                .unwrap();
        }

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/v1/admin/playback/sessions/history?user_id={target_user}"
                    ))
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
        let sessions: Vec<super::SessionHistoryView> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].user_id, target_user);
        assert!(sessions[0].user_display_name.is_some());
    }

    #[tokio::test]
    async fn stop_session_requires_admin() {
        let (router, state) = test_state().await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let token = mint_access_token(&state, user_id);

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!(
                        "/api/v1/admin/playback/sessions/{}/stop",
                        Uuid::new_v4()
                    ))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn stopping_an_unknown_session_is_still_a_no_op_success() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!(
                        "/api/v1/admin/playback/sessions/{}/stop",
                        Uuid::new_v4()
                    ))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn stop_session_removes_it_from_the_live_registry_and_finalizes_history() {
        use streamarr_model::{ClientPlatform, PlayMethod, PlaybackSession};

        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let session = PlaybackSession {
            id: Uuid::new_v4(),
            user_id: admin_id,
            device_id: Uuid::new_v4(),
            media_file_id: Uuid::new_v4(),
            rendition_id: None,
            started_at: chrono::Utc::now(),
            ended_at: None,
            play_method: PlayMethod::Transcode,
            transcode_reason: None,
            source_codec: "h265".to_string(),
            source_container: "mkv".to_string(),
            source_bitrate: Some(20_000_000),
            target_codec: "h264".to_string(),
            target_container: "mp4".to_string(),
            target_bitrate: Some(4_000_000),
            client_platform: ClientPlatform::Web,
            client_version: "1.0.0".to_string(),
            ip_address: None,
            bytes_streamed: 5_000,
            buffering_events: 0,
            buffering_ms_total: 0,
            stop_reason: None,
        };
        let session_id = session.id;
        state.app.session_registry.insert(session.clone());
        state
            .app
            .analytics_store
            .record_session_start(&session)
            .await
            .unwrap();

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/admin/playback/sessions/{session_id}/stop"))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        // Gone from the live registry -- a second "active sessions" list
        // must not still show it.
        assert!(state.app.session_registry.get(session_id).is_none());

        // Finalized in durable history with the admin-stop reason, not left
        // as a permanently-open row.
        let history = state
            .app
            .analytics_store
            .list_sessions(&streamarr_db::analytics::SessionFilter {
                user_id: Some(admin_id),
                from: None,
                to: None,
                limit: 10,
                offset: 0,
            })
            .await
            .unwrap();
        let stopped = history
            .iter()
            .find(|s| s.id == session_id)
            .expect("stopped session should still be in history");
        assert!(stopped.ended_at.is_some());
        assert_eq!(
            stopped.stop_reason,
            Some(streamarr_model::StopReason::Other(
                "admin_stopped".to_string()
            ))
        );
    }
}
