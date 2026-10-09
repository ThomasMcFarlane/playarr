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
    /// Moves whenever a refresh stores new source data.
    generation: std::sync::atomic::AtomicU64,
    responses: Mutex<HashMap<String, CachedResponse>>,
    /// Builds in progress, so identical concurrent requests share one.
    flights: Mutex<HashMap<String, Flight>>,
    stats: CacheCounters,
    feed: ChangeFeed,
    lags: Mutex<LagCache>,
}

/// Average availability lag per `(provider, external id)`. It depends only on
/// the stored grab and import events, so it is shared by every viewer and
/// dropped when one is added.
#[derive(Default)]
struct LagCache {
    generation: u64,
    by_ref: HashMap<(String, String), Option<i64>>,
}

const LAG_CAP: usize = 50_000;

/// Where the cache reads live changes from: the process-wide log in
/// production, a scripted one in tests (the log is shared by every test in
/// a process).
struct ChangeFeed {
    since: Box<dyn Fn(u64) -> Option<Vec<playarr_db::LiveChange>> + Send + Sync>,
    tick: Box<dyn Fn() -> u64 + Send + Sync>,
}

impl Default for ChangeFeed {
    fn default() -> Self {
        Self {
            since: Box::new(playarr_db::live_changes_since),
            tick: Box::new(playarr_db::live_change_tick),
        }
    }
}

/// A response build in progress. Later requests join it only while nothing
/// it depends on has changed since it started.
#[derive(Clone)]
struct Flight {
    source_generation: u64,
    tick: u64,
    cell: Arc<tokio::sync::OnceCell<Arc<playarr_model::CalendarResponse>>>,
}

/// What a built response depends on: the library works its entries point at,
/// and the external ids of entries that have no work yet (a new work carrying
/// one of them changes the answer).
#[derive(Debug, Default, Clone)]
pub struct ResponseDeps {
    works: HashSet<Uuid>,
    unmatched: HashSet<playarr_model::ExternalRef>,
}

impl ResponseDeps {
    pub fn of(response: &playarr_model::CalendarResponse) -> Self {
        let mut deps = Self::default();
        for entry in &response.entries {
            match entry.work_id {
                Some(id) => {
                    deps.works.insert(id);
                }
                None => {
                    if let Some(snapshot) = &entry.snapshot {
                        deps.unmatched
                            .extend(snapshot.external_refs.iter().cloned());
                    }
                }
            }
        }
        deps
    }

    pub fn unmatched(&self) -> &HashSet<playarr_model::ExternalRef> {
        &self.unmatched
    }
}

/// Why a lookup did not answer from the cache.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Miss {
    /// Nothing stored under the key.
    Cold,
    /// Older than [`RESPONSE_TTL`].
    Expired,
    /// A source refresh stored changed data.
    Source,
    /// A live change touched something the response depends on.
    Change,
    /// More changes happened since than the log remembers.
    Overflow,
}

pub enum Lookup {
    Hit(Arc<playarr_model::CalendarResponse>),
    /// Fresh unless one of `candidates` (works changed since the entry was
    /// built, not among its own) now carries one of `deps.unmatched()`.
    /// Confirm with [`CalendarCache::confirm`] at `tick`.
    Check {
        response: Arc<playarr_model::CalendarResponse>,
        candidates: Vec<Uuid>,
        deps: ResponseDeps,
        tick: u64,
    },
    Miss(Miss),
}

struct FlightGuard<'a> {
    flights: &'a Mutex<HashMap<String, Flight>>,
    key: &'a str,
    cell: &'a Arc<tokio::sync::OnceCell<Arc<playarr_model::CalendarResponse>>>,
}

impl Drop for FlightGuard<'_> {
    fn drop(&mut self) {
        let mut flights = self.flights.lock().unwrap_or_else(|e| e.into_inner());
        if flights
            .get(self.key)
            .is_some_and(|f| Arc::ptr_eq(&f.cell, self.cell))
        {
            flights.remove(self.key);
        }
    }
}

