//! Background-refreshed cache of every calendar source's data.
//!
//! The calendar API never waits on a *arr instance: it answers from here. A
//! refresher task fills the cache per instance and month on a schedule (and
//! when a webhook says something changed), with a per-call timeout and a
//! doubling backoff after failures. A failed refresh keeps the last good data.
//! Chunks and health persist in SQLite so a restart serves immediately.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, Datelike, Months, NaiveDate, Utc};
use playarr_arr_sync::calendar::{classify_error, fetch_calendar, CalendarCandidate};
use playarr_db::{SqlxCalendarSourceCacheRepo, StoredChunk, StoredHealth};
use playarr_model::{CalendarSourceState, SourceInstance, SourceKind};
use tokio::sync::Notify;
use uuid::Uuid;

use crate::AppState;

/// Months before the current one that stay cached.
pub const MONTHS_BACK: u32 = 3;
/// Months after the current one that stay cached.
pub const MONTHS_FORWARD: u32 = 9;

#[derive(Debug, Clone, Copy)]
pub struct RefreshTiming {
    /// Time allowed for one month of one instance.
    pub chunk_timeout: Duration,
    /// Wait between refreshes while the instance is healthy.
    pub interval: Duration,
    /// First wait after a failure; doubles per consecutive failure.
    pub backoff_base: Duration,
    pub backoff_max: Duration,
}

impl Default for RefreshTiming {
    fn default() -> Self {
        Self {
            // Nothing waits on a refresh, so a slow instance gets time to answer.
            chunk_timeout: Duration::from_secs(120),
            interval: Duration::from_secs(10 * 60),
            backoff_base: Duration::from_secs(60),
            backoff_max: Duration::from_secs(30 * 60),
        }
    }
}

impl RefreshTiming {
    /// How long to wait before the next attempt after `failures` failures in a row.
    pub fn delay_after(&self, failures: u32) -> Duration {
        if failures == 0 {
            return self.interval;
        }
        let factor = 1u32 << failures.saturating_sub(1).min(16);
        self.backoff_base
            .saturating_mul(factor)
            .min(self.backoff_max)
    }
}

#[derive(Debug, Clone, Default)]
pub struct SourceHealth {
    pub last_success_at: Option<DateTime<Utc>>,
    pub last_attempt_at: Option<DateTime<Utc>>,
    pub last_error: Option<(CalendarSourceState, String)>,
    pub consecutive_failures: u32,
}

#[derive(Default)]
struct Inner {
    /// (instance, `YYYY-MM`) -> last good entries of that month.
    chunks: HashMap<(Uuid, String), Vec<CalendarCandidate>>,
    health: HashMap<Uuid, SourceHealth>,
    in_flight: HashSet<Uuid>,
    /// Instances to refresh now regardless of schedule.
    due_now: HashSet<Uuid>,
}

pub struct CalendarCache {
    inner: Mutex<Inner>,
    store: Option<SqlxCalendarSourceCacheRepo>,
    timing: RefreshTiming,
    wake: Notify,
}

impl Default for CalendarCache {
    fn default() -> Self {
        Self::build(None, RefreshTiming::default())
    }
}

pub fn month_key(date: NaiveDate) -> String {
    format!("{:04}-{:02}", date.year(), date.month())
}

fn month_bounds(key: &str) -> Option<(NaiveDate, NaiveDate)> {
    let first = NaiveDate::parse_from_str(&format!("{key}-01"), "%Y-%m-%d").ok()?;
    let last = first.checked_add_months(Months::new(1))?.pred_opt()?;
    Some((first, last))
}

/// The months to keep cached around `today`, nearest first.
pub fn window_months(today: NaiveDate) -> Vec<String> {
    let first_of_month = today.with_day(1).unwrap_or(today);
    let mut keys = vec![month_key(first_of_month)];
    for offset in 1..=MONTHS_FORWARD.max(MONTHS_BACK) {
        if offset <= MONTHS_FORWARD {
            if let Some(d) = first_of_month.checked_add_months(Months::new(offset)) {
                keys.push(month_key(d));
            }
        }
        if offset <= MONTHS_BACK {
            if let Some(d) = first_of_month.checked_sub_months(Months::new(offset)) {
                keys.push(month_key(d));
            }
        }
    }
    keys
}

