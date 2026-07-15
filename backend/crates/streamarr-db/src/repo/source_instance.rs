use async_trait::async_trait;
use sqlx::any::AnyRow;
use sqlx::Row;
use streamarr_model::{Sensitive, SourceInstance};
use uuid::Uuid;

use crate::codec::{
    bool_from_i64, bool_to_i64, parse_uuid, source_kind_from_str, source_kind_to_str,
};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

/// CRUD surface over [`streamarr_model::SourceInstance`] -- the configured
/// *arr connections Streamarr syncs its catalog from. Persists what today
/// only lives in `streamarr-api`'s in-memory `SourceInstanceRegistry`, so a
/// restart no longer forgets every registered instance.
///
/// `api_key_encrypted` is stored as plain `TEXT` for now: there is no
/// encryption-at-rest mechanism anywhere in this codebase yet, and adding
/// one (key management, rotation, etc.) is explicitly out of scope for this
/// repository -- it's a separate, deferred concern. The field keeps its
/// `Sensitive<String>` wrapper on the Rust side purely to stop it leaking
/// via `Debug`/`Display` (see `streamarr_model::Sensitive`'s own doc
/// comment); it does not encrypt anything by itself.
#[async_trait]
pub trait SourceInstanceRepo: Send + Sync {
    async fn list_all(&self) -> Result<Vec<SourceInstance>, DbError>;

    /// Insert-or-update by `SourceInstance::id`.
    async fn upsert(&self, instance: &SourceInstance) -> Result<(), DbError>;

    async fn delete(&self, id: Uuid) -> Result<(), DbError>;
}

pub struct SqlxSourceInstanceRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxSourceInstanceRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }

    fn from_row(row: &AnyRow) -> Result<SourceInstance, DbError> {
        let id: String = row.try_get("id")?;
        let kind: String = row.try_get("kind")?;
        let name: String = row.try_get("name")?;
        let base_url: String = row.try_get("base_url")?;
        let api_key_encrypted: String = row.try_get("api_key_encrypted")?;
        let priority: i32 = row.try_get("priority")?;
        let default_root_folder_id: Option<String> = row.try_get("default_root_folder_id")?;
        let default_quality_profile_id: Option<i64> = row.try_get("default_quality_profile_id")?;
        let enabled_for_requests: i64 = row.try_get("enabled_for_requests")?;
        let best_effort: i64 = row.try_get("best_effort")?;

        Ok(SourceInstance {
            id: parse_uuid(&id)?,
            kind: source_kind_from_str(&kind)?,
            name,
            base_url,
            api_key_encrypted: Sensitive::new(api_key_encrypted),
            priority,
            default_root_folder_id,
            default_quality_profile_id,
            enabled_for_requests: bool_from_i64(enabled_for_requests),
            best_effort: bool_from_i64(best_effort),
        })
    }
}

#[async_trait]
impl SourceInstanceRepo for SqlxSourceInstanceRepo {
    async fn list_all(&self) -> Result<Vec<SourceInstance>, DbError> {
        let sql = "SELECT id, kind, name, base_url, api_key_encrypted, priority, \
                    default_root_folder_id, default_quality_profile_id, enabled_for_requests, \
                    best_effort FROM source_instances ORDER BY priority, name";
        let rows = sqlx::query(sql).fetch_all(&self.pool).await?;
        rows.iter().map(Self::from_row).collect()
    }

    async fn upsert(&self, instance: &SourceInstance) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO source_instances \
                 (id, kind, name, base_url, api_key_encrypted, priority, default_root_folder_id, \
                 default_quality_profile_id, enabled_for_requests, best_effort) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                 kind = excluded.kind, name = excluded.name, base_url = excluded.base_url, \
                 api_key_encrypted = excluded.api_key_encrypted, priority = excluded.priority, \
                 default_root_folder_id = excluded.default_root_folder_id, \
                 default_quality_profile_id = excluded.default_quality_profile_id, \
                 enabled_for_requests = excluded.enabled_for_requests, \
                 best_effort = excluded.best_effort"
            }
            Backend::Postgres => {
                "INSERT INTO source_instances \
                 (id, kind, name, base_url, api_key_encrypted, priority, default_root_folder_id, \
                 default_quality_profile_id, enabled_for_requests, best_effort) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) \
                 ON CONFLICT (id) DO UPDATE SET \
                 kind = excluded.kind, name = excluded.name, base_url = excluded.base_url, \
                 api_key_encrypted = excluded.api_key_encrypted, priority = excluded.priority, \
                 default_root_folder_id = excluded.default_root_folder_id, \
                 default_quality_profile_id = excluded.default_quality_profile_id, \
                 enabled_for_requests = excluded.enabled_for_requests, \
                 best_effort = excluded.best_effort"
            }
        };
        sqlx::query(sql)
            .bind(instance.id.to_string())
            .bind(source_kind_to_str(instance.kind))
            .bind(instance.name.as_str())
            .bind(instance.base_url.as_str())
            .bind(instance.api_key_encrypted.expose_secret().as_str())
            .bind(instance.priority)
            .bind(instance.default_root_folder_id.as_deref())
            .bind(instance.default_quality_profile_id)
            .bind(bool_to_i64(instance.enabled_for_requests))
            .bind(bool_to_i64(instance.best_effort))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete(&self, id: Uuid) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "DELETE FROM source_instances WHERE id = ?",
            Backend::Postgres => "DELETE FROM source_instances WHERE id = $1",
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
}

