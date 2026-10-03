//! Aggregated release calendar -- `docs/architecture/release-calendar.md`.
//!
//! `GET /api/v1/calendar` queries every permitted Sonarr, Radarr, Lidarr and
//! Readarr instance concurrently, merges duplicate releases, reports
//! unreachable instances instead of dropping them, and joins each entry to
//! its catalog `Work` when one exists.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{Duration as ChronoDuration, NaiveDate, Utc};
use playarr_arr_sync::calendar::{
    classify_error, fetch_calendar, merge_candidates, CalendarCandidate,
};
use playarr_model::{
    CalendarMediaKind, CalendarResponse, CalendarSourceState, CalendarSourceStatus, SourceInstance,
    SourceKind,
};
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::auth_extractor::CatalogViewer;
use crate::error::ApiError;
use crate::AppState;

/// Longest window one request may cover.
pub const MAX_WINDOW_DAYS: i64 = 92;
const DEFAULT_WINDOW_DAYS: i64 = 30;
const SOURCE_TIMEOUT: Duration = Duration::from_secs(10);
const CACHE_TTL: Duration = Duration::from_secs(60);

type CacheKey = (Uuid, NaiveDate, NaiveDate);

/// Short-lived cache of raw per-instance answers. User-independent on
/// purpose: permissions are applied before querying and after merging.
#[derive(Default)]
pub struct CalendarCache {
    entries: Mutex<HashMap<CacheKey, (Instant, Vec<CalendarCandidate>)>>,
}

impl CalendarCache {
    pub fn new() -> Self {
        Self::default()
    }

    fn get(&self, key: &CacheKey) -> Option<Vec<CalendarCandidate>> {
        let entries = self.entries.lock().ok()?;
        entries
            .get(key)
            .filter(|(at, _)| at.elapsed() < CACHE_TTL)
            .map(|(_, value)| value.clone())
    }

    fn put(&self, key: CacheKey, value: Vec<CalendarCandidate>) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.retain(|_, (at, _)| at.elapsed() < CACHE_TTL);
            entries.insert(key, (Instant::now(), value));
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct CalendarQuery {
    /// First day, inclusive (`YYYY-MM-DD`). Defaults to today (UTC).
    pub start: Option<NaiveDate>,
    /// Last day, inclusive. Defaults to `start` plus 30 days; at most 92 days
    /// after `start`.
    pub end: Option<NaiveDate>,
    /// Comma-separated `episode,movie,album,book`. All when omitted.
    pub kind: Option<String>,
    /// Restrict to one source instance.
    pub source_instance_id: Option<Uuid>,
}

/// Which instances a caller may query: `None` allows every instance.
fn is_calendar_source(kind: SourceKind) -> bool {
    matches!(
        kind,
        SourceKind::Sonarr | SourceKind::Radarr | SourceKind::Lidarr | SourceKind::Readarr
    )
}

fn parse_kinds(raw: Option<&str>) -> Result<Option<HashSet<CalendarMediaKind>>, ApiError> {
    let Some(raw) = raw.filter(|r| !r.trim().is_empty()) else {
        return Ok(None);
    };
    let mut kinds = HashSet::new();
    for part in raw.split(',') {
        kinds.insert(match part.trim() {
            "episode" => CalendarMediaKind::Episode,
            "movie" => CalendarMediaKind::Movie,
            "album" => CalendarMediaKind::Album,
            "book" => CalendarMediaKind::Book,
            other => {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "invalid_kind",
                    format!("unknown calendar kind `{other}`"),
                ))
            }
        });
    }
    Ok(Some(kinds))
}

/// Resolves the requested window, applying defaults and the span cap.
pub(crate) fn resolve_window(
    start: Option<NaiveDate>,
    end: Option<NaiveDate>,
) -> Result<(NaiveDate, NaiveDate), ApiError> {
    let start = start.unwrap_or_else(|| Utc::now().date_naive());
    let end = end.unwrap_or(start + ChronoDuration::days(DEFAULT_WINDOW_DAYS));
    if end < start || (end - start).num_days() > MAX_WINDOW_DAYS {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_range",
            format!("end must not precede start and the range is at most {MAX_WINDOW_DAYS} days"),
        ));
    }
    Ok((start, end))
}

