//! Stale-while-revalidate cache of the `(work, language)` pairs behind the
//! language filters and the Filters panel's language lists.
//!
//! Reading the pairs is one `SELECT DISTINCT` over every file's language rows
//! joined to its work. On a library with tens of thousands of files that takes
//! seconds for audio and up to half a minute for subtitles on a busy server, and
//! the languages endpoint ran it twice per request, so the Filters panel
//! waited that long for its lists. The index changes rarely (a sync that found
//! something new, a probe or a sidecar rescan), so the pairs are kept in memory:
//!
//! * a fresh entry (younger than [`FRESH_FOR`], read after the last language
//!   write in this process and the last [`WorkLanguageCache::invalidate`]) is
//!   returned as is;
//! * an older or invalidated entry is returned at once and refreshed once in the
//!   background;
//! * with no entry, or one older than [`MAX_AGE`], the caller waits for the read.
//!
//! Every read runs in its own task and is shared per kind, so a request that is
//! cancelled while it waits cannot abort it, and concurrent requests share one
//! read. A read that panics or fails leaves the previous pairs in place and the
//! next request tries again.
//!
//! The cache holds nothing per viewer: household gates and library access are
//! applied by the caller on top of the pairs.

use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use playarr_db::DbError;
use tokio::sync::watch;
use uuid::Uuid;

/// How long a read of the pairs is served without being refreshed.
pub(crate) const FRESH_FOR: Duration = Duration::from_secs(60);
/// Beyond this age the pairs are not served any more: the caller waits for a new read.
pub(crate) const MAX_AGE: Duration = Duration::from_secs(600);

pub(crate) type Pairs = Arc<Vec<(Uuid, String)>>;
type Outcome = Option<Result<Pairs, String>>;

#[derive(Default)]
struct Entry {
    pairs: Option<Pairs>,
    loaded: Option<Instant>,
    /// Language write tick and invalidation epoch the pairs were read at.
    tick: u64,
    epoch: u64,
    /// The read in progress, if any.
    inflight: Option<watch::Receiver<Outcome>>,
}

pub(crate) struct WorkLanguageCache {
    fresh_for: Duration,
    max_age: Duration,
    epoch: AtomicU64,
    entries: Mutex<HashMap<String, Entry>>,
}

/// Clears the read in progress when its task ends, also when it panics.
struct ReadGuard {
    cache: Arc<WorkLanguageCache>,
    kind: String,
}

impl Drop for ReadGuard {
    fn drop(&mut self) {
        if let Some(entry) = self.cache.lock().get_mut(&self.kind) {
            entry.inflight = None;
        }
    }
}

