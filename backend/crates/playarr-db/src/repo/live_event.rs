//! Durable, bounded change log behind the per-user live event stream
//! (`GET /api/v1/events`, `docs/architecture/live-events.md`).
//!
//! Rows are minimal pointers (entity type + id + which facets changed), never
//! entity bodies, so a row never leaks data a recipient may not see: the stream
//! handler decides who may receive a row, and clients refetch through the
//! normal authorised read APIs.
//!
//! Fan-out is database-first. [`LiveEventPublisher::publish`] inserts a row and
//! wakes in-process streams; every stream re-reads `seq > cursor` from the
//! table. That makes the same code correct for a single process, for the
//! API and worker roles running as separate processes sharing one SQLite
//! file. A wake only cuts latency; streams also poll on a timer.
//! Separate servers with separate databases (for example two regional servers) never share events.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{decode_err, parse_uuid};
use crate::error::DbError;
use crate::pool::DbPool;
use crate::write_queue::{write, WriteQueue};

/// Event kinds (the `type` field of a stream frame).
pub mod kind {
    /// Resume position or watched state of one media file changed.
    pub const WATCH: &str = "watch";
    /// A catalogue work was added, changed, removed or gained files.
    pub const LIBRARY: &str = "library";
    /// A playlist or its items changed.
    pub const PLAYLIST: &str = "playlist";
    /// The watchlist changed.
    pub const WATCHLIST: &str = "watchlist";
    /// A calendar entry may have changed state (imported, released, removed).
    pub const CALENDAR: &str = "calendar";
    /// A download ticket changed state.
    pub const DOWNLOAD: &str = "download";
    /// Household policy, approvals or schedule status changed.
    pub const HOUSEHOLD: &str = "household";
    /// The account, its policy or its library access changed.
    pub const ACCOUNT: &str = "account";
    /// Admin-only operational change (sources, sync status).
    pub const ADMIN: &str = "admin";
}

/// How long a row is replayable through `Last-Event-ID`.
pub const RETENTION_MS: i64 = 10 * 60 * 1000;
/// Hard cap on retained rows; the oldest are dropped first.
pub const MAX_ROWS: i64 = 50_000;

/// A change to publish. `user_id: None` means "every user whose library access
/// covers `source_instance_id`" (or, for `admin` events, every admin).
#[derive(Debug, Clone, PartialEq)]
pub struct NewLiveEvent {
    pub user_id: Option<Uuid>,
    pub kind: &'static str,
    pub entity: &'static str,
    pub entity_id: Option<String>,
    pub changed: Vec<&'static str>,
    pub source_instance_id: Option<Uuid>,
}

impl NewLiveEvent {
    /// An event for exactly one user (their own state on other devices).
    pub fn for_user(
        user_id: Uuid,
        kind: &'static str,
        entity: &'static str,
        entity_id: impl ToString,
        changed: &[&'static str],
    ) -> Self {
        Self {
            user_id: Some(user_id),
            kind,
            entity,
            entity_id: Some(entity_id.to_string()),
            changed: changed.to_vec(),
            source_instance_id: None,
        }
    }

    /// An event for every user allowed to see `source_instance_id`.
    pub fn for_library(
        kind: &'static str,
        entity: &'static str,
        entity_id: impl ToString,
        changed: &[&'static str],
        source_instance_id: Option<Uuid>,
    ) -> Self {
        Self {
            user_id: None,
            kind,
            entity,
            entity_id: Some(entity_id.to_string()),
            changed: changed.to_vec(),
            source_instance_id,
        }
    }
}

/// A stored event.
#[derive(Debug, Clone, PartialEq)]
pub struct LiveEvent {
    pub seq: i64,
    pub user_id: Option<Uuid>,
    pub kind: String,
    pub entity: String,
    pub entity_id: Option<String>,
    pub changed: Vec<String>,
    pub source_instance_id: Option<Uuid>,
    pub created_ms: i64,
}

#[async_trait]
pub trait LiveEventRepo: Send + Sync {
    async fn insert(&self, event: &NewLiveEvent, now_ms: i64) -> Result<(), DbError>;
    /// Inserts several events; the SQL repo does it in one transaction (one
    /// commit sync). The default inserts one by one.
    async fn insert_many(&self, events: &[NewLiveEvent], now_ms: i64) -> Result<(), DbError> {
        for event in events {
            self.insert(event, now_ms).await?;
        }
        Ok(())
    }
    /// Rows with `seq > after`, oldest first.
    async fn list_after(&self, after: i64, limit: i64) -> Result<Vec<LiveEvent>, DbError>;
    /// `(min seq, max seq)` of retained rows.
    async fn bounds(&self) -> Result<(Option<i64>, Option<i64>), DbError>;
    /// Deletes rows older than the retention window and any beyond the cap.
    async fn purge(&self, now_ms: i64) -> Result<u64, DbError>;
}

pub struct SqlxLiveEventRepo {
    pool: DbPool,
    queue: Option<WriteQueue>,
}

impl SqlxLiveEventRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool, queue: None }
    }

    /// Stores events through the shared write queue so they share a commit
    /// with other small writes.
    pub fn with_write_queue(mut self, queue: WriteQueue) -> Self {
        self.queue = Some(queue);
        self
    }
}

