//! `playarr-cache` — a cache + pub/sub abstraction, so the rest of the
//! backend (catalog read caching, playback session fan-out to whichever
//! SSE/websocket client is connected) codes against one trait.
//!
//! The one implementation is [`InMemory`] (moka + local broadcast): Playarr
//! is SQLite-only (ADR 0002), one process per database, so every subscriber
//! lives in the same process. Multi-node deployments share state through
//! peer sync, not through a shared cache.
//!
//! Get/set/delete and publish/subscribe are combined on one trait
//! ([`CacheAndPubSub`]) because both are backed by the same resource (one
//! moka cache + one broadcast registry).
// `async_trait` expansions trip clippy::double_must_use on current stable.
#![allow(clippy::double_must_use)]

mod in_memory;

use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::broadcast;

pub use in_memory::InMemory;

#[derive(Debug, thiserror::Error)]
pub enum CacheError {
    #[error("backend error: {0}")]
    Backend(String),
    #[error("no subscribers or channel already closed")]
    ChannelClosed,
}

/// The channel type every [`CacheAndPubSub::subscribe`] implementation
/// hands back. A `tokio::sync::broadcast::Receiver` rather than a boxed
/// `Stream`, which avoids a needless boxing/dyn-Stream layer.
pub type Subscription = broadcast::Receiver<Vec<u8>>;

#[async_trait]
pub trait CacheAndPubSub: Send + Sync {
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, CacheError>;

    /// `ttl: None` means "no expiry" (cache until evicted/overwritten).
    async fn set(&self, key: &str, value: Vec<u8>, ttl: Option<Duration>)
        -> Result<(), CacheError>;

    async fn delete(&self, key: &str) -> Result<(), CacheError>;

    /// Fire-and-forget publish; `Ok(())` does not guarantee any subscriber
    /// received it (pub/sub, not a durable queue).
    async fn publish(&self, channel: &str, payload: Vec<u8>) -> Result<(), CacheError>;

    /// Subscribes to `channel`, creating it if this is the first
    /// subscriber. The returned [`Subscription`] only observes messages
    /// published *after* the call returns.
    async fn subscribe(&self, channel: &str) -> Result<Subscription, CacheError>;
}
