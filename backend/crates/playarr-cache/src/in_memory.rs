//! [`InMemory`] — the [`crate::CacheAndPubSub`] implementation for
//! [`playarr_config::DeploymentTier::SingleNode`]. Fully functional (not
//! a stub): a [`moka`] cache for get/set/delete, and a registry of
//! [`tokio::sync::broadcast`] channels for publish/subscribe. Correct by
//! construction for single-node deployments, since every subscriber lives
//! in this same process.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use tokio::sync::broadcast;

use crate::{CacheAndPubSub, CacheError, Subscription};

/// Per-channel broadcast buffer size: how many not-yet-received messages a
/// slow subscriber can lag behind by before it starts missing them (lagged
/// receivers get a `RecvError::Lagged` rather than blocking the publisher).
const CHANNEL_CAPACITY: usize = 256;

#[derive(Clone)]
struct CacheEntry {
    value: Vec<u8>,
    expires_at: Option<Instant>,
}

pub struct InMemory {
    store: moka::future::Cache<String, CacheEntry>,
    channels: Mutex<HashMap<String, broadcast::Sender<Vec<u8>>>>,
}

impl InMemory {
    /// A cache with a generous default capacity, suitable for dev/test and
    /// small single-node deployments. Use [`InMemory::with_max_capacity`]
    /// to size it for a specific workload.
    pub fn new() -> Self {
        Self::with_max_capacity(10_000)
    }

    pub fn with_max_capacity(max_capacity: u64) -> Self {
        Self {
            store: moka::future::Cache::builder()
                .max_capacity(max_capacity)
                .build(),
            channels: Mutex::new(HashMap::new()),
        }
    }

    fn channel(&self, name: &str) -> broadcast::Sender<Vec<u8>> {
        let mut channels = self.channels.lock().expect("channel registry poisoned");
        channels
            .entry(name.to_string())
            .or_insert_with(|| broadcast::channel(CHANNEL_CAPACITY).0)
            .clone()
    }
}

impl Default for InMemory {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl CacheAndPubSub for InMemory {
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, CacheError> {
        match self.store.get(key).await {
            Some(entry)
                if entry
                    .expires_at
                    .is_none_or(|deadline| Instant::now() < deadline) =>
            {
                Ok(Some(entry.value))
            }
            Some(_expired) => {
                self.store.invalidate(key).await;
                Ok(None)
            }
            None => Ok(None),
        }
    }

    async fn set(
        &self,
        key: &str,
        value: Vec<u8>,
        ttl: Option<Duration>,
    ) -> Result<(), CacheError> {
        let expires_at = ttl.map(|ttl| Instant::now() + ttl);
        self.store
            .insert(key.to_string(), CacheEntry { value, expires_at })
            .await;
        Ok(())
    }

    async fn delete(&self, key: &str) -> Result<(), CacheError> {
        self.store.invalidate(key).await;
        Ok(())
    }

    async fn publish(&self, channel: &str, payload: Vec<u8>) -> Result<(), CacheError> {
        // `send` errors only when there are zero receivers, which is
        // normal, expected pub/sub behavior (nobody happened to be
        // listening), not a failure — deliberately swallowed per the
        // trait's documented fire-and-forget semantics.
        let _ = self.channel(channel).send(payload);
        Ok(())
    }

    async fn subscribe(&self, channel: &str) -> Result<Subscription, CacheError> {
        Ok(self.channel(channel).subscribe())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn set_then_get_round_trips() {
        let cache = InMemory::new();
        cache.set("k", b"v".to_vec(), None).await.unwrap();
        assert_eq!(cache.get("k").await.unwrap(), Some(b"v".to_vec()));
    }

    #[tokio::test]
    async fn missing_key_is_none() {
        let cache = InMemory::new();
        assert_eq!(cache.get("missing").await.unwrap(), None);
    }

    #[tokio::test]
    async fn expired_entry_reads_as_none() {
        let cache = InMemory::new();
        cache
            .set("k", b"v".to_vec(), Some(Duration::from_millis(1)))
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(cache.get("k").await.unwrap(), None);
    }

    #[tokio::test]
    async fn delete_removes_entry() {
        let cache = InMemory::new();
        cache.set("k", b"v".to_vec(), None).await.unwrap();
        cache.delete("k").await.unwrap();
        assert_eq!(cache.get("k").await.unwrap(), None);
    }

    #[tokio::test]
    async fn publish_reaches_subscriber() {
        let cache = InMemory::new();
        let mut sub = cache.subscribe("chan").await.unwrap();
        cache.publish("chan", b"hello".to_vec()).await.unwrap();
        assert_eq!(sub.recv().await.unwrap(), b"hello");
    }

    #[tokio::test]
    async fn publish_with_no_subscribers_is_not_an_error() {
        let cache = InMemory::new();
        cache
            .publish("nobody-listening", b"hi".to_vec())
            .await
            .unwrap();
    }
}