#[cfg(test)]
mod tests {
    use streamarr_model::SourceKind;

    use super::*;
    use crate::pool::test_sqlite_pool;

    fn sample_instance(kind: SourceKind, name: &str) -> SourceInstance {
        SourceInstance {
            id: Uuid::new_v4(),
            kind,
            name: name.to_string(),
            base_url: "https://arr.example.com".to_string(),
            api_key_encrypted: Sensitive::new("super-secret-api-key".to_string()),
            priority: 10,
            default_root_folder_id: Some("/data/media".to_string()),
            default_quality_profile_id: Some(4),
            enabled_for_requests: true,
            best_effort: false,
        }
    }

    #[tokio::test]
    async fn upsert_then_list_round_trips() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxSourceInstanceRepo::new(pool);
        let instance = sample_instance(SourceKind::Sonarr, "Main Sonarr");

        repo.upsert(&instance).await.expect("upsert");
        let all = repo.list_all().await.expect("list_all");

        assert_eq!(all.len(), 1);
        assert_eq!(all[0], instance);
    }

    #[tokio::test]
    async fn upsert_updates_existing_row() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxSourceInstanceRepo::new(pool);
        let mut instance = sample_instance(SourceKind::Radarr, "Main Radarr");
        repo.upsert(&instance).await.unwrap();

        instance.name = "Renamed Radarr".to_string();
        instance.priority = 1;
        instance.best_effort = true;
        instance.default_root_folder_id = None;
        instance.default_quality_profile_id = None;
        instance.api_key_encrypted = Sensitive::new("rotated-api-key".to_string());
        repo.upsert(&instance).await.unwrap();

        let all = repo.list_all().await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0], instance);
    }

    #[tokio::test]
    async fn list_all_orders_by_priority_then_name() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxSourceInstanceRepo::new(pool);

        let mut low_priority = sample_instance(SourceKind::Sonarr, "Z Sonarr");
        low_priority.priority = 5;
        let mut high_priority_b = sample_instance(SourceKind::Radarr, "B Radarr");
        high_priority_b.priority = 1;
        let mut high_priority_a = sample_instance(SourceKind::Radarr, "A Radarr");
        high_priority_a.priority = 1;

        repo.upsert(&low_priority).await.unwrap();
        repo.upsert(&high_priority_b).await.unwrap();
        repo.upsert(&high_priority_a).await.unwrap();

        let all = repo.list_all().await.unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].name, "A Radarr");
        assert_eq!(all[1].name, "B Radarr");
        assert_eq!(all[2].name, "Z Sonarr");
    }

    #[tokio::test]
    async fn delete_removes_row() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxSourceInstanceRepo::new(pool);
        let instance = sample_instance(SourceKind::Prowlarr, "Prowlarr");
        repo.upsert(&instance).await.unwrap();

        repo.delete(instance.id).await.unwrap();
        let all = repo.list_all().await.unwrap();
        assert!(all.is_empty());
    }

    #[tokio::test]
    async fn delete_missing_returns_not_found() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxSourceInstanceRepo::new(pool);
        let err = repo.delete(Uuid::new_v4()).await.unwrap_err();
        assert!(matches!(err, DbError::NotFound));
    }

    #[tokio::test]
    async fn all_source_kinds_round_trip() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxSourceInstanceRepo::new(pool);

        for kind in [
            SourceKind::Sonarr,
            SourceKind::Radarr,
            SourceKind::Lidarr,
            SourceKind::Bazarr,
            SourceKind::Prowlarr,
            SourceKind::Readarr,
        ] {
            let instance = sample_instance(kind, "instance");
            repo.upsert(&instance).await.unwrap();
            let all = repo.list_all().await.unwrap();
            let fetched = all.iter().find(|i| i.id == instance.id).unwrap();
            assert_eq!(fetched.kind, kind);
            repo.delete(instance.id).await.unwrap();
        }
    }
}