/// Builds the calendar for `allowed` libraries (`None` = unrestricted).
pub(crate) async fn build_calendar(
    state: &AppState,
    allowed: Option<&[Uuid]>,
    start: NaiveDate,
    end: NaiveDate,
    kinds: Option<&HashSet<CalendarMediaKind>>,
    only_instance: Option<Uuid>,
) -> CalendarResponse {
    let mut instances: Vec<SourceInstance> = state
        .source_instances
        .all()
        .into_iter()
        .filter(|i| is_calendar_source(i.kind))
        .filter(|i| allowed.is_none_or(|ids| ids.contains(&i.id)))
        .filter(|i| only_instance.is_none_or(|id| id == i.id))
        .collect();
    instances.sort_by(|a, b| (a.priority, &a.name, a.id).cmp(&(b.priority, &b.name, b.id)));

    let cache = &state.calendar_cache;
    let results = futures::future::join_all(instances.iter().map(|instance| async move {
        let key = (instance.id, start, end);
        if let Some(hit) = cache.get(&key) {
            return Ok(hit);
        }
        let fetched = tokio::time::timeout(SOURCE_TIMEOUT, fetch_calendar(instance, start, end))
            .await
            .map_err(|_| {
                (
                    CalendarSourceState::Unreachable,
                    "timed out waiting for the instance".to_string(),
                )
            })?
            .map_err(|e| classify_error(&e))?;
        cache.put(key, fetched.clone());
        Ok::<_, (CalendarSourceState, String)>(fetched)
    }))
    .await;

    let mut statuses = Vec::new();
    let mut candidates = Vec::new();
    for (instance, result) in instances.iter().zip(results) {
        let (status, error, count) = match result {
            Ok(entries) => {
                let kept: Vec<_> = entries
                    .into_iter()
                    .filter(|c| kinds.is_none_or(|k| k.contains(&c.entry.media_kind)))
                    .collect();
                let count = kept.len() as u32;
                candidates.extend(kept);
                (CalendarSourceState::Ok, None, count)
            }
            Err((state, message)) => {
                tracing::warn!(instance = %instance.name, state = ?state, "calendar source failed");
                (state, Some(message), 0)
            }
        };
        statuses.push(CalendarSourceStatus {
            source_instance_id: instance.id,
            name: instance.name.clone(),
            kind: instance.kind,
            status,
            error,
            entry_count: count,
        });
    }

    let mut merged = merge_candidates(candidates);
    let mut resolved: HashMap<(String, String), Option<Uuid>> = HashMap::new();
    for candidate in &mut merged {
        let Some((provider, external_id)) = candidate.work_ref.clone() else {
            continue;
        };
        let cache_key = (format!("{provider:?}"), external_id.clone());
        let work_id = match resolved.get(&cache_key) {
            Some(found) => *found,
            None => {
                let found = state
                    .work_repo
                    .find_by_external_ref(&provider, &external_id)
                    .await
                    .ok()
                    .flatten()
                    .map(|w| w.id);
                resolved.insert(cache_key, found);
                found
            }
        };
        candidate.entry.work_id = work_id;
    }

    CalendarResponse {
        start,
        end,
        entries: merged.into_iter().map(|c| c.entry).collect(),
        sources: statuses,
    }
}

