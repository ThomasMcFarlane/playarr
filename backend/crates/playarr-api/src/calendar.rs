//! Aggregated release calendar -- `docs/architecture/release-calendar.md`.
//!
//! `GET /api/v1/calendar` queries every permitted Sonarr, Radarr, Lidarr and
//! Readarr instance concurrently, merges duplicate releases, reports
//! unreachable instances instead of dropping them, and joins each entry to
//! its catalog `Work` when one exists.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::Engine;
use chrono::{DateTime, Duration as ChronoDuration, NaiveDate, Utc};
use playarr_arr_sync::calendar::{
    classify_error, fetch_calendar, merge_candidates, CalendarCandidate,
};
use playarr_model::{
    CalendarMediaKind, CalendarResponse, CalendarSourceState, CalendarSourceStatus, SourceInstance,
    SourceKind,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
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
    let mut lags: HashMap<(String, String), Option<i64>> = HashMap::new();
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
        if candidate.entry.media_kind == CalendarMediaKind::Episode {
            let lag_key = (
                playarr_arr_sync::availability::provider_name(&provider),
                external_id,
            );
            if !lags.contains_key(&lag_key) {
                let lag = lag_for_refs(state, std::slice::from_ref(&lag_key))
                    .await
                    .ok()
                    .and_then(|l| l.average_seconds);
                lags.insert(lag_key.clone(), lag);
            }
            candidate.entry.average_lag_seconds = lags[&lag_key];
        }
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

/// Lag statistic for one work, merged across every external id it carries.
async fn lag_for_refs(
    state: &AppState,
    refs: &[(String, String)],
) -> Result<playarr_model::AvailabilityLag, ApiError> {
    let mut events = Vec::new();
    for (provider, external_id) in refs {
        events.extend(
            state
                .availability_event_repo
                .list_for(provider, external_id)
                .await
                .map_err(|e| ApiError::internal(e.to_string()))?,
        );
    }
    Ok(playarr_model::compute_lag(&events))
}

#[utoipa::path(
    get,
    path = "/api/v1/catalog/{id}/availability-lag",
    tag = "calendar",
    params(("id" = Uuid, Path, description = "Catalog work id")),
    responses(
        (status = 200, description = "Average time from release to availability, from real grab/import events. Backfills and items without release data are counted but excluded.", body = playarr_model::AvailabilityLag),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller may not view the catalog"),
        (status = 404, description = "No work with this id")
    )
)]
pub async fn availability_lag_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    Path(id): Path<Uuid>,
) -> Result<Json<playarr_model::AvailabilityLag>, ApiError> {
    let allowed = viewer.allowed_libraries();
    let detail = state.catalog.get_by_id(id, allowed.as_deref()).await?;
    let refs: Vec<(String, String)> = detail
        .work
        .external_refs
        .iter()
        .map(|r| {
            (
                playarr_arr_sync::availability::provider_name(&r.provider),
                r.external_id.clone(),
            )
        })
        .collect();
    Ok(Json(lag_for_refs(&state, &refs).await?))
}