impl CalendarCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// A cache that persists to SQLite; call [`Self::load`] once at startup.
    pub fn persistent(store: SqlxCalendarSourceCacheRepo) -> Self {
        Self::build(Some(store), RefreshTiming::default())
    }

    pub fn with_timing(mut self, timing: RefreshTiming) -> Self {
        self.timing = timing;
        self
    }

    fn build(store: Option<SqlxCalendarSourceCacheRepo>, timing: RefreshTiming) -> Self {
        Self {
            inner: Mutex::new(Inner::default()),
            store,
            timing,
            wake: Notify::new(),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Loads persisted chunks and health into memory.
    pub async fn load(&self) {
        let Some(store) = &self.store else { return };
        let (chunks, health) = match (store.all_chunks().await, store.all_health().await) {
            (Ok(c), Ok(h)) => (c, h),
            (Err(e), _) | (_, Err(e)) => {
                tracing::warn!(error = %e, "calendar cache: could not load persisted data");
                return;
            }
        };
        let mut inner = self.lock();
        for chunk in chunks {
            let (Ok(id), Ok(entries)) = (
                Uuid::parse_str(&chunk.instance_id),
                serde_json::from_str::<Vec<CalendarCandidate>>(&chunk.entries_json),
            ) else {
                continue;
            };
            inner.chunks.insert((id, chunk.month), entries);
        }
        for h in health {
            let Ok(id) = Uuid::parse_str(&h.instance_id) else {
                continue;
            };
            inner.health.insert(
                id,
                SourceHealth {
                    last_success_at: h.last_success_at,
                    last_attempt_at: h.last_attempt_at,
                    last_error: h.last_error_message.map(|m| {
                        (
                            match h.last_error_state.as_deref() {
                                Some("rejected") => CalendarSourceState::Rejected,
                                Some("error") => CalendarSourceState::Error,
                                _ => CalendarSourceState::Unreachable,
                            },
                            m,
                        )
                    }),
                    consecutive_failures: h.consecutive_failures,
                },
            );
        }
    }

    /// Cached entries of `instance` dated inside the inclusive window. Never blocks on a source.
    pub fn snapshot(
        &self,
        instance: Uuid,
        start: NaiveDate,
        end: NaiveDate,
    ) -> Vec<CalendarCandidate> {
        let inner = self.lock();
        let mut out = Vec::new();
        let mut cursor = start.with_day(1).unwrap_or(start);
        while cursor <= end {
            if let Some(entries) = inner.chunks.get(&(instance, month_key(cursor))) {
                out.extend(
                    entries
                        .iter()
                        .filter(|c| c.entry.date >= start && c.entry.date <= end)
                        .cloned(),
                );
            }
            match cursor.checked_add_months(Months::new(1)) {
                Some(next) => cursor = next,
                None => break,
            }
        }
        out
    }

    pub fn health(&self, instance: Uuid) -> SourceHealth {
        self.lock()
            .health
            .get(&instance)
            .cloned()
            .unwrap_or_default()
    }

    /// Asks the refresher to refresh every instance (or one) at its next wake-up.
    pub fn request_refresh(&self, instance: Option<Uuid>) {
        {
            let mut inner = self.lock();
            match instance {
                Some(id) => {
                    inner.due_now.insert(id);
                }
                None => {
                    let ids: Vec<Uuid> = inner.health.keys().copied().collect();
                    inner.due_now.extend(ids);
                    inner.due_now.insert(Uuid::nil());
                }
            }
        }
        self.wake.notify_one();
    }

    fn is_due(&self, instance: Uuid, now: DateTime<Utc>) -> bool {
        let inner = self.lock();
        if inner.in_flight.contains(&instance) {
            return false;
        }
        if inner.due_now.contains(&instance) || inner.due_now.contains(&Uuid::nil()) {
            return true;
        }
        match inner
            .health
            .get(&instance)
            .and_then(|h| h.last_attempt_at.map(|at| (at, h)))
        {
            None => true,
            Some((at, h)) => {
                let wait = self.timing.delay_after(h.consecutive_failures);
                now.signed_duration_since(at)
                    .to_std()
                    .map(|elapsed| elapsed >= wait)
                    .unwrap_or(false)
            }
        }
    }

    /// Refreshes every month of `instance` around `today`, nearest first.
    /// Stops at the first failure (a dead instance costs one timeout, not one
    /// per month) and keeps whatever was cached before.
    pub async fn refresh_instance(&self, instance: &SourceInstance, today: NaiveDate) {
        {
            let mut inner = self.lock();
            if !inner.in_flight.insert(instance.id) {
                return;
            }
            inner.due_now.remove(&instance.id);
        }
        let mut failure: Option<(CalendarSourceState, String)> = None;
        for month in window_months(today) {
            let Some((first, last)) = month_bounds(&month) else {
                continue;
            };
            let result = tokio::time::timeout(
                self.timing.chunk_timeout,
                fetch_calendar(instance, first, last),
            )
            .await;
            let entries = match result {
                Ok(Ok(entries)) => entries,
                Ok(Err(e)) => {
                    failure = Some(classify_error(&e));
                    break;
                }
                Err(_) => {
                    failure = Some((
                        CalendarSourceState::Unreachable,
                        "timed out waiting for the instance".to_string(),
                    ));
                    break;
                }
            };
            let now = Utc::now();
            if let Some(store) = &self.store {
                match serde_json::to_string(&entries) {
                    Ok(json) => {
                        if let Err(e) = store
                            .put_chunk(&StoredChunk {
                                instance_id: instance.id.to_string(),
                                month: month.clone(),
                                fetched_at: now,
                                entries_json: json,
                            })
                            .await
                        {
                            tracing::warn!(error = %e, "calendar cache: could not persist a month");
                        }
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "calendar cache: could not encode a month")
                    }
                }
            }
            self.lock().chunks.insert((instance.id, month), entries);
        }

        let now = Utc::now();
        let health = {
            let mut inner = self.lock();
            let health = inner.health.entry(instance.id).or_default();
            health.last_attempt_at = Some(now);
            match &failure {
                None => {
                    health.last_success_at = Some(now);
                    health.last_error = None;
                    health.consecutive_failures = 0;
                }
                Some(error) => {
                    health.last_error = Some(error.clone());
                    health.consecutive_failures = health.consecutive_failures.saturating_add(1);
                }
            }
            let snapshot = health.clone();
            inner.in_flight.remove(&instance.id);
            snapshot
        };
        if let Some(error) = &failure {
            tracing::warn!(instance = %instance.name, state = ?error.0, reason = %error.1, failures = health.consecutive_failures, "calendar refresh failed; serving the last good data");
        }
        if let Some(store) = &self.store {
            let stored = StoredHealth {
                instance_id: instance.id.to_string(),
                last_success_at: health.last_success_at,
                last_attempt_at: health.last_attempt_at,
                last_error_state: health
                    .last_error
                    .as_ref()
                    .map(|(s, _)| format!("{s:?}").to_lowercase()),
                last_error_message: health.last_error.as_ref().map(|(_, m)| m.clone()),
                consecutive_failures: health.consecutive_failures,
            };
            if let Err(e) = store.put_health(&stored).await {
                tracing::warn!(error = %e, "calendar cache: could not persist health");
            }
        }
    }

    /// One pass: refresh each due instance concurrently, drop what no longer applies.
    pub async fn refresh_due(&self, instances: &[SourceInstance]) {
        let now = Utc::now();
        let today = now.date_naive();
        let due: Vec<&SourceInstance> = instances
            .iter()
            .filter(|i| is_calendar_source(i.kind))
            .filter(|i| self.is_due(i.id, now))
            .collect();
        {
            let mut inner = self.lock();
            inner.due_now.remove(&Uuid::nil());
        }
        futures::future::join_all(due.into_iter().map(|i| self.refresh_instance(i, today))).await;
        self.prune(instances, today).await;
    }

    async fn prune(&self, instances: &[SourceInstance], today: NaiveDate) {
        let keep_ids: Vec<Uuid> = instances.iter().map(|i| i.id).collect();
        let months: HashSet<String> = window_months(today).into_iter().collect();
        {
            let mut inner = self.lock();
            inner
                .chunks
                .retain(|(id, month), _| keep_ids.contains(id) && months.contains(month));
            inner.health.retain(|id, _| keep_ids.contains(id));
        }
        if let Some(store) = &self.store {
            let oldest = months.iter().min().cloned().unwrap_or_default();
            let keep: Vec<String> = keep_ids.iter().map(|id| id.to_string()).collect();
            if let Err(e) = store.prune(&oldest, &keep).await {
                tracing::warn!(error = %e, "calendar cache: prune failed");
            }
        }
    }
}

