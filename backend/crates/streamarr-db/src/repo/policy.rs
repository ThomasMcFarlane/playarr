use async_trait::async_trait;
use sqlx::any::AnyRow;
use sqlx::Row;
use streamarr_model::Policy;
use uuid::Uuid;

use crate::codec::parse_uuid;
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

/// CRUD surface over [`streamarr_model::Policy`] -- the permission/
/// entitlement bundle a [`streamarr_model::User`] is attached to via
/// `User::policy_id`. Kept as its own repository (rather than folded into
/// `UserRepo`) because policies are shared many-to-one across users and
/// have their own lifecycle (an admin edits a policy independently of any
/// one user it happens to be assigned to).
#[async_trait]
pub trait PolicyRepo: Send + Sync {
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Policy>, DbError>;

    /// Insert-or-update by `Policy::id`.
    async fn upsert(&self, policy: &Policy) -> Result<(), DbError>;

    async fn delete(&self, id: Uuid) -> Result<(), DbError>;

    async fn list_all(&self) -> Result<Vec<Policy>, DbError>;
}

pub struct SqlxPolicyRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxPolicyRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }

    fn from_row(row: &AnyRow) -> Result<Policy, DbError> {
        let id: String = row.try_get("id")?;
        let name: String = row.try_get("name")?;
        let library_allow: String = row.try_get("library_allow")?;
        let blocked_folders: String = row.try_get("blocked_folders")?;
        let max_rating: Option<String> = row.try_get("max_rating")?;
        let blocked_tags: String = row.try_get("blocked_tags")?;
        let allowed_tags: String = row.try_get("allowed_tags")?;
        let can_transcode: i64 = row.try_get("can_transcode")?;
        let can_download: i64 = row.try_get("can_download")?;
        let can_delete: i64 = row.try_get("can_delete")?;
        let can_share_public: i64 = row.try_get("can_share_public")?;
        let device_allow: String = row.try_get("device_allow")?;
        let max_concurrent_sessions: Option<i64> = row.try_get("max_concurrent_sessions")?;
        let access_schedule: Option<String> = row.try_get("access_schedule")?;
        let can_stream: i64 = row.try_get("can_stream")?;
        let is_admin: i64 = row.try_get("is_admin")?;

        Ok(Policy {
            id: parse_uuid(&id)?,
            name,
            library_allow: serde_json::from_str(&library_allow)?,
            blocked_folders: serde_json::from_str(&blocked_folders)?,
            max_rating,
            blocked_tags: serde_json::from_str(&blocked_tags)?,
            allowed_tags: serde_json::from_str(&allowed_tags)?,
            can_transcode: can_transcode != 0,
            can_download: can_download != 0,
            can_delete: can_delete != 0,
            can_share_public: can_share_public != 0,
            device_allow: serde_json::from_str(&device_allow)?,
            // Always written from a non-negative `u32` (see `upsert`
            // below), so casting back is lossless for any value this
            // repository itself ever stored.
            max_concurrent_sessions: max_concurrent_sessions.map(|n| n as u32),
            access_schedule: access_schedule
                .map(|raw| serde_json::from_str(&raw))
                .transpose()?,
            can_stream: can_stream != 0,
            is_admin: is_admin != 0,
        })
    }
}

