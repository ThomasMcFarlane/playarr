//! [`PostgresListenNotify`] — the [`crate::CacheAndPubSub`] implementation
//! for [`streamarr_config::DeploymentTier::MultiNodePostgres`] (Postgres
//! without Redis): `LISTEN`/`NOTIFY` for pub/sub, backed by a small cache
//! table (`cache_entries`, see `backend/migrations/postgres/0003_cache_entries.sql`)
//! for get/set/delete since `NOTIFY` alone has no storage of its own.
//!
//! `NOTIFY` payloads must be text, but [`crate::CacheAndPubSub::publish`]
//! takes an arbitrary `Vec<u8>`, so [`PostgresListenNotify::publish`]
//! base64-encodes the payload for the wire and [`PostgresListenNotify::subscribe`]'s
//! background listener decodes it back on receipt — see [`encode_payload`]/
//! [`decode_payload`]. Postgres also hard-caps a `NOTIFY` payload at 8000
//! bytes; [`encode_payload`] enforces that against the *encoded* length and
//! fails fast rather than letting the database reject it, since a caller
//! that wants to publish something bigger needs to know to pass a
//! reference (an id to re-fetch via `get`) instead.

use std::sync::Mutex;
use std::time::Duration;

use async_trait::async_trait;
use base64::Engine;
use chrono::{DateTime, Utc};
use sqlx::postgres::PgListener;
use tokio::sync::broadcast;
use tokio::task::JoinHandle;

use crate::channel_registry::ChannelRegistry;
use crate::{CacheAndPubSub, CacheError, Subscription};

/// Postgres's own hard cap on a `NOTIFY` payload, in bytes — this is the
/// limit on the base64-*encoded* string actually sent over the wire (see
/// module doc comment), not on the raw pre-encoding payload.
const MAX_NOTIFY_PAYLOAD_BYTES: usize = 8000;

/// How often the background sweep clears expired `cache_entries` rows.
/// Purely space reclamation, not a correctness concern — `get` already
/// filters `expires_at` itself, so an unswept expired row simply reads as
/// absent until the next sweep removes it. 60s keeps dead rows from
/// accumulating for long without adding meaningful load.
const SWEEP_INTERVAL: Duration = Duration::from_secs(60);

/// Fixed delay before retrying a dropped `LISTEN` connection. See
/// `redis.rs`'s identically-named/valued constant for why this is a fixed
/// delay rather than a full backoff policy — same reasoning, same
/// deferred scope (TODO there applies here too).
const RECONNECT_DELAY: Duration = Duration::from_secs(2);

pub struct PostgresListenNotify {
    pool: sqlx::PgPool,
    /// One background `LISTEN` task per distinct subscribed channel name;
    /// see [`crate::channel_registry`]'s doc comment for the shared
    /// pattern this and `Redis::subscribe` both follow.
    registry: ChannelRegistry,
    /// Handles for the sweep task and every `run_listener` task, kept only
    /// so [`Drop`] can abort them — nothing else reads this field.
    background_tasks: Mutex<Vec<JoinHandle<()>>>,
}

impl PostgresListenNotify {
    /// Must be called from within a Tokio runtime, like every other
    /// constructor of an async-capable type in this codebase (e.g.
    /// `streamarr_coordination::PostgresCoordinator`) — it spawns the
    /// periodic sweep task immediately so callers don't need a separate
    /// "start background work" step.
    pub fn new(pool: sqlx::PgPool) -> Self {
        let sweep_handle = tokio::spawn(Self::run_sweeper(pool.clone()));
        Self {
            pool,
            registry: ChannelRegistry::new(),
            background_tasks: Mutex::new(vec![sweep_handle]),
        }
    }

    async fn run_sweeper(pool: sqlx::PgPool) {
        let mut interval = tokio::time::interval(SWEEP_INTERVAL);
        // The first tick fires immediately; skip it so a freshly
        // constructed instance doesn't run a (harmless but pointless)
        // sweep before anything could possibly have expired yet.
        interval.tick().await;
        loop {
            interval.tick().await;
            if let Err(e) = sqlx::query(
                "DELETE FROM cache_entries WHERE expires_at IS NOT NULL AND expires_at <= now()",
            )
            .execute(&pool)
            .await
            {
                tracing::warn!(error = %e, "cache_entries sweep failed");
            }
        }
    }

    /// Runs for the rest of the process's life once spawned — see
    /// `Redis::run_listener`'s doc comment for why leaking one dedicated
    /// connection per distinct channel name for the process's lifetime is
    /// an acceptable simplification here.
    async fn run_listener(pool: sqlx::PgPool, channel: String, sender: broadcast::Sender<Vec<u8>>) {
        loop {
            if let Err(e) = Self::listen_once(&pool, &channel, &sender).await {
                tracing::warn!(
                    error = %e,
                    channel = %channel,
                    "postgres LISTEN connection failed, reconnecting"
                );
            }
            tokio::time::sleep(RECONNECT_DELAY).await;
        }
    }

