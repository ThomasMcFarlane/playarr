//! Short-lived shared snapshot of this node's own derived leaf availability.
//!
//! Deriving it walks every work with a media file, builds the work's whole
//! catalogue tree and stats every file, so on a large library one derivation
//! takes many seconds of CPU. A node runs it for each peer's pull of
//! `GET /api/v1/peer/availability` and again for its own push to each peer,
//! all of them on a roughly one-minute cadence. Callers share one snapshot
//! instead, and callers arriving while a derivation runs wait for it rather
//! than starting their own.
//!
//! The price is staleness: a file that appears or disappears is reflected in
//! the next snapshot, at most [`OwnAvailabilityCache::ttl`] later. Peers use
//! availability as a routing hint and refresh it every minute, so a short
//! delay changes nothing they can observe beyond that. Errors are never
//! cached.

use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use tokio::sync::Mutex;

/// How long a derived snapshot is reused.
pub const DEFAULT_TTL: Duration = Duration::from_secs(120);

/// How old a snapshot may be and still be served while a fresh one is derived
/// in the background (see [`OwnAvailabilityCache::get_or_refresh`]).
pub const DEFAULT_MAX_STALE: Duration = Duration::from_secs(15 * 60);

/// One cached value with single-flight refresh.
pub struct OwnAvailabilityCache<T> {
    ttl: Duration,
    /// The snapshot. Only ever locked for an instant, never across an await,
    /// so a caller that can use a stale value is never held up by a derivation.
    slot: StdMutex<Option<(Instant, Arc<T>)>>,
    /// Held while deriving, so concurrent derivations share one run.
    derive_lock: Mutex<()>,
    /// A background refresh is queued or running.
    refreshing: AtomicBool,
    /// Longest a background derivation may run before it is dropped, which
    /// frees the derive lock (a hung network mount would otherwise hold it
    /// for ever).
    derive_timeout: Duration,
}

/// Clears the `refreshing` flag when the background task ends, however it ends
/// (finished, timed out or panicked).
struct RefreshingGuard<'a>(&'a AtomicBool);

impl Drop for RefreshingGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

/// Default for [`OwnAvailabilityCache::with_derive_timeout`].
pub const DEFAULT_DERIVE_TIMEOUT: Duration = Duration::from_secs(5 * 60);

impl<T> OwnAvailabilityCache<T> {
    pub fn new(ttl: Duration) -> Self {
        Self {
            ttl,
            slot: StdMutex::new(None),
            derive_lock: Mutex::new(()),
            refreshing: AtomicBool::new(false),
            derive_timeout: DEFAULT_DERIVE_TIMEOUT,
        }
    }

    /// Sets how long a background derivation may run.
    pub fn with_derive_timeout(mut self, timeout: Duration) -> Self {
        self.derive_timeout = timeout;
        self
    }

    pub fn ttl(&self) -> Duration {
        self.ttl
    }

    /// The snapshot and its age, if there is one.
    fn peek(&self) -> Option<(Duration, Arc<T>)> {
        let slot = self.slot.lock().unwrap_or_else(|e| e.into_inner());
        slot.as_ref()
            .map(|(at, value)| (at.elapsed(), value.clone()))
    }

    fn fresh(&self) -> Option<Arc<T>> {
        self.peek()
            .filter(|(age, _)| *age < self.ttl)
            .map(|(_, value)| value)
    }

    fn store(&self, value: Arc<T>) {
        *self.slot.lock().unwrap_or_else(|e| e.into_inner()) = Some((Instant::now(), value));
    }

    /// The cached value when it is younger than the TTL, otherwise the result
    /// of `derive`, which is then cached. The derive lock is held while
    /// deriving, so concurrent callers share that one derivation.
    pub async fn get_or_derive<E, F, Fut>(&self, derive: F) -> Result<Arc<T>, E>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, E>>,
    {
        if let Some(value) = self.fresh() {
            return Ok(value);
        }
        let _deriving = self.derive_lock.lock().await;
        // Another caller may have derived while this one waited.
        if let Some(value) = self.fresh() {
            return Ok(value);
        }
        let value = Arc::new(derive().await?);
        self.store(value.clone());
        Ok(value)
    }
}