const INSERT_SQL: &str = "INSERT INTO live_events (user_id, kind, entity, entity_id, changed, \
     source_instance_id, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?)";

/// Owned bind values for one event, so the write can run again.
struct EventRow {
    user_id: Option<String>,
    kind: &'static str,
    entity: &'static str,
    entity_id: Option<String>,
    changed: String,
    source_instance_id: Option<String>,
}

impl EventRow {
    fn new(e: &NewLiveEvent) -> Result<Self, DbError> {
        Ok(Self {
            user_id: e.user_id.map(|u| u.to_string()),
            kind: e.kind,
            entity: e.entity,
            entity_id: e.entity_id.clone(),
            changed: serde_json::to_string(&e.changed)?,
            source_instance_id: e.source_instance_id.map(|u| u.to_string()),
        })
    }
}

async fn insert_row(
    conn: &mut sqlx::AnyConnection,
    row: &EventRow,
    now_ms: i64,
) -> Result<(), DbError> {
    sqlx::query(INSERT_SQL)
        .bind(row.user_id.clone())
        .bind(row.kind)
        .bind(row.entity)
        .bind(row.entity_id.clone())
        .bind(row.changed.clone())
        .bind(row.source_instance_id.clone())
        .bind(now_ms)
        .execute(conn)
        .await?;
    Ok(())
}

fn from_row(row: &AnyRow) -> Result<LiveEvent, DbError> {
    let opt = |s: Option<String>| s.map(|s| parse_uuid(&s)).transpose();
    let changed: String = row.try_get("changed")?;
    Ok(LiveEvent {
        seq: row.try_get("seq")?,
        user_id: opt(row.try_get("user_id")?)?,
        kind: row.try_get("kind")?,
        entity: row.try_get("entity")?,
        entity_id: row.try_get("entity_id")?,
        changed: serde_json::from_str(&changed).map_err(|e| decode_err(e.to_string()))?,
        source_instance_id: opt(row.try_get("source_instance_id")?)?,
        created_ms: row.try_get("created_ms")?,
    })
}

#[async_trait]
impl LiveEventRepo for SqlxLiveEventRepo {
    async fn insert(&self, e: &NewLiveEvent, now_ms: i64) -> Result<(), DbError> {
        let row = Arc::new(EventRow::new(e)?);
        write(self.queue.as_ref(), &self.pool, move |conn| {
            let row = row.clone();
            Box::pin(async move { insert_row(conn, &row, now_ms).await })
        })
        .await
    }

    async fn insert_many(&self, events: &[NewLiveEvent], now_ms: i64) -> Result<(), DbError> {
        if events.is_empty() {
            return Ok(());
        }
        let rows = Arc::new(
            events
                .iter()
                .map(EventRow::new)
                .collect::<Result<Vec<_>, _>>()?,
        );
        write(self.queue.as_ref(), &self.pool, move |conn| {
            let rows = rows.clone();
            Box::pin(async move {
                for row in rows.iter() {
                    insert_row(conn, row, now_ms).await?;
                }
                Ok(())
            })
        })
        .await
    }

    async fn list_after(&self, after: i64, limit: i64) -> Result<Vec<LiveEvent>, DbError> {
        let rows = sqlx::query(
            "SELECT seq, user_id, kind, entity, entity_id, changed, source_instance_id, \
             created_ms FROM live_events WHERE seq > ? ORDER BY seq LIMIT ?",
        )
        .bind(after)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(from_row).collect()
    }

