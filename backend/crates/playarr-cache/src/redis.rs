//! [`Redis`] — the [`crate::CacheAndPubSub`] implementation for
//! [`playarr_config::DeploymentTier::MultiNodePostgresRedis`].
//!
//! `get`/`set`/`delete`/`publish` run over a single shared
//! `redis::aio::ConnectionManager` (multiplexed, auto-reconnecting, cheap
//! to clone — safe to hand a fresh clone to every call). `subscribe` opens
//! a *separate*, dedicated `redis::aio::PubSub` connection per distinct
//! channel name — Redis pub/sub connections can't multiplex regular
//! commands once subscribed, so they can't share the `ConnectionManager` —
//! and bridges it onto a local `tokio::sync::broadcast` channel via
//! [`crate::channel_registry::ChannelRegistry`], so however many local
//! callers subscribe to the same channel name, only one upstream Redis
//! subscription is ever opened for it.

use std::sync::Mutex;
use std::time::Duration;

use async_trait::async_trait;
use futures::StreamExt;
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use tokio::sync::{broadcast, OnceCell};
use tokio::task::JoinHandle;

use crate::channel_registry::ChannelRegistry;
use crate::{CacheAndPubSub, CacheError, Subscription};

/// Fixed delay before retrying a dropped pub/sub connection.
///
/// TODO: a full exponential-backoff-with-jitter retry policy (and a cap on
/// total retries, surfaced as a health signal) is deferred — out of scope
/// for this first real implementation. A fixed delay is a reasonable
/// starting point: it bounds reconnect frequency without needing any extra
/// state, and Redis pub/sub reconnects are cheap/idempotent (just
/// `SUBSCRIBE` again).
const RECONNECT_DELAY: Duration = Duration::from_secs(2);

pub struct Redis {
    connection_url: String,
    /// Lazily established on first use (see [`Redis::connection`]) since
    /// [`Redis::new`] is synchronous/infallible but connecting is
    /// inherently async/fallible. Cloning a `ConnectionManager` is cheap
    /// (it's an `Arc` around the real connection state), so every call
    /// grabs its own clone rather than holding a lock across an `.await`.
    connection_manager: OnceCell<ConnectionManager>,
    /// One background listener task per distinct subscribed channel name;
    /// see the module doc comment.
    registry: ChannelRegistry,
    /// Handles for [`Redis::run_listener`] tasks, kept only so [`Drop`] can
    /// abort them — nothing else reads this field.
    listener_tasks: Mutex<Vec<JoinHandle<()>>>,
}

impl Redis {
    pub fn new(connection_url: impl Into<String>) -> Self {
        Self {
            connection_url: connection_url.into(),
            connection_manager: OnceCell::new(),
            registry: ChannelRegistry::new(),
            listener_tasks: Mutex::new(Vec::new()),
        }
    }

    /// Returns a clone of the shared, auto-reconnecting connection,
    /// establishing it on first call. `redis::Client::open` only parses
    /// `connection_url` (no I/O — an invalid URL fails here, fast, on the
    /// very first call rather than hanging); the actual TCP connect
    /// happens inside `ConnectionManager::new`.
    async fn connection(&self) -> Result<ConnectionManager, CacheError> {
        self.connection_manager
            .get_or_try_init(|| async {
                let client = redis::Client::open(self.connection_url.as_str())
                    .map_err(|e| CacheError::Backend(e.to_string()))?;
                ConnectionManager::new(client)
                    .await
                    .map_err(|e| CacheError::Backend(e.to_string()))
            })
            .await
            .cloned()
    }

    /// Runs for the rest of the process's life once spawned — there is no
    /// unsubscribe/refcounting to tear it down early. That's a deliberate
    /// simplification: the channel names this crate is used for (playback
    /// sessions, catalog invalidation topics) are few and long-lived
    /// relative to individual subscriber lifetimes, so leaking one Redis
    /// connection per distinct channel name for the process's lifetime is
    /// cheap. A refcounted teardown is TODO if that assumption stops
    /// holding.
    async fn run_listener(
        connection_url: String,
        channel: String,
        sender: broadcast::Sender<Vec<u8>>,
    ) {
        loop {
            if let Err(e) = Self::listen_once(&connection_url, &channel, &sender).await {
                tracing::warn!(
                    error = %e,
                    channel = %channel,
                    "redis pub/sub connection failed, reconnecting"
                );
            }
            tokio::time::sleep(RECONNECT_DELAY).await;
        }
    }

