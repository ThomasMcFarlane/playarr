//! Stale-while-revalidate cache for live lookups against external sources
//! (Radarr, Sonarr, Dubarr) on a user-facing request path.
//!
//! Owner rule: a user-facing request never waits on a source for longer than a
//! short deadline and never reports a source error. A fresh entry is served as
//! is; a stale entry is served at once while one background task refreshes it;
//! a miss waits at most `deadline` for the live answer, and the lookup keeps
//! running in the background so the next request is served from the cache. A
//! failed lookup keeps the last good value and is not retried for
//! [`FAILURE_BACKOFF`], so a dead source costs one timeout, not one per request.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::hash::Hash;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// A dead source is not asked again for this long.
pub(crate) const FAILURE_BACKOFF: Duration = Duration::from_secs(30);

/// What a lookup produced.
pub(crate) enum Fetched<V> {
    Ok(V),
    Failed,
}

struct Entry<V> {
    at: Instant,
    value: V,
}

struct Inner<K, V> {
    entries: HashMap<K, Entry<V>>,
    in_flight: HashSet<K>,
    failed_at: HashMap<K, Instant>,
}

pub(crate) struct SwrCache<K, V> {
    inner: Mutex<Option<Inner<K, V>>>,
    fresh: Duration,
    stale: Duration,
    max_entries: usize,
}

impl<K: Hash + Eq + Clone, V: Clone> SwrCache<K, V> {
    pub(crate) const fn new(fresh: Duration, stale: Duration, max_entries: usize) -> Self {
        Self {
            inner: Mutex::new(None),
            fresh,
            stale,
            max_entries,
        }
    }

    fn with<R>(&self, f: impl FnOnce(&mut Inner<K, V>) -> R) -> R {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let inner = guard.get_or_insert_with(|| Inner {
            entries: HashMap::new(),
            in_flight: HashSet::new(),
            failed_at: HashMap::new(),
        });
        f(inner)
    }

    /// Drops every cached value (a source reported changes).
    pub(crate) fn clear(&self) {
        self.with(|i| i.entries.clear());
    }

    /// Drops the cached values whose key matches (one source reported changes).
    pub(crate) fn clear_where(&self, matches: impl Fn(&K) -> bool) {
        self.with(|i| i.entries.retain(|k, _| !matches(k)));
    }

    fn insert(&self, key: K, value: V) {
        let max = self.max_entries;
        self.with(|i| {
            if i.entries.len() >= max && !i.entries.contains_key(&key) {
                if let Some(oldest) = i
                    .entries
                    .iter()
                    .min_by_key(|(_, e)| e.at)
                    .map(|(k, _)| k.clone())
                {
                    i.entries.remove(&oldest);
                }
            }
            i.failed_at.remove(&key);
            i.entries.insert(
                key,
                Entry {
                    at: Instant::now(),
                    value,
                },
            );
        });
    }

    /// True when the caller should start a refresh: none is running and the
    /// last attempt did not fail recently.
    fn begin_refresh(&self, key: &K) -> bool {
        self.with(|i| {
            if i.in_flight.contains(key) {
                return false;
            }
            if i.failed_at
                .get(key)
                .is_some_and(|at| at.elapsed() < FAILURE_BACKOFF)
            {
                return false;
            }
            i.in_flight.insert(key.clone());
            true
        })
    }

    fn end_refresh(&self, key: &K, failed: bool) {
        self.with(|i| {
            i.in_flight.remove(key);
            if failed {
                i.failed_at.insert(key.clone(), Instant::now());
            }
        });
    }

    fn peek(&self, key: &K) -> Option<(bool, V)> {
        let (fresh, stale) = (self.fresh, self.stale);
        self.with(|i| {
            let entry = i.entries.get(key)?;
            let age = entry.at.elapsed();
            if age >= stale {
                return None;
            }
            Some((age < fresh, entry.value.clone()))
        })
    }

    /// Serves `key` from the cache, refreshing in the background as needed.
    /// Returns `None` only when nothing is cached and the live lookup did not
    /// answer within `deadline` (or the source failed recently).
    pub(crate) async fn get<F, Fut>(
        &'static self,
        key: K,
        deadline: Duration,
        fetch: F,
    ) -> Option<V>
    where
        K: Send + Sync + 'static,
        V: Send + 'static,
        F: FnOnce() -> Fut,
        Fut: Future<Output = Fetched<V>> + Send + 'static,
    {
        match self.peek(&key) {
            Some((true, value)) => Some(value),
            Some((false, value)) => {
                if self.begin_refresh(&key) {
                    self.spawn_refresh(key, fetch());
                }
                Some(value)
            }
            None => {
                if !self.begin_refresh(&key) {
                    return None;
                }
                let handle = self.spawn_refresh(key.clone(), fetch());
                match tokio::time::timeout(deadline, handle).await {
                    Ok(Ok(Some(value))) => Some(value),
                    _ => None,
                }
            }
        }
    }

