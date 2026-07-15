//! `streamarr-cache` — a cache + pub/sub abstraction, so the rest of the
//! backend (catalog read caching, playback session fan-out to whichever
//! node an SSE/websocket client is connected to) codes against one trait
//! regardless of `streamarr_config::DeploymentTier`.
//!
//! Three implementations ship here: [`InMemory`] (moka + local
//! broadcast, for [`streamarr_config::DeploymentTier::SingleNode`]),
//! [`Redis`] (for [`streamarr_config::DeploymentTier::MultiNodePostgresRedis`]),
//! and [`PostgresListenNotify`] (`LISTEN`/`NOTIFY` plus a table-backed
//! cache, for [`streamarr_config::DeploymentTier::MultiNodePostgres`]).
//!
//! Get/set/delete and publish/subscribe are combined on one trait
//! ([`CacheAndPubSub`]) rather than split into two, because every
//! implementation here backs both with the same connection/resource (one
//! moka cache + one broadcast registry; one Redis connection pool; one
//! Postgres connection for `LISTEN`/`NOTIFY`), so splitting the trait would
//! only push that coupling into every call site instead of removing it.

mod channel_registry;
mod in_memory;
mod postgres_listen_notify;
mod redis;

use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::broadcast;

pub use in_memory::InMemory;
pub use postgres_listen_notify::PostgresListenNotify;
pub use redis::Redis;

#[derive(Debug, thiserror::Error)]
pub enum CacheError {
    #[error("backend error: {0}")]
    Backend(String),
    #[error("no subscribers or channel already closed")]
    ChannelClosed,
}

/// The channel type every [`CacheAndPubSub::subscribe`] implementation
/// hands back. A `tokio::sync::broadcast::Receiver` rather than a boxed
/// `Stream` — every backend here (in-memory, Redis, Postgres
/// `LISTEN`/`NOTIFY`) fundamentally works by bridging external
/// notifications onto an in-process broadcast channel, so returning the
/// concrete receiver type avoids a needless boxing/dyn-Stream layer on top
/// of that bridge.
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