    /// Opens one dedicated pub/sub connection, subscribes to `channel`,
    /// and forwards every message onto `sender` until the connection ends
    /// (cleanly or otherwise). Returns once the stream ends so the caller
    /// can decide whether/when to reconnect.
    async fn listen_once(
        connection_url: &str,
        channel: &str,
        sender: &broadcast::Sender<Vec<u8>>,
    ) -> Result<(), CacheError> {
        let client =
            redis::Client::open(connection_url).map_err(|e| CacheError::Backend(e.to_string()))?;
        let mut pubsub = client
            .get_async_pubsub()
            .await
            .map_err(|e| CacheError::Backend(e.to_string()))?;
        pubsub
            .subscribe(channel)
            .await
            .map_err(|e| CacheError::Backend(e.to_string()))?;

        let mut messages = pubsub.into_on_message();
        while let Some(msg) = messages.next().await {
            // Errors here mean zero local receivers right now, which is
            // normal (nobody happens to be listening this instant), not a
            // failure — same fire-and-forget semantics `publish` documents.
            let _ = sender.send(msg.get_payload_bytes().to_vec());
        }
        Ok(())
    }
}

impl Drop for Redis {
    fn drop(&mut self) {
        if let Ok(tasks) = self.listener_tasks.lock() {
            for task in tasks.iter() {
                task.abort();
            }
        }
    }
}

#[async_trait]
impl CacheAndPubSub for Redis {
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, CacheError> {
        let mut conn = self.connection().await?;
        conn.get(key)
            .await
            .map_err(|e| CacheError::Backend(e.to_string()))
    }

    async fn set(
        &self,
        key: &str,
        value: Vec<u8>,
        ttl: Option<Duration>,
    ) -> Result<(), CacheError> {
        let mut conn = self.connection().await?;
        match ttl {
            Some(ttl) => {
                // `PX` (milliseconds) rather than `EX` (whole seconds) so a
                // sub-second TTL doesn't silently round down to zero/away
                // entirely.
                let options = redis::SetOptions::default()
                    .with_expiration(redis::SetExpiry::PX(ttl.as_millis() as u64));
                conn.set_options(key, value, options)
                    .await
                    .map_err(|e| CacheError::Backend(e.to_string()))
            }
            None => conn
                .set(key, value)
                .await
                .map_err(|e| CacheError::Backend(e.to_string())),
        }
    }

    async fn delete(&self, key: &str) -> Result<(), CacheError> {
        let mut conn = self.connection().await?;
        conn.del(key)
            .await
            .map_err(|e| CacheError::Backend(e.to_string()))
    }

    async fn publish(&self, channel: &str, payload: Vec<u8>) -> Result<(), CacheError> {
        let mut conn = self.connection().await?;
        conn.publish(channel, payload)
            .await
            .map_err(|e| CacheError::Backend(e.to_string()))
    }

    async fn subscribe(&self, channel: &str) -> Result<Subscription, CacheError> {
        let (receiver, sender, should_spawn_listener) = self.registry.subscribe(channel);
        if should_spawn_listener {
            let handle = tokio::spawn(Self::run_listener(
                self.connection_url.clone(),
                channel.to_string(),
                sender,
            ));
            self.listener_tasks
                .lock()
                .expect("listener task registry poisoned")
                .push(handle);
        }
        Ok(receiver)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Everything below is testable without a live Redis server: URL
    // parsing/validation is synchronous and local (`redis::Client::open`
    // never touches the network), and it's the only fallible, pure-ish
    // logic in this file that doesn't require an actual server round trip.
    // `get`/`set`/`delete`/`publish`/`subscribe` against a real Redis
    // instance, reconnect behavior in `run_listener`, and the
    // `ConnectionManager`'s own retry logic all require integration
    // testing against a live Redis — deliberately not covered here per
    // this task's scope (no live Redis is spun up in this crate's tests).

    #[tokio::test]
    async fn malformed_url_fails_fast_without_a_network_call() {
        // Not a `redis://`/`rediss://`/`redis+unix://` URL at all, so
        // `redis::Client::open` rejects it at parse time — this must
        // return quickly (bounded by the test's own timeout) rather than
        // hang trying to resolve/connect anywhere.
        let cache = Redis::new("not-a-redis-url");
        let result = tokio::time::timeout(Duration::from_secs(5), cache.get("some-key"))
            .await
            .expect("must fail fast, not hang");
        assert!(matches!(result, Err(CacheError::Backend(_))));
    }

    #[tokio::test]
    async fn malformed_url_error_is_consistent_across_calls() {
        // The parse failure is cached in `connection_manager` via
        // `get_or_try_init` only on success; a failed init does not
        // poison the `OnceCell`, so repeated calls each retry the parse
        // and each fail the same way rather than panicking on a poisoned
        // cell.
        let cache = Redis::new("also-not-a-redis-url");
        for _ in 0..3 {
            let result = tokio::time::timeout(Duration::from_secs(5), cache.delete("k"))
                .await
                .expect("must fail fast, not hang");
            assert!(matches!(result, Err(CacheError::Backend(_))));
        }
    }
}