#[async_trait]
impl PolicyRepo for SqlxPolicyRepo {
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Policy>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, name, library_allow, blocked_folders, max_rating, blocked_tags, \
                 allowed_tags, can_transcode, can_download, can_delete, can_share_public, \
                 device_allow, max_concurrent_sessions, access_schedule, can_stream, is_admin \
                 FROM policies WHERE id = ?"
            }
            Backend::Postgres => {
                "SELECT id, name, library_allow, blocked_folders, max_rating, blocked_tags, \
                 allowed_tags, can_transcode, can_download, can_delete, can_share_public, \
                 device_allow, max_concurrent_sessions, access_schedule, can_stream, is_admin \
                 FROM policies WHERE id = $1"
            }
        };
        let row = sqlx::query(sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(Self::from_row).transpose()
    }

    async fn upsert(&self, policy: &Policy) -> Result<(), DbError> {
        let library_allow = serde_json::to_string(&policy.library_allow)?;
        let blocked_folders = serde_json::to_string(&policy.blocked_folders)?;
        let blocked_tags = serde_json::to_string(&policy.blocked_tags)?;
        let allowed_tags = serde_json::to_string(&policy.allowed_tags)?;
        let device_allow = serde_json::to_string(&policy.device_allow)?;
        let access_schedule = policy
            .access_schedule
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;

        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO policies \
                 (id, name, library_allow, blocked_folders, max_rating, blocked_tags, \
                 allowed_tags, can_transcode, can_download, can_delete, can_share_public, \
                 device_allow, max_concurrent_sessions, access_schedule, can_stream, is_admin) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                 name = excluded.name, library_allow = excluded.library_allow, \
                 blocked_folders = excluded.blocked_folders, max_rating = excluded.max_rating, \
                 blocked_tags = excluded.blocked_tags, allowed_tags = excluded.allowed_tags, \
                 can_transcode = excluded.can_transcode, can_download = excluded.can_download, \
                 can_delete = excluded.can_delete, can_share_public = excluded.can_share_public, \
                 device_allow = excluded.device_allow, \
                 max_concurrent_sessions = excluded.max_concurrent_sessions, \
                 access_schedule = excluded.access_schedule, can_stream = excluded.can_stream, \
                 is_admin = excluded.is_admin"
            }
            Backend::Postgres => {
                "INSERT INTO policies \
                 (id, name, library_allow, blocked_folders, max_rating, blocked_tags, \
                 allowed_tags, can_transcode, can_download, can_delete, can_share_public, \
                 device_allow, max_concurrent_sessions, access_schedule, can_stream, is_admin) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) \
                 ON CONFLICT (id) DO UPDATE SET \
                 name = excluded.name, library_allow = excluded.library_allow, \
                 blocked_folders = excluded.blocked_folders, max_rating = excluded.max_rating, \
                 blocked_tags = excluded.blocked_tags, allowed_tags = excluded.allowed_tags, \
                 can_transcode = excluded.can_transcode, can_download = excluded.can_download, \
                 can_delete = excluded.can_delete, can_share_public = excluded.can_share_public, \
                 device_allow = excluded.device_allow, \
                 max_concurrent_sessions = excluded.max_concurrent_sessions, \
                 access_schedule = excluded.access_schedule, can_stream = excluded.can_stream, \
                 is_admin = excluded.is_admin"
            }
        };
        sqlx::query(sql)
            .bind(policy.id.to_string())
            .bind(policy.name.as_str())
            .bind(library_allow)
            .bind(blocked_folders)
            .bind(policy.max_rating.as_deref())
            .bind(blocked_tags)
            .bind(allowed_tags)
            .bind(policy.can_transcode as i64)
            .bind(policy.can_download as i64)
            .bind(policy.can_delete as i64)
            .bind(policy.can_share_public as i64)
            .bind(device_allow)
            .bind(policy.max_concurrent_sessions.map(|n| n as i64))
            .bind(access_schedule)
            .bind(policy.can_stream as i64)
            .bind(policy.is_admin as i64)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete(&self, id: Uuid) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "DELETE FROM policies WHERE id = ?",
            Backend::Postgres => "DELETE FROM policies WHERE id = $1",
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

    async fn list_all(&self) -> Result<Vec<Policy>, DbError> {
        let sql = "SELECT id, name, library_allow, blocked_folders, max_rating, blocked_tags, \
                    allowed_tags, can_transcode, can_download, can_delete, can_share_public, \
                    device_allow, max_concurrent_sessions, access_schedule, can_stream, is_admin \
                    FROM policies ORDER BY name";
        let rows = sqlx::query(sql).fetch_all(&self.pool).await?;
        rows.iter().map(Self::from_row).collect()
    }
}

