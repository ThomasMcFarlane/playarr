use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::any::AnyRow;
use sqlx::Row;
use streamarr_model::{Sensitive, SourceInstance};
use uuid::Uuid;

use crate::codec::{
    bool_from_i64, bool_to_i64, format_datetime, parse_uuid, source_kind_from_str,
    source_kind_to_str,
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
///
/// `updated_at`/`deleted_at` (added by
/// `backend/migrations/{postgres/0036,sqlite/0033}_peer_sync_state.sql`,
/// nullable and additive -- see `docs/architecture/peer-groups.md` §2.2)
/// exist purely for cross-node sync bookkeeping and are deliberately not
/// read into [`streamarr_model::SourceInstance`] here -- same rationale as
/// `crate::repo::user`'s own doc comment. Unlike `users`/`policies`, this
/// table gets no `origin_peer_id` column (see the migration's own SQL):
/// group-library association, not row ownership, is how a `SourceInstance`
/// participates in a group (§2.3), so there's no origin claim to default.
#[async_trait]
pub trait SourceInstanceRepo: Send + Sync {
    async fn list_all(&self) -> Result<Vec<SourceInstance>, DbError>;

    /// Insert-or-update by `SourceInstance::id`. Always stamps `updated_at`
    /// with the current server time, never a caller-supplied value.
    async fn upsert(&self, instance: &SourceInstance) -> Result<(), DbError>;

    /// Soft-deletes by setting `deleted_at`, rather than a hard `DELETE`.
    /// A no-op (returns [`DbError::NotFound`]) if the row doesn't exist or
    /// is already deleted, exactly like the hard delete this replaced.
    async fn delete(&self, id: Uuid) -> Result<(), DbError>;

    /// Every row whose `updated_at` is strictly greater than `since` (every
    /// row, oldest first, when `since` is `None`) -- the read behind `GET
    /// /api/v1/peer/libraries?since=`'s `source_instances` half
    /// (`docs/architecture/peer-groups.md` §3.1/§3.6). Deliberately not
    /// filtered on `deleted_at IS NULL`, unlike [`Self::list_all`] -- see
    /// `crate::repo::user::UserRepo::list_updated_since`'s doc comment for
    /// why a tombstoned row must still be reported. Returns the **full**
    /// [`SourceInstance`], `api_key_encrypted` included: it is the calling
    /// endpoint handler's job, not this repository's, to strip that field
    /// (and any other node-local-only field -- see this module's own doc
    /// comment and §3.1's table) before a row goes out over the wire.
    async fn list_updated_since(
        &self,
        since: Option<DateTime<Utc>>,
    ) -> Result<Vec<SourceInstance>, DbError>;
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
        let best_effort: i64 = row.try_get("best_effort")?;
        let group_library_id: Option<String> = row.try_get("group_library_id")?;

        Ok(SourceInstance {
            id: parse_uuid(&id)?,
            kind: source_kind_from_str(&kind)?,
            name,
            base_url,
            api_key_encrypted: Sensitive::new(api_key_encrypted),
            priority,
            default_root_folder_id,
            default_quality_profile_id,
            best_effort: bool_from_i64(best_effort),
            group_library_id: group_library_id.as_deref().map(parse_uuid).transpose()?,
        })
    }
}

#[async_trait]
impl SourceInstanceRepo for SqlxSourceInstanceRepo {
    async fn list_all(&self) -> Result<Vec<SourceInstance>, DbError> {
        let sql = "SELECT id, kind, name, base_url, api_key_encrypted, priority, \
                    default_root_folder_id, default_quality_profile_id, \
                    best_effort, group_library_id FROM source_instances \
                    WHERE deleted_at IS NULL ORDER BY priority, name";
        let rows = sqlx::query(sql).fetch_all(&self.pool).await?;
        rows.iter().map(Self::from_row).collect()
    }

