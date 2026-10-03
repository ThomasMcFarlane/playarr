//! Storage boundary for [`TdarrConnection`] -- see
//! `playarr_model::tdarr`'s module doc comment for why this is a
//! singleton (always 0 or 1 rows), unlike every other repo in this
//! module, which manage many rows of their aggregate.

use async_trait::async_trait;
use playarr_model::{Sensitive, TdarrConnection};
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::{uuid, Uuid};

use crate::codec::{format_datetime, parse_datetime};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

/// The one row this table ever holds -- every `upsert` targets this id,
/// so re-registering (e.g. rotating the API key) replaces the existing
/// connection rather than creating a second one. Same fixed-id-singleton
/// convention `library_view::NEWLY_ADDED_VIEW_ID` uses.
const TDARR_CONNECTION_ID: Uuid = uuid!("00000000-0000-0000-0000-00000000d001");

#[async_trait]
pub trait TdarrConnectionRepo: Send + Sync {
    /// `None` if no connection has been registered yet.
    async fn get(&self) -> Result<Option<TdarrConnection>, DbError>;

    /// Insert-or-replace the singleton connection.
    async fn upsert(&self, connection: &TdarrConnection) -> Result<(), DbError>;

    /// No-op (not an error) if no connection was registered.
    async fn delete(&self) -> Result<(), DbError>;
}

pub struct SqlxTdarrConnectionRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxTdarrConnectionRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }

    fn from_row(row: &AnyRow) -> Result<TdarrConnection, DbError> {
        let base_url: String = row.try_get("base_url")?;
        let api_key_encrypted: String = row.try_get("api_key_encrypted")?;
        let tdarr_db_id: String = row.try_get("tdarr_db_id")?;
        let default_profile: String = row.try_get("default_profile")?;
        let worker_process: String = row.try_get("worker_process")?;
        let default_worker_limit: i32 = row.try_get("default_worker_limit")?;
        let throttled_worker_limit: i32 = row.try_get("throttled_worker_limit")?;
        let active_session_threshold: i32 = row.try_get("active_session_threshold")?;
        let throttle_check_interval_secs: i64 = row.try_get("throttle_check_interval_secs")?;
        let updated_at: String = row.try_get("updated_at")?;

        Ok(TdarrConnection {
            base_url,
            api_key_encrypted: Sensitive::new(api_key_encrypted),
            tdarr_db_id,
            default_profile,
            worker_process,
            default_worker_limit,
            throttled_worker_limit,
            active_session_threshold,
            throttle_check_interval_secs,
            updated_at: parse_datetime(&updated_at)?,
        })
    }
}