impl<T: Send + Sync + 'static> OwnAvailabilityCache<T> {
    /// Like [`get_or_derive`](Self::get_or_derive), but a snapshot older than
    /// the TTL and younger than `max_stale` is returned at once while one
    /// background task derives the next. Only a caller that finds no snapshot,
    /// or one older than `max_stale`, waits for a derivation.
    ///
    /// A derivation on a large library takes minutes. Waiting for it under the
    /// lock made every peer pull that arrived meanwhile wait as long (minutes,
    /// with the peers retrying on top). Peers use the rows as a routing hint
    /// and refresh them every minute, so a snapshot a few minutes old changes
    /// nothing they can observe. A failed background derivation is logged and
    /// the stale snapshot stays until `max_stale` passes.
    pub async fn get_or_refresh<E, F, Fut>(
        self: &Arc<Self>,
        max_stale: Duration,
        derive: F,
    ) -> Result<Arc<T>, E>
    where
        E: std::fmt::Debug + Send + 'static,
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<T, E>> + Send + 'static,
    {
        match self.peek() {
            Some((age, value)) if age < self.ttl => Ok(value),
            // A zero TTL means no caching at all, stale serving included.
            Some((age, value)) if age < max_stale && !self.ttl.is_zero() => {
                if !self.refreshing.swap(true, Ordering::AcqRel) {
                    let cache = self.clone();
                    tokio::spawn(async move {
                        let _reset = RefreshingGuard(&cache.refreshing);
                        match tokio::time::timeout(cache.derive_timeout, cache.get_or_derive(derive))
                            .await
                        {
                            Ok(Ok(_)) => {}
                            Ok(Err(err)) => tracing::warn!(
                                error = ?err,
                                "refreshing the own availability snapshot failed; serving the previous one"
                            ),
                            Err(_) => tracing::warn!(
                                timeout_s = cache.derive_timeout.as_secs(),
                                "refreshing the own availability snapshot timed out; serving the previous one"
                            ),
                        }
                    });
                }
                Ok(value)
            }
            _ => self.get_or_derive(derive).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    #[tokio::test]
    async fn reuses_the_snapshot_within_the_ttl_and_rederives_after_it() {
        let cache = OwnAvailabilityCache::new(Duration::from_millis(80));
        let calls = AtomicUsize::new(0);
        let derive = || async { Ok::<_, ()>(calls.fetch_add(1, Ordering::SeqCst)) };
        assert_eq!(*cache.get_or_derive(derive).await.unwrap(), 0);
        assert_eq!(*cache.get_or_derive(derive).await.unwrap(), 0);
        tokio::time::sleep(Duration::from_millis(120)).await;
        assert_eq!(*cache.get_or_derive(derive).await.unwrap(), 1);
    }

    #[tokio::test]
    async fn concurrent_callers_share_one_derivation() {
        let cache = Arc::new(OwnAvailabilityCache::new(Duration::from_secs(60)));
        let calls = Arc::new(AtomicUsize::new(0));
        let mut tasks = Vec::new();
        for _ in 0..8 {
            let (cache, calls) = (cache.clone(), calls.clone());
            tasks.push(tokio::spawn(async move {
                cache
                    .get_or_derive(|| async {
                        tokio::time::sleep(Duration::from_millis(50)).await;
                        Ok::<_, ()>(calls.fetch_add(1, Ordering::SeqCst))
                    })
                    .await
                    .unwrap()
            }));
        }
        for task in tasks {
            assert_eq!(*task.await.unwrap(), 0);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn errors_are_not_cached() {
        let cache = OwnAvailabilityCache::new(Duration::from_secs(60));
        assert!(cache
            .get_or_derive(|| async { Err::<u8, _>("boom") })
            .await
            .is_err());
        assert_eq!(
            *cache
                .get_or_derive(|| async { Ok::<_, &str>(7u8) })
                .await
                .unwrap(),
            7
        );
    }

    #[tokio::test]
    async fn a_zero_ttl_never_reuses() {
        let cache = OwnAvailabilityCache::new(Duration::ZERO);
        let calls = AtomicUsize::new(0);
        let derive = || async { Ok::<_, ()>(calls.fetch_add(1, Ordering::SeqCst)) };
        assert_eq!(*cache.get_or_derive(derive).await.unwrap(), 0);
        assert_eq!(*cache.get_or_derive(derive).await.unwrap(), 1);
    }

    #[tokio::test]
    async fn a_stale_snapshot_is_served_at_once_while_one_background_derivation_runs() {
        let cache = Arc::new(OwnAvailabilityCache::new(Duration::from_millis(20)));
        let calls = Arc::new(AtomicUsize::new(0));
        let release = Arc::new(tokio::sync::Notify::new());
        let derive = |calls: Arc<AtomicUsize>, release: Option<Arc<tokio::sync::Notify>>| {
            move || async move {
                let n = calls.fetch_add(1, Ordering::SeqCst);
                if let Some(release) = release {
                    release.notified().await;
                }
                Ok::<_, ()>(n)
            }
        };
        let max_stale = Duration::from_secs(60);
        assert_eq!(
            *cache
                .get_or_refresh(max_stale, derive(calls.clone(), None))
                .await
                .unwrap(),
            0
        );
        tokio::time::sleep(Duration::from_millis(40)).await;
        // The refresh blocks until released, yet every caller answers at once
        // with the previous snapshot, and only one derivation starts.
        for _ in 0..5 {
            let answered = tokio::time::timeout(
                Duration::from_millis(500),
                cache.get_or_refresh(max_stale, derive(calls.clone(), Some(release.clone()))),
            )
            .await
            .expect("a stale snapshot must not wait for the derivation")
            .unwrap();
            assert_eq!(*answered, 0);
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(calls.load(Ordering::SeqCst), 2, "one initial, one refresh");
        release.notify_one();
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(
            *cache
                .get_or_refresh(max_stale, derive(calls.clone(), None))
                .await
                .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn a_snapshot_older_than_max_stale_is_waited_for() {
        let cache = Arc::new(OwnAvailabilityCache::new(Duration::from_millis(10)));
        let calls = Arc::new(AtomicUsize::new(0));
        let derive = |calls: Arc<AtomicUsize>| {
            move || async move { Ok::<_, ()>(calls.fetch_add(1, Ordering::SeqCst)) }
        };
        let max_stale = Duration::from_millis(40);
        cache
            .get_or_refresh(max_stale, derive(calls.clone()))
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(80)).await;
        assert_eq!(
            *cache
                .get_or_refresh(max_stale, derive(calls.clone()))
                .await
                .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn a_failed_background_refresh_keeps_the_stale_snapshot() {
        let cache = Arc::new(OwnAvailabilityCache::new(Duration::from_millis(10)));
        let max_stale = Duration::from_secs(60);
        cache
            .get_or_refresh(max_stale, || async { Ok::<_, &'static str>(7u8) })
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(30)).await;
        let served = cache
            .get_or_refresh(max_stale, || async { Err::<u8, _>("boom") })
            .await
            .unwrap();
        assert_eq!(*served, 7);
        tokio::time::sleep(Duration::from_millis(30)).await;
        let again = cache
            .get_or_refresh(max_stale, || async { Err::<u8, _>("boom") })
            .await
            .unwrap();
        assert_eq!(*again, 7);
    }

    #[tokio::test]
    async fn a_panicking_background_refresh_does_not_stop_later_refreshes() {
        let cache = Arc::new(OwnAvailabilityCache::new(Duration::from_millis(10)));
        let calls = Arc::new(AtomicUsize::new(0));
        let max_stale = Duration::from_secs(60);
        cache
            .get_or_refresh(max_stale, || async { Ok::<_, ()>(0usize) })
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(30)).await;
        let c = calls.clone();
        cache
            .get_or_refresh(max_stale, move || async move {
                c.fetch_add(1, Ordering::SeqCst);
                if true {
                    panic!("derive panicked");
                }
                Ok::<_, ()>(1usize)
            })
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        let c = calls.clone();
        let served = cache
            .get_or_refresh(max_stale, move || async move {
                c.fetch_add(1, Ordering::SeqCst);
                Ok::<_, ()>(2usize)
            })
            .await
            .unwrap();
        assert_eq!(*served, 0, "still the stale snapshot");
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(calls.load(Ordering::SeqCst), 2, "a second derivation ran");
    }

    #[tokio::test]
    async fn a_hung_derivation_is_dropped_and_frees_the_lock() {
        let cache = Arc::new(
            OwnAvailabilityCache::new(Duration::from_millis(10))
                .with_derive_timeout(Duration::from_millis(100)),
        );
        let max_stale = Duration::from_millis(60);
        cache
            .get_or_refresh(max_stale, || async { Ok::<_, ()>(0usize) })
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
        // Served stale; the background derivation never finishes.
        cache
            .get_or_refresh(max_stale, || async {
                std::future::pending::<()>().await;
                Ok::<_, ()>(1usize)
            })
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(80)).await;
        // Past max_stale, this caller must wait for the lock, which the
        // timeout frees.
        let value = tokio::time::timeout(
            Duration::from_secs(5),
            cache.get_or_refresh(max_stale, || async { Ok::<_, ()>(2usize) }),
        )
        .await
        .expect("a hung derivation must not hold the lock for ever")
        .unwrap();
        assert_eq!(*value, 2);
    }
}
