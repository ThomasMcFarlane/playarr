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
//! * after a library change published through the live event log (an import,
//!   a metadata upsert or a removal), at most once per [`EVENT_GRACE`] so a
//!   burst of writes does not rebuild per write;
//! * in the background once it is older than [`MAX_AGE`], which bounds what a
//!   writer in another process (no event in this one) can leave stale;
//! * on [`SnapshotCache::invalidate`].
//!
//! A snapshot holds nothing per viewer: library access, household gates and
//! watch state are applied on top of it by the caller, so one snapshot serves
//! every user and profile without leaking between them.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use playarr_db::{MediaFileRepo, WorkRepo};
use playarr_model::{Work, WorkKind};
use uuid::Uuid;

use crate::CatalogError;

/// A snapshot that a library change made stale is still served for this long
/// after it was built, then rebuilt. Coalesces a burst of writes.
const EVENT_GRACE: Duration = Duration::from_millis(1500);
/// Older than this, the snapshot is refreshed in the background.
const MAX_AGE: Duration = Duration::from_secs(30);

pub struct Snapshot {
    /// Changes with every rebuild; caches derived from the snapshot key on it.
    pub version: u64,
    built_at: Instant,
    /// Live-event tick read before the build: a change at or after it is not
    /// necessarily reflected.
    tick: u64,
    /// Live-event tick up to which changes have been looked at.
    scanned: AtomicU64,
    dirty: AtomicBool,
    /// Rebuild at the next read regardless of the grace period.
    forced: AtomicBool,
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

    /// True once a library change was published after this snapshot was read.
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
}

pub struct SnapshotCache {
    work_repo: Arc<dyn WorkRepo>,
    media_file_repo: Arc<dyn MediaFileRepo>,
    current: Mutex<Option<Arc<Snapshot>>>,
    /// Single flight: one rebuild at a time, everyone else waits for it.
    build: tokio::sync::Mutex<()>,
    refreshing: AtomicBool,
    versions: AtomicU64,
}

impl SnapshotCache {
    pub fn new(work_repo: Arc<dyn WorkRepo>, media_file_repo: Arc<dyn MediaFileRepo>) -> Arc<Self> {
        Arc::new(Self {
            work_repo,
            media_file_repo,
            current: Mutex::new(None),
            build: tokio::sync::Mutex::new(()),
            refreshing: AtomicBool::new(false),
            versions: AtomicU64::new(0),
        })
    }

    fn current(&self) -> Option<Arc<Snapshot>> {
        self.current
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// The snapshot to read from. Builds it on first use; afterwards it is
    /// returned at once, and a stale one is rebuilt (see the module docs).
    pub async fn get(self: &Arc<Self>) -> Result<Arc<Snapshot>, CatalogError> {
        let Some(snapshot) = self.current() else {
            return self.rebuild().await;
        };
        let age = snapshot.built_at.elapsed();
        if snapshot.changed() {
            if age >= EVENT_GRACE || snapshot.forced.load(Ordering::Acquire) {
                return match self.rebuild().await {
                    Ok(fresh) => Ok(fresh),
                    Err(error) => {
                        tracing::warn!(%error, "catalog snapshot rebuild failed; serving the previous one");
                        Ok(snapshot)
                    }
                };
            }
            self.refresh_later(EVENT_GRACE - age);
        } else if age >= MAX_AGE {
            self.refresh_later(Duration::ZERO);
        }
        Ok(snapshot)
    }

    /// Makes the next read rebuild, for writers that publish no live event.
    pub fn invalidate(&self) {
        if let Some(snapshot) = self.current() {
            snapshot.forced.store(true, Ordering::Release);
            snapshot.dirty.store(true, Ordering::Release);
        }
    }

    /// Builds the snapshot ahead of the first request.
    pub async fn warm(self: &Arc<Self>) {
        if let Err(error) = self.get().await {
            tracing::warn!(%error, "catalog snapshot warm-up failed");
        }
    }

    fn refresh_later(self: &Arc<Self>, after: Duration) {
        if self.refreshing.swap(true, Ordering::AcqRel) {
            return;
        }
        let this = self.clone();
        tokio::spawn(async move {
            if !after.is_zero() {
                tokio::time::sleep(after).await;
            }
            if let Err(error) = this.rebuild().await {
                tracing::warn!(%error, "catalog snapshot refresh failed; serving the previous one");
            }
            this.refreshing.store(false, Ordering::Release);
        });
    }

    async fn rebuild(&self) -> Result<Arc<Snapshot>, CatalogError> {
        let asked = Instant::now();
        let _building = self.build.lock().await;
        // Another request rebuilt while this one waited: that is fresh enough.
        if let Some(current) = self.current() {
            if current.built_at >= asked {
                return Ok(current);
            }
        }
        let started = Instant::now();
        let tick = playarr_db::live_change_tick();
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
        let snapshot = Arc::new(Snapshot {
            version: self.versions.fetch_add(1, Ordering::Relaxed) + 1,
            built_at: Instant::now(),
            tick,
            scanned: AtomicU64::new(tick),
            dirty: AtomicBool::new(false),
            forced: AtomicBool::new(false),
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
