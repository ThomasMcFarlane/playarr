//! [`Redis`] — the [`crate::CacheAndPubSub`] implementation for
//! [`streamarr_config::DeploymentTier::MultiNodePostgresRedis`]. Struct
//! skeleton only: wiring a real Redis client (`redis`/`fred`) is downstream
//! work, so this crate doesn't carry that dependency yet. Exists so
//! `streamarr-bin`'s startup wiring has a real, constructible type ahead of
//! that work landing.

use std::time::Duration;

use async_trait::async_trait;

use crate::{CacheAndPubSub, CacheError, Subscription};

pub struct Redis {
    connection_url: String,
}

impl Redis {
    pub fn new(connection_url: impl Into<String>) -> Self {
        Self {
            connection_url: connection_url.into(),
        }
    }
}

#[async_trait]
impl CacheAndPubSub for Redis {
    async fn get(&self, _key: &str) -> Result<Option<Vec<u8>>, CacheError> {
        // GET <key>
        let _ = &self.connection_url;
        unimplemented!("Redis::get")
    }

    async fn set(
        &self,
        _key: &str,
        _value: Vec<u8>,
        _ttl: Option<Duration>,
    ) -> Result<(), CacheError> {
        // SET <key> <value> [PX <ttl_ms>]
        unimplemented!("Redis::set")
    }

    async fn delete(&self, _key: &str) -> Result<(), CacheError> {
        // DEL <key>
        unimplemented!("Redis::delete")
    }

    async fn publish(&self, _channel: &str, _payload: Vec<u8>) -> Result<(), CacheError> {
        // PUBLISH <channel> <payload>
        unimplemented!("Redis::publish")
    }

    async fn subscribe(&self, _channel: &str) -> Result<Subscription, CacheError> {
        // SUBSCRIBE <channel>, on a dedicated connection (Redis pub/sub
        // connections can't multiplex regular commands once subscribed).
        // A background task reads frames off that connection and
        // re-publishes them onto a local `tokio::sync::broadcast` channel,
        // matching every other backend's `Subscription` type.
        unimplemented!("Redis::subscribe")
    }
}
