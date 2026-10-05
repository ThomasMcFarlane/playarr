//! Database boundary for Playarr Server's singleton system settings.

use async_trait::async_trait;
use playarr_model::{SystemSettings, DEFAULT_INSTANCE_NAME};
use sqlx::Row;

use crate::error::DbError;
use crate::pool::{Backend, DbPool};

const SYSTEM_SETTINGS_ID: &str = "00000000-0000-0000-0000-00000000a001";

#[async_trait]
pub trait SystemSettingsRepo: Send + Sync {
    async fn get(&self) -> Result<SystemSettings, DbError>;
    async fn upsert(&self, settings: &SystemSettings) -> Result<(), DbError>;
}

pub struct SqlxSystemSettingsRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxSystemSettingsRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }
}

#[async_trait]
impl SystemSettingsRepo for SqlxSystemSettingsRepo {
    async fn get(&self) -> Result<SystemSettings, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "SELECT instance_name FROM system_settings WHERE id = ?",
            Backend::Postgres => "SELECT instance_name FROM system_settings WHERE id = $1",
        };
        let row = sqlx::query(sql)
            .bind(SYSTEM_SETTINGS_ID)
            .fetch_optional(&self.pool)
            .await?;

        Ok(SystemSettings {
            instance_name: row
                .map(|row| row.get("instance_name"))
                .unwrap_or_else(|| DEFAULT_INSTANCE_NAME.to_string()),
        })
    }

    async fn upsert(&self, settings: &SystemSettings) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO system_settings (id, instance_name) VALUES (?, ?) \
                 ON CONFLICT (id) DO UPDATE SET instance_name = excluded.instance_name"
            }
            Backend::Postgres => {
                "INSERT INTO system_settings (id, instance_name) VALUES ($1, $2) \
                 ON CONFLICT (id) DO UPDATE SET instance_name = excluded.instance_name"
            }
        };
        sqlx::query(sql)
            .bind(SYSTEM_SETTINGS_ID)
            .bind(&settings.instance_name)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pool::test_sqlite_pool;

    #[tokio::test]
    async fn migration_seeds_default_settings() {
        let repo = SqlxSystemSettingsRepo::new(test_sqlite_pool().await);
        assert_eq!(
            repo.get().await.unwrap(),
            SystemSettings {
                instance_name: DEFAULT_INSTANCE_NAME.to_string()
            }
        );
    }

    #[tokio::test]
    async fn upsert_replaces_the_singleton() {
        let repo = SqlxSystemSettingsRepo::new(test_sqlite_pool().await);
        let settings = SystemSettings {
            instance_name: "Lounge".to_string(),
        };
        repo.upsert(&settings).await.unwrap();
        assert_eq!(repo.get().await.unwrap(), settings);
    }
}