    async fn bounds(&self) -> Result<(Option<i64>, Option<i64>), DbError> {
        let row = sqlx::query("SELECT MIN(seq) AS lo, MAX(seq) AS hi FROM live_events")
            .fetch_one(&self.pool)
            .await?;
        Ok((row.try_get("lo")?, row.try_get("hi")?))
    }

    async fn purge(&self, now_ms: i64) -> Result<u64, DbError> {
        // The newest row is never purged: it is the watermark that lets a
        // reconnecting client prove it is not behind (see the stream handler).
        let aged = sqlx::query(
            "DELETE FROM live_events WHERE created_ms < ? \
             AND seq < (SELECT MAX(seq) FROM live_events)",
        )
        .bind(now_ms - RETENTION_MS)
        .execute(&self.pool)
        .await?
        .rows_affected();
        let over_cap = sqlx::query(
            "DELETE FROM live_events WHERE seq <= \
             (SELECT MAX(seq) FROM live_events) - ?",
        )
        .bind(MAX_ROWS)
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(aged + over_cap)
    }
}

/// Process-wide wake counter for stream loops. The database stays the source of
/// truth; this only makes a stream notice a local write immediately instead of
/// at its next timer tick.
static WAKE: LazyLock<tokio::sync::watch::Sender<u64>> =
    LazyLock::new(|| tokio::sync::watch::channel(0).0);

/// Subscribes to "a live event was published in this process".
pub fn subscribe_wake() -> tokio::sync::watch::Receiver<u64> {
    WAKE.subscribe()
}

/// Change counters for caches that derive per-viewer answers from state the
/// live events describe. Every published event bumps the library-wide counter
/// (no user) or the counter of the one user it is for. A cache entry built at
/// counters `(global, user)` is stale once either has moved.
static GLOBAL_GENERATION: AtomicU64 = AtomicU64::new(0);
static USER_GENERATIONS: LazyLock<Mutex<HashMap<Uuid, u64>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// The `(library-wide, this user's)` change counters.
pub fn change_generation(user_id: Uuid) -> (u64, u64) {
    let user = USER_GENERATIONS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&user_id)
        .copied()
        .unwrap_or(0);
    (GLOBAL_GENERATION.load(Ordering::Acquire), user)
}

/// One published change as the in-process caches see it: which kind of thing
/// changed, for whom, and which entity. A cache entry built at tick `t` asks
/// [`changes_since`]`(t)` and decides for itself which of them touch it, so a
/// change it does not depend on leaves it alone.
#[derive(Debug, Clone, PartialEq)]
pub struct ChangeRecord {
    pub tick: u64,
    /// `None`: a library-wide change.
    pub user_id: Option<Uuid>,
    pub kind: &'static str,
    /// What kind of entity changed (`"work"`, `"playlist"`, ...).
    pub entity: &'static str,
    pub entity_id: Option<String>,
    pub changed: Vec<&'static str>,
}

/// Records kept for [`changes_since`]; a cache entry older than this many
/// changes is treated as stale.
const CHANGE_LOG_CAP: usize = 4096;

#[derive(Default)]
struct ChangeLog {
    next: u64,
    records: std::collections::VecDeque<ChangeRecord>,
}

static CHANGE_LOG: LazyLock<Mutex<ChangeLog>> = LazyLock::new(Mutex::default);

/// The tick after the latest recorded change. Read it before building a cache
/// entry, so a change during the build leaves the entry stale rather than
/// wrongly fresh.
pub fn change_tick() -> u64 {
    CHANGE_LOG.lock().unwrap_or_else(|e| e.into_inner()).next
}

/// Every change recorded at or after `tick`, oldest first. `None` when some of
/// them have already been dropped: the caller cannot tell what it missed.
pub fn changes_since(tick: u64) -> Option<Vec<ChangeRecord>> {
    let log = CHANGE_LOG.lock().unwrap_or_else(|e| e.into_inner());
    if tick >= log.next {
        return Some(Vec::new());
    }
    let first = log.records.front().map_or(log.next, |r| r.tick);
    if tick < first {
        return None;
    }
    Some(
        log.records
            .iter()
            .filter(|r| r.tick >= tick)
            .cloned()
            .collect(),
    )
}

