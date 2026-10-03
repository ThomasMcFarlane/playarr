use async_trait::async_trait;
use chrono::{DateTime, Utc};
use playarr_model::{ClientPlatform, Device};
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{
    bool_from_i64, bool_to_i64, decode_err, format_datetime, parse_datetime, parse_uuid,
};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

/// CRUD surface over [`playarr_model::Device`]. Kept separate from a
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
    backend: Backend,
}

impl SqlxDeviceRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }

    fn from_row(row: &AnyRow) -> Result<Device, DbError> {
        let id: String = row.try_get("id")?;
        let user_id: String = row.try_get("user_id")?;
        let name: String = row.try_get("name")?;
        let platform: String = row.try_get("platform")?;
        let client_version: String = row.try_get("client_version")?;
        let last_seen_at: Option<String> = row.try_get("last_seen_at")?;
        let trusted: i64 = row.try_get("trusted")?;

        Ok(Device {
            id: parse_uuid(&id)?,
            user_id: parse_uuid(&user_id)?,
            name,
            platform: ClientPlatform::from_wire_name(&platform)
                .ok_or_else(|| decode_err(format!("unknown client platform {platform:?}")))?,
            client_version,
            last_seen_at: last_seen_at.map(|s| parse_datetime(&s)).transpose()?,
            trusted: bool_from_i64(trusted),
        })
    }
}

