//! An in-memory copy of the catalogue's browse inputs, shared by every request.
//!
//! Browsing and the Home rails used to read the whole catalogue from the
//! database on every cold request: each kind's works with their external ids,
//! the set of works that have a file, and every `(work, source)` pair. A Home
//! load did that three times over (one scan per library) and a Library page
//! once, so a cold request cost hundreds of milliseconds of CPU on an idle
//! machine and seconds on a busy two-core one.
//!
//! The snapshot is read once and then reused. It is rebuilt
//!
//! * as soon as a library change is published through the live event log in
//!   this process (an import, a metadata upsert, a removal, a file that moved);
//! * when a cheap probe of the database (the newest library live event, the number of
//!   works and files) differs from the one taken at the last build, checked at
//!   most every [`PROBE_EVERY`]. That covers writers in another process and
//!   anything that publishes no event here; and
//! * on [`SnapshotCache::invalidate`].
//!
//! With nothing changed it is never rebuilt and its [`Snapshot::version`]
//! stays, so caches keyed on the version keep hitting.
//!
//! A snapshot holds nothing per viewer: library access, household gates and
//! watch state are applied on top of it by the caller, so one snapshot serves
//! every user and profile without leaking between them.
//!
//! The rebuild runs as its own task, so a request that is cancelled while it
//! waits cannot abort it; every waiter shares the one result. After a failed
//! rebuild the previous snapshot keeps being served and a new attempt waits
//! out a growing backoff.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::time::Instant;

use playarr_db::DbPool;
use sqlx::Row;

use playarr_db::{MediaFileRepo, WorkRepo};
use playarr_model::{Work, WorkKind};
use uuid::Uuid;

use crate::CatalogError;

/// How often a read re-checks the database probe.
const PROBE_EVERY: Duration = Duration::from_secs(5);
/// First wait after a failed rebuild; doubles per failure up to the maximum.
const BACKOFF_BASE: Duration = Duration::from_secs(2);
const BACKOFF_MAX: Duration = Duration::from_secs(60);

/// What the database looked like at a build: any difference means a write
/// happened since. `None` when the probe could not be read.
type Probe = Option<(i64, i64, i64)>;

pub struct Snapshot {
    /// Changes only when the catalogue was rebuilt from different data;
    /// caches derived from the snapshot key on it.
    pub version: u64,
    /// Live-event tick read before the build: a change at or after it is not
    /// necessarily reflected.
    tick: u64,
    /// Live-event tick up to which changes have been looked at.
    scanned: AtomicU64,
    dirty: AtomicBool,
    /// The database probe at the build, and when it was last compared.
    probe: Probe,
    probed_at: Mutex<Instant>,
    /// Every catalogue work of each kind, in `sort_title` order.
    works: HashMap<WorkKind, Vec<Arc<Work>>>,
    /// Media files per work; works without a file are absent.
    file_counts: HashMap<Uuid, u32>,
    /// Source instances that contributed a file to each work.
    sources: HashMap<Uuid, Vec<Uuid>>,
}

impl Snapshot {
    /// The works of `kind`, in `sort_title` order.
    pub fn works(&self, kind: WorkKind) -> &[Arc<Work>] {
        self.works.get(&kind).map(Vec::as_slice).unwrap_or(&[])
    }

    /// Whether the work has at least one media file.
    pub fn is_playable(&self, work_id: &Uuid) -> bool {
        self.file_counts.contains_key(work_id)
    }

    /// Media files of the work (0 when it has none).
    pub fn file_count(&self, work_id: &Uuid) -> u32 {
        self.file_counts.get(work_id).copied().unwrap_or(0)
    }

    /// Source instances with a file for `work_id` (empty when it has none).
    pub fn sources_of(&self, work_id: &Uuid) -> &[Uuid] {
        self.sources.get(work_id).map(Vec::as_slice).unwrap_or(&[])
    }

    /// True once a library change was published in this process after this
    /// snapshot was read.
    fn changed(&self) -> bool {
        if self.dirty.load(Ordering::Acquire) {
            return true;
        }
        let seen = self.scanned.load(Ordering::Acquire);
        let now = playarr_db::live_change_tick();
        if now == seen {
            return false;
        }
        let touched = match playarr_db::live_changes_since(seen.max(self.tick)) {
            // Some changes were dropped from the log: assume the worst.
            None => true,
            Some(records) => records
                .iter()
                .any(|r| r.kind == playarr_db::live_event_kind::LIBRARY),
        };
        if touched {
            self.dirty.store(true, Ordering::Release);
        } else {
            self.scanned.store(now, Ordering::Release);
        }
        touched
    }