fn record_change(event: &NewLiveEvent) {
    let mut log = CHANGE_LOG.lock().unwrap_or_else(|e| e.into_inner());
    let tick = log.next;
    log.next += 1;
    if log.records.len() >= CHANGE_LOG_CAP {
        log.records.pop_front();
    }
    log.records.push_back(ChangeRecord {
        tick,
        user_id: event.user_id,
        kind: event.kind,
        entity: event.entity,
        entity_id: event.entity_id.clone(),
        changed: event.changed.clone(),
    });
}

fn bump_generation(event: &NewLiveEvent) {
    record_change(event);
    let user_id = event.user_id;
    match user_id {
        None => {
            GLOBAL_GENERATION.fetch_add(1, Ordering::AcqRel);
        }
        Some(user) => {
            let mut map = USER_GENERATIONS.lock().unwrap_or_else(|e| e.into_inner());
            *map.entry(user).or_insert(0) += 1;
        }
    }
}

fn wake() {
    WAKE.send_modify(|v| *v = v.wrapping_add(1));
}

/// `(user, media file)` -> (last publish time, last watched state).
type ProgressThrottle = HashMap<(Uuid, Uuid), (Instant, bool)>;

/// Writes events and wakes streams. Cheap to clone. Failures are logged and
/// swallowed: a lost live event must never fail the write that caused it, and
/// clients also refetch on reconnect and on their fallback poll.
#[derive(Clone)]
pub struct LiveEventPublisher {
    repo: Arc<dyn LiveEventRepo>,
    published: Arc<AtomicU64>,
    throttle: Arc<Mutex<ProgressThrottle>>,
}

