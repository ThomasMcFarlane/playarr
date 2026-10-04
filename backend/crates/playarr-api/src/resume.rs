//! Smart Start/Resume for TV series (`docs/architecture/smart-resume.md`).
//!
//! The rules live in `playarr_model::resume` as a pure function; this module
//! only gathers its inputs (the series tree, the caller's watch progress and
//! recorded answers) and records the viewer's answers.
//!
//! * `GET    /api/v1/catalog/{id}/resume-plan`          -- the plan for one series.
//! * `POST   /api/v1/catalog/{id}/resume-plan/choice`   -- record which option was picked.
//! * `DELETE /api/v1/catalog/{id}/resume-plan/choices`  -- forget every recorded answer.
//! * `GET    /api/v1/playback/resume-plans`             -- plans for series with history (Home).

use std::collections::HashMap;

use axum::extract::{Path, State};
use axum::Json;
use chrono::Utc;
use playarr_catalog::{WorkChildren, WorkDetail};
use playarr_model::{
    compute_resume_plan, missed_run_episode_ids, ResumeDismissal, ResumeDismissalKind,
    ResumeEpisode, ResumeOptionKind, ResumePlan, WatchProgress,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth_extractor::CatalogViewer;
use crate::error::ApiError;
use crate::AppState;

/// Most series returned by the Home list, newest activity first.
const HOME_PLAN_LIMIT: usize = 30;

#[derive(Debug, Deserialize, ToSchema)]
pub struct ResumeChoiceRequest {
    /// The option the viewer picked.
    pub kind: ResumeOptionKind,
    /// That option's `episode_id`.
    pub episode_id: Uuid,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ResumeClearResponse {
    pub removed: u64,
}

fn episodes_of(detail: &WorkDetail) -> Option<Vec<ResumeEpisode>> {
    let WorkChildren::Series(seasons) = &detail.children else {
        return None;
    };
    Some(
        seasons
            .iter()
            .flat_map(|s| {
                s.episodes.iter().map(|e| ResumeEpisode {
                    episode_id: e.episode.id,
                    season_number: s.season.season_number,
                    episode_number: e.episode.episode_number,
                    title: e.episode.title.clone(),
                    media_file_id: e.media_file_id,
                    runtime_ms: e
                        .runtime_ms
                        .or(e.episode.runtime_minutes.map(|m| u64::from(m) * 60_000)),
                })
            })
            .collect(),
    )
}

struct Inputs {
    episodes: Vec<ResumeEpisode>,
    progress: Vec<WatchProgress>,
    dismissals: Vec<ResumeDismissal>,
}

impl Inputs {
    fn plan(&self, series: Uuid) -> ResumePlan {
        compute_resume_plan(series, &self.episodes, &self.progress, &self.dismissals)
    }
}

async fn load(
    state: &AppState,
    viewer: &CatalogViewer,
    series: Uuid,
    all_progress: Option<&[WatchProgress]>,
) -> Result<Inputs, ApiError> {
    let allowed = viewer.allowed_libraries();
    let gate = state
        .household
        .gate_for(&viewer.policy, viewer.user_id)
        .await;
    let detail = state
        .catalog
        .get_by_id_with(
            series,
            crate::household::access(allowed.as_deref(), gate.as_deref()),
        )
        .await?;
    let episodes = episodes_of(&detail)
        .ok_or_else(|| ApiError::not_found(format!("work {series} is not a series")))?;
    let progress: Vec<WatchProgress> = match all_progress {
        Some(rows) => rows
            .iter()
            .filter(|p| p.work_id == series)
            .cloned()
            .collect(),
        None => state
            .watch_progress
            .list_for_user(viewer.user_id)
            .await?
            .into_iter()
            .filter(|p| p.work_id == series)
            .collect(),
    };
    let dismissals = state
        .resume_dismissals
        .list_for_series(viewer.user_id, series)
        .await?;
    Ok(Inputs {
        episodes,
        progress,
        dismissals,
    })
}

#[utoipa::path(
    get,
    path = "/api/v1/catalog/{id}/resume-plan",
    tag = "playback",
    params(("id" = Uuid, Path, description = "Series work id")),
    responses(
        (status = 200, description = "What a Start/Resume press should do for this viewer: the episode to play, or the options to offer when the history is ambiguous", body = ResumePlan, example = json!({
            "series_work_id": "7a9d3e1f-8b4c-4d2a-9b3e-5f6a7b8c9d0e",
            "action": "resume",
            "reason": "choice_required",
            "needs_choice": true,
            "ask_reasons": ["missed_episode"],
            "target": {
                "kind": "missed_episode",
                "episode_id": "11111111-1111-4111-8111-111111111101",
                "media_file_id": "22222222-2222-4222-8222-222222222201",
                "season_number": 1,
                "episode_number": 1,
                "label": "S01E01",
                "title": "Pilot",
                "position_ms": 0,
                "duration_ms": 1_800_000,
                "progress_percent": 0
            },
            "options": []
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access"),
        (status = 404, description = "No series with this id")
    )
)]
pub async fn get_resume_plan_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(id): Path<Uuid>,
) -> Result<Json<ResumePlan>, ApiError> {
    let inputs = load(&state, &viewer, id, None).await?;
    Ok(Json(inputs.plan(id)))
}

#[utoipa::path(
    post,
    path = "/api/v1/catalog/{id}/resume-plan/choice",
    tag = "playback",
    params(("id" = Uuid, Path, description = "Series work id")),
    request_body = ResumeChoiceRequest,
    responses(
        (status = 200, description = "The answer was recorded; the plan as it now stands", body = ResumePlan),
        (status = 400, description = "The picked option is not one the current plan offers"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access"),
        (status = 404, description = "No series with this id")
    )
)]
pub async fn record_resume_choice_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(id): Path<Uuid>,
    Json(body): Json<ResumeChoiceRequest>,
) -> Result<Json<ResumePlan>, ApiError> {
    let inputs = load(&state, &viewer, id, None).await?;
    let plan = inputs.plan(id);
    if !plan
        .options
        .iter()
        .any(|o| o.kind == body.kind && o.episode_id == body.episode_id)
    {
        return Err(ApiError::bad_request(
            "the picked option is not offered by the current resume plan",
        ));
    }
    let now = Utc::now();
    // Picking anything but the missed episode declines the whole gap run.
    if body.kind != ResumeOptionKind::MissedEpisode {
        if let Some(missed) = plan
            .options
            .iter()
            .find(|o| o.kind == ResumeOptionKind::MissedEpisode)
        {
            for episode_id in
                missed_run_episode_ids(&inputs.episodes, &inputs.progress, missed.episode_id)
            {
                state
                    .resume_dismissals
                    .record(
                        viewer.user_id,
                        id,
                        ResumeDismissalKind::MissedEpisode,
                        episode_id,
                        now,
                    )
                    .await?;
            }
        }
    }
    // Either answer to the rewatch question resolves it for that anchor.
    if let Some(anchor) = plan
        .options
        .iter()
        .find(|o| o.kind == ResumeOptionKind::ContinueFromLastWatched)
        .and_then(|o| o.anchor_episode_id)
    {
        let kind = match body.kind {
            ResumeOptionKind::NextInSeries => Some(ResumeDismissalKind::RewatchContinueSeries),
            ResumeOptionKind::ContinueFromLastWatched => {
                Some(ResumeDismissalKind::RewatchContinueLast)
            }
            _ => None,
        };
        if let Some(kind) = kind {
            state
                .resume_dismissals
                .record(viewer.user_id, id, kind, anchor, now)
                .await?;
        }
    }
    let inputs = load(&state, &viewer, id, None).await?;
    Ok(Json(inputs.plan(id)))
}