#[async_trait]
impl DeviceRepo for SqlxDeviceRepo {
    async fn get(&self, id: Uuid) -> Result<Device, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, user_id, name, platform, client_version, last_seen_at, trusted \
                 FROM devices WHERE id = ?"
            }
            Backend::Postgres => {
                "SELECT id, user_id, name, platform, client_version, last_seen_at, trusted \
                 FROM devices WHERE id = $1"
            }
        };
        let row = sqlx::query(sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?
            .ok_or(DbError::NotFound)?;
        Self::from_row(&row)
    }

    async fn list_for_user(&self, user_id: Uuid) -> Result<Vec<Device>, DbError> {
        // `NULLS LAST` is supported by both engines (SQLite since 3.30,
        // Postgres always) so this needs no per-backend variant beyond the
        // placeholder.
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, user_id, name, platform, client_version, last_seen_at, trusted \
                 FROM devices WHERE user_id = ? ORDER BY last_seen_at DESC NULLS LAST"
            }
            Backend::Postgres => {
                "SELECT id, user_id, name, platform, client_version, last_seen_at, trusted \
                 FROM devices WHERE user_id = $1 ORDER BY last_seen_at DESC NULLS LAST"
            }
        };
        let rows = sqlx::query(sql)
            .bind(user_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(Self::from_row).collect()
    }

    async fn upsert(&self, device: &Device) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO devices (id, user_id, name, platform, client_version, last_seen_at, trusted) \
                 VALUES (?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                 user_id = excluded.user_id, name = excluded.name, platform = excluded.platform, \
                 client_version = excluded.client_version, last_seen_at = excluded.last_seen_at, \
                 trusted = excluded.trusted"
            }
            Backend::Postgres => {
                "INSERT INTO devices (id, user_id, name, platform, client_version, last_seen_at, trusted) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7) \
                 ON CONFLICT (id) DO UPDATE SET \
                 user_id = excluded.user_id, name = excluded.name, platform = excluded.platform, \
                 client_version = excluded.client_version, last_seen_at = excluded.last_seen_at, \
                 trusted = excluded.trusted"
            }
        };
        sqlx::query(sql)
            .bind(device.id.to_string())
            .bind(device.user_id.to_string())
            .bind(device.name.as_str())
            .bind(device.platform.wire_name())
            .bind(device.client_version.as_str())
            .bind(device.last_seen_at.map(format_datetime))
            .bind(bool_to_i64(device.trusted))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete(&self, id: Uuid) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "DELETE FROM devices WHERE id = ?",
            Backend::Postgres => "DELETE FROM devices WHERE id = $1",
        };
        let result = sqlx::query(sql)
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    async fn touch_last_seen(&self, id: Uuid, at: DateTime<Utc>) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "UPDATE devices SET last_seen_at = ? WHERE id = ?",
            Backend::Postgres => "UPDATE devices SET last_seen_at = $1 WHERE id = $2",
        };
        let result = sqlx::query(sql)
            .bind(format_datetime(at))
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, SubsecRound};

    use super::*;
    use crate::pool::test_sqlite_pool;

    fn sample_device(user_id: Uuid) -> Device {
        Device {
            id: Uuid::new_v4(),
            user_id,
            name: "Kitchen TV".to_string(),
            platform: ClientPlatform::TvWebos,
            client_version: "1.0.0".to_string(),
            // Storage round-trips through millisecond precision (see
            // `codec::format_datetime`); truncate here so the fixture
            // matches what `get()` hands back.
            last_seen_at: Some(Utc::now().trunc_subsecs(3)),
            trusted: true,
        }
    }

    #[tokio::test]
    async fn upsert_then_get_round_trips() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxDeviceRepo::new(pool);
        let device = sample_device(Uuid::new_v4());

        repo.upsert(&device).await.expect("upsert");
        let fetched = repo.get(device.id).await.expect("get");
        assert_eq!(fetched, device);
    }

    #[tokio::test]
    async fn upsert_updates_existing_row() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxDeviceRepo::new(pool);
        let mut device = sample_device(Uuid::new_v4());
        repo.upsert(&device).await.unwrap();

        device.name = "Bedroom TV".to_string();
        device.trusted = false;
        repo.upsert(&device).await.unwrap();

        let fetched = repo.get(device.id).await.unwrap();
        assert_eq!(fetched.name, "Bedroom TV");
        assert!(!fetched.trusted);
    }

    #[tokio::test]
    async fn list_for_user_orders_newest_first_nulls_last() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxDeviceRepo::new(pool);
        let user_id = Uuid::new_v4();

        let mut older = sample_device(user_id);
        older.last_seen_at = Some(Utc::now() - Duration::hours(2));
        let mut newer = sample_device(user_id);
        newer.last_seen_at = Some(Utc::now());
        let mut never_seen = sample_device(user_id);
        never_seen.last_seen_at = None;
        // Device belonging to a different user must not show up.
        let other_user = sample_device(Uuid::new_v4());

        for d in [&older, &newer, &never_seen, &other_user] {
            repo.upsert(d).await.unwrap();
        }

        let devices = repo.list_for_user(user_id).await.unwrap();
        assert_eq!(devices.len(), 3);
        assert_eq!(devices[0].id, newer.id);
        assert_eq!(devices[1].id, older.id);
        assert_eq!(devices[2].id, never_seen.id);
    }

    #[tokio::test]
    async fn touch_last_seen_updates_timestamp() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxDeviceRepo::new(pool);
        let mut device = sample_device(Uuid::new_v4());
        device.last_seen_at = None;
        repo.upsert(&device).await.unwrap();

        let now = Utc::now();
        repo.touch_last_seen(device.id, now).await.unwrap();

        let fetched = repo.get(device.id).await.unwrap();
        let seen = fetched.last_seen_at.expect("last_seen_at set");
        assert!((seen - now).num_milliseconds().abs() < 5);
    }

    #[tokio::test]
    async fn touch_last_seen_missing_returns_not_found() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxDeviceRepo::new(pool);
        let err = repo
            .touch_last_seen(Uuid::new_v4(), Utc::now())
            .await
            .unwrap_err();
        assert!(matches!(err, DbError::NotFound));
    }

    #[tokio::test]
    async fn delete_removes_row() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxDeviceRepo::new(pool);
        let device = sample_device(Uuid::new_v4());
        repo.upsert(&device).await.unwrap();

        repo.delete(device.id).await.unwrap();
        let err = repo.get(device.id).await.unwrap_err();
        assert!(matches!(err, DbError::NotFound));
    }

    #[tokio::test]
    async fn delete_missing_returns_not_found() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxDeviceRepo::new(pool);
        let err = repo.delete(Uuid::new_v4()).await.unwrap_err();
        assert!(matches!(err, DbError::NotFound));
    }
}