fn is_calendar_source(kind: SourceKind) -> bool {
    matches!(
        kind,
        SourceKind::Sonarr | SourceKind::Radarr | SourceKind::Lidarr | SourceKind::Readarr
    )
}

/// Keeps the cache fresh for the life of the process.
pub async fn run_refresher(state: AppState) {
    let cache: Arc<CalendarCache> = state.calendar_cache.clone();
    cache.load().await;
    loop {
        let instances = state.source_instances.all();
        cache.refresh_due(&instances).await;
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(15)) => {}
            _ = cache.wake.notified() => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use playarr_model::Sensitive;
    use serde_json::json;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn instance(url: String) -> SourceInstance {
        SourceInstance {
            id: Uuid::new_v4(),
            kind: SourceKind::Sonarr,
            name: "TV".to_string(),
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

    async fn sonarr(delay: Duration) -> MockServer {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/calendar"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_delay(delay)
                    .set_body_json(json!([{
                        "id": 1, "seriesId": 1, "seasonNumber": 1, "episodeNumber": 1,
                        "title": "Pilot", "airDate": "2026-10-10",
                        "airDateUtc": "2026-10-10T20:00:00Z", "hasFile": false,
                        "monitored": true,
                        "series": {"id": 1, "title": "Show", "tvdbId": 77, "images": []}
                    }])),
            )
            .mount(&server)
            .await;
        server
    }

    fn day(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    #[tokio::test]
    async fn serves_the_last_good_data_while_the_source_is_down() {
        let cache = CalendarCache::new().with_timing(RefreshTiming {
            chunk_timeout: Duration::from_secs(2),
            ..Default::default()
        });
        let server = sonarr(Duration::ZERO).await;
        let mut inst = instance(server.uri());
        cache.refresh_instance(&inst, day(2026, 10, 15)).await;
        let (start, end) = (day(2026, 10, 1), day(2026, 10, 31));
        assert_eq!(cache.snapshot(inst.id, start, end).len(), 1);
        assert!(cache.health(inst.id).last_success_at.is_some());

        // The source goes away: the next refresh fails, the data stays.
        inst.base_url = "http://127.0.0.1:1".to_string();
        cache.refresh_instance(&inst, day(2026, 10, 15)).await;
        assert_eq!(cache.snapshot(inst.id, start, end).len(), 1);
        let health = cache.health(inst.id);
        assert_eq!(health.consecutive_failures, 1);
        assert!(health.last_error.is_some());
        assert!(health.last_success_at.is_some());
    }

    #[tokio::test]
    async fn a_slow_source_costs_one_timeout_not_one_per_month() {
        let cache = CalendarCache::new().with_timing(RefreshTiming {
            chunk_timeout: Duration::from_millis(200),
            ..Default::default()
        });
        let server = sonarr(Duration::from_secs(5)).await;
        let inst = instance(server.uri());
        let started = std::time::Instant::now();
        cache.refresh_instance(&inst, day(2026, 10, 15)).await;
        assert!(started.elapsed() < Duration::from_secs(2));
        let health = cache.health(inst.id);
        assert_eq!(health.consecutive_failures, 1);
        assert_eq!(
            health.last_error.unwrap().0,
            CalendarSourceState::Unreachable
        );
        assert!(cache
            .snapshot(inst.id, day(2026, 10, 1), day(2026, 10, 31))
            .is_empty());
    }

    #[test]
    fn backoff_doubles_and_is_capped() {
        let t = RefreshTiming::default();
        assert_eq!(t.delay_after(0), Duration::from_secs(600));
        assert_eq!(t.delay_after(1), Duration::from_secs(60));
        assert_eq!(t.delay_after(2), Duration::from_secs(120));
        assert_eq!(t.delay_after(3), Duration::from_secs(240));
        assert_eq!(t.delay_after(20), Duration::from_secs(1800));
    }

    #[tokio::test]
    async fn due_follows_the_schedule_and_backoff() {
        let cache = CalendarCache::new();
        let inst = instance("http://127.0.0.1:1".to_string());
        let now = Utc::now();
        assert!(cache.is_due(inst.id, now), "never refreshed");
        cache.lock().health.insert(
            inst.id,
            SourceHealth {
                last_attempt_at: Some(now),
                consecutive_failures: 2,
                ..Default::default()
            },
        );
        assert!(!cache.is_due(inst.id, now + chrono::Duration::seconds(90)));
        assert!(cache.is_due(inst.id, now + chrono::Duration::seconds(121)));
        cache.request_refresh(Some(inst.id));
        assert!(cache.is_due(inst.id, now));
    }

    #[test]
    fn window_covers_past_and_future_months_nearest_first() {
        let months = window_months(day(2026, 10, 8));
        assert_eq!(months[0], "2026-10");
        assert!(months.contains(&"2026-07".to_string()));
        assert!(months.contains(&"2027-07".to_string()));
        assert!(!months.contains(&"2026-06".to_string()));
        assert_eq!(months.len(), (MONTHS_BACK + MONTHS_FORWARD + 1) as usize);
    }
}