    /// True when the periodic database probe differs from the build's.
    async fn probe_changed(&self, pool: &DbPool, every: Duration) -> bool {
        {
            let mut at = self.probed_at.lock().unwrap_or_else(|e| e.into_inner());
            if at.elapsed() < every {
                return false;
            }
            *at = Instant::now();
        }
        let now = read_probe(pool).await;
        let changed = now.is_none() || now != self.probe;
        if changed {
            self.dirty.store(true, Ordering::Release);
        }
        changed
    }
}

async fn read_probe(pool: &DbPool) -> Probe {
    let row = sqlx::query(
        "SELECT (SELECT COALESCE(MAX(seq), 0) FROM live_events WHERE kind = 'library') AS events, \
                (SELECT COUNT(*) FROM works) AS works, \
                (SELECT COUNT(*) FROM media_files) AS files",
    )
    .fetch_one(pool)
    .await
    .ok()?;
    Some((
        row.try_get::<i64, _>("events").ok()?,
        row.try_get::<i64, _>("works").ok()?,
        row.try_get::<i64, _>("files").ok()?,
    ))
}

/// The result of one rebuild, shared by everyone who waited for it.
type Outcome = Option<Result<Arc<Snapshot>, String>>;

struct Failures {
    count: u32,
    retry_at: Option<Instant>,
}

pub struct SnapshotCache {
    work_repo: Arc<dyn WorkRepo>,
    media_file_repo: Arc<dyn MediaFileRepo>,
    pool: DbPool,
    current: Mutex<Option<Arc<Snapshot>>>,
    /// The rebuild in progress, if any; waiters subscribe to its result.
    inflight: Mutex<Option<tokio::sync::watch::Receiver<Outcome>>>,
    failures: Mutex<Failures>,
    versions: AtomicU64,
    probe_every_ms: AtomicU64,
}

impl SnapshotCache {
    pub fn new(
        work_repo: Arc<dyn WorkRepo>,
        media_file_repo: Arc<dyn MediaFileRepo>,
        pool: DbPool,
    ) -> Arc<Self> {
        Arc::new(Self {
            work_repo,
            media_file_repo,
            pool,
            current: Mutex::new(None),
            inflight: Mutex::new(None),
            failures: Mutex::new(Failures {
                count: 0,
                retry_at: None,
            }),
            versions: AtomicU64::new(0),
            probe_every_ms: AtomicU64::new(PROBE_EVERY.as_millis() as u64),
        })
    }

    fn probe_every(&self) -> Duration {
        Duration::from_millis(self.probe_every_ms.load(Ordering::Relaxed))
    }

    /// How often a read compares the database probe (tests shorten it).
    pub fn set_probe_every(&self, every: Duration) {
        self.probe_every_ms
            .store(every.as_millis() as u64, Ordering::Relaxed);
    }