    // `enabled_for_requests` still exists as a DB column (see
    // migrations/{sqlite,postgres}/000{6,9}_source_instances.sql) but is
    // deliberately not read/written here anymore -- it backed a request-
    // submission feature Streamarr no longer has (see
    // streamarr_model::SourceInstance's own doc comment). Leaving the
    // column in place (rather than a destructive DROP COLUMN migration)
    // means it just keeps whatever value it already has for existing rows,
    // and a fresh insert relies on the column's own DEFAULT -- both
    // harmless, and safe to actually drop later in a real migration
    // without any code-level urgency.
    async fn upsert(&self, instance: &SourceInstance) -> Result<(), DbError> {
        // `updated_at` is bound once below from the server clock, never a
        // caller-supplied value -- see this module's own doc comment.
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO source_instances \
                 (id, kind, name, base_url, api_key_encrypted, priority, default_root_folder_id, \
                 default_quality_profile_id, best_effort, group_library_id, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                 kind = excluded.kind, name = excluded.name, base_url = excluded.base_url, \
                 api_key_encrypted = excluded.api_key_encrypted, priority = excluded.priority, \
                 default_root_folder_id = excluded.default_root_folder_id, \
                 default_quality_profile_id = excluded.default_quality_profile_id, \
                 best_effort = excluded.best_effort, group_library_id = excluded.group_library_id, \
                 updated_at = excluded.updated_at"
            }
            Backend::Postgres => {
                "INSERT INTO source_instances \
                 (id, kind, name, base_url, api_key_encrypted, priority, default_root_folder_id, \
                 default_quality_profile_id, best_effort, group_library_id, updated_at) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) \
                 ON CONFLICT (id) DO UPDATE SET \
                 kind = excluded.kind, name = excluded.name, base_url = excluded.base_url, \
                 api_key_encrypted = excluded.api_key_encrypted, priority = excluded.priority, \
                 default_root_folder_id = excluded.default_root_folder_id, \
                 default_quality_profile_id = excluded.default_quality_profile_id, \
                 best_effort = excluded.best_effort, group_library_id = excluded.group_library_id, \
                 updated_at = excluded.updated_at"
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
            .bind(bool_to_i64(instance.best_effort))
            .bind(instance.group_library_id.map(|id| id.to_string()))
            .bind(format_datetime(chrono::Utc::now()))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete(&self, id: Uuid) -> Result<(), DbError> {
        // Soft delete: sets `deleted_at` instead of removing the row --
        // see `SqlxUserRepo::delete`'s doc comment for the full rationale,
        // including why `AND deleted_at IS NULL` keeps a double-delete
        // returning `NotFound` exactly like the hard delete this replaced.
        let sql = match self.backend {
            Backend::Sqlite => {
                "UPDATE source_instances SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL"
            }
            Backend::Postgres => {
                "UPDATE source_instances SET deleted_at = $1 WHERE id = $2 AND deleted_at IS NULL"
            }
        };
        let result = sqlx::query(sql)
            .bind(format_datetime(chrono::Utc::now()))
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    async fn list_updated_since(
        &self,
        since: Option<DateTime<Utc>>,
    ) -> Result<Vec<SourceInstance>, DbError> {
        const SELECT: &str = "id, kind, name, base_url, api_key_encrypted, priority, \
                               default_root_folder_id, default_quality_profile_id, best_effort, \
                               group_library_id";
        // Deliberately no `WHERE deleted_at IS NULL` -- see this trait
        // method's own doc comment.
        let sql = match (self.backend, since.is_some()) {
            (Backend::Sqlite, true) => format!(
                "SELECT {SELECT} FROM source_instances WHERE updated_at > ? \
                 ORDER BY updated_at ASC, id ASC"
            ),
            (Backend::Sqlite, false) => {
                format!("SELECT {SELECT} FROM source_instances ORDER BY updated_at ASC, id ASC")
            }
            (Backend::Postgres, true) => format!(
                "SELECT {SELECT} FROM source_instances WHERE updated_at > $1 \
                 ORDER BY updated_at ASC, id ASC"
            ),
            (Backend::Postgres, false) => {
                format!("SELECT {SELECT} FROM source_instances ORDER BY updated_at ASC, id ASC")
            }
        };
        let mut query = sqlx::query(&sql);
        if let Some(since) = since {
            query = query.bind(format_datetime(since));
        }
        let rows = query.fetch_all(&self.pool).await?;
        rows.iter().map(Self::from_row).collect()
    }
}

#[cfg(test)]
mod tests {
    use chrono::{SubsecRound, Utc};
    use streamarr_model::SourceKind;

    use super::*;
    use crate::codec::parse_datetime;
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
            best_effort: false,
            group_library_id: None,
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

    /// `group_library_id` (§5.1/§2.3 -- the operator-asserted mapping of
    /// this node's own instance onto a group-wide `GroupLibrary`) round
    /// trips through `upsert`/`list_all` the same as every other nullable
    /// column here, and can be cleared back to `None` on an update.
    #[tokio::test]
    async fn group_library_id_round_trips_and_can_be_cleared() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxSourceInstanceRepo::new(pool);
        let mut instance = sample_instance(SourceKind::Radarr, "Grouped Radarr");
        instance.group_library_id = Some(Uuid::new_v4());
        repo.upsert(&instance).await.unwrap();

        let all = repo.list_all().await.unwrap();
        assert_eq!(all[0].group_library_id, instance.group_library_id);

        instance.group_library_id = None;
        repo.upsert(&instance).await.unwrap();
        let all = repo.list_all().await.unwrap();
        assert_eq!(all[0].group_library_id, None);
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
    async fn delete_soft_deletes_the_row_instead_of_removing_it() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxSourceInstanceRepo::new(pool.clone());
        let instance = sample_instance(SourceKind::Prowlarr, "Tombstoned");
        repo.upsert(&instance).await.unwrap();

        repo.delete(instance.id).await.unwrap();

        let (count, deleted_at): (i64, Option<String>) =
            sqlx::query_as("SELECT COUNT(*), MAX(deleted_at) FROM source_instances WHERE id = ?")
                .bind(instance.id.to_string())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 1, "soft delete must not remove the row");
        assert!(deleted_at.is_some());

        assert!(repo.list_all().await.unwrap().is_empty());

        let err = repo.delete(instance.id).await.unwrap_err();
        assert!(matches!(err, DbError::NotFound));
    }

    #[tokio::test]
    async fn upsert_stamps_updated_at_from_the_server_clock() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxSourceInstanceRepo::new(pool.clone());
        // Truncated to millisecond precision to match `format_datetime`'s
        // own storage precision -- see the identical note in
        // `crate::repo::user`'s own version of this test.
        let before = Utc::now().trunc_subsecs(3);
        let instance = sample_instance(SourceKind::Sonarr, "Freshly Written");

        repo.upsert(&instance).await.unwrap();

        let (updated_at,): (Option<String>,) =
            sqlx::query_as("SELECT updated_at FROM source_instances WHERE id = ?")
                .bind(instance.id.to_string())
                .fetch_one(&pool)
                .await
                .unwrap();
        let updated_at =
            parse_datetime(&updated_at.expect("upsert always sets updated_at")).unwrap();
        assert!(updated_at >= before);
        assert!(updated_at <= Utc::now());
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
            SourceKind::Whisparr,
        ] {
            let instance = sample_instance(kind, "instance");
            repo.upsert(&instance).await.unwrap();
            let all = repo.list_all().await.unwrap();
            let fetched = all.iter().find(|i| i.id == instance.id).unwrap();
            assert_eq!(fetched.kind, kind);
            repo.delete(instance.id).await.unwrap();
        }
    }

    #[tokio::test]
    async fn list_updated_since_none_returns_every_row_including_soft_deleted() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxSourceInstanceRepo::new(pool.clone());
        let kept = sample_instance(SourceKind::Sonarr, "Kept");
        let tombstoned = sample_instance(SourceKind::Radarr, "Tombstoned For Sync");
        repo.upsert(&kept).await.unwrap();
        repo.upsert(&tombstoned).await.unwrap();
        repo.delete(tombstoned.id).await.unwrap();

        let rows = repo.list_updated_since(None).await.unwrap();
        let ids: Vec<Uuid> = rows.iter().map(|instance| instance.id).collect();
        assert!(ids.contains(&kept.id));
        assert!(
            ids.contains(&tombstoned.id),
            "a soft-deleted row must still be reported so its tombstone can propagate"
        );
    }

    #[tokio::test]
    async fn list_updated_since_a_cursor_excludes_rows_at_or_before_it() {
        // `SourceInstanceRepo` has no `apply_synced` (see this module's own
        // doc comment -- there's no `origin_peer_id`/privilege-gating
        // concern for this table), so unlike `crate::repo::user`'s identical
        // test, `updated_at` is backdated with a direct `UPDATE` after
        // `upsert` rather than via a caller-supplied metadata write.
        let pool = test_sqlite_pool().await;
        let repo = SqlxSourceInstanceRepo::new(pool.clone());
        let now = Utc::now().trunc_subsecs(3);
        let cursor = now - chrono::Duration::minutes(10);

        let old = sample_instance(SourceKind::Sonarr, "Already Synced");
        repo.upsert(&old).await.unwrap();
        sqlx::query("UPDATE source_instances SET updated_at = ? WHERE id = ?")
            .bind(format_datetime(cursor))
            .bind(old.id.to_string())
            .execute(&pool)
            .await
            .unwrap();

        let fresh = sample_instance(SourceKind::Radarr, "Freshly Changed");
        repo.upsert(&fresh).await.unwrap();
        sqlx::query("UPDATE source_instances SET updated_at = ? WHERE id = ?")
            .bind(format_datetime(now))
            .bind(fresh.id.to_string())
            .execute(&pool)
            .await
            .unwrap();

        let rows = repo.list_updated_since(Some(cursor)).await.unwrap();
        let ids: Vec<Uuid> = rows.iter().map(|instance| instance.id).collect();
        assert!(
            !ids.contains(&old.id),
            "a row at or before the cursor must not be re-reported"
        );
        assert!(ids.contains(&fresh.id));
    }

    #[tokio::test]
    async fn list_updated_since_orders_oldest_first() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxSourceInstanceRepo::new(pool.clone());
        let now = Utc::now().trunc_subsecs(3);

        let older = sample_instance(SourceKind::Sonarr, "Older Write");
        repo.upsert(&older).await.unwrap();
        sqlx::query("UPDATE source_instances SET updated_at = ? WHERE id = ?")
            .bind(format_datetime(now - chrono::Duration::minutes(10)))
            .bind(older.id.to_string())
            .execute(&pool)
            .await
            .unwrap();

        let newer = sample_instance(SourceKind::Radarr, "Newer Write");
        repo.upsert(&newer).await.unwrap();
        sqlx::query("UPDATE source_instances SET updated_at = ? WHERE id = ?")
            .bind(format_datetime(now))
            .bind(newer.id.to_string())
            .execute(&pool)
            .await
            .unwrap();

        let rows = repo.list_updated_since(None).await.unwrap();
        let position = |id: Uuid| rows.iter().position(|instance| instance.id == id).unwrap();
        assert!(position(older.id) < position(newer.id));
    }
}