#[cfg(test)]
mod tests {
    use streamarr_model::{AccessWindow, ClientPlatform, TimeRange, Weekday};

    use super::*;
    use crate::pool::test_sqlite_pool;

    fn sample_policy(name: &str) -> Policy {
        Policy {
            id: Uuid::new_v4(),
            name: name.to_string(),
            library_allow: vec![Uuid::new_v4(), Uuid::new_v4()],
            blocked_folders: vec!["/data/pre-release".to_string()],
            max_rating: Some("PG-13".to_string()),
            blocked_tags: vec!["spoiler".to_string()],
            allowed_tags: vec!["family".to_string()],
            can_transcode: true,
            can_download: false,
            can_delete: false,
            can_share_public: false,
            device_allow: vec![ClientPlatform::Web, ClientPlatform::AndroidTv],
            max_concurrent_sessions: Some(3),
            access_schedule: Some(vec![AccessWindow {
                weekday: Weekday::Monday,
                time_range: TimeRange {
                    start_minute_of_day: 360,
                    end_minute_of_day: 1320,
                },
            }]),
            can_stream: true,
            is_admin: false,
        }
    }

    #[tokio::test]
    async fn upsert_then_find_round_trips() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPolicyRepo::new(pool);
        let policy = sample_policy("Family");

        repo.upsert(&policy).await.expect("upsert");
        let fetched = repo.find_by_id(policy.id).await.expect("find_by_id");

        assert_eq!(fetched, Some(policy));
    }

    #[tokio::test]
    async fn find_by_id_missing_returns_none() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPolicyRepo::new(pool);
        let found = repo.find_by_id(Uuid::new_v4()).await.expect("find_by_id");
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn upsert_updates_existing_row() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPolicyRepo::new(pool);
        let mut policy = sample_policy("Original");
        repo.upsert(&policy).await.unwrap();

        policy.name = "Renamed".to_string();
        policy.can_delete = true;
        policy.max_concurrent_sessions = None;
        policy.access_schedule = None;
        policy.max_rating = None;
        repo.upsert(&policy).await.unwrap();

        let fetched = repo.find_by_id(policy.id).await.unwrap();
        assert_eq!(fetched, Some(policy));
    }

    #[tokio::test]
    async fn access_schedule_none_and_empty_vec_stay_distinct() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPolicyRepo::new(pool);

        let mut no_restriction = sample_policy("Always Allowed");
        no_restriction.access_schedule = None;
        let mut lockout = sample_policy("Never Allowed");
        lockout.access_schedule = Some(vec![]);

        repo.upsert(&no_restriction).await.unwrap();
        repo.upsert(&lockout).await.unwrap();

        let fetched_none = repo.find_by_id(no_restriction.id).await.unwrap().unwrap();
        let fetched_empty = repo.find_by_id(lockout.id).await.unwrap().unwrap();
        assert_eq!(fetched_none.access_schedule, None);
        assert_eq!(fetched_empty.access_schedule, Some(vec![]));
    }

    #[tokio::test]
    async fn list_all_orders_by_name() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPolicyRepo::new(pool);

        repo.upsert(&sample_policy("Zebra")).await.unwrap();
        repo.upsert(&sample_policy("Alpha")).await.unwrap();
        repo.upsert(&sample_policy("Mid")).await.unwrap();

        let all = repo.list_all().await.unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].name, "Alpha");
        assert_eq!(all[1].name, "Mid");
        assert_eq!(all[2].name, "Zebra");
    }

    #[tokio::test]
    async fn delete_removes_row() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPolicyRepo::new(pool);
        let policy = sample_policy("Doomed");
        repo.upsert(&policy).await.unwrap();

        repo.delete(policy.id).await.unwrap();
        let found = repo.find_by_id(policy.id).await.unwrap();
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn delete_missing_returns_not_found() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPolicyRepo::new(pool);
        let err = repo.delete(Uuid::new_v4()).await.unwrap_err();
        assert!(matches!(err, DbError::NotFound));
    }
}