    /// Opens one dedicated `LISTEN` connection and forwards notifications
    /// on `channel` onto `sender` until the connection errors (there is no
    /// clean/graceful end to a `PgListener::recv` loop — every
    /// disconnection surfaces as an `Err`, which is why this always
    /// returns `Err`, never `Ok`, and the caller's job is only ever to
    /// decide whether/when to reconnect).
    async fn listen_once(
        pool: &sqlx::PgPool,
        channel: &str,
        sender: &broadcast::Sender<Vec<u8>>,
    ) -> Result<(), CacheError> {
        // `connect_with` opens a connection using the pool's connect
        // options rather than checking one out of the pool itself — held
        // open for this loop's whole lifetime. Never a connection
        // borrowed-and-returned per query, which would silently drop the
        // subscription the moment sqlx returned it to the pool.
        let mut listener = PgListener::connect_with(pool)
            .await
            .map_err(|e| CacheError::Backend(e.to_string()))?;
        listener
            .listen(channel)
            .await
            .map_err(|e| CacheError::Backend(e.to_string()))?;

        loop {
            let notification = listener
                .recv()
                .await
                .map_err(|e| CacheError::Backend(e.to_string()))?;
            match decode_payload(notification.payload()) {
                Ok(bytes) => {
                    // Errors here mean zero local receivers right now,
                    // which is normal (nobody happens to be listening this
                    // instant), not a failure — same fire-and-forget
                    // semantics `publish` documents.
                    let _ = sender.send(bytes);
                }
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        channel = %channel,
                        "dropping malformed NOTIFY payload"
                    );
                }
            }
        }
    }
}

impl Drop for PostgresListenNotify {
    fn drop(&mut self) {
        if let Ok(tasks) = self.background_tasks.lock() {
            for task in tasks.iter() {
                task.abort();
            }
        }
    }
}

/// Base64-encodes `payload` for transport as a `NOTIFY` text argument,
/// rejecting anything that would exceed Postgres's 8000-byte payload cap
/// once encoded. Pure/sync so it's unit-testable without a database.
fn encode_payload(payload: &[u8]) -> Result<String, CacheError> {
    let encoded = base64::engine::general_purpose::STANDARD.encode(payload);
    if encoded.len() > MAX_NOTIFY_PAYLOAD_BYTES {
        return Err(CacheError::Backend(format!(
            "payload too large for NOTIFY: {} raw bytes encode to {} bytes, over the {}-byte \
             limit (publish a reference/id instead and let subscribers `get` the full value)",
            payload.len(),
            encoded.len(),
            MAX_NOTIFY_PAYLOAD_BYTES,
        )));
    }
    Ok(encoded)
}

/// Inverse of [`encode_payload`].
fn decode_payload(encoded: &str) -> Result<Vec<u8>, CacheError> {
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| CacheError::Backend(format!("malformed NOTIFY payload: {e}")))
}

/// `ttl: None` maps to "never expires" (`NULL` in `cache_entries.expires_at`);
/// `Some(ttl)` maps to `now() + ttl`, computed application-side (rather
/// than in SQL via an interval literal) so it's unit-testable without a
/// database.
fn expiry_from_ttl(ttl: Option<Duration>) -> Option<DateTime<Utc>> {
    let ttl = ttl?;
    // `Duration::MAX`-scale values would overflow `chrono::Duration`
    // (which is bounded, unlike `std::time::Duration`); treating that as
    // "no expiry" is more useful than erroring, and no real caller passes
    // a TTL anywhere near that scale.
    chrono::Duration::from_std(ttl)
        .ok()
        .and_then(|ttl| Utc::now().checked_add_signed(ttl))
}

