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
//! * a fresh entry (younger than [`FRESH_FOR`]) is returned as is;
//! * an older entry is returned at once and refreshed once in the background;
//! * with no entry, the first caller reads and the others wait for that one read.
//!
//! The cache holds nothing per viewer: household gates and library access are
//! applied by the caller on top of the pairs.

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use playarr_db::DbError;
use uuid::Uuid;

/// How long a read of the pairs is served without being refreshed.
pub(crate) const FRESH_FOR: Duration = Duration::from_secs(60);

pub(crate) type Pairs = Arc<Vec<(Uuid, String)>>;

struct Slot {
    pairs: Pairs,
    loaded: Instant,
    refreshing: bool,
}

pub(crate) struct WorkLanguageCache {
    fresh_for: Duration,
    slots: Mutex<HashMap<String, Slot>>,
    /// Held while a first read runs, so concurrent first requests share it.
    first_read: tokio::sync::Mutex<()>,
}

impl WorkLanguageCache {
    pub(crate) fn new(fresh_for: Duration) -> Arc<Self> {
        Arc::new(Self {
            fresh_for,
            slots: Mutex::new(HashMap::new()),
            first_read: tokio::sync::Mutex::new(()),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Slot>> {
        self.slots.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The pairs for `kind`. `load` reads them from the database; it runs at
    /// most once at a time per cache for a first read, and once in the
    /// background per stale entry.
    pub(crate) async fn get<F, Fut>(self: &Arc<Self>, kind: &str, load: F) -> Result<Pairs, DbError>
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<Vec<(Uuid, String)>, DbError>> + Send + 'static,
    {
        {
            let mut slots = self.lock();
            if let Some(slot) = slots.get_mut(kind) {
                let pairs = slot.pairs.clone();
                if slot.loaded.elapsed() >= self.fresh_for && !slot.refreshing {
                    slot.refreshing = true;
                    drop(slots);
                    self.spawn_refresh(kind.to_string(), load);
                }
                return Ok(pairs);
            }
        }
        let _first = self.first_read.lock().await;
        if let Some(slot) = self.lock().get(kind) {
            return Ok(slot.pairs.clone());
        }
        let pairs: Pairs = Arc::new(load().await?);
        self.lock().insert(
            kind.to_string(),
            Slot {
                pairs: pairs.clone(),
                loaded: Instant::now(),
                refreshing: false,
            },
        );
        Ok(pairs)
    }

    fn spawn_refresh<F, Fut>(self: &Arc<Self>, kind: String, load: F)
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<Vec<(Uuid, String)>, DbError>> + Send + 'static,
    {
        let cache = self.clone();
        tokio::spawn(async move {
            let result = load().await;
            let mut slots = cache.lock();
            if let Some(slot) = slots.get_mut(&kind) {
                slot.refreshing = false;
                match result {
                    Ok(pairs) => {
                        slot.pairs = Arc::new(pairs);
                        slot.loaded = Instant::now();
                    }
                    // Keep serving the old pairs; the next request tries again.
                    Err(error) => tracing::warn!(%error, kind, "language index refresh failed"),
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn pair(n: u128, lang: &str) -> (Uuid, String) {
        (Uuid::from_u128(n), lang.to_string())
    }

    #[tokio::test]
    async fn fresh_entry_is_read_once() {
        let cache = WorkLanguageCache::new(Duration::from_secs(60));
        let reads = Arc::new(AtomicUsize::new(0));
        for _ in 0..3 {
            let reads = reads.clone();
            let pairs = cache
                .get("audio", move || async move {
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
        let cache = WorkLanguageCache::new(Duration::from_secs(60));
        let audio = cache
            .get("audio", || async { Ok(vec![pair(1, "en")]) })
            .await
            .unwrap();
        let subtitle = cache
            .get("subtitle", || async { Ok(vec![pair(1, "fr")]) })
            .await
            .unwrap();
        assert_eq!(audio[0].1, "en");
        assert_eq!(subtitle[0].1, "fr");
    }

    #[tokio::test]
    async fn concurrent_first_requests_share_one_read() {
        let cache = WorkLanguageCache::new(Duration::from_secs(60));
        let reads = Arc::new(AtomicUsize::new(0));
        let mut tasks = Vec::new();
        for _ in 0..5 {
            let cache = cache.clone();
            let reads = reads.clone();
            tasks.push(tokio::spawn(async move {
                cache
                    .get("audio", move || async move {
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
    async fn stale_entry_is_served_at_once_and_refreshed_in_the_background() {
        let cache = WorkLanguageCache::new(Duration::ZERO);
        cache
            .get("audio", || async { Ok(vec![pair(1, "en")]) })
            .await
            .unwrap();
        // The refresh is slow, yet the caller gets the old pairs straight away.
        let stale = cache
            .get("audio", || async {
                tokio::time::sleep(Duration::from_millis(100)).await;
                Ok(vec![pair(1, "en"), pair(2, "ja")])
            })
            .await
            .unwrap();
        assert_eq!(stale.len(), 1);
        tokio::time::sleep(Duration::from_millis(300)).await;
        let refreshed = cache
            .get("audio", || async { Ok(vec![pair(9, "xx")]) })
            .await
            .unwrap();
        assert_eq!(refreshed.len(), 2);
    }

    #[tokio::test]
    async fn only_one_refresh_runs_at_a_time() {
        let cache = WorkLanguageCache::new(Duration::ZERO);
        cache
            .get("audio", || async { Ok(Vec::new()) })
            .await
            .unwrap();
        let reads = Arc::new(AtomicUsize::new(0));
        for _ in 0..4 {
            let reads = reads.clone();
            cache
                .get("audio", move || async move {
                    reads.fetch_add(1, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    Ok(Vec::new())
                })
                .await
                .unwrap();
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(reads.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn failed_first_read_is_not_cached_and_failed_refresh_keeps_old_pairs() {
        let cache = WorkLanguageCache::new(Duration::ZERO);
        let failed = cache
            .get("audio", || async { Err(DbError::NotFound) })
            .await;
        assert!(failed.is_err());
        cache
            .get("audio", || async { Ok(vec![pair(1, "en")]) })
            .await
            .unwrap();
        cache
            .get("audio", || async { Err(DbError::NotFound) })
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        let kept = cache
            .get("audio", || async { Ok(vec![pair(1, "en")]) })
            .await
            .unwrap();
        assert_eq!(kept.len(), 1);
    }
}