impl WorkLanguageCache {
    pub(crate) fn new(fresh_for: Duration, max_age: Duration) -> Arc<Self> {
        Arc::new(Self {
            fresh_for,
            max_age,
            epoch: AtomicU64::new(0),
            entries: Mutex::new(HashMap::new()),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Entry>> {
        self.entries.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Marks every entry out of date: the next request serves it once more and
    /// refreshes it in the background.
    pub(crate) fn invalidate(&self) {
        self.epoch.fetch_add(1, Ordering::AcqRel);
    }

    /// The pairs for `kind`. `tick` is the current language write tick; an entry
    /// read at another tick is out of date. `load` reads the pairs from the
    /// database and runs in its own task.
    pub(crate) async fn get<F, Fut>(
        self: &Arc<Self>,
        kind: &str,
        tick: u64,
        load: F,
    ) -> Result<Pairs, DbError>
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<Vec<(Uuid, String)>, DbError>> + Send + 'static,
    {
        let epoch = self.epoch.load(Ordering::Acquire);
        let mut receiver = {
            let mut entries = self.lock();
            let entry = entries.entry(kind.to_string()).or_default();
            let age = entry.loaded.map(|at| at.elapsed());
            let usable = entry
                .pairs
                .clone()
                .filter(|_| age.is_some_and(|a| a < self.max_age));
            let fresh = age.is_some_and(|a| a < self.fresh_for)
                && entry.tick == tick
                && entry.epoch == epoch;
            if let (true, Some(pairs)) = (fresh, usable.clone()) {
                return Ok(pairs);
            }
            if entry.inflight.is_none() {
                let (sender, receiver) = watch::channel(None);
                entry.inflight = Some(receiver);
                let guard = ReadGuard {
                    cache: self.clone(),
                    kind: kind.to_string(),
                };
                tokio::spawn(async move {
                    let result = load().await.map(Arc::new);
                    let outcome = {
                        let mut entries = guard.cache.lock();
                        let entry = entries.entry(guard.kind.clone()).or_default();
                        match result {
                            Ok(pairs) => {
                                entry.pairs = Some(pairs.clone());
                                entry.loaded = Some(Instant::now());
                                entry.tick = tick;
                                entry.epoch = epoch;
                                Ok(pairs)
                            }
                            // Keep serving the old pairs; the next request tries again.
                            Err(error) => {
                                tracing::warn!(%error, kind = %guard.kind, "language index read failed");
                                Err(error.to_string())
                            }
                        }
                    };
                    let _ = sender.send(Some(outcome));
                    drop(guard);
                });
            }
            if let Some(pairs) = usable {
                return Ok(pairs);
            }
            entry.inflight.clone().expect("a read is in progress")
        };
        let outcome = receiver
            .wait_for(|value| value.is_some())
            .await
            .map(|value| value.clone());
        match outcome {
            Ok(Some(Ok(pairs))) => Ok(pairs),
            Ok(Some(Err(message))) => Err(DbError::Backend(sqlx::Error::Protocol(message))),
            _ => Err(DbError::Backend(sqlx::Error::Protocol(
                "language index read was aborted".to_string(),
            ))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    fn cache() -> Arc<WorkLanguageCache> {
        WorkLanguageCache::new(Duration::from_secs(60), Duration::from_secs(600))
    }

    fn pair(n: u128, lang: &str) -> (Uuid, String) {
        (Uuid::from_u128(n), lang.to_string())
    }

    async fn settle() {
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    #[tokio::test]
    async fn fresh_entry_is_read_once() {
        let cache = cache();
        let reads = Arc::new(AtomicUsize::new(0));
        for _ in 0..3 {
            let reads = reads.clone();
            let pairs = cache
                .get("audio", 0, move || async move {
                    reads.fetch_add(1, Ordering::SeqCst);
                    Ok(vec![pair(1, "en")])
                })
                .await
                .unwrap();
            assert_eq!(pairs.as_slice(), &[pair(1, "en")]);
        }
        assert_eq!(reads.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn kinds_are_cached_separately() {
        let cache = cache();
        let audio = cache
            .get("audio", 0, || async { Ok(vec![pair(1, "en")]) })
            .await
            .unwrap();
        let subtitle = cache
            .get("subtitle", 0, || async { Ok(vec![pair(1, "fr")]) })
            .await
            .unwrap();
        assert_eq!(audio[0].1, "en");
        assert_eq!(subtitle[0].1, "fr");
    }

    #[tokio::test]
    async fn concurrent_first_requests_share_one_read() {
        let cache = cache();
        let reads = Arc::new(AtomicUsize::new(0));
        let mut tasks = Vec::new();
        for _ in 0..5 {
            let cache = cache.clone();
            let reads = reads.clone();
            tasks.push(tokio::spawn(async move {
                cache
                    .get("audio", 0, move || async move {
                        reads.fetch_add(1, Ordering::SeqCst);
                        tokio::time::sleep(Duration::from_millis(50)).await;
                        Ok(vec![pair(1, "en")])
                    })
                    .await
                    .unwrap()
            }));
        }
        for task in tasks {
            assert_eq!(task.await.unwrap().len(), 1);
        }
        assert_eq!(reads.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_cancelled_first_request_does_not_abort_the_read() {
        let cache = cache();
        let reads = Arc::new(AtomicUsize::new(0));
        let first = {
            let (cache, reads) = (cache.clone(), reads.clone());
            tokio::spawn(async move {
                cache
                    .get("audio", 0, move || async move {
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        reads.fetch_add(1, Ordering::SeqCst);
                        Ok(vec![pair(1, "en")])
                    })
                    .await
            })
        };
        tokio::time::sleep(Duration::from_millis(20)).await;
        first.abort();
        let second = cache
            .get("audio", 0, || async { Ok(vec![pair(9, "xx")]) })
            .await
            .unwrap();
        assert_eq!(second.as_slice(), &[pair(1, "en")]);
        assert_eq!(reads.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn stale_entry_is_served_at_once_and_refreshed_in_the_background() {
        let cache = WorkLanguageCache::new(Duration::ZERO, Duration::from_secs(600));
        cache
            .get("audio", 0, || async { Ok(vec![pair(1, "en")]) })
            .await
            .unwrap();
        let stale = cache
            .get("audio", 0, || async {
                tokio::time::sleep(Duration::from_millis(100)).await;
                Ok(vec![pair(1, "en"), pair(2, "ja")])
            })
            .await
            .unwrap();
        assert_eq!(stale.len(), 1);
        settle().await;
        let refreshed = cache
            .get("audio", 0, || async { Ok(vec![pair(9, "xx")]) })
            .await
            .unwrap();
        assert_eq!(refreshed.len(), 2);
    }

    #[tokio::test]
    async fn only_one_refresh_runs_at_a_time() {
        let cache = WorkLanguageCache::new(Duration::ZERO, Duration::from_secs(600));
        cache
            .get("audio", 0, || async { Ok(Vec::new()) })
            .await
            .unwrap();
        let reads = Arc::new(AtomicUsize::new(0));
        for _ in 0..4 {
            let reads = reads.clone();
            cache
                .get("audio", 0, move || async move {
                    reads.fetch_add(1, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    Ok(Vec::new())
                })
                .await
                .unwrap();
        }
        settle().await;
        assert_eq!(reads.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_new_write_tick_refreshes_in_the_background() {
        let cache = cache();
        cache
            .get("audio", 1, || async { Ok(vec![pair(1, "en")]) })
            .await
            .unwrap();
        let old = cache
            .get("audio", 2, || async {
                Ok(vec![pair(1, "en"), pair(2, "ja")])
            })
            .await
            .unwrap();
        assert_eq!(old.len(), 1);
        settle().await;
        let new = cache
            .get("audio", 2, || async { Ok(Vec::new()) })
            .await
            .unwrap();
        assert_eq!(new.len(), 2);
    }

    #[tokio::test]
    async fn invalidate_refreshes_in_the_background() {
        let cache = cache();
        cache
            .get("audio", 0, || async { Ok(vec![pair(1, "en")]) })
            .await
            .unwrap();
        cache.invalidate();
        let old = cache
            .get("audio", 0, || async {
                Ok(vec![pair(1, "en"), pair(2, "ja")])
            })
            .await
            .unwrap();
        assert_eq!(old.len(), 1);
        settle().await;
        assert_eq!(
            cache
                .get("audio", 0, || async { Ok(Vec::new()) })
                .await
                .unwrap()
                .len(),
            2
        );
    }

    #[tokio::test]
    async fn beyond_the_hard_max_age_the_caller_waits_for_a_new_read() {
        let cache = WorkLanguageCache::new(Duration::ZERO, Duration::ZERO);
        cache
            .get("audio", 0, || async { Ok(vec![pair(1, "en")]) })
            .await
            .unwrap();
        let fresh = cache
            .get("audio", 0, || async { Ok(vec![pair(2, "ja")]) })
            .await
            .unwrap();
        assert_eq!(fresh.as_slice(), &[pair(2, "ja")]);
    }

    #[tokio::test]
    async fn failed_first_read_is_not_cached_and_failed_refresh_keeps_old_pairs() {
        let cache = WorkLanguageCache::new(Duration::ZERO, Duration::from_secs(600));
        assert!(cache
            .get("audio", 0, || async { Err(DbError::NotFound) })
            .await
            .is_err());
        cache
            .get("audio", 0, || async { Ok(vec![pair(1, "en")]) })
            .await
            .unwrap();
        cache
            .get("audio", 0, || async { Err(DbError::NotFound) })
            .await
            .unwrap();
        settle().await;
        let kept = cache
            .get("audio", 0, || async { Ok(vec![pair(1, "en")]) })
            .await
            .unwrap();
        assert_eq!(kept.len(), 1);
    }

    #[tokio::test]
    async fn a_panicking_read_does_not_wedge_the_cache() {
        // First read panics: the waiter gets an error and the next request reads again.
        let cache = WorkLanguageCache::new(Duration::ZERO, Duration::from_secs(600));
        let failed = cache
            .get("audio", 0, || async { panic!("loader panics") })
            .await;
        assert!(failed.is_err());
        cache
            .get("audio", 0, || async { Ok(vec![pair(1, "en")]) })
            .await
            .unwrap();
        // A refresh that panics leaves the old pairs and clears the in-progress flag.
        cache
            .get("audio", 0, || async { panic!("refresh panics") })
            .await
            .unwrap();
        settle().await;
        let reads = Arc::new(AtomicUsize::new(0));
        let counted = reads.clone();
        cache
            .get("audio", 0, move || async move {
                counted.fetch_add(1, Ordering::SeqCst);
                Ok(vec![pair(1, "en"), pair(2, "ja")])
            })
            .await
            .unwrap();
        settle().await;
        assert_eq!(reads.load(Ordering::SeqCst), 1);
        assert_eq!(
            cache
                .get("audio", 0, || async { Ok(Vec::new()) })
                .await
                .unwrap()
                .len(),
            2
        );
    }
}