#[async_trait]
impl TdarrConnectionRepo for SqlxTdarrConnectionRepo {
    async fn get(&self) -> Result<Option<TdarrConnection>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT base_url, api_key_encrypted, tdarr_db_id, default_profile, worker_process, \
                 default_worker_limit, throttled_worker_limit, active_session_threshold, \
                 throttle_check_interval_secs, updated_at FROM tdarr_connection WHERE id = ?"
            }
            Backend::Postgres => {
                "SELECT base_url, api_key_encrypted, tdarr_db_id, default_profile, worker_process, \
                 default_worker_limit, throttled_worker_limit, active_session_threshold, \
                 throttle_check_interval_secs, updated_at FROM tdarr_connection WHERE id = $1"
            }
        };
        let row = sqlx::query(sql)
            .bind(TDARR_CONNECTION_ID.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(Self::from_row).transpose()
    }

    async fn upsert(&self, connection: &TdarrConnection) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO tdarr_connection \
                 (id, base_url, api_key_encrypted, tdarr_db_id, default_profile, worker_process, \
                  default_worker_limit, throttled_worker_limit, active_session_threshold, \
                  throttle_check_interval_secs, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                 base_url = excluded.base_url, api_key_encrypted = excluded.api_key_encrypted, \
                 tdarr_db_id = excluded.tdarr_db_id, default_profile = excluded.default_profile, \
                 worker_process = excluded.worker_process, \
                 default_worker_limit = excluded.default_worker_limit, \
                 throttled_worker_limit = excluded.throttled_worker_limit, \
                 active_session_threshold = excluded.active_session_threshold, \
                 throttle_check_interval_secs = excluded.throttle_check_interval_secs, \
                 updated_at = excluded.updated_at"
            }
            Backend::Postgres => {
                "INSERT INTO tdarr_connection \
                 (id, base_url, api_key_encrypted, tdarr_db_id, default_profile, worker_process, \
                  default_worker_limit, throttled_worker_limit, active_session_threshold, \
                  throttle_check_interval_secs, updated_at) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) \
                 ON CONFLICT (id) DO UPDATE SET \
                 base_url = excluded.base_url, api_key_encrypted = excluded.api_key_encrypted, \
                 tdarr_db_id = excluded.tdarr_db_id, default_profile = excluded.default_profile, \
                 worker_process = excluded.worker_process, \
                 default_worker_limit = excluded.default_worker_limit, \
                 throttled_worker_limit = excluded.throttled_worker_limit, \
                 active_session_threshold = excluded.active_session_threshold, \
                 throttle_check_interval_secs = excluded.throttle_check_interval_secs, \
                 updated_at = excluded.updated_at"
            }
        };
        sqlx::query(sql)
            .bind(TDARR_CONNECTION_ID.to_string())
            .bind(connection.base_url.as_str())
            .bind(connection.api_key_encrypted.expose_secret().as_str())
            .bind(connection.tdarr_db_id.as_str())
            .bind(connection.default_profile.as_str())
            .bind(connection.worker_process.as_str())
            .bind(connection.default_worker_limit)
            .bind(connection.throttled_worker_limit)
            .bind(connection.active_session_threshold)
            .bind(connection.throttle_check_interval_secs)
            .bind(format_datetime(connection.updated_at))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete(&self) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "DELETE FROM tdarr_connection WHERE id = ?",
            Backend::Postgres => "DELETE FROM tdarr_connection WHERE id = $1",
        };
        sqlx::query(sql)
            .bind(TDARR_CONNECTION_ID.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pool::test_sqlite_pool;
    use chrono::SubsecRound;

    fn sample_connection() -> TdarrConnection {
        TdarrConnection {
            base_url: "http://tdarr.local:8265".to_string(),
            api_key_encrypted: Sensitive::new("test-api-key".to_string()),
            tdarr_db_id: "playarr".to_string(),
            default_profile: "h264-720p-4mbps".to_string(),
            worker_process: "transcodecpu".to_string(),
            default_worker_limit: 2,
            throttled_worker_limit: 0,
            active_session_threshold: 2,
            throttle_check_interval_secs: 30,
            updated_at: chrono::Utc::now().trunc_subsecs(3),
        }
    }

    #[tokio::test]
    async fn get_with_no_connection_registered_is_none() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxTdarrConnectionRepo::new(pool);
        assert_eq!(repo.get().await.unwrap(), None);
    }

    #[tokio::test]
    async fn upsert_then_get_round_trips() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxTdarrConnectionRepo::new(pool);
        let connection = sample_connection();

        repo.upsert(&connection).await.unwrap();
        let fetched = repo.get().await.unwrap().unwrap();
        assert_eq!(fetched, connection);
    }

    #[tokio::test]
    async fn upsert_replaces_the_single_row_not_appends() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxTdarrConnectionRepo::new(pool);

        repo.upsert(&sample_connection()).await.unwrap();
        let mut updated = sample_connection();
        updated.base_url = "http://tdarr-new.local:8265".to_string();
        repo.upsert(&updated).await.unwrap();

        let fetched = repo.get().await.unwrap().unwrap();
        assert_eq!(fetched.base_url, "http://tdarr-new.local:8265");

        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM tdarr_connection")
            .fetch_one(&repo.pool)
            .await
            .unwrap();
        assert_eq!(count.0, 1);
    }

    #[tokio::test]
    async fn delete_removes_the_connection() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxTdarrConnectionRepo::new(pool);
        repo.upsert(&sample_connection()).await.unwrap();

        repo.delete().await.unwrap();
        assert_eq!(repo.get().await.unwrap(), None);
    }

    #[tokio::test]
    async fn delete_with_nothing_registered_is_not_an_error() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxTdarrConnectionRepo::new(pool);
        repo.delete().await.unwrap();
    }
}