    fn current(&self) -> Option<Arc<Snapshot>> {
        self.current
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// The snapshot to read from. Builds it on first use; afterwards it is
    /// returned at once unless a change since the build was seen, in which case
    /// it is rebuilt first (see the module docs).
    pub async fn get(self: &Arc<Self>) -> Result<Arc<Snapshot>, CatalogError> {
        let Some(snapshot) = self.current() else {
            return self.rebuild().await;
        };
        if !snapshot.changed() && !snapshot.probe_changed(&self.pool, self.probe_every()).await {
            return Ok(snapshot);
        }
        // Backing off after a failure: keep serving what is there.
        if self.backing_off() {
            return Ok(snapshot);
        }
        match self.rebuild().await {
            Ok(fresh) => Ok(fresh),
            Err(error) => {
                tracing::warn!(%error, "catalog snapshot rebuild failed; serving the previous one");
                Ok(snapshot)
            }
        }
    }

    fn backing_off(&self) -> bool {
        self.failures
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retry_at
            .is_some_and(|at| Instant::now() < at)
    }

    /// Makes the next read rebuild, for writers that publish no live event.
    pub fn invalidate(&self) {
        if let Some(snapshot) = self.current() {
            snapshot.dirty.store(true, Ordering::Release);
        }
        let mut failures = self.failures.lock().unwrap_or_else(|e| e.into_inner());
        failures.retry_at = None;
    }

    /// Builds the snapshot ahead of the first request.
    pub async fn warm(self: &Arc<Self>) {
        if let Err(error) = self.get().await {
            tracing::warn!(%error, "catalog snapshot warm-up failed");
        }
    }

    /// Joins the rebuild in progress or starts one, and waits for its result.
    /// The build runs in its own task: dropping this future does not stop it.
    async fn rebuild(self: &Arc<Self>) -> Result<Arc<Snapshot>, CatalogError> {
        let mut rx = {
            let mut inflight = self.inflight.lock().unwrap_or_else(|e| e.into_inner());
            match inflight.as_ref() {
                Some(rx) => rx.clone(),
                None => {
                    let (tx, rx) = tokio::sync::watch::channel(None);
                    *inflight = Some(rx.clone());
                    let this = self.clone();
                    tokio::spawn(async move {
                        let outcome = this.build().await;
                        match &outcome {
                            Ok(_) => {
                                let mut f = this.failures.lock().unwrap_or_else(|e| e.into_inner());
                                f.count = 0;
                                f.retry_at = None;
                            }
                            Err(_) => {
                                let mut f = this.failures.lock().unwrap_or_else(|e| e.into_inner());
                                f.count += 1;
                                let wait = BACKOFF_BASE
                                    .saturating_mul(1u32 << (f.count - 1).min(10))
                                    .min(BACKOFF_MAX);
                                f.retry_at = Some(Instant::now() + wait);
                            }
                        }
                        *this.inflight.lock().unwrap_or_else(|e| e.into_inner()) = None;
                        let _ = tx.send(Some(outcome.map_err(|e| e.to_string())));
                    });
                    rx
                }
            }
        };
        let outcome = rx
            .wait_for(|value| value.is_some())
            .await
            .map_err(|_| CatalogError::Data("catalog snapshot rebuild was dropped".into()))?
            .clone();
        match outcome {
            Some(Ok(snapshot)) => Ok(snapshot),
            Some(Err(message)) => Err(CatalogError::Data(message)),
            None => Err(CatalogError::Data(
                "catalog snapshot rebuild gave no result".into(),
            )),
        }
    }

    async fn build(&self) -> Result<Arc<Snapshot>, CatalogError> {
        let started = Instant::now();
        let tick = playarr_db::live_change_tick();
        let probe = read_probe(&self.pool).await;
        let mut works = HashMap::new();
        for kind in crate::ALL_KINDS {
            let list = self
                .work_repo
                .list_by_kind(kind, crate::SCAN_LIMIT, 0)
                .await?;
            works.insert(kind, list.into_iter().map(Arc::new).collect::<Vec<_>>());
        }
        let file_counts = self.media_file_repo.count_by_work().await?;
        let mut sources: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
        for (work_id, source_id) in self.media_file_repo.list_work_source_instances().await? {
            sources.entry(work_id).or_default().push(source_id);
        }
        let previous = self.current();
        // The version moves only when the data did, so a rebuild that found
        // nothing new keeps every cache keyed on it.
        let same = previous.as_ref().is_some_and(|p| {
            p.works == works && p.file_counts == file_counts && p.sources == sources
        });
        let version = match (&previous, same) {
            (Some(p), true) => p.version,
            _ => self.versions.fetch_add(1, Ordering::Relaxed) + 1,
        };
        let snapshot = Arc::new(Snapshot {
            version,
            tick,
            scanned: AtomicU64::new(tick),
            dirty: AtomicBool::new(false),
            probe,
            probed_at: Mutex::new(Instant::now()),
            works,
            file_counts,
            sources,
        });
        tracing::debug!(
            version = snapshot.version,
            works = snapshot.works.values().map(Vec::len).sum::<usize>(),
            elapsed_ms = started.elapsed().as_millis() as u64,
            "catalog snapshot built"
        );
        *self.current.lock().unwrap_or_else(|e| e.into_inner()) = Some(snapshot.clone());
        Ok(snapshot)
    }
}
