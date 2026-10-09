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
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::Mutex;

/// How long a derived snapshot is reused.
pub const DEFAULT_TTL: Duration = Duration::from_secs(120);

/// One cached value with single-flight refresh.
pub struct OwnAvailabilityCache<T> {
    ttl: Duration,
    slot: Mutex<Option<(Instant, Arc<T>)>>,
}

impl<T> OwnAvailabilityCache<T> {
    pub fn new(ttl: Duration) -> Self {
        Self {
            ttl,
            slot: Mutex::new(None),
        }
    }

    pub fn ttl(&self) -> Duration {
        self.ttl
    }

    /// The cached value when it is younger than the TTL, otherwise the result
    /// of `derive`, which is then cached. The lock is held while deriving, so
    /// concurrent callers share that one derivation.
    pub async fn get_or_derive<E, F, Fut>(&self, derive: F) -> Result<Arc<T>, E>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, E>>,
    {
        let mut slot = self.slot.lock().await;
        if let Some((at, value)) = slot.as_ref() {
            if at.elapsed() < self.ttl {
                return Ok(value.clone());
            }
        }
        let value = Arc::new(derive().await?);
        *slot = Some((Instant::now(), value.clone()));
        Ok(value)
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
}