#[derive(Default)]
struct CacheCounters {
    hits: std::sync::atomic::AtomicU64,
    shared: std::sync::atomic::AtomicU64,
    cold: std::sync::atomic::AtomicU64,
    expired: std::sync::atomic::AtomicU64,
    source: std::sync::atomic::AtomicU64,
    change: std::sync::atomic::AtomicU64,
    overflow: std::sync::atomic::AtomicU64,
}

/// Cumulative response-cache outcomes since the process started.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CacheStats {
    pub hits: u64,
    /// Requests that joined a build already in progress.
    pub shared: u64,
    pub cold: u64,
    pub expired: u64,
    pub source: u64,
    pub change: u64,
    pub overflow: u64,
}

impl CacheStats {
    pub fn misses(&self) -> u64 {
        self.cold + self.expired + self.source + self.change + self.overflow
    }
}

/// How long a built response may be served without a rebuild. Live events and
/// source refreshes invalidate sooner; this bounds changes that raise neither.
const RESPONSE_TTL: Duration = Duration::from_secs(120);
const RESPONSE_CAP: usize = 256;

struct CachedResponse {
    built: std::time::Instant,
    source_generation: u64,
    /// Live changes before this tick are already reflected in `response`.
    tick: u64,
    deps: ResponseDeps,
    response: std::sync::Arc<playarr_model::CalendarResponse>,
}

/// Whether one live change touches a response built for `viewer`.
enum Effect {
    Stale,
    Untouched,
    /// Stale only if this work now carries an id the response lacks a work for.
    MaybeNewWork(Uuid),
}