    fn spawn_refresh<Fut>(&'static self, key: K, fut: Fut) -> tokio::task::JoinHandle<Option<V>>
    where
        K: Send + Sync + 'static,
        V: Send + 'static,
        Fut: Future<Output = Fetched<V>> + Send + 'static,
    {
        tokio::spawn(async move {
            match fut.await {
                Fetched::Ok(value) => {
                    self.insert(key.clone(), value.clone());
                    self.end_refresh(&key, false);
                    Some(value)
                }
                Fetched::Failed => {
                    self.end_refresh(&key, true);
                    None
                }
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    static CACHE: SwrCache<&'static str, u32> =
        SwrCache::new(Duration::from_millis(50), Duration::from_secs(60), 2);

    #[tokio::test]
    async fn miss_waits_at_most_the_deadline_then_fills_in_the_background() {
        let started = Instant::now();
        let first = CACHE
            .get("slow", Duration::from_millis(20), || async {
                tokio::time::sleep(Duration::from_millis(150)).await;
                Fetched::Ok(7)
            })
            .await;
        assert_eq!(first, None);
        assert!(started.elapsed() < Duration::from_millis(120));
        tokio::time::sleep(Duration::from_millis(250)).await;
        let calls = Arc::new(AtomicUsize::new(0));
        let c = calls.clone();
        let second = CACHE
            .get("slow", Duration::from_millis(20), move || async move {
                c.fetch_add(1, Ordering::SeqCst);
                Fetched::Ok(9)
            })
            .await;
        // Stale by now (50 ms) or fresh: the filled value is served at once.
        assert_eq!(second, Some(7));
    }

    #[tokio::test]
    async fn stale_value_is_served_immediately_and_refreshed_once() {
        static C: SwrCache<&'static str, u32> =
            SwrCache::new(Duration::from_millis(10), Duration::from_secs(60), 8);
        let hits = Arc::new(AtomicUsize::new(0));
        let h = hits.clone();
        let v = C
            .get("k", Duration::from_secs(1), move || async move {
                h.fetch_add(1, Ordering::SeqCst);
                Fetched::Ok(1)
            })
            .await;
        assert_eq!(v, Some(1));
        tokio::time::sleep(Duration::from_millis(30)).await;
        let mut served = Vec::new();
        for _ in 0..3 {
            let h = hits.clone();
            served.push(
                C.get("k", Duration::from_secs(1), move || async move {
                    h.fetch_add(1, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(80)).await;
                    Fetched::Ok(2)
                })
                .await,
            );
        }
        assert_eq!(served, vec![Some(1), Some(1), Some(1)]);
        tokio::time::sleep(Duration::from_millis(150)).await;
        // One initial fetch plus exactly one background refresh.
        assert_eq!(hits.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn failure_keeps_the_last_good_value_and_backs_off() {
        static C: SwrCache<&'static str, u32> =
            SwrCache::new(Duration::from_millis(10), Duration::from_secs(60), 8);
        assert_eq!(
            C.get("k", Duration::from_secs(1), || async { Fetched::Ok(5) })
                .await,
            Some(5)
        );
        tokio::time::sleep(Duration::from_millis(30)).await;
        let attempts = Arc::new(AtomicUsize::new(0));
        for _ in 0..3 {
            let a = attempts.clone();
            let v = C
                .get("k", Duration::from_secs(1), move || async move {
                    a.fetch_add(1, Ordering::SeqCst);
                    Fetched::Failed
                })
                .await;
            assert_eq!(v, Some(5));
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn dead_source_with_nothing_cached_is_asked_once_per_backoff() {
        static C: SwrCache<&'static str, u32> =
            SwrCache::new(Duration::from_secs(60), Duration::from_secs(60), 8);
        let attempts = Arc::new(AtomicUsize::new(0));
        for _ in 0..3 {
            let a = attempts.clone();
            let v = C
                .get("k", Duration::from_secs(1), move || async move {
                    a.fetch_add(1, Ordering::SeqCst);
                    Fetched::Failed
                })
                .await;
            assert_eq!(v, None);
        }
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn oldest_entry_is_evicted_beyond_the_cap() {
        static C: SwrCache<&'static str, u32> =
            SwrCache::new(Duration::from_secs(60), Duration::from_secs(60), 2);
        for (k, v) in [("a", 1), ("b", 2), ("c", 3)] {
            C.get(
                k,
                Duration::from_secs(1),
                move || async move { Fetched::Ok(v) },
            )
            .await;
            tokio::time::sleep(Duration::from_millis(3)).await;
        }
        assert!(C.peek(&"a").is_none());
        assert!(C.peek(&"b").is_some() && C.peek(&"c").is_some());
    }
}