impl LiveEventPublisher {
    pub fn new(repo: Arc<dyn LiveEventRepo>) -> Self {
        Self {
            repo,
            published: Arc::new(AtomicU64::new(0)),
            throttle: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn from_pool(pool: DbPool) -> Self {
        Self::new(Arc::new(SqlxLiveEventRepo::new(pool)))
    }

    /// Like [`from_pool`](Self::from_pool), storing events through `queue`.
    pub fn from_pool_queued(pool: DbPool, queue: WriteQueue) -> Self {
        Self::new(Arc::new(
            SqlxLiveEventRepo::new(pool).with_write_queue(queue),
        ))
    }

    pub fn repo(&self) -> Arc<dyn LiveEventRepo> {
        self.repo.clone()
    }

    pub async fn publish(&self, event: NewLiveEvent) {
        let now = chrono::Utc::now().timestamp_millis();
        if let Err(err) = self.repo.insert(&event, now).await {
            tracing::warn!(%err, kind = event.kind, "failed to publish live event");
            return;
        }
        bump_generation(&event);
        wake();
        // Retention is enforced opportunistically so no extra job is needed.
        if self.published.fetch_add(1, Ordering::Relaxed) % 200 == 199 {
            let _ = self.repo.purge(now).await;
        }
    }

    /// Publishes several events with one commit.
    pub async fn publish_all(&self, events: impl IntoIterator<Item = NewLiveEvent>) {
        let events: Vec<NewLiveEvent> = events.into_iter().collect();
        if events.is_empty() {
            return;
        }
        let now = chrono::Utc::now().timestamp_millis();
        if let Err(err) = self.repo.insert_many(&events, now).await {
            tracing::warn!(%err, count = events.len(), "failed to publish live events");
            return;
        }
        for event in &events {
            bump_generation(event);
        }
        wake();
        let before = self
            .published
            .fetch_add(events.len() as u64, Ordering::Relaxed);
        if before / 200 != (before + events.len() as u64) / 200 {
            let _ = self.repo.purge(now).await;
        }
    }

    /// Progress is reported every few seconds during playback. Publishing every
    /// tick would flood other devices, so a `(user, media file)` pair publishes
    /// when its watched state changes (or it is new) and otherwise at most once
    /// per `min_gap`.
    pub fn should_publish_progress(
        &self,
        user_id: Uuid,
        media_file_id: Uuid,
        watched: bool,
        min_gap: Duration,
    ) -> bool {
        let mut map = self.throttle.lock().unwrap_or_else(|e| e.into_inner());
        if map.len() > 4096 {
            map.retain(|_, (at, _)| at.elapsed() < min_gap);
        }
        let now = Instant::now();
        match map.get(&(user_id, media_file_id)) {
            Some((at, was)) if *was == watched && at.elapsed() < min_gap => false,
            _ => {
                map.insert((user_id, media_file_id), (now, watched));
                true
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pool::test_sqlite_pool;

    #[tokio::test]
    async fn publishing_moves_the_matching_change_counters_only() {
        let publisher = LiveEventPublisher::from_pool(test_sqlite_pool().await);
        let (me, other) = (Uuid::new_v4(), Uuid::new_v4());
        let start = change_generation(me);
        publisher
            .publish(NewLiveEvent::for_user(
                other,
                kind::WATCH,
                "work",
                Uuid::new_v4(),
                &["progress"],
            ))
            .await;
        assert_eq!(change_generation(me).1, start.1);
        publisher
            .publish(NewLiveEvent::for_user(
                me,
                kind::WATCHLIST,
                "work",
                Uuid::new_v4(),
                &["added"],
            ))
            .await;
        assert_eq!(change_generation(me).1, start.1 + 1);
        let global = change_generation(me).0;
        publisher
            .publish(NewLiveEvent::for_library(
                kind::LIBRARY,
                "work",
                Uuid::new_v4(),
                &["files"],
                None,
            ))
            .await;
        assert!(change_generation(me).0 > global);
    }

    #[tokio::test]
    async fn publish_all_stores_every_event_in_order() {
        let publisher = LiveEventPublisher::from_pool(test_sqlite_pool().await);
        let (user, work) = (Uuid::new_v4(), Uuid::new_v4());
        publisher
            .publish_all([
                NewLiveEvent::for_user(user, kind::WATCH, "work", work, &["progress"]),
                NewLiveEvent::for_library(kind::LIBRARY, "work", work, &["files"], None),
                NewLiveEvent::for_library(kind::CALENDAR, "work", work, &["imported"], None),
            ])
            .await;
        publisher.publish_all(Vec::<NewLiveEvent>::new()).await;
        let all = publisher.repo().list_after(0, 10).await.unwrap();
        let kinds: Vec<_> = all.iter().map(|e| e.kind.as_str()).collect();
        assert_eq!(kinds, vec!["watch", "library", "calendar"]);
    }

    #[tokio::test]
    async fn insert_list_bounds_and_purge() {
        let repo = SqlxLiveEventRepo::new(test_sqlite_pool().await);
        let user = Uuid::new_v4();
        let work = Uuid::new_v4();
        repo.insert(
            &NewLiveEvent::for_user(user, kind::WATCH, "work", work, &["progress"]),
            1_000,
        )
        .await
        .unwrap();
        repo.insert(
            &NewLiveEvent::for_library(kind::LIBRARY, "work", work, &["files"], None),
            2_000,
        )
        .await
        .unwrap();
        let all = repo.list_after(0, 10).await.unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].user_id, Some(user));
        assert_eq!(all[0].changed, vec!["progress".to_string()]);
        assert_eq!(all[1].user_id, None);
        assert!(all[0].seq < all[1].seq);
        assert_eq!(repo.list_after(all[0].seq, 10).await.unwrap().len(), 1);
        let (lo, hi) = repo.bounds().await.unwrap();
        assert_eq!((lo, hi), (Some(all[0].seq), Some(all[1].seq)));
        // Both rows are older than the window, but the newest is kept as the
        // watermark.
        assert_eq!(repo.purge(RETENTION_MS + 5_000).await.unwrap(), 1);
        let left = repo.list_after(0, 10).await.unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].seq, all[1].seq);
    }

    #[test]
    fn progress_throttle_publishes_on_state_change_and_after_the_gap() {
        let (user, file) = (Uuid::new_v4(), Uuid::new_v4());
        let p = LiveEventPublisher::new(Arc::new(NoopRepo));
        let gap = Duration::from_millis(40);
        assert!(p.should_publish_progress(user, file, false, gap));
        assert!(!p.should_publish_progress(user, file, false, gap));
        assert!(p.should_publish_progress(user, file, true, gap));
        std::thread::sleep(Duration::from_millis(60));
        assert!(p.should_publish_progress(user, file, true, gap));
    }

    struct NoopRepo;
    #[async_trait]
    impl LiveEventRepo for NoopRepo {
        async fn insert(&self, _: &NewLiveEvent, _: i64) -> Result<(), DbError> {
            Ok(())
        }
        async fn list_after(&self, _: i64, _: i64) -> Result<Vec<LiveEvent>, DbError> {
            Ok(vec![])
        }
        async fn bounds(&self) -> Result<(Option<i64>, Option<i64>), DbError> {
            Ok((None, None))
        }
        async fn purge(&self, _: i64) -> Result<u64, DbError> {
            Ok(0)
        }
    }
}
