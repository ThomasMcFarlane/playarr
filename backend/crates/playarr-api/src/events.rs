//! Per-user live change stream: `GET /api/v1/events`
//! (`docs/architecture/live-events.md`).
//!
//! The stream is a thin, durable pointer log. Writers (repository decorators,
//! admin and household handlers, the arr sync worker) append minimal rows to
//! `live_events`; each open stream tails that table after its cursor, keeps only
//! what its caller may see, and sends one `change` frame per row. A frame names
//! an entity and what changed, never the entity body, so clients refetch through
//! the normal authorised read APIs and cannot learn anything this stream could
//! leak beyond "something with this id changed".

use std::collections::{HashMap, VecDeque};
use std::convert::Infallible;
use std::time::Duration;

use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures::Stream;
use playarr_db::{live_event_kind as kind, subscribe_live_events, LiveEvent, NewLiveEvent};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth_extractor::{resolve_catalog_access, AnytimeStreamingUser};
use crate::error::ApiError;
use crate::AppState;

/// A stream ends after this long so it never outlives the access token that
/// opened it; clients reconnect with `Last-Event-ID`.
const STREAM_MAX_AGE: Duration = Duration::from_secs(5 * 60);
/// Re-check interval when no in-process wake arrives (other process or replica).
const FALLBACK_POLL: Duration = Duration::from_millis(2_000);
/// How often the caller's policy and library access are re-resolved.
const POLICY_REFRESH: Duration = Duration::from_secs(30);
/// Comment frames keep proxies and clients' read timeouts alive.
const HEARTBEAT: Duration = Duration::from_secs(15);
/// More rows of one kind than this in one batch collapse into a single
/// `bulk` frame (a first sync touches every title); clients then invalidate
/// the whole area instead of thousands of single entities.
const BULK_THRESHOLD: usize = 50;
const BATCH: i64 = 500;

#[derive(Debug, Deserialize, ToSchema)]
pub struct EventsQuery {
    /// Last event seq already processed; `Last-Event-ID` wins when larger.
    #[serde(default)]
    pub after: i64,
}

/// Payload of a `change` frame. `entity` + `id` say what to refetch;
/// `changed` says which facets moved. A `bulk` entry in `changed` (with
/// `entity` `*`) means "many things changed, refetch this whole area".
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ChangeEvent {
    pub seq: i64,
    /// `watch`, `library`, `playlist`, `watchlist`, `calendar`, `download`,
    /// `household`, `account` or `admin`.
    #[serde(rename = "type")]
    pub kind: String,
    /// `work`, `playlist`, `watchlist`, `download`, `profile`, `source_instance`
    /// or `*` for a bulk change.
    pub entity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub changed: Vec<String>,
    /// Server time of the change in epoch milliseconds. Monotonic enough to
    /// drop an event for data fetched at or after this instant.
    pub at: i64,
}

/// Payload of the first `ready` frame.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ReadyEvent {
    /// Newest seq at connect time; this frame's SSE `id`, so a reconnect
    /// resumes from here even when no change arrived.
    pub seq: i64,
    pub retention_ms: i64,
    pub heartbeat_ms: u64,
    pub max_age_ms: u64,
    pub server_time_ms: i64,
}

/// Payload of a `resync` frame: the cursor could not be honoured, so the
/// client must refetch everything it shows.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ResyncEvent {
    pub reason: String,
    pub seq: i64,
}

fn to_change(e: &LiveEvent) -> ChangeEvent {
    ChangeEvent {
        seq: e.seq,
        kind: e.kind.clone(),
        entity: e.entity.clone(),
        id: e.entity_id.clone(),
        changed: e.changed.clone(),
        at: e.created_ms,
    }
}

/// What one stream's caller may receive. Rebuilt on a timer so a policy edit
/// or a household lock takes effect without waiting for a reconnect.
struct Audience {
    user_id: Uuid,
    is_admin: bool,
    /// `None` = every library.
    libraries: Option<Vec<Uuid>>,
    /// Outside the household schedule or over budget: only `household` and
    /// `account` events pass, so a locked profile learns when it is unlocked
    /// but is not nudged about content.
    locked: bool,
}