fn effect_of(change: &playarr_db::LiveChange, viewer: Uuid, deps: &ResponseDeps) -> Effect {
    use playarr_db::live_event_kind as kind;
    // Another user's own state never changes this viewer's answer.
    if change.user_id.is_some_and(|u| u != viewer) {
        return Effect::Untouched;
    }
    let work = change
        .entity_id
        .as_deref()
        .filter(|_| change.entity == "work")
        .and_then(|id| Uuid::parse_str(id).ok());
    match change.kind {
        // Position ticks and watched marks matter for a title in the response only.
        kind::WATCH => match work {
            Some(id) if deps.works.contains(&id) => Effect::Stale,
            Some(_) => Effect::Untouched,
            None => Effect::Stale,
        },
        kind::WATCHLIST | kind::HOUSEHOLD | kind::ACCOUNT => Effect::Stale,
        kind::LIBRARY | kind::CALENDAR => match work {
            Some(id) if deps.works.contains(&id) => Effect::Stale,
            Some(id)
                if !deps.unmatched.is_empty()
                    && change
                        .changed
                        .iter()
                        .any(|c| matches!(*c, "upserted" | "files" | "imported")) =>
            {
                Effect::MaybeNewWork(id)
            }
            Some(_) => Effect::Untouched,
            None => Effect::Stale,
        },
        kind::PLAYLIST | kind::DOWNLOAD | kind::ADMIN => Effect::Untouched,
        _ => Effect::Stale,
    }
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
            generation: std::sync::atomic::AtomicU64::new(0),
            responses: Mutex::new(HashMap::new()),
            flights: Mutex::new(HashMap::new()),
            stats: CacheCounters::default(),
            feed: ChangeFeed::default(),
            lags: Mutex::new(LagCache::default()),
        }
    }

    /// A built response for `key` unless something it depends on has changed:
    /// a source refresh that stored different data, a live change to one of
    /// its works or to the viewer's own watch state, watchlist, household or
    /// account, or the TTL. The key must name the viewer.
    pub fn lookup(&self, key: &str, viewer: Uuid) -> Lookup {
        use std::sync::atomic::Ordering::Relaxed;
        let mut map = self.responses.lock().unwrap_or_else(|e| e.into_inner());
        let Some(entry) = map.get_mut(key) else {
            self.stats.cold.fetch_add(1, Relaxed);
            return Lookup::Miss(Miss::Cold);
        };
        let miss = |counter: &std::sync::atomic::AtomicU64, why| {
            counter.fetch_add(1, Relaxed);
            Lookup::Miss(why)
        };
        if entry.built.elapsed() >= RESPONSE_TTL {
            return miss(&self.stats.expired, Miss::Expired);
        }
        if entry.source_generation != self.generation.load(std::sync::atomic::Ordering::Acquire) {
            return miss(&self.stats.source, Miss::Source);
        }
        let Some(changes) = (self.feed.since)(entry.tick) else {
            return miss(&self.stats.overflow, Miss::Overflow);
        };
        let mut candidates = Vec::new();
        for change in &changes {
            match effect_of(change, viewer, &entry.deps) {
                Effect::Stale => return miss(&self.stats.change, Miss::Change),
                Effect::Untouched => {}
                Effect::MaybeNewWork(id) => candidates.push(id),
            }
        }
        let tick = changes.last().map_or(entry.tick, |c| c.tick + 1);
        if candidates.is_empty() {
            entry.tick = tick;
            self.stats.hits.fetch_add(1, Relaxed);
            return Lookup::Hit(entry.response.clone());
        }
        candidates.sort();
        candidates.dedup();
        Lookup::Check {
            response: entry.response.clone(),
            candidates,
            deps: entry.deps.clone(),
            tick,
        }
    }

    /// Settles a [`Lookup::Check`]: the candidates did not touch the response
    /// (`fresh`) or they did.
    ///
    /// `checked` is the response the lookup returned: only that very entry is
    /// advanced or removed. If another build replaced it while the candidates
    /// were being read, the newer entry is left alone and, for a fresh
    /// verdict, the caller still serves the checked response, which was
    /// current when it was looked up.
    pub fn confirm(
        &self,
        key: &str,
        checked: &Arc<playarr_model::CalendarResponse>,
        tick: u64,
        fresh: bool,
    ) -> bool {
        use std::sync::atomic::Ordering::Relaxed;
        let mut map = self.responses.lock().unwrap_or_else(|e| e.into_inner());
        let same = map
            .get(key)
            .is_some_and(|entry| Arc::ptr_eq(&entry.response, checked));
        if fresh {
            if same {
                if let Some(entry) = map.get_mut(key) {
                    entry.tick = entry.tick.max(tick);
                }
            }
            self.stats.hits.fetch_add(1, Relaxed);
        } else {
            if same {
                map.remove(key);
            }
            self.stats.change.fetch_add(1, Relaxed);
        }
        fresh
    }

    /// Stores a response built when the counters read `source_generation` and
    /// `tick` (read them before building, so a change during the build leaves
    /// the entry stale rather than wrongly fresh).
    pub fn store_response(
        &self,
        key: String,
        source_generation: u64,
        tick: u64,
        response: std::sync::Arc<playarr_model::CalendarResponse>,
    ) {
        let deps = ResponseDeps::of(&response);
        let mut map = self.responses.lock().unwrap_or_else(|e| e.into_inner());
        // A build that started earlier must not replace one that saw more.
        if map
            .get(&key)
            .is_some_and(|old| old.source_generation == source_generation && old.tick > tick)
        {
            return;
        }
        if map.len() >= RESPONSE_CAP && !map.contains_key(&key) {
            map.retain(|_, v| v.built.elapsed() < RESPONSE_TTL);
            if map.len() >= RESPONSE_CAP {
                if let Some(oldest) = map
                    .iter()
                    .min_by_key(|(_, v)| v.built)
                    .map(|(k, _)| k.clone())
                {
                    map.remove(&oldest);
                }
            }
        }
        map.insert(
            key,
            CachedResponse {
                built: std::time::Instant::now(),
                source_generation,
                tick,
                deps,
                response,
            },
        );
    }

    /// Builds the response for `key` once however many requests ask at the
    /// same time: a request arriving while an identical build runs (and
    /// nothing has changed since it started) waits for that build instead of
    /// starting another. `build` is given the counters read at the start.
    /// Returns the response and whether this call joined an earlier build.
    pub async fn build_once<F, Fut>(
        &self,
        key: &str,
        build: F,
    ) -> (Arc<playarr_model::CalendarResponse>, bool)
    where
        F: FnOnce(u64, u64) -> Fut,
        Fut: std::future::Future<Output = Arc<playarr_model::CalendarResponse>>,
    {
        let source_generation = self.source_generation();
        let tick = (self.feed.tick)();
        let (flight, joined) = {
            let mut flights = self.flights.lock().unwrap_or_else(|e| e.into_inner());
            match flights.get(key) {
                Some(f) if f.source_generation == source_generation && f.tick == tick => {
                    (f.clone(), true)
                }
                _ => {
                    let f = Flight {
                        source_generation,
                        tick,
                        cell: Arc::new(tokio::sync::OnceCell::new()),
                    };
                    flights.insert(key.to_string(), f.clone());
                    (f, false)
                }
            }
        };
        if joined {
            self.stats
                .shared
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
        // Removes the flight when this call ends, including when the request is
        // cancelled mid-build, so no entry outlives its leader.
        let _guard = FlightGuard {
            flights: &self.flights,
            key,
            cell: &flight.cell,
        };
        let response = flight
            .cell
            .get_or_init(|| build(source_generation, tick))
            .await
            .clone();
        (response, joined)
    }

    /// Cached lags of `keys` valid at event `generation`, and the keys not cached.
    #[allow(clippy::type_complexity)]
    pub fn cached_lags(
        &self,
        keys: &[(String, String)],
        generation: u64,
    ) -> (
        HashMap<(String, String), Option<i64>>,
        Vec<(String, String)>,
    ) {
        let cache = self.lags.lock().unwrap_or_else(|e| e.into_inner());
        let mut found = HashMap::new();
        let mut missing = Vec::new();
        for key in keys {
            match cache
                .by_ref
                .get(key)
                .filter(|_| cache.generation == generation)
            {
                Some(lag) => {
                    found.insert(key.clone(), *lag);
                }
                None => missing.push(key.clone()),
            }
        }
        (found, missing)
    }

    /// Stores lags computed from the events as of `generation` (read before
    /// the events were).
    pub fn store_lags(
        &self,
        generation: u64,
        lags: impl IntoIterator<Item = ((String, String), Option<i64>)>,
    ) {
        let mut cache = self.lags.lock().unwrap_or_else(|e| e.into_inner());
        if generation < cache.generation {
            return;
        }
        if generation > cache.generation || cache.by_ref.len() >= LAG_CAP {
            cache.by_ref.clear();
            cache.generation = generation;
        }
        cache.by_ref.extend(lags);
    }

    /// The tick to record on an entry built now.
    pub fn change_tick(&self) -> u64 {
        (self.feed.tick)()
    }

    pub fn stats(&self) -> CacheStats {
        use std::sync::atomic::Ordering::Relaxed;
        let c = &self.stats;
        CacheStats {
            hits: c.hits.load(Relaxed),
            shared: c.shared.load(Relaxed),
            cold: c.cold.load(Relaxed),
            expired: c.expired.load(Relaxed),
            source: c.source.load(Relaxed),
            change: c.change.load(Relaxed),
            overflow: c.overflow.load(Relaxed),
        }
    }

    pub fn source_generation(&self) -> u64 {
        self.generation.load(std::sync::atomic::Ordering::Acquire)
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

    /// Stores one month of an instance's entries as a refresh would. Test and
    /// benchmark fixtures use it instead of a mock source.
    #[cfg(test)]
    pub(crate) fn seed_chunk(
        &self,
        instance: Uuid,
        month: String,
        entries: Vec<CalendarCandidate>,
    ) {
        self.lock().chunks.insert((instance, month), entries);
        self.generation
            .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
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
            // A refresh that brings the same entries changes nothing: keep the
            // stored chunk and every response built from it.
            let unchanged = self
                .lock()
                .chunks
                .get(&(instance.id, month.clone()))
                .is_some_and(|old| *old == entries);
            if unchanged {
                continue;
            }
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
            self.generation
                .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
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

    fn response_with(
        work: Option<Uuid>,
        unmatched_ref: Option<&str>,
    ) -> Arc<playarr_model::CalendarResponse> {
        let day = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        let entry = |work_id: Option<Uuid>, external_id: &str| {
            let mut entry: playarr_model::CalendarEntry = serde_json::from_value(json!({
                "id": external_id, "media_kind": "episode", "release_type": "air",
                "title": "Show", "date": "2026-10-01", "monitored": true,
                "has_file": false, "sources": []
            }))
            .unwrap();
            entry.work_id = work_id;
            if work_id.is_none() {
                entry.snapshot = Some(playarr_model::discovery::TitleSnapshot {
                    kind: playarr_model::discovery::DiscoveryKind::Series,
                    title: "Show".into(),
                    year: None,
                    work_id: None,
                    external_refs: vec![playarr_model::ExternalRef {
                        provider: playarr_model::ExternalProvider::Tvdb,
                        external_id: external_id.to_string(),
                    }],
                    poster_url: None,
                });
            }
            entry
        };
        let mut entries = Vec::new();
        if let Some(work) = work {
            entries.push(entry(Some(work), "known"));
        }
        if let Some(id) = unmatched_ref {
            entries.push(entry(None, id));
        }
        Arc::new(playarr_model::CalendarResponse {
            start: day,
            end: day,
            entries,
            sources: vec![],
        })
    }

    /// A scripted change log standing in for the process-wide one.
    #[derive(Clone, Default)]
    struct Feed(Arc<Mutex<Vec<playarr_db::LiveChange>>>);

    impl Feed {
        fn cache(&self) -> CalendarCache {
            let (since, tick) = (self.0.clone(), self.0.clone());
            let mut cache = CalendarCache::new();
            cache.feed = ChangeFeed {
                since: Box::new(move |t| {
                    Some(
                        since
                            .lock()
                            .unwrap()
                            .iter()
                            .filter(|c| c.tick >= t)
                            .cloned()
                            .collect(),
                    )
                }),
                tick: Box::new(move || tick.lock().unwrap().len() as u64),
            };
            cache
        }

        fn push(
            &self,
            user: Option<Uuid>,
            kind: &'static str,
            entity: &'static str,
            id: Uuid,
            changed: &'static str,
        ) {
            let mut log = self.0.lock().unwrap();
            let tick = log.len() as u64;
            log.push(playarr_db::LiveChange {
                tick,
                user_id: user,
                kind,
                entity,
                entity_id: Some(id.to_string()),
                changed: vec![changed],
            });
        }
    }

    fn put(cache: &CalendarCache, key: &str, response: Arc<playarr_model::CalendarResponse>) {
        cache.store_response(
            key.into(),
            cache.source_generation(),
            cache.change_tick(),
            response,
        );
    }

    fn is_hit(cache: &CalendarCache, key: &str, user: Uuid) -> bool {
        matches!(cache.lookup(key, user), Lookup::Hit(_))
    }

    #[test]
    fn a_response_survives_changes_it_does_not_depend_on() {
        use playarr_db::live_event_kind as kind;
        let feed = Feed::default();
        let cache = feed.cache();
        let (me, other) = (Uuid::new_v4(), Uuid::new_v4());
        let (mine, unrelated) = (Uuid::new_v4(), Uuid::new_v4());
        assert!(matches!(cache.lookup("k", me), Lookup::Miss(Miss::Cold)));
        put(&cache, "k", response_with(Some(mine), None));
        assert!(is_hit(&cache, "k", me));

        // Another user's progress, a work the response lacks, a playlist and
        // an admin change all leave it alone.
        let quiet: [(Option<Uuid>, &'static str, &'static str, Uuid, &'static str); 6] = [
            (Some(other), kind::WATCH, "work", mine, "progress"),
            (Some(me), kind::WATCH, "work", unrelated, "progress"),
            (None, kind::LIBRARY, "work", unrelated, "upserted"),
            (None, kind::CALENDAR, "work", unrelated, "imported"),
            (Some(me), kind::PLAYLIST, "playlist", unrelated, "items"),
            (None, kind::ADMIN, "source", unrelated, "status"),
        ];
        for (user, k, entity, id, changed) in quiet {
            feed.push(user, k, entity, id, changed);
            assert!(is_hit(&cache, "k", me), "{k} {changed} left alone");
        }

        // The viewer's own progress on a work in it, a file landing for such a
        // work, and the viewer's watchlist each make it stale.
        let stale: [(Option<Uuid>, &'static str, &'static str, Uuid, &'static str); 3] = [
            (Some(me), kind::WATCH, "work", mine, "progress"),
            (None, kind::LIBRARY, "work", mine, "files"),
            (Some(me), kind::WATCHLIST, "work", unrelated, "added"),
        ];
        for (user, k, entity, id, changed) in stale {
            put(&cache, "k", response_with(Some(mine), None));
            assert!(is_hit(&cache, "k", me));
            feed.push(user, k, entity, id, changed);
            assert!(
                matches!(cache.lookup("k", me), Lookup::Miss(Miss::Change)),
                "{k} {changed}"
            );
        }
    }

    #[test]
    fn a_new_work_only_matters_when_it_carries_an_id_the_response_lacks_a_work_for() {
        use playarr_db::live_event_kind as kind;
        let feed = Feed::default();
        let cache = feed.cache();
        let me = Uuid::new_v4();
        let appeared = Uuid::new_v4();
        put(&cache, "k", response_with(None, Some("424242")));
        feed.push(None, kind::LIBRARY, "work", appeared, "upserted");
        let Lookup::Check {
            response,
            candidates,
            deps,
            tick,
        } = cache.lookup("k", me)
        else {
            panic!("an unknown work may be the missing one");
        };
        assert_eq!(candidates, vec![appeared]);
        assert!(deps.unmatched().iter().any(|r| r.external_id == "424242"));
        // Settled as unrelated, the entry keeps serving and does not ask again.
        assert!(cache.confirm("k", &response, tick, true));
        assert!(is_hit(&cache, "k", me));
        // Settled as the missing work, it is gone.
        feed.push(None, kind::LIBRARY, "work", appeared, "upserted");
        let Lookup::Check { response, tick, .. } = cache.lookup("k", me) else {
            panic!("checked again");
        };
        assert!(!cache.confirm("k", &response, tick, false));
        assert!(matches!(cache.lookup("k", me), Lookup::Miss(Miss::Cold)));
        // A response with a work for everything never asks.
        put(&cache, "k", response_with(Some(Uuid::new_v4()), None));
        feed.push(None, kind::LIBRARY, "work", appeared, "upserted");
        assert!(is_hit(&cache, "k", me));
    }

    /// Ten minutes of ordinary traffic against one open calendar: a request
    /// every 5 s, another user's progress every 3 s, the viewer's own progress
    /// on an unrelated title every 10 s, a library sync touching other works
    /// every 20 s and one import for a title in the calendar every 150 s. The
    /// old rule (any event for the viewer or the library makes it stale) is
    /// counted alongside.
    #[test]
    fn hit_rate_under_ordinary_traffic() {
        use playarr_db::live_event_kind as kind;
        let feed = Feed::default();
        let cache = feed.cache();
        let (me, other, mine) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        put(&cache, "k", response_with(Some(mine), None));
        let (mut hits, mut old_hits, mut requests) = (0u32, 0u32, 0u32);
        let mut events_since_build_old = false;
        for second in 1..=600u32 {
            if second % 3 == 0 {
                feed.push(Some(other), kind::WATCH, "work", Uuid::new_v4(), "progress");
                // The old counters moved for any event, whoever it was for.
                events_since_build_old = true;
            }
            if second % 10 == 0 {
                feed.push(Some(me), kind::WATCH, "work", Uuid::new_v4(), "progress");
                events_since_build_old = true;
            }
            if second % 20 == 0 {
                feed.push(None, kind::LIBRARY, "work", Uuid::new_v4(), "upserted");
                events_since_build_old = true;
            }
            if second % 150 == 0 {
                feed.push(None, kind::CALENDAR, "work", mine, "imported");
                events_since_build_old = true;
            }
            if second % 5 == 0 {
                requests += 1;
                if !events_since_build_old {
                    old_hits += 1;
                }
                if is_hit(&cache, "k", me) {
                    hits += 1;
                } else {
                    put(&cache, "k", response_with(Some(mine), None));
                }
                events_since_build_old = false;
            }
            // The 120 s TTL, which this loop cannot wait for.
            if second % 120 == 0 {
                put(&cache, "k", response_with(Some(mine), None));
                events_since_build_old = false;
            }
        }
        eprintln!("hit rate over {requests} requests: now {hits}, before {old_hits}");
        assert_eq!(old_hits, 0, "every window had an event");
        assert!(hits * 100 >= requests * 95, "{hits}/{requests}");
    }

    /// An older build that finishes late must not make a newer entry look
    /// fresher than it is, and a verdict about one entry must not touch another.
    #[test]
    fn a_late_older_build_and_a_stale_verdict_cannot_mark_an_entry_fresh() {
        use playarr_db::live_event_kind as kind;
        let feed = Feed::default();
        let cache = feed.cache();
        let (me, mine, appeared) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        let unmatched = || response_with(Some(mine), Some("424242"));

        // R1 is built at tick 0; a change it depends on lands (tick 0); R2 is
        // built after it (tick 1).
        let old_tick = cache.change_tick();
        let old = unmatched();
        feed.push(Some(me), kind::WATCH, "work", mine, "progress");
        let newer = unmatched();
        put(&cache, "k", newer.clone());
        feed.push(None, kind::LIBRARY, "work", appeared, "upserted");
        let Lookup::Check { response, tick, .. } = cache.lookup("k", me) else {
            panic!("an unknown work may be the missing one");
        };
        assert!(Arc::ptr_eq(&response, &newer));

        // The old build finishes now: it must not replace the newer entry.
        cache.store_response("k".into(), cache.source_generation(), old_tick, old.clone());
        assert!(cache.confirm("k", &response, tick, true));
        assert!(
            is_hit(&cache, "k", me),
            "the newer entry survived and advanced"
        );

        // A verdict about a response that is no longer the entry (another
        // build replaced it while the candidates were read) changes nothing.
        let replacement = unmatched();
        put(&cache, "k", replacement.clone());
        assert!(!cache.confirm("k", &newer, tick, false));
        assert!(is_hit(&cache, "k", me), "the replacement was not removed");
        // And it must not skip a change the replacement has not seen.
        feed.push(Some(me), kind::WATCH, "work", mine, "progress");
        assert!(cache.confirm("k", &newer, tick + 100, true));
        assert!(matches!(cache.lookup("k", me), Lookup::Miss(Miss::Change)));
    }

    #[tokio::test]
    async fn a_cancelled_build_leaves_no_flight_behind() {
        let cache = Arc::new(CalendarCache::new());
        let cancelled = tokio::time::timeout(
            Duration::from_millis(20),
            cache.build_once("k", |_, _| async {
                std::future::pending::<()>().await;
                response_with(None, None)
            }),
        )
        .await;
        assert!(cancelled.is_err(), "the build was cancelled");
        assert!(cache.flights.lock().unwrap().is_empty());
        // The next request builds normally.
        let (_, joined) = cache
            .build_once("k", |_, _| async { response_with(None, None) })
            .await;
        assert!(!joined);
        assert!(cache.flights.lock().unwrap().is_empty());
    }

    #[test]
    fn a_source_refresh_that_stores_data_makes_responses_stale() {
        let cache = Feed::default().cache();
        let me = Uuid::new_v4();
        put(&cache, "k", response_with(None, None));
        assert!(is_hit(&cache, "k", me));
        cache
            .generation
            .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
        assert!(matches!(cache.lookup("k", me), Lookup::Miss(Miss::Source)));
    }

    #[tokio::test]
    async fn identical_concurrent_builds_run_once() {
        let cache = Arc::new(CalendarCache::new());
        let builds = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let run = |cache: Arc<CalendarCache>, builds: Arc<std::sync::atomic::AtomicUsize>| async move {
            cache
                .build_once("k", |_, _| async move {
                    builds.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    response_with(None, None)
                })
                .await
        };
        let (a, b, c) = tokio::join!(
            run(cache.clone(), builds.clone()),
            run(cache.clone(), builds.clone()),
            run(cache.clone(), builds.clone())
        );
        assert_eq!(builds.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert_eq!([a.1, b.1, c.1].iter().filter(|joined| **joined).count(), 2);
        assert_eq!(cache.stats().shared, 2);
    }

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