#[utoipa::path(
    get,
    path = "/api/v1/calendar",
    tag = "calendar",
    params(CalendarQuery),
    responses(
        (status = 200, description = "Upcoming releases from every permitted instance, with per-instance status", body = CalendarResponse),
        (status = 400, description = "Invalid range or kind"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller may not view the catalog")
    )
)]
pub async fn calendar_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Query(params): Query<CalendarQuery>,
) -> Result<Json<CalendarResponse>, ApiError> {
    let (start, end) = resolve_window(params.start, params.end)?;
    let kinds = parse_kinds(params.kind.as_deref())?;
    let allowed = viewer.allowed_libraries();
    Ok(Json(
        build_calendar(
            &state,
            allowed.as_deref(),
            start,
            end,
            kinds.as_ref(),
            params.source_instance_id,
        )
        .await,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        bearer_header, mint_access_token, seed_admin_user, seed_streaming_user_with_library_allow,
        test_state,
    };
    use axum::body::Body;
    use axum::http::Request;
    use playarr_model::Sensitive;
    use serde_json::json;
    use tower::ServiceExt;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn instance(kind: SourceKind, name: &str, url: String) -> SourceInstance {
        SourceInstance {
            id: Uuid::new_v4(),
            kind,
            name: name.to_string(),
            base_url: url,
            api_key_encrypted: Sensitive::new("k".to_string()),
            priority: 0,
            default_root_folder_id: None,
            folder_mappings: Default::default(),
            default_quality_profile_id: None,
            best_effort: false,
            group_library_id: None,
        }
    }

    async fn fake_sonarr(series_title: &str) -> MockServer {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/calendar"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([{
                "id": 1, "seriesId": 1, "seasonNumber": 1, "episodeNumber": 1, "title": "Pilot",
                "airDate": "2026-10-10", "airDateUtc": "2026-10-10T20:00:00Z",
                "hasFile": false, "monitored": true,
                "series": {"id": 1, "title": series_title, "tvdbId": 77, "images": []}
            }])))
            .mount(&server)
            .await;
        server
    }

    async fn get(router: axum::Router, token: &str, uri: &str) -> (StatusCode, serde_json::Value) {
        let response = router
            .oneshot(
                Request::builder()
                    .uri(uri)
                    .header("Authorization", bearer_header(token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(json!(null)),
        )
    }

    #[tokio::test]
    async fn merges_instances_reports_unreachable_and_respects_permissions() {
        let (router, state) = test_state().await;
        let a = fake_sonarr("Show").await;
        let b = fake_sonarr("Show").await;
        let sonarr_a = instance(SourceKind::Sonarr, "TV HD", a.uri());
        let sonarr_b = instance(SourceKind::Sonarr, "TV 4K", b.uri());
        let down = instance(SourceKind::Radarr, "Movies", "http://127.0.0.1:1".into());
        for i in [&sonarr_a, &sonarr_b, &down] {
            state.source_instances.upsert(i.clone());
        }

        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let token = mint_access_token(&state, admin);
        let uri = "/api/v1/calendar?start=2026-10-01&end=2026-10-31";
        let (status, body) = get(router.clone(), &token, uri).await;
        assert_eq!(status, StatusCode::OK);
        let entries = body["entries"].as_array().unwrap();
        assert_eq!(
            entries.len(),
            1,
            "same tvdb episode on two instances merges"
        );
        assert_eq!(entries[0]["sources"].as_array().unwrap().len(), 2);
        assert_eq!(entries[0]["title"], "Show");
        let sources = body["sources"].as_array().unwrap();
        assert_eq!(sources.len(), 3);
        let radarr = sources.iter().find(|s| s["name"] == "Movies").unwrap();
        assert_eq!(radarr["status"], "unreachable");
        assert!(radarr["error"].as_str().unwrap().len() > 3);

        // A restricted user sees only the library they were granted.
        let user = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user, vec![sonarr_a.id]).await;
        let token = mint_access_token(&state, user);
        let (status, body) = get(router.clone(), &token, uri).await;
        assert_eq!(status, StatusCode::OK);
        let entries = body["entries"].as_array().unwrap();
        assert_eq!(entries[0]["sources"].as_array().unwrap().len(), 1);
        assert_eq!(body["sources"].as_array().unwrap().len(), 1);
        assert_eq!(body["sources"][0]["name"], "TV HD");
    }

    #[tokio::test]
    async fn rejects_oversized_or_inverted_ranges_and_bad_kinds() {
        let (router, state) = test_state().await;
        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let token = mint_access_token(&state, admin);
        for uri in [
            "/api/v1/calendar?start=2026-01-01&end=2026-12-31",
            "/api/v1/calendar?start=2026-10-10&end=2026-10-01",
            "/api/v1/calendar?kind=podcast",
        ] {
            let (status, _) = get(router.clone(), &token, uri).await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
        }
    }

    #[tokio::test]
    async fn requires_authentication() {
        let (router, _state) = test_state().await;
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/calendar")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn kind_filter_and_work_join() {
        let (router, state) = test_state().await;
        let server = fake_sonarr("Show").await;
        state
            .source_instances
            .upsert(instance(SourceKind::Sonarr, "TV", server.uri()));
        let work_id = crate::test_support::seed_series_with_tvdb(&state, "Show", "77").await;
        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let token = mint_access_token(&state, admin);
        let (_, body) = get(
            router.clone(),
            &token,
            "/api/v1/calendar?start=2026-10-01&end=2026-10-31&kind=episode",
        )
        .await;
        assert_eq!(body["entries"][0]["work_id"], work_id.to_string());
        let (_, body) = get(
            router,
            &token,
            "/api/v1/calendar?start=2026-10-01&end=2026-10-31&kind=movie",
        )
        .await;
        assert!(body["entries"].as_array().unwrap().is_empty());
    }
}
