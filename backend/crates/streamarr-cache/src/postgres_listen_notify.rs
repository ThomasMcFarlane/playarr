//! [`PostgresListenNotify`] — the [`crate::CacheAndPubSub`] implementation
//! for [`streamarr_config::DeploymentTier::MultiNodePostgres`] (Postgres
//! without Redis): `LISTEN`/`NOTIFY` for pub/sub, backed by a small cache
//! table for get/set/delete since `NOTIFY` alone has no storage of its own.

use std::time::Duration;

use async_trait::async_trait;

use crate::{CacheAndPubSub, CacheError, Subscription};

pub struct PostgresListenNotify {
    pool: sqlx::PgPool,
}

impl PostgresListenNotify {
    pub fn new(pool: sqlx::PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl CacheAndPubSub for PostgresListenNotify {
    async fn get(&self, _key: &str) -> Result<Option<Vec<u8>>, CacheError> {
        // SELECT value FROM cache_entries
        // WHERE key = $1 AND (expires_at IS NULL OR expires_at > now())
        //
        // `cache_entries` belongs in `streamarr-db`'s Postgres migration
        // set (it's schema, not coordination/cache logic) — this tier needs
        // it precisely because `NOTIFY` has no storage of its own, unlike
        // Redis which serves both halves of this trait from one server.
        let _ = &self.pool;
        unimplemented!("PostgresListenNotify::get")
    }

    async fn set(
        &self,
        _key: &str,
        _value: Vec<u8>,
        _ttl: Option<Duration>,
    ) -> Result<(), CacheError> {
        // INSERT INTO cache_entries (key, value, expires_at)
        // VALUES ($1, $2, $3)
        // ON CONFLICT (key) DO UPDATE
        //   SET value = excluded.value, expires_at = excluded.expires_at
        unimplemented!("PostgresListenNotify::set")
    }

    async fn delete(&self, _key: &str) -> Result<(), CacheError> {
        // DELETE FROM cache_entries WHERE key = $1
        unimplemented!("PostgresListenNotify::delete")
    }

    async fn publish(&self, _channel: &str, _payload: Vec<u8>) -> Result<(), CacheError> {
        // SELECT pg_notify($1, $2)
        //
        // NOTIFY payloads are capped at 8000 bytes by Postgres itself;
        // callers publishing larger payloads need to pass a reference (an
        // id to re-fetch via `get`) rather than the payload itself.
        unimplemented!("PostgresListenNotify::publish")
    }

    async fn subscribe(&self, _channel: &str) -> Result<Subscription, CacheError> {
        // LISTEN <channel>, held open on one dedicated `PgConnection` taken
        // out of the pool for the connection's whole lifetime — never a
        // connection borrowed-and-returned per query, which would silently
        // drop the subscription the moment it's returned to the pool. A
        // background task polls `PgListener::recv()` on that connection and
        // re-publishes notifications onto a local `tokio::sync::broadcast`
        // channel, matching every other backend's `Subscription` type.
        unimplemented!("PostgresListenNotify::subscribe")
    }
}