#[utoipa::path(
    delete,
    path = "/api/v1/catalog/{id}/resume-plan/choices",
    tag = "playback",
    params(("id" = Uuid, Path, description = "Series work id")),
    responses(
        (status = 200, description = "Every recorded answer for this series was forgotten", body = ResumeClearResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access"),
        (status = 404, description = "No series with this id")
    )
)]
pub async fn clear_resume_choices_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(id): Path<Uuid>,
) -> Result<Json<ResumeClearResponse>, ApiError> {
    // Resolve the series first so an unknown or hidden id is a 404.
    load(&state, &viewer, id, Some(&[])).await?;
    let removed = state
        .resume_dismissals
        .clear_for_series(viewer.user_id, id)
        .await?;
    Ok(Json(ResumeClearResponse { removed }))
}

#[utoipa::path(
    get,
    path = "/api/v1/playback/resume-plans",
    tag = "playback",
    responses(
        (status = 200, description = "Resume plans for the series this viewer has watch history in, newest activity first; series outside the caller's allowed libraries are omitted", body = [ResumePlan]),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller has neither Playarr streaming access nor admin access")
    )
)]
pub async fn list_resume_plans_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
) -> Result<Json<Vec<ResumePlan>>, ApiError> {
    let progress = state.watch_progress.list_for_user(viewer.user_id).await?;
    let mut latest: HashMap<Uuid, chrono::DateTime<Utc>> = HashMap::new();
    for p in &progress {
        let at = p.updated_at.unwrap_or_default();
        let entry = latest.entry(p.work_id).or_insert(at);
        *entry = (*entry).max(at);
    }
    let mut works: Vec<(Uuid, chrono::DateTime<Utc>)> = latest.into_iter().collect();
    works.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    let mut plans = Vec::new();
    for (work_id, _) in works {
        if plans.len() >= HOME_PLAN_LIMIT {
            break;
        }
        // Movies, hidden and deleted works fail to load as a visible series.
        let Ok(mut inputs) = load(&state, &viewer, work_id, Some(&progress)).await else {
            continue;
        };
        if inputs.progress.is_empty() {
            continue;
        }
        inputs.dismissals = state
            .resume_dismissals
            .list_for_series(viewer.user_id, work_id)
            .await?;
        plans.push(inputs.plan(work_id));
    }
    Ok(Json(plans))
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use axum::Router;
    use playarr_model::media::LeafRef;
    use playarr_model::{ResumeAction, ResumeReason};
    use tower::ServiceExt;

    use super::*;
    use crate::test_support::{
        bearer_header, mint_access_token, seed_movie, seed_series_with_tvdb,
        seed_streaming_user_with_library_allow, test_state, TestState,
    };

    struct Series {
        id: Uuid,
        source: Uuid,
        /// Episode id and media file id, by `(season, episode)`.
        eps: HashMap<(i32, i32), (Uuid, Uuid)>,
    }

    async fn seed_series(state: &TestState, shape: &[(i32, i32)]) -> Series {
        let id = seed_series_with_tvdb(state, "Resume Show", "424242").await;
        let source = Uuid::new_v4();
        let mut eps = HashMap::new();
        for &(season_number, count) in shape {
            let season = Uuid::new_v4();
            sqlx::query(
                "INSERT INTO seasons (id, series_work_id, season_number, title, overview, monitored, availability) \
                 VALUES (?, ?, ?, NULL, NULL, 1, 'available')",
            )
            .bind(season.to_string())
            .bind(id.to_string())
            .bind(i64::from(season_number))
            .execute(&state.pool)
            .await
            .unwrap();
            for number in 1..=count {
                let episode = Uuid::new_v4();
                sqlx::query(
                    "INSERT INTO episodes (id, season_id, episode_number, title, overview, images, air_date, runtime_minutes, monitored, availability) \
                     VALUES (?, ?, ?, ?, NULL, '[]', NULL, 30, 1, 'available')",
                )
                .bind(episode.to_string())
                .bind(season.to_string())
                .bind(i64::from(number))
                .bind(format!("Episode {season_number}x{number}"))
                .execute(&state.pool)
                .await
                .unwrap();
                let file = playarr_model::MediaFile {
                    id: Uuid::new_v4(),
                    work_id: id,
                    leaf_ref: LeafRef::Episode(episode),
                    path: std::path::PathBuf::from(format!(
                        "/media/tv/{season_number}x{number}.mkv"
                    )),
                    container: "mkv".to_string(),
                    codec: "h264".to_string(),
                    bitrate: Some(4_000_000),
                    duration_ms: Some(1_800_000),
                    size_bytes: 1_000_000,
                    source_instance_id: source,
                    source_file_id: Some(format!("{season_number}-{number}")),
                };
                state.media_file_repo.create(&file).await.unwrap();
                state.media_files.insert(file.clone());
                eps.insert((season_number, number), (episode, file.id));
            }
        }
        Series { id, source, eps }
    }

    async fn call(
        router: &Router,
        method: &str,
        uri: &str,
        token: &str,
        body: Option<serde_json::Value>,
    ) -> (StatusCode, serde_json::Value) {
        let mut req = Request::builder()
            .method(method)
            .uri(uri)
            .header("Authorization", bearer_header(token));
        let body = match body {
            Some(v) => {
                req = req.header("Content-Type", "application/json");
                Body::from(v.to_string())
            }
            None => Body::empty(),
        };
        let resp = router
            .clone()
            .oneshot(req.body(body).unwrap())
            .await
            .unwrap();
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        (status, json)
    }

    async fn watch(router: &Router, token: &str, file: Uuid, position_ms: u64) {
        let (status, _) = call(
            router,
            "PUT",
            &format!("/api/v1/playback/{file}/progress"),
            token,
            Some(serde_json::json!({"position_ms": position_ms, "duration_ms": 1_800_000})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }

    fn plan_of(json: serde_json::Value) -> ResumePlan {
        serde_json::from_value(json).expect("a ResumePlan")
    }

    async fn setup(shape: &[(i32, i32)]) -> (Router, TestState, Series, String) {
        let (router, state) = test_state().await;
        let series = seed_series(&state, shape).await;
        let user = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user, vec![series.source]).await;
        let token = mint_access_token(&state, user);
        (router, state, series, token)
    }

    #[tokio::test]
    async fn fresh_viewer_starts_at_the_first_episode() {
        let (router, _state, s, token) = setup(&[(0, 1), (1, 3), (2, 3)]).await;
        let (status, json) = call(
            &router,
            "GET",
            &format!("/api/v1/catalog/{}/resume-plan", s.id),
            &token,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let plan = plan_of(json);
        assert_eq!(plan.action, ResumeAction::Start);
        assert_eq!(plan.reason, ResumeReason::NotStarted);
        let target = plan.target.unwrap();
        assert_eq!(target.label, "S01E01");
        assert_eq!(target.media_file_id, s.eps[&(1, 1)].1);
    }

    #[tokio::test]
    async fn in_order_viewing_resumes_at_the_next_episode_without_asking() {
        let (router, _state, s, token) = setup(&[(1, 4)]).await;
        for e in 1..=2 {
            watch(&router, &token, s.eps[&(1, e)].1, 1_800_000).await;
        }
        let (_, json) = call(
            &router,
            "GET",
            &format!("/api/v1/catalog/{}/resume-plan", s.id),
            &token,
            None,
        )
        .await;
        let plan = plan_of(json);
        assert_eq!(plan.action, ResumeAction::Resume);
        assert!(!plan.needs_choice);
        assert_eq!(plan.target.unwrap().label, "S01E03");
    }

    #[tokio::test]
    async fn declining_a_missed_episode_is_remembered_and_can_be_cleared() {
        let (router, _state, s, token) = setup(&[(1, 4), (2, 3)]).await;
        for e in 2..=4 {
            watch(&router, &token, s.eps[&(1, e)].1, 1_800_000).await;
        }
        watch(&router, &token, s.eps[&(2, 1)].1, 1_800_000).await;
        let uri = format!("/api/v1/catalog/{}/resume-plan", s.id);
        let plan = plan_of(call(&router, "GET", &uri, &token, None).await.1);
        assert!(plan.needs_choice);
        assert_eq!(plan.options[0].kind, ResumeOptionKind::MissedEpisode);
        assert_eq!(plan.options[0].label, "S01E01");
        assert_eq!(plan.options[1].label, "S02E02");

        // An option that was not offered is rejected.
        let (status, _) = call(
            &router,
            "POST",
            &format!("{uri}/choice"),
            &token,
            Some(serde_json::json!({"kind": "next_in_series", "episode_id": s.eps[&(2, 3)].0})),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);

        let (status, json) = call(
            &router,
            "POST",
            &format!("{uri}/choice"),
            &token,
            Some(serde_json::json!({"kind": "next_in_series", "episode_id": s.eps[&(2, 2)].0})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let after = plan_of(json);
        assert!(!after.needs_choice);
        assert_eq!(after.target.unwrap().label, "S02E02");
        // Asked once: still not asked on a fresh GET.
        let again = plan_of(call(&router, "GET", &uri, &token, None).await.1);
        assert!(!again.needs_choice);

        let (status, json) = call(&router, "DELETE", &format!("{uri}/choices"), &token, None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["removed"], 1);
        let reset = plan_of(call(&router, "GET", &uri, &token, None).await.1);
        assert!(reset.needs_choice);
    }

    #[tokio::test]
    async fn a_gap_that_is_also_start_over_is_not_asked() {
        let (router, _state, s, token) = setup(&[(1, 3)]).await;
        watch(&router, &token, s.eps[&(1, 2)].1, 1_800_000).await;
        watch(&router, &token, s.eps[&(1, 3)].1, 1_800_000).await;
        let uri = format!("/api/v1/catalog/{}/resume-plan", s.id);
        let plan = plan_of(call(&router, "GET", &uri, &token, None).await.1);
        // The only gap is also where start-over would land: no chooser.
        assert!(!plan.needs_choice);
        assert_eq!(plan.target.unwrap().label, "S01E01");
    }

    #[tokio::test]
    async fn answers_are_per_viewer() {
        let (router, state, s, token) = setup(&[(1, 4), (2, 3)]).await;
        let other = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, other, vec![s.source]).await;
        let other_token = mint_access_token(&state, other);
        for t in [&token, &other_token] {
            for e in 2..=4 {
                watch(&router, t, s.eps[&(1, e)].1, 1_800_000).await;
            }
            watch(&router, t, s.eps[&(2, 1)].1, 1_800_000).await;
        }
        let uri = format!("/api/v1/catalog/{}/resume-plan", s.id);
        call(
            &router,
            "POST",
            &format!("{uri}/choice"),
            &token,
            Some(serde_json::json!({"kind": "next_in_series", "episode_id": s.eps[&(2, 2)].0})),
        )
        .await;
        assert!(!plan_of(call(&router, "GET", &uri, &token, None).await.1).needs_choice);
        assert!(plan_of(call(&router, "GET", &uri, &other_token, None).await.1).needs_choice);
    }

    #[tokio::test]
    async fn movies_and_unknown_ids_are_not_found() {
        let (router, state, _s, token) = setup(&[(1, 1)]).await;
        let movie = seed_movie(&state, "Not a series").await;
        for id in [movie, Uuid::new_v4()] {
            let (status, _) = call(
                &router,
                "GET",
                &format!("/api/v1/catalog/{id}/resume-plan"),
                &token,
                None,
            )
            .await;
            assert_eq!(status, StatusCode::NOT_FOUND);
        }
    }

    #[tokio::test]
    async fn requires_authentication() {
        let (router, _state, s, _token) = setup(&[(1, 1)]).await;
        let resp = router
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/catalog/{}/resume-plan", s.id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn home_list_holds_only_series_with_history_newest_first() {
        let (router, state, s, token) = setup(&[(1, 3)]).await;
        let (_, json) = call(
            &router,
            "GET",
            "/api/v1/playback/resume-plans",
            &token,
            None,
        )
        .await;
        assert_eq!(json.as_array().unwrap().len(), 0);
        watch(&router, &token, s.eps[&(1, 1)].1, 900_000).await;
        let (status, json) = call(
            &router,
            "GET",
            "/api/v1/playback/resume-plans",
            &token,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let plans: Vec<ResumePlan> = serde_json::from_value(json).unwrap();
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].series_work_id, s.id);
        assert_eq!(plans[0].reason, ResumeReason::ResumeUnfinished);
        let _ = state;
    }
}