/// How far back and forward the subscription feed reaches.
const FEED_DAYS_BACK: i64 = 14;
const FEED_DAYS_FORWARD: i64 = 180;
const FEED_TOKEN_LEN: usize = 43;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CalendarFeedStatus {
    pub active: bool,
    pub created_at: Option<DateTime<Utc>>,
    pub last_used_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CalendarFeedCreated {
    /// Full subscription URL, shown once.
    pub url: String,
    /// The secret path component, shown once.
    pub token: String,
    pub created_at: DateTime<Utc>,
}

fn hash_token(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// 256 bits of OS randomness, URL-safe, 43 characters.
fn new_token() -> String {
    let mut bytes = [0u8; 32];
    bytes[..16].copy_from_slice(Uuid::new_v4().as_bytes());
    bytes[16..].copy_from_slice(Uuid::new_v4().as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

#[utoipa::path(
    get,
    path = "/api/v1/calendar/feed",
    tag = "calendar",
    responses(
        (status = 200, description = "Whether the caller has an active subscription token", body = CalendarFeedStatus),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller may not view the catalog")
    )
)]
pub async fn get_calendar_feed_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
) -> Result<Json<CalendarFeedStatus>, ApiError> {
    let info = state
        .calendar_feed_token_repo
        .active_for_user(viewer.user_id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(CalendarFeedStatus {
        active: info.is_some(),
        created_at: info.as_ref().map(|i| i.created_at),
        last_used_at: info.and_then(|i| i.last_used_at),
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/calendar/feed",
    tag = "calendar",
    responses(
        (status = 201, description = "A new subscription URL; any previous token stops working. The token is returned only here.", body = CalendarFeedCreated),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller may not view the catalog")
    )
)]
pub async fn create_calendar_feed_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
    headers: HeaderMap,
) -> Result<(StatusCode, Json<CalendarFeedCreated>), ApiError> {
    let token = new_token();
    let now = Utc::now();
    state
        .calendar_feed_token_repo
        .rotate(viewer.user_id, &hash_token(&token), now)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let url = crate::oauth::request_verification_uri(
        &headers,
        &format!("/api/v1/calendar/feed/{token}.ics"),
    );
    Ok((
        StatusCode::CREATED,
        Json(CalendarFeedCreated {
            url,
            token,
            created_at: now,
        }),
    ))
}

#[utoipa::path(
    delete,
    path = "/api/v1/calendar/feed",
    tag = "calendar",
    responses(
        (status = 204, description = "The subscription token is revoked (idempotent)"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller may not view the catalog")
    )
)]
pub async fn revoke_calendar_feed_handler(
    State(state): State<AppState>,
    viewer: CatalogViewer,
) -> Result<StatusCode, ApiError> {
    state
        .calendar_feed_token_repo
        .revoke(viewer.user_id, Utc::now())
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/v1/calendar/feed/{file}",
    tag = "calendar",
    params(("file" = String, Path, description = "The subscription token followed by `.ics`")),
    responses(
        (status = 200, description = "iCalendar (RFC 5545) feed of the owner's releases", content_type = "text/calendar", body = String),
        (status = 404, description = "Unknown or revoked token")
    )
)]
pub async fn calendar_feed_ics_handler(
    State(state): State<AppState>,
    Path(file): Path<String>,
) -> Result<Response, ApiError> {
    let not_found = || ApiError::not_found("calendar feed not found");
    let token = file.strip_suffix(".ics").ok_or_else(not_found)?;
    if token.len() != FEED_TOKEN_LEN {
        return Err(not_found());
    }
    let now = Utc::now();
    let user_id = state
        .calendar_feed_token_repo
        .resolve(&hash_token(token), now)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(not_found)?;
    // The owner's *current* grants apply, so access changes take effect at once.
    let (_policy, allowed) = crate::auth_extractor::resolve_catalog_access(&state, user_id)
        .await
        .map_err(|_| not_found())?;
    let today = now.date_naive();
    let response = build_calendar(
        &state,
        allowed.as_deref(),
        today - ChronoDuration::days(FEED_DAYS_BACK),
        today + ChronoDuration::days(FEED_DAYS_FORWARD),
        None,
        None,
    )
    .await;
    let body =
        crate::ics::render_calendar(&response.entries, &state.node_id, "Playarr releases", now);
    let mut res = body.into_response();
    let headers = res.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/calendar; charset=utf-8"),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=900"),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("inline; filename=\"playarr-releases.ics\""),
    );
    Ok(res)
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

    async fn send(
        router: axum::Router,
        method: &str,
        uri: &str,
        token: Option<&str>,
    ) -> (StatusCode, HeaderMap, Vec<u8>) {
        let mut req = Request::builder().method(method).uri(uri);
        if let Some(t) = token {
            req = req.header("Authorization", bearer_header(t));
        }
        let response = router
            .oneshot(req.body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec();
        (status, headers, bytes)
    }

    fn feed_path(created: &serde_json::Value) -> String {
        format!(
            "/api/v1/calendar/feed/{}.ics",
            created["token"].as_str().unwrap()
        )
    }

    #[tokio::test]
    async fn feed_token_lifecycle_rotation_and_revocation() {
        let (router, state) = test_state().await;
        let server = fake_sonarr_today().await;
        state
            .source_instances
            .upsert(instance(SourceKind::Sonarr, "TV", server.uri()));
        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let token = mint_access_token(&state, admin);

        let (status, _, body) =
            send(router.clone(), "GET", "/api/v1/calendar/feed", Some(&token)).await;
        assert_eq!(status, StatusCode::OK);
        let status_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(status_json["active"], false);

        let (status, _, body) = send(
            router.clone(),
            "POST",
            "/api/v1/calendar/feed",
            Some(&token),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        let first: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(first["url"]
            .as_str()
            .unwrap()
            .ends_with(&format!("{}.ics", first["token"].as_str().unwrap())));

        // The feed needs no Authorization header, only the token.
        let (status, headers, body) = send(router.clone(), "GET", &feed_path(&first), None).await;
        assert_eq!(status, StatusCode::OK);
        assert!(headers[header::CONTENT_TYPE]
            .to_str()
            .unwrap()
            .starts_with("text/calendar"));
        let ics = String::from_utf8(body).unwrap();
        assert!(ics.contains("BEGIN:VEVENT"), "{ics}");
        assert!(ics.contains("SUMMARY:Morning Programme S01E01: Pilot"));

        let (_, _, body) = send(router.clone(), "GET", "/api/v1/calendar/feed", Some(&token)).await;
        let status_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(status_json["active"], true);
        assert!(status_json["last_used_at"].is_string());
        assert!(!String::from_utf8_lossy(&body).contains(first["token"].as_str().unwrap()));

        // Regenerating revokes the old URL.
        let (_, _, body) = send(
            router.clone(),
            "POST",
            "/api/v1/calendar/feed",
            Some(&token),
        )
        .await;
        let second: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_ne!(first["token"], second["token"]);
        assert_eq!(
            send(router.clone(), "GET", &feed_path(&first), None)
                .await
                .0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            send(router.clone(), "GET", &feed_path(&second), None)
                .await
                .0,
            StatusCode::OK
        );

        // Revoking stops the feed; revoking again is harmless.
        assert_eq!(
            send(
                router.clone(),
                "DELETE",
                "/api/v1/calendar/feed",
                Some(&token)
            )
            .await
            .0,
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            send(router.clone(), "GET", &feed_path(&second), None)
                .await
                .0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            send(
                router.clone(),
                "DELETE",
                "/api/v1/calendar/feed",
                Some(&token)
            )
            .await
            .0,
            StatusCode::NO_CONTENT
        );
    }

    #[tokio::test]
    async fn feed_rejects_malformed_tokens_and_unauthenticated_management() {
        let (router, _state) = test_state().await;
        for uri in [
            "/api/v1/calendar/feed/not-a-token.ics",
            "/api/v1/calendar/feed/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.ics",
            "/api/v1/calendar/feed/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ] {
            assert_eq!(
                send(router.clone(), "GET", uri, None).await.0,
                StatusCode::NOT_FOUND,
                "{uri}"
            );
        }
        assert_eq!(
            send(router.clone(), "POST", "/api/v1/calendar/feed", None)
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            send(router, "DELETE", "/api/v1/calendar/feed", None)
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn feed_is_scoped_to_the_owners_current_libraries() {
        let (router, state) = test_state().await;
        let hd = fake_sonarr_today().await;
        let uhd = fake_sonarr_today().await;
        let hd_instance = instance(SourceKind::Sonarr, "TV HD", hd.uri());
        let uhd_instance = instance(SourceKind::Sonarr, "TV 4K", uhd.uri());
        state.source_instances.upsert(hd_instance.clone());
        state.source_instances.upsert(uhd_instance);
        let user = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, user, vec![hd_instance.id]).await;
        let token = mint_access_token(&state, user);
        let (_, _, body) = send(
            router.clone(),
            "POST",
            "/api/v1/calendar/feed",
            Some(&token),
        )
        .await;
        let created: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let (_, _, body) = send(router, "GET", &feed_path(&created), None).await;
        let ics = String::from_utf8(body).unwrap();
        assert!(ics.contains("Source: TV HD"), "{ics}");
        assert!(
            !ics.contains("TV 4K"),
            "restricted user must not see the other library"
        );
    }

    async fn fake_sonarr_today() -> MockServer {
        let server = MockServer::start().await;
        let now = Utc::now();
        Mock::given(method("GET"))
            .and(path("/api/v3/calendar"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([{
                "id": 1, "seriesId": 1, "seasonNumber": 1, "episodeNumber": 1, "title": "Pilot",
                "airDate": now.format("%Y-%m-%d").to_string(),
                "airDateUtc": now.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
                "hasFile": false, "monitored": true,
                "series": {"id": 1, "title": "Morning Programme", "tvdbId": 99, "images": []}
            }])))
            .mount(&server)
            .await;
        server
    }

    #[tokio::test]
    async fn webhook_events_drive_the_availability_lag_and_calendar_entries() {
        let (router, state) = test_state().await;
        let server = fake_sonarr("Show").await; // tvdb 77, aired 2026-10-10 in the fixture
        let sonarr = instance(SourceKind::Sonarr, "TV", server.uri());
        state.source_instances.upsert(sonarr.clone());
        let work_id = crate::test_support::seed_series_with_tvdb(&state, "Show", "77").await;

        let now = Utc::now();
        let air = |hours_ago: i64| {
            (now - ChronoDuration::hours(hours_ago))
                .format("%Y-%m-%dT%H:%M:%SZ")
                .to_string()
        };
        let payload = json!({
            "eventType": "Download", "isUpgrade": false,
            "series": {"id": 1, "tvdbId": 77},
            "episodes": [
                {"id": 1, "seasonNumber": 1, "episodeNumber": 1, "airDateUtc": air(2)},
                {"id": 2, "seasonNumber": 1, "episodeNumber": 2, "airDateUtc": air(24 * 60)},
                {"id": 3, "seasonNumber": 1, "episodeNumber": 3}
            ]
        });
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/webhooks/{}", sonarr.id))
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::ACCEPTED);

        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let token = mint_access_token(&state, admin);
        let (status, body) = get(
            router.clone(),
            &token,
            &format!("/api/v1/catalog/{work_id}/availability-lag"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["sample_count"], 1);
        assert_eq!(
            body["backfill_count"], 1,
            "the 60-day-old episode is a backfill"
        );
        assert_eq!(
            body["unknown_count"], 1,
            "no air date is explicit, not zero"
        );
        let average = body["average_seconds"].as_i64().unwrap();
        assert!((7200..7300).contains(&average), "average {average}");

        let (_, body) = get(
            router,
            &token,
            "/api/v1/calendar?start=2026-10-01&end=2026-10-31",
        )
        .await;
        let lag = body["entries"][0]["average_lag_seconds"].as_i64().unwrap();
        assert!((7200..7300).contains(&lag));
    }

    #[tokio::test]
    async fn availability_lag_has_no_average_without_events() {
        let (router, state) = test_state().await;
        let work_id = crate::test_support::seed_series_with_tvdb(&state, "Quiet", "5").await;
        let admin = Uuid::new_v4();
        seed_admin_user(&state, admin).await;
        let token = mint_access_token(&state, admin);
        let (status, body) = get(
            router.clone(),
            &token,
            &format!("/api/v1/catalog/{work_id}/availability-lag"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(body["average_seconds"].is_null());
        let (status, _) = get(
            router,
            &token,
            &format!("/api/v1/catalog/{}/availability-lag", Uuid::new_v4()),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }
}