#[async_trait]
impl CacheAndPubSub for PostgresListenNotify {
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, CacheError> {
        sqlx::query_scalar::<_, Vec<u8>>(
            "SELECT value FROM cache_entries \
             WHERE key = $1 AND (expires_at IS NULL OR expires_at > now())",
        )
        .bind(key)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| CacheError::Backend(e.to_string()))
    }

    async fn set(
        &self,
        key: &str,
        value: Vec<u8>,
        ttl: Option<Duration>,
    ) -> Result<(), CacheError> {
        let expires_at = expiry_from_ttl(ttl);
        sqlx::query(
            "INSERT INTO cache_entries (key, value, expires_at) VALUES ($1, $2, $3) \
             ON CONFLICT (key) DO UPDATE \
               SET value = excluded.value, expires_at = excluded.expires_at",
        )
        .bind(key)
        .bind(value)
        .bind(expires_at)
        .execute(&self.pool)
        .await
        .map_err(|e| CacheError::Backend(e.to_string()))?;
        Ok(())
    }

    async fn delete(&self, key: &str) -> Result<(), CacheError> {
        sqlx::query("DELETE FROM cache_entries WHERE key = $1")
            .bind(key)
            .execute(&self.pool)
            .await
            .map_err(|e| CacheError::Backend(e.to_string()))?;
        Ok(())
    }

    async fn publish(&self, channel: &str, payload: Vec<u8>) -> Result<(), CacheError> {
        let encoded = encode_payload(&payload)?;
        sqlx::query("SELECT pg_notify($1, $2)")
            .bind(channel)
            .bind(encoded)
            .execute(&self.pool)
            .await
            .map_err(|e| CacheError::Backend(e.to_string()))?;
        Ok(())
    }

    async fn subscribe(&self, channel: &str) -> Result<Subscription, CacheError> {
        let (receiver, sender, should_spawn_listener) = self.registry.subscribe(channel);
        if should_spawn_listener {
            let handle = tokio::spawn(Self::run_listener(
                self.pool.clone(),
                channel.to_string(),
                sender,
            ));
            self.background_tasks
                .lock()
                .expect("background task registry poisoned")
                .push(handle);
        }
        Ok(receiver)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Everything below is testable without a live Postgres: base64
    // encoding, the NOTIFY size-limit check, and TTL-to-timestamp
    // arithmetic are all pure, local logic with no I/O. `get`/`set`/
    // `delete` against `cache_entries`, the periodic sweep actually
    // deleting rows, and `LISTEN`/`NOTIFY` delivery itself all require
    // integration testing against a live Postgres instance (with
    // `backend/migrations/postgres/0003_cache_entries.sql` applied) —
    // deliberately not covered here per this task's scope (no live
    // Postgres is spun up in this crate's tests).

    #[test]
    fn payload_round_trips_through_encode_decode() {
        let payload = b"hello, notify".to_vec();
        let encoded = encode_payload(&payload).unwrap();
        let decoded = decode_payload(&encoded).unwrap();
        assert_eq!(decoded, payload);
    }

    #[test]
    fn empty_payload_round_trips() {
        let encoded = encode_payload(&[]).unwrap();
        assert_eq!(decode_payload(&encoded).unwrap(), Vec::<u8>::new());
    }

    #[test]
    fn arbitrary_binary_payload_round_trips() {
        let payload: Vec<u8> = (0u8..=255).collect();
        let encoded = encode_payload(&payload).unwrap();
        assert_eq!(decode_payload(&encoded).unwrap(), payload);
    }

    #[test]
    fn payload_within_the_postgres_notify_cap_is_accepted() {
        // Base64 inflates by ~4/3; pick a raw size that lands comfortably
        // under the 8000-byte *encoded* cap.
        let payload = vec![0u8; 5000];
        assert!(encode_payload(&payload).is_ok());
    }

    #[test]
    fn payload_over_the_postgres_notify_cap_is_rejected() {
        let payload = vec![0u8; 7000]; // encodes to > 8000 bytes
        let err = encode_payload(&payload).unwrap_err();
        assert!(matches!(err, CacheError::Backend(_)));
    }

    #[test]
    fn payload_right_at_the_boundary_is_accepted() {
        // 6000 raw bytes -> exactly 8000 base64 bytes (6000 / 3 * 4).
        let payload = vec![0u8; 6000];
        assert!(encode_payload(&payload).is_ok());
    }

    #[test]
    fn malformed_base64_fails_to_decode() {
        assert!(decode_payload("not valid base64!!!").is_err());
    }

    #[test]
    fn no_ttl_means_no_expiry() {
        assert_eq!(expiry_from_ttl(None), None);
    }

    #[test]
    fn ttl_maps_to_a_timestamp_offset_by_roughly_the_ttl() {
        let ttl = Duration::from_secs(60);
        let before = Utc::now();
        let expires_at = expiry_from_ttl(Some(ttl)).expect("Some(ttl) must produce Some(expiry)");
        let after = Utc::now();

        let ttl_signed = chrono::Duration::from_std(ttl).unwrap();
        assert!(expires_at >= before + ttl_signed);
        assert!(expires_at <= after + ttl_signed);
    }

    #[test]
    fn zero_ttl_expiry_is_not_in_the_past() {
        let expires_at = expiry_from_ttl(Some(Duration::ZERO)).unwrap();
        assert!(expires_at >= Utc::now() - chrono::Duration::seconds(1));
    }
}