impl Audience {
    async fn resolve(state: &AppState, user_id: Uuid) -> Result<Self, ApiError> {
        let (policy, libraries) = resolve_catalog_access(state, user_id).await?;
        let locked = state
            .household
            .ensure_time_allowed(&policy, user_id)
            .await
            .is_err();
        Ok(Self {
            user_id,
            is_admin: policy.is_admin,
            libraries,
            locked,
        })
    }
}

/// Library visibility for a work-level event with no source instance of its
/// own. A work with no synced file is visible to no restricted caller, the same
/// rule the catalogue applies.
async fn work_visible(
    state: &AppState,
    cache: &mut HashMap<Uuid, bool>,
    libraries: &[Uuid],
    work_id: Uuid,
) -> bool {
    if let Some(v) = cache.get(&work_id) {
        return *v;
    }
    let visible = match state.media_file_repo.list_by_work_id(work_id).await {
        Ok(files) => files
            .iter()
            .any(|f| libraries.contains(&f.source_instance_id)),
        Err(_) => false,
    };
    if cache.len() > 2048 {
        cache.clear();
    }
    cache.insert(work_id, visible);
    visible
}

async fn deliverable(
    state: &AppState,
    audience: &Audience,
    cache: &mut HashMap<Uuid, bool>,
    e: &LiveEvent,
) -> bool {
    if let Some(target) = e.user_id {
        if target != audience.user_id {
            return false;
        }
        return !audience.locked || matches!(e.kind.as_str(), kind::HOUSEHOLD | kind::ACCOUNT);
    }
    match e.kind.as_str() {
        kind::ADMIN => audience.is_admin,
        _ if audience.locked => false,
        kind::LIBRARY | kind::CALENDAR => {
            let Some(libraries) = audience.libraries.as_deref() else {
                return true;
            };
            if let Some(instance) = e.source_instance_id {
                return libraries.contains(&instance);
            }
            match e.entity_id.as_deref().and_then(|s| s.parse::<Uuid>().ok()) {
                Some(work) if e.entity == "work" => {
                    work_visible(state, cache, libraries, work).await
                }
                // A bulk "refetch the whole area" row names no content.
                _ => e.entity == "*",
            }
        }
        // System-wide rows (for example a System playlist) with no owner.
        _ => true,
    }
}

/// Collapses large same-kind runs into one `bulk` frame.
fn coalesce(events: Vec<LiveEvent>) -> Vec<ChangeEvent> {
    let mut per_kind: HashMap<&str, usize> = HashMap::new();
    for e in &events {
        *per_kind.entry(e.kind.as_str()).or_default() += 1;
    }
    let mut bulk_sent: Vec<String> = Vec::new();
    let mut out = Vec::with_capacity(events.len());
    let last_seq: HashMap<String, (i64, i64)> = events
        .iter()
        .map(|e| (e.kind.clone(), (e.seq, e.created_ms)))
        .collect();
    for e in &events {
        if per_kind[e.kind.as_str()] <= BULK_THRESHOLD {
            out.push(to_change(e));
        } else if !bulk_sent.contains(&e.kind) {
            bulk_sent.push(e.kind.clone());
        }
    }
    for kind in bulk_sent {
        let (seq, at) = last_seq[&kind];
        out.push(ChangeEvent {
            seq,
            kind,
            entity: "*".into(),
            id: None,
            changed: vec!["bulk".into()],
            at,
        });
    }
    out.sort_by_key(|c| c.seq);
    out
}

