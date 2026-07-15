use async_trait::async_trait;
use chrono::{DateTime, Utc};
use streamarr_model::Device;
use uuid::Uuid;

use crate::error::DbError;
use crate::pool::DbPool;

/// CRUD surface over [`streamarr_model::Device`]. Kept separate from a
/// hypothetical `UserRepo` because devices are queried and mutated far more
/// often (every request touches `touch_last_seen`; `Policy::device_allow`
/// and `max_concurrent_sessions` checks list by user) than user profile
/// data is.
#[async_trait]
pub trait DeviceRepo: Send + Sync {
    async fn get(&self, id: Uuid) -> Result<Device, DbError>;

    async fn list_for_user(&self, user_id: Uuid) -> Result<Vec<Device>, DbError>;

    async fn upsert(&self, device: &Device) -> Result<(), DbError>;

    async fn delete(&self, id: Uuid) -> Result<(), DbError>;

    /// Cheap, high-frequency write path (called on effectively every
    /// authenticated request) — kept as its own method rather than routed
    /// through `upsert` so implementations can use a narrow `UPDATE ...
    /// SET last_seen_at` rather than re-writing the whole row.
    async fn touch_last_seen(&self, id: Uuid, at: DateTime<Utc>) -> Result<(), DbError>;
}

pub struct SqlxDeviceRepo {
    pool: DbPool,
}

impl SqlxDeviceRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl DeviceRepo for SqlxDeviceRepo {
    async fn get(&self, _id: Uuid) -> Result<Device, DbError> {
        // SELECT * FROM devices WHERE id = $1
        let _ = &self.pool;
        unimplemented!("SqlxDeviceRepo::get")
    }

    async fn list_for_user(&self, _user_id: Uuid) -> Result<Vec<Device>, DbError> {
        // SELECT * FROM devices WHERE user_id = $1 ORDER BY last_seen_at DESC NULLS LAST
        unimplemented!("SqlxDeviceRepo::list_for_user")
    }

    async fn upsert(&self, _device: &Device) -> Result<(), DbError> {
        // INSERT INTO devices (...) VALUES (...) ON CONFLICT (id) DO UPDATE SET ...
        unimplemented!("SqlxDeviceRepo::upsert")
    }

    async fn delete(&self, _id: Uuid) -> Result<(), DbError> {
        // DELETE FROM devices WHERE id = $1
        unimplemented!("SqlxDeviceRepo::delete")
    }

    async fn touch_last_seen(&self, _id: Uuid, _at: DateTime<Utc>) -> Result<(), DbError> {
        // UPDATE devices SET last_seen_at = $2 WHERE id = $1
        unimplemented!("SqlxDeviceRepo::touch_last_seen")
    }
}