#[utoipa::path(
    get,
    path = "/api/v1/events",
    tag = "events",
    params(("after" = Option<i64>, Query, description = "Last event seq already processed (or send Last-Event-ID)")),
    responses(
        (status = 200, description = "Server-sent events. `ready` (id = newest seq, body `ReadyEvent`), then `change` frames (id = seq, body `ChangeEvent`) for this account's data, plus `resync` (body `ResyncEvent`) when the resume cursor is too old. `:` comment lines are heartbeats. The stream ends after five minutes; reconnect with `Last-Event-ID`. A server without this route answers non-event-stream content (for example HTML), which clients treat as unsupported and fall back to polling.", content_type = "text/event-stream", body = String),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller lacks Playarr access")
    )
)]
pub async fn events_stream_handler(
    State(state): State<AppState>,
    user: AnytimeStreamingUser,
    headers: HeaderMap,
    Query(query): Query<EventsQuery>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let user_id = user.user_id;
    let audience = Audience::resolve(&state, user_id).await?;
    let last_event_id = headers
        .get("last-event-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<i64>().ok())
        .unwrap_or(0);
    let requested = query.after.max(last_event_id).max(0);

    let repo = state.live_events.repo();
    let (lo, hi) = repo
        .bounds()
        .await
        .map_err(|e| ApiError::internal(format!("live events unavailable: {e}")))?;
    let newest = hi.unwrap_or(0);
    // A cursor ahead of the log (database replaced) or behind the oldest
    // retained row (events were purged while disconnected) cannot be replayed.
    let stale = requested > 0
        && (requested > newest || lo.is_some_and(|lo| lo > requested.saturating_add(1)));
    let cursor = if requested == 0 || stale {
        newest
    } else {
        requested
    };

    struct Loop {
        state: AppState,
        audience: Audience,
        cursor: i64,
        wake: tokio::sync::watch::Receiver<u64>,
        queued: VecDeque<Event>,
        stage: u8,
        newest: i64,
        stale: bool,
        refreshed: tokio::time::Instant,
        started: tokio::time::Instant,
        work_cache: HashMap<Uuid, bool>,
        ticks: u32,
    }
    let now = tokio::time::Instant::now();
    let init = Loop {
        wake: subscribe_live_events(),
        state,
        audience,
        cursor,
        queued: VecDeque::new(),
        stage: 0,
        newest,
        stale,
        refreshed: now,
        started: now,
        work_cache: HashMap::new(),
        ticks: 0,
    };

    let stream = futures::stream::unfold(init, move |mut l| async move {
        // Stage 0/1: `ready` (always) then `resync` (when the cursor was stale).
        if l.stage == 0 {
            l.stage = 1;
            let ready = ReadyEvent {
                seq: l.newest,
                retention_ms: playarr_db::LIVE_EVENT_RETENTION_MS,
                heartbeat_ms: HEARTBEAT.as_millis() as u64,
                max_age_ms: STREAM_MAX_AGE.as_millis() as u64,
                server_time_ms: chrono::Utc::now().timestamp_millis(),
            };
            let frame = Event::default()
                .event("ready")
                .id(l.newest.to_string())
                .json_data(&ready)
                .unwrap_or_else(|_| Event::default().comment("encode error"));
            return Some((Ok(frame), l));
        }
        if l.stage == 1 {
            l.stage = 2;
            if l.stale {
                let resync = ResyncEvent {
                    reason: "cursor_expired".into(),
                    seq: l.newest,
                };
                let frame = Event::default()
                    .event("resync")
                    .id(l.newest.to_string())
                    .json_data(&resync)
                    .unwrap_or_else(|_| Event::default().comment("encode error"));
                return Some((Ok(frame), l));
            }
        }
        loop {
            if let Some(frame) = l.queued.pop_front() {
                return Some((Ok(frame), l));
            }
            if l.started.elapsed() >= STREAM_MAX_AGE {
                return None;
            }
            if l.refreshed.elapsed() >= POLICY_REFRESH {
                match Audience::resolve(&l.state, l.audience.user_id).await {
                    Ok(a) => l.audience = a,
                    // Disabled, deleted or no longer allowed: end the stream so
                    // the reconnect is authorised afresh.
                    Err(_) => return None,
                }
                l.refreshed = tokio::time::Instant::now();
            }
            match l.state.live_events.repo().list_after(l.cursor, BATCH).await {
                Ok(rows) => {
                    let full = rows.len() as i64 >= BATCH;
                    if let Some(last) = rows.last() {
                        l.cursor = l.cursor.max(last.seq);
                    }
                    let mut mine = Vec::new();
                    for row in rows {
                        if deliverable(&l.state, &l.audience, &mut l.work_cache, &row).await {
                            mine.push(row);
                        }
                    }
                    for change in coalesce(mine) {
                        let frame = Event::default()
                            .event("change")
                            .id(change.seq.to_string())
                            .json_data(&change)
                            .unwrap_or_else(|_| Event::default().comment("encode error"));
                        l.queued.push_back(frame);
                    }
                    if full || !l.queued.is_empty() {
                        continue;
                    }
                }
                Err(_) => return None,
            }
            l.ticks = l.ticks.wrapping_add(1);
            if l.ticks % 60 == 0 {
                let _ = l.state.live_events.repo().purge(now_ms()).await;
            }
            let _ = tokio::time::timeout(FALLBACK_POLL, l.wake.changed()).await;
        }
    });
    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(HEARTBEAT)))
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Publishes household and account events for each of `users`.
pub async fn publish_to_users(
    state: &AppState,
    users: impl IntoIterator<Item = Uuid>,
    kind: &'static str,
    entity: &'static str,
    entity_id: impl ToString,
    changed: &[&'static str],
) {
    let id = entity_id.to_string();
    let mut seen = std::collections::HashSet::new();
    for user in users {
        if seen.insert(user) {
            state
                .live_events
                .publish(NewLiveEvent::for_user(user, kind, entity, &id, changed))
                .await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        mint_access_token, seed_admin_user, seed_downloadable_media_file, seed_movie,
        seed_streaming_user, seed_streaming_user_with_library_allow, test_state, TestState,
    };
    use axum::body::{Body, BodyDataStream};
    use axum::http::{Request, StatusCode};
    use axum::Router;
    use futures::StreamExt;
    use tower::ServiceExt;

    fn ev(seq: i64, kind: &str) -> LiveEvent {
        LiveEvent {
            seq,
            user_id: None,
            kind: kind.into(),
            entity: "work".into(),
            entity_id: Some(Uuid::new_v4().to_string()),
            changed: vec!["x".into()],
            source_instance_id: None,
            created_ms: seq * 10,
        }
    }

    #[test]
    fn large_same_kind_runs_collapse_to_one_bulk_frame() {
        let mut events: Vec<LiveEvent> = (1..=60).map(|i| ev(i, "library")).collect();
        events.push(ev(61, "playlist"));
        let out = coalesce(events);
        assert_eq!(out.len(), 2, "{out:?}");
        let bulk = out.iter().find(|c| c.kind == "library").unwrap();
        assert_eq!((bulk.entity.as_str(), bulk.seq), ("*", 60));
        assert_eq!(bulk.changed, vec!["bulk".to_string()]);
        assert!(out
            .iter()
            .any(|c| c.kind == "playlist" && c.entity == "work"));
        assert_eq!(coalesce(vec![ev(1, "library"), ev(2, "library")]).len(), 2);
    }

    async fn open(
        router: &Router,
        token: &str,
        last_event_id: Option<i64>,
    ) -> (StatusCode, Option<BodyDataStream>) {
        let mut req = Request::builder()
            .uri("/api/v1/events")
            .header("Authorization", format!("Bearer {token}"));
        if let Some(id) = last_event_id {
            req = req.header("Last-Event-ID", id.to_string());
        }
        let res = router
            .clone()
            .oneshot(req.body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = res.status();
        let ct = res
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        if status != StatusCode::OK {
            return (status, None);
        }
        assert!(ct.starts_with("text/event-stream"), "{ct}");
        (status, Some(res.into_body().into_data_stream()))
    }

    async fn read_until(stream: &mut BodyDataStream, needle: &str, within: Duration) -> String {
        let deadline = tokio::time::Instant::now() + within;
        let mut seen = String::new();
        loop {
            let left = deadline.saturating_duration_since(tokio::time::Instant::now());
            match tokio::time::timeout(left, stream.next()).await {
                Ok(Some(Ok(chunk))) => {
                    seen.push_str(&String::from_utf8_lossy(&chunk));
                    if seen.contains(needle) {
                        return seen;
                    }
                }
                _ => return seen,
            }
        }
    }

    /// Everything the stream sends within `within`.
    async fn drain(stream: &mut BodyDataStream, within: Duration) -> String {
        read_until(stream, "\u{0}never", within).await
    }

    fn progress(
        work: Uuid,
        file: Uuid,
        position_ms: u64,
        completed: bool,
    ) -> playarr_model::WatchProgress {
        playarr_model::WatchProgress {
            media_file_id: file,
            work_id: work,
            position_ms,
            duration_ms: 1_000_000,
            state: playarr_model::WatchProgress::state_for(position_ms, 1_000_000, completed),
            updated_at: Some(chrono::Utc::now()),
        }
    }

    async fn setup() -> (Router, TestState, Uuid, String) {
        let (router, state) = test_state().await;
        let user = Uuid::new_v4();
        seed_streaming_user(&state, user).await;
        let token = mint_access_token(&state, user);
        (router, state, user, token)
    }

    const WAIT: Duration = Duration::from_millis(2_500);
    const QUIET: Duration = Duration::from_millis(600);

    #[tokio::test]
    async fn requires_authentication() {
        let (router, _state) = test_state().await;
        let (status, _) = open(&router, "garbage", None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn watched_state_on_one_device_reaches_the_users_other_stream_only() {
        let (router, state, user, token) = setup().await;
        let other = Uuid::new_v4();
        seed_streaming_user(&state, other).await;
        let other_token = mint_access_token(&state, other);
        let work = seed_movie(&state, "Live").await;
        let file = seed_media_file_for(&state, work).await;

        let (_, s) = open(&router, &token, None).await;
        let mut mine = s.unwrap();
        let (_, s) = open(&router, &other_token, None).await;
        let mut theirs = s.unwrap();
        let ready = read_until(&mut mine, "event: ready", WAIT).await;
        assert!(ready.contains("event: ready"), "{ready}");
        read_until(&mut theirs, "event: ready", WAIT).await;

        // Another device of `user` marks the title watched.
        state
            .app
            .watch_progress
            .upsert(user, &progress(work, file, 990_000, true))
            .await
            .unwrap();

        let got = read_until(&mut mine, "event: change", WAIT).await;
        assert!(got.contains("\"type\":\"watch\""), "{got}");
        assert!(got.contains(&work.to_string()), "{got}");
        assert!(got.contains("\"changed\":[\"watched\"]"), "{got}");
        let leaked = drain(&mut theirs, QUIET).await;
        assert!(!leaked.contains("event: change"), "other user got {leaked}");
    }

    #[tokio::test]
    async fn progress_ticks_are_throttled_but_state_changes_are_not() {
        let (router, state, user, token) = setup().await;
        let work = seed_movie(&state, "Ticks").await;
        let file = seed_media_file_for(&state, work).await;
        let (_, s) = open(&router, &token, None).await;
        let mut stream = s.unwrap();
        read_until(&mut stream, "event: ready", WAIT).await;
        for pos in [10_000, 20_000, 30_000, 40_000] {
            state
                .app
                .watch_progress
                .upsert(user, &progress(work, file, pos, false))
                .await
                .unwrap();
        }
        let seen = drain(&mut stream, Duration::from_millis(900)).await;
        assert_eq!(seen.matches("event: change").count(), 1, "{seen}");
        state
            .app
            .watch_progress
            .upsert(user, &progress(work, file, 995_000, true))
            .await
            .unwrap();
        let done = read_until(&mut stream, "watched", WAIT).await;
        assert!(done.contains("\"changed\":[\"watched\"]"), "{done}");
    }

    async fn seed_media_file_for(state: &TestState, work: Uuid) -> Uuid {
        seed_downloadable_media_file(state, work, Uuid::new_v4())
            .await
            .id
    }

    #[tokio::test]
    async fn library_events_are_scoped_to_allowed_libraries() {
        let (router, state, _user, _t) = setup().await;
        // `library_allow` empty means deny-all, so the unrestricted viewer is
        // an admin who can also stream.
        let unrestricted = Uuid::new_v4();
        crate::test_support::seed_policy_user(&state, unrestricted, |p| {
            p.is_admin = true;
            p.can_stream = true;
        })
        .await;
        let open_token = mint_access_token(&state, unrestricted);
        let lib_a = Uuid::new_v4();
        let lib_b = Uuid::new_v4();
        let restricted = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, restricted, vec![lib_a]).await;
        let restricted_token = mint_access_token(&state, restricted);

        let (_, s) = open(&router, &restricted_token, None).await;
        let mut r = s.unwrap();
        let (_, s) = open(&router, &open_token, None).await;
        let mut o = s.unwrap();
        read_until(&mut r, "event: ready", WAIT).await;
        read_until(&mut o, "event: ready", WAIT).await;

        // A new episode file imported into library B: the restricted viewer
        // must not hear about it, the unrestricted one must.
        let work_b = seed_movie(&state, "In B").await;
        let _ = seed_downloadable_media_file(&state, work_b, lib_b).await;
        let seen_o = read_until(&mut o, "imported", WAIT).await;
        assert!(seen_o.contains(&work_b.to_string()), "{seen_o}");
        assert!(seen_o.contains("\"changed\":[\"files\"]"), "{seen_o}");
        assert!(seen_o.contains("\"type\":\"calendar\""), "{seen_o}");
        let seen_r = drain(&mut r, QUIET).await;
        assert!(
            !seen_r.contains(&work_b.to_string()),
            "restricted viewer leaked: {seen_r}"
        );

        // The same import into library A reaches the restricted viewer.
        let work_a = seed_movie(&state, "In A").await;
        let _ = seed_downloadable_media_file(&state, work_a, lib_a).await;
        let seen_r = read_until(&mut r, "\"changed\":[\"files\"]", WAIT).await;
        assert!(seen_r.contains(&work_a.to_string()), "{seen_r}");
    }

    #[tokio::test]
    async fn work_level_events_without_an_instance_follow_the_works_files() {
        let (router, state, _user, _t) = setup().await;
        let lib_a = Uuid::new_v4();
        let restricted = Uuid::new_v4();
        seed_streaming_user_with_library_allow(&state, restricted, vec![lib_a]).await;
        let token = mint_access_token(&state, restricted);
        let work = seed_movie(&state, "Seeded before connecting").await;
        let _ = seed_downloadable_media_file(&state, work, lib_a).await;
        let (_, s) = open(&router, &token, None).await;
        let mut stream = s.unwrap();
        read_until(&mut stream, "event: ready", WAIT).await;
        // A metadata edit upserts the work (no source instance on the row).
        let w = state.work_repo.get(work).await.unwrap();
        state.work_repo.upsert(&w).await.unwrap();
        let seen = read_until(&mut stream, "upserted", WAIT).await;
        assert!(seen.contains(&work.to_string()), "{seen}");

        let hidden = seed_movie(&state, "Hidden, no files").await;
        let w = state.work_repo.get(hidden).await.unwrap();
        state.work_repo.upsert(&w).await.unwrap();
        let seen = drain(&mut stream, QUIET).await;
        assert!(!seen.contains(&hidden.to_string()), "{seen}");
    }

    #[tokio::test]
    async fn last_event_id_replays_missed_events_and_a_stale_cursor_resyncs() {
        let (router, state, user, token) = setup().await;
        let work = seed_movie(&state, "Resume").await;
        let file = seed_media_file_for(&state, work).await;
        let (_, s) = open(&router, &token, None).await;
        let mut first = s.unwrap();
        let ready = read_until(&mut first, "event: ready", WAIT).await;
        let id: i64 = ready
            .lines()
            .find_map(|l| l.strip_prefix("id: "))
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        drop(first);

        // Missed while disconnected.
        let w2 = seed_movie(&state, "Second").await;
        let f2 = seed_media_file_for(&state, w2).await;
        state
            .app
            .watch_progress
            .upsert(user, &progress(w2, f2, 995_000, true))
            .await
            .unwrap();
        let _ = (work, file);
        let (_, s) = open(&router, &token, Some(id)).await;
        let mut again = s.unwrap();
        let replay = read_until(&mut again, &w2.to_string(), WAIT).await;
        assert!(replay.contains("event: change"), "{replay}");
        assert!(!replay.contains("event: resync"), "{replay}");

        // A cursor beyond the log (database replaced) cannot be honoured.
        let (_, s) = open(&router, &token, Some(10_000_000)).await;
        let mut stale = s.unwrap();
        let seen = read_until(&mut stale, "event: resync", WAIT).await;
        assert!(seen.contains("cursor_expired"), "{seen}");

        // A cursor older than the oldest retained row resyncs too.
        sqlx::query("DELETE FROM live_events WHERE seq < (SELECT MAX(seq) FROM live_events)")
            .execute(&state_pool(&state))
            .await
            .unwrap();
        let (_, s) = open(&router, &token, Some(1)).await;
        let mut purged = s.unwrap();
        let seen = read_until(&mut purged, "event: resync", WAIT).await;
        assert!(seen.contains("cursor_expired"), "{seen}");
    }

    fn state_pool(state: &TestState) -> sqlx::AnyPool {
        state.pool.clone()
    }

    #[tokio::test]
    async fn admin_events_reach_admins_only_and_playlists_reach_their_owner_only() {
        let (router, state, user, token) = setup().await;
        let admin = Uuid::new_v4();
        crate::test_support::seed_policy_user(&state, admin, |p| {
            p.is_admin = true;
            p.can_stream = true;
        })
        .await;
        let admin_token = mint_access_token(&state, admin);
        // An admin account that cannot stream is refused outright.
        let non_streaming_admin = Uuid::new_v4();
        seed_admin_user(&state, non_streaming_admin).await;
        let (status, _) = open(
            &router,
            &mint_access_token(&state, non_streaming_admin),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (_, a) = open(&router, &admin_token, None).await;
        let mut admin_stream = a.unwrap();
        read_until(&mut admin_stream, "event: ready", WAIT).await;

        let (_, s) = open(&router, &token, None).await;
        let mut stream = s.unwrap();
        read_until(&mut stream, "event: ready", WAIT).await;
        state
            .app
            .live_events
            .publish(NewLiveEvent {
                user_id: None,
                kind: playarr_db::live_event_kind::ADMIN,
                entity: "source_instance",
                entity_id: Some(Uuid::new_v4().to_string()),
                changed: vec!["sync_finished"],
                source_instance_id: None,
            })
            .await;
        state
            .app
            .live_events
            .publish(NewLiveEvent::for_user(
                Uuid::new_v4(),
                playarr_db::live_event_kind::PLAYLIST,
                "playlist",
                Uuid::new_v4(),
                &["items"],
            ))
            .await;
        state
            .app
            .live_events
            .publish(NewLiveEvent::for_user(
                user,
                playarr_db::live_event_kind::WATCHLIST,
                "watchlist",
                "tmdb:1",
                &["added"],
            ))
            .await;
        let admin_seen = read_until(&mut admin_stream, "sync_finished", WAIT).await;
        assert!(admin_seen.contains("\"type\":\"admin\""), "{admin_seen}");
        assert!(
            !admin_seen.contains("\"type\":\"playlist\""),
            "{admin_seen}"
        );
        let seen = read_until(&mut stream, "watchlist", WAIT).await;
        assert!(seen.contains("\"type\":\"watchlist\""), "{seen}");
        assert!(!seen.contains("source_instance"), "{seen}");
        assert!(!seen.contains("\"type\":\"playlist\""), "{seen}");
    }
}
