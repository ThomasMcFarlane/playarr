use async_trait::async_trait;
use chrono::{DateTime, Utc};
use playarr_model::Policy;
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};
use crate::repo::user::SyncMetadata;

/// CRUD surface over [`playarr_model::Policy`] -- the permission/
/// entitlement bundle a [`playarr_model::User`] is attached to via
/// `User::policy_id`. Kept as its own repository (rather than folded into
/// `UserRepo`) because policies are shared many-to-one across users and
/// have their own lifecycle (an admin edits a policy independently of any
/// one user it happens to be assigned to).
///
/// `updated_at`/`deleted_at`/`origin_peer_id` (added by
/// `backend/migrations/{postgres/0036,sqlite/0033}_peer_sync_state.sql`,
/// nullable and additive -- see `docs/architecture/peer-groups.md` §2.2)
/// exist purely for cross-node sync bookkeeping and are deliberately not
/// read into [`playarr_model::Policy`] here -- same rationale as
/// `crate::repo::user`'s own doc comment. `upsert` always stamps
/// `updated_at` with the current server time (never a caller-supplied
/// value), `delete` sets `deleted_at` instead of removing the row, and
/// `origin_peer_id` is set exactly once, by
/// [`PolicyRepo::set_origin_peer_id_if_unset`].
#[async_trait]
pub trait PolicyRepo: Send + Sync {
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Policy>, DbError>;

    /// Insert-or-update by `Policy::id`. Always stamps `updated_at` with
    /// the current server time, never a caller-supplied value.
    async fn upsert(&self, policy: &Policy) -> Result<(), DbError>;

    /// Soft-deletes by setting `deleted_at`, rather than a hard `DELETE`.
    /// A no-op (returns [`DbError::NotFound`]) if the row doesn't exist or
    /// is already deleted, exactly like the hard delete this replaced.
    async fn delete(&self, id: Uuid) -> Result<(), DbError>;

    async fn list_all(&self) -> Result<Vec<Policy>, DbError>;

    /// Defaults `origin_peer_id` to `peer_id` on a row that doesn't have
    /// one yet -- called by `playarr-api`'s local-creation handlers
    /// immediately after `upsert` on a freshly-inserted row, never by
    /// `upsert` itself. See `crate::repo::user::UserRepo::
    /// set_origin_peer_id_if_unset`'s doc comment for the full rationale.
    async fn set_origin_peer_id_if_unset(&self, id: Uuid, peer_id: Uuid) -> Result<(), DbError>;

    /// Reads `updated_at`/`origin_peer_id`/`deleted_at` for `id`, regardless
    /// of soft-delete state -- see `crate::repo::user::UserRepo::
    /// get_sync_metadata`'s doc comment for the full rationale, identical
    /// here.
    async fn get_sync_metadata(&self, id: Uuid) -> Result<Option<SyncMetadata>, DbError>;

    /// Applies an already-LWW-resolved incoming row from a peer, writing
    /// `metadata` verbatim -- see `crate::repo::user::UserRepo::
    /// apply_synced`'s doc comment for the full rationale, identical here.
    async fn apply_synced(&self, policy: &Policy, metadata: SyncMetadata) -> Result<(), DbError>;

    /// Every row whose `updated_at` is strictly greater than `since` (every
    /// row, oldest first, when `since` is `None`), paired with its
    /// [`SyncMetadata`] -- see `crate::repo::user::UserRepo::
    /// list_updated_since`'s doc comment for the full rationale, identical
    /// here (including deliberately not filtering `deleted_at IS NULL`, so a
    /// tombstoned policy still propagates). The read behind `GET
    /// /api/v1/peer/accounts?since=`'s `policies` half.
    async fn list_updated_since(
        &self,
        since: Option<DateTime<Utc>>,
    ) -> Result<Vec<(Policy, SyncMetadata)>, DbError>;
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
        let group_library_allow: String = row.try_get("group_library_allow")?;
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
        let household: String = row.try_get("household")?;
        let can_request: i64 = row.try_get("can_request")?;

        Ok(Policy {
            id: parse_uuid(&id)?,
            name,
            library_allow: serde_json::from_str(&library_allow)?,
            group_library_allow: serde_json::from_str(&group_library_allow)?,
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
            household: serde_json::from_str(&household)?,
            can_request: can_request != 0,
        })
    }

    /// Same row shape as [`Self::from_row`], plus the three sync-only
    /// columns parsed into a [`SyncMetadata`] -- see
    /// `crate::repo::user::SqlxUserRepo::from_row_with_metadata`'s doc
    /// comment for the identical rationale.
    fn from_row_with_metadata(row: &AnyRow) -> Result<(Policy, SyncMetadata), DbError> {
        let policy = Self::from_row(row)?;
        let updated_at: Option<String> = row.try_get("updated_at")?;
        let origin_peer_id: Option<String> = row.try_get("origin_peer_id")?;
        let deleted_at: Option<String> = row.try_get("deleted_at")?;
        let metadata = SyncMetadata {
            updated_at: updated_at
                .as_deref()
                .map(parse_datetime)
                .transpose()?
                .unwrap_or_default(),
            origin_peer_id: origin_peer_id.as_deref().map(parse_uuid).transpose()?,
            deleted_at: deleted_at.as_deref().map(parse_datetime).transpose()?,
        };
        Ok((policy, metadata))
    }
}

#[async_trait]
impl PolicyRepo for SqlxPolicyRepo {
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Policy>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, name, library_allow, group_library_allow, blocked_folders, max_rating, \
                 blocked_tags, allowed_tags, can_transcode, can_download, can_delete, \
                 can_share_public, device_allow, max_concurrent_sessions, access_schedule, \
                 can_stream, is_admin, household, can_request \
                 FROM policies WHERE id = ? AND deleted_at IS NULL"
            }
            Backend::Postgres => {
                "SELECT id, name, library_allow, group_library_allow, blocked_folders, max_rating, \
                 blocked_tags, allowed_tags, can_transcode, can_download, can_delete, \
                 can_share_public, device_allow, max_concurrent_sessions, access_schedule, \
                 can_stream, is_admin, household, can_request \
                 FROM policies WHERE id = $1 AND deleted_at IS NULL"
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
        let group_library_allow = serde_json::to_string(&policy.group_library_allow)?;
        let blocked_folders = serde_json::to_string(&policy.blocked_folders)?;
        let blocked_tags = serde_json::to_string(&policy.blocked_tags)?;
        let allowed_tags = serde_json::to_string(&policy.allowed_tags)?;
        let device_allow = serde_json::to_string(&policy.device_allow)?;
        let access_schedule = policy
            .access_schedule
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let household = serde_json::to_string(&policy.household)?;

        // `updated_at` is bound once below from the server clock, never a
        // caller-supplied value -- see this module's own doc comment.
        // `origin_peer_id` is deliberately absent from both the column
        // list and `DO UPDATE SET` -- same reasoning as `SqlxUserRepo::
        // upsert`: a fresh row's value stays `NULL` until `set_origin_
        // peer_id_if_unset` sets it once, and an update through this
        // method can never clobber an existing row's origin claim.
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO policies \
                 (id, name, library_allow, group_library_allow, blocked_folders, max_rating, \
                 blocked_tags, allowed_tags, can_transcode, can_download, can_delete, \
                 can_share_public, device_allow, max_concurrent_sessions, access_schedule, \
                 can_stream, is_admin, updated_at, household, can_request) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                 name = excluded.name, library_allow = excluded.library_allow, \
                 group_library_allow = excluded.group_library_allow, \
                 blocked_folders = excluded.blocked_folders, max_rating = excluded.max_rating, \
                 blocked_tags = excluded.blocked_tags, allowed_tags = excluded.allowed_tags, \
                 can_transcode = excluded.can_transcode, can_download = excluded.can_download, \
                 can_delete = excluded.can_delete, can_share_public = excluded.can_share_public, \
                 device_allow = excluded.device_allow, \
                 max_concurrent_sessions = excluded.max_concurrent_sessions, \
                 access_schedule = excluded.access_schedule, can_stream = excluded.can_stream, \
                 is_admin = excluded.is_admin, updated_at = excluded.updated_at, \
                 household = excluded.household, can_request = excluded.can_request"
            }
            Backend::Postgres => {
                "INSERT INTO policies \
                 (id, name, library_allow, group_library_allow, blocked_folders, max_rating, \
                 blocked_tags, allowed_tags, can_transcode, can_download, can_delete, \
                 can_share_public, device_allow, max_concurrent_sessions, access_schedule, \
                 can_stream, is_admin, updated_at, household, can_request) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, \
                 $17, $18, $19, $20) \
                 ON CONFLICT (id) DO UPDATE SET \
                 name = excluded.name, library_allow = excluded.library_allow, \
                 group_library_allow = excluded.group_library_allow, \
                 blocked_folders = excluded.blocked_folders, max_rating = excluded.max_rating, \
                 blocked_tags = excluded.blocked_tags, allowed_tags = excluded.allowed_tags, \
                 can_transcode = excluded.can_transcode, can_download = excluded.can_download, \
                 can_delete = excluded.can_delete, can_share_public = excluded.can_share_public, \
                 device_allow = excluded.device_allow, \
                 max_concurrent_sessions = excluded.max_concurrent_sessions, \
                 access_schedule = excluded.access_schedule, can_stream = excluded.can_stream, \
                 is_admin = excluded.is_admin, updated_at = excluded.updated_at, \
                 household = excluded.household, can_request = excluded.can_request"
            }
        };
        sqlx::query(sql)
            .bind(policy.id.to_string())
            .bind(policy.name.as_str())
            .bind(library_allow)
            .bind(group_library_allow)
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
            .bind(format_datetime(chrono::Utc::now()))
            .bind(household)
            .bind(policy.can_request as i64)
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
                "UPDATE policies SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL"
            }
            Backend::Postgres => {
                "UPDATE policies SET deleted_at = $1 WHERE id = $2 AND deleted_at IS NULL"
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

    async fn list_all(&self) -> Result<Vec<Policy>, DbError> {
        let sql = "SELECT id, name, library_allow, group_library_allow, blocked_folders, \
                    max_rating, blocked_tags, allowed_tags, can_transcode, can_download, \
                    can_delete, can_share_public, device_allow, max_concurrent_sessions, \
                    access_schedule, can_stream, is_admin, household, can_request \
                    FROM policies WHERE deleted_at IS NULL ORDER BY name";
        let rows = sqlx::query(sql).fetch_all(&self.pool).await?;
        rows.iter().map(Self::from_row).collect()
    }

    async fn set_origin_peer_id_if_unset(&self, id: Uuid, peer_id: Uuid) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "UPDATE policies SET origin_peer_id = ? WHERE id = ? AND origin_peer_id IS NULL"
            }
            Backend::Postgres => {
                "UPDATE policies SET origin_peer_id = $1 WHERE id = $2 AND origin_peer_id IS NULL"
            }
        };
        sqlx::query(sql)
            .bind(peer_id.to_string())
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn get_sync_metadata(&self, id: Uuid) -> Result<Option<SyncMetadata>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT updated_at, origin_peer_id, deleted_at FROM policies WHERE id = ?"
            }
            Backend::Postgres => {
                "SELECT updated_at, origin_peer_id, deleted_at FROM policies WHERE id = $1"
            }
        };
        let row = sqlx::query(sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.map(|row| {
            let updated_at: Option<String> = row.try_get("updated_at")?;
            let origin_peer_id: Option<String> = row.try_get("origin_peer_id")?;
            let deleted_at: Option<String> = row.try_get("deleted_at")?;
            Ok(SyncMetadata {
                updated_at: updated_at
                    .as_deref()
                    .map(parse_datetime)
                    .transpose()?
                    .unwrap_or_default(),
                origin_peer_id: origin_peer_id.as_deref().map(parse_uuid).transpose()?,
                deleted_at: deleted_at.as_deref().map(parse_datetime).transpose()?,
            })
        })
        .transpose()
    }

    async fn apply_synced(&self, policy: &Policy, metadata: SyncMetadata) -> Result<(), DbError> {
        let library_allow = serde_json::to_string(&policy.library_allow)?;
        let group_library_allow = serde_json::to_string(&policy.group_library_allow)?;
        let blocked_folders = serde_json::to_string(&policy.blocked_folders)?;
        let blocked_tags = serde_json::to_string(&policy.blocked_tags)?;
        let allowed_tags = serde_json::to_string(&policy.allowed_tags)?;
        let device_allow = serde_json::to_string(&policy.device_allow)?;
        let access_schedule = policy
            .access_schedule
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let household = serde_json::to_string(&policy.household)?;

        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO policies \
                 (id, name, library_allow, group_library_allow, blocked_folders, max_rating, \
                 blocked_tags, allowed_tags, can_transcode, can_download, can_delete, \
                 can_share_public, device_allow, max_concurrent_sessions, access_schedule, \
                 can_stream, is_admin, updated_at, origin_peer_id, deleted_at, household, can_request) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                 name = excluded.name, library_allow = excluded.library_allow, \
                 group_library_allow = excluded.group_library_allow, \
                 blocked_folders = excluded.blocked_folders, max_rating = excluded.max_rating, \
                 blocked_tags = excluded.blocked_tags, allowed_tags = excluded.allowed_tags, \
                 can_transcode = excluded.can_transcode, can_download = excluded.can_download, \
                 can_delete = excluded.can_delete, can_share_public = excluded.can_share_public, \
                 device_allow = excluded.device_allow, \
                 max_concurrent_sessions = excluded.max_concurrent_sessions, \
                 access_schedule = excluded.access_schedule, can_stream = excluded.can_stream, \
                 is_admin = excluded.is_admin, updated_at = excluded.updated_at, \
                 origin_peer_id = excluded.origin_peer_id, deleted_at = excluded.deleted_at, \
                 household = excluded.household, can_request = excluded.can_request"
            }
            Backend::Postgres => {
                "INSERT INTO policies \
                 (id, name, library_allow, group_library_allow, blocked_folders, max_rating, \
                 blocked_tags, allowed_tags, can_transcode, can_download, can_delete, \
                 can_share_public, device_allow, max_concurrent_sessions, access_schedule, \
                 can_stream, is_admin, updated_at, origin_peer_id, deleted_at, household, can_request) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, \
                 $17, $18, $19, $20, $21, $22) \
                 ON CONFLICT (id) DO UPDATE SET \
                 name = excluded.name, library_allow = excluded.library_allow, \
                 group_library_allow = excluded.group_library_allow, \
                 blocked_folders = excluded.blocked_folders, max_rating = excluded.max_rating, \
                 blocked_tags = excluded.blocked_tags, allowed_tags = excluded.allowed_tags, \
                 can_transcode = excluded.can_transcode, can_download = excluded.can_download, \
                 can_delete = excluded.can_delete, can_share_public = excluded.can_share_public, \
                 device_allow = excluded.device_allow, \
                 max_concurrent_sessions = excluded.max_concurrent_sessions, \
                 access_schedule = excluded.access_schedule, can_stream = excluded.can_stream, \
                 is_admin = excluded.is_admin, updated_at = excluded.updated_at, \
                 origin_peer_id = excluded.origin_peer_id, deleted_at = excluded.deleted_at, \
                 household = excluded.household, can_request = excluded.can_request"
            }
        };
        sqlx::query(sql)
            .bind(policy.id.to_string())
            .bind(policy.name.as_str())
            .bind(library_allow)
            .bind(group_library_allow)
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
            .bind(format_datetime(metadata.updated_at))
            .bind(metadata.origin_peer_id.map(|id| id.to_string()))
            .bind(metadata.deleted_at.map(format_datetime))
            .bind(household)
            .bind(policy.can_request as i64)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn list_updated_since(
        &self,
        since: Option<DateTime<Utc>>,
    ) -> Result<Vec<(Policy, SyncMetadata)>, DbError> {
        const SELECT: &str = "id, name, library_allow, group_library_allow, blocked_folders, \
                               max_rating, blocked_tags, allowed_tags, can_transcode, \
                               can_download, can_delete, can_share_public, device_allow, \
                               max_concurrent_sessions, access_schedule, can_stream, is_admin, household, can_request, \
                               updated_at, origin_peer_id, deleted_at";
        // Deliberately no `WHERE deleted_at IS NULL` -- see this trait
        // method's own doc comment.
        let sql = match (self.backend, since.is_some()) {
            (Backend::Sqlite, true) => {
                format!("SELECT {SELECT} FROM policies WHERE updated_at > ? ORDER BY updated_at ASC, id ASC")
            }
            (Backend::Sqlite, false) => {
                format!("SELECT {SELECT} FROM policies ORDER BY updated_at ASC, id ASC")
            }
            (Backend::Postgres, true) => {
                format!("SELECT {SELECT} FROM policies WHERE updated_at > $1 ORDER BY updated_at ASC, id ASC")
            }
            (Backend::Postgres, false) => {
                format!("SELECT {SELECT} FROM policies ORDER BY updated_at ASC, id ASC")
            }
        };
        let mut query = sqlx::query(&sql);
        if let Some(since) = since {
            query = query.bind(format_datetime(since));
        }
        let rows = query.fetch_all(&self.pool).await?;
        rows.iter().map(Self::from_row_with_metadata).collect()
    }
}

#[cfg(test)]
mod tests {
    use chrono::{SubsecRound, Utc};
    use playarr_model::{AccessWindow, ClientPlatform, TimeRange, Weekday};

    use super::*;
    use crate::codec::parse_datetime;
    use crate::pool::test_sqlite_pool;

    fn sample_policy(name: &str) -> Policy {
        Policy {
            id: Uuid::new_v4(),
            name: name.to_string(),
            library_allow: vec![Uuid::new_v4(), Uuid::new_v4()],
            group_library_allow: vec![Uuid::new_v4()],
            blocked_folders: vec!["/data/pre-release".to_string()],
            max_rating: Some("PG-13".to_string()),
            blocked_tags: vec!["spoiler".to_string()],
            allowed_tags: vec!["family".to_string()],
            can_transcode: true,
            can_download: false,
            can_delete: false,
            can_share_public: false,
            can_request: true,
            device_allow: vec![ClientPlatform::Web, ClientPlatform::AndroidTv],
            max_concurrent_sessions: Some(3),
            household: playarr_model::HouseholdControls {
                unrated: playarr_model::UnratedContent::Allow,
                timezone: Some("Europe/London".to_string()),
                daily_budget_minutes: Some(90),
                game_allow: Some(vec![]),
                guardian_user_ids: vec![Uuid::new_v4()],
                approval_required: vec![playarr_model::ApprovalKind::Purchase],
                offline_ttl_hours: Some(12),
                ..Default::default()
            },
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

    #[tokio::test]
    async fn delete_soft_deletes_the_row_instead_of_removing_it() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPolicyRepo::new(pool.clone());
        let policy = sample_policy("Tombstoned");
        repo.upsert(&policy).await.unwrap();

        repo.delete(policy.id).await.unwrap();

        let (count, deleted_at): (i64, Option<String>) =
            sqlx::query_as("SELECT COUNT(*), MAX(deleted_at) FROM policies WHERE id = ?")
                .bind(policy.id.to_string())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 1, "soft delete must not remove the row");
        assert!(deleted_at.is_some());

        assert!(repo.find_by_id(policy.id).await.unwrap().is_none());
        assert!(!repo
            .list_all()
            .await
            .unwrap()
            .iter()
            .any(|p| p.id == policy.id));

        let err = repo.delete(policy.id).await.unwrap_err();
        assert!(matches!(err, DbError::NotFound));
    }

    #[tokio::test]
    async fn upsert_stamps_updated_at_from_the_server_clock() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPolicyRepo::new(pool.clone());
        // Truncated to millisecond precision to match `format_datetime`'s
        // own storage precision -- see the identical note in
        // `crate::repo::user`'s own version of this test.
        let before = Utc::now().trunc_subsecs(3);
        let policy = sample_policy("Freshly Written");

        repo.upsert(&policy).await.unwrap();

        let (updated_at,): (Option<String>,) =
            sqlx::query_as("SELECT updated_at FROM policies WHERE id = ?")
                .bind(policy.id.to_string())
                .fetch_one(&pool)
                .await
                .unwrap();
        let updated_at =
            parse_datetime(&updated_at.expect("upsert always sets updated_at")).unwrap();
        assert!(updated_at >= before);
        assert!(updated_at <= Utc::now());
    }

    #[tokio::test]
    async fn set_origin_peer_id_if_unset_sets_once_and_never_overwrites() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPolicyRepo::new(pool.clone());
        let policy = sample_policy("Origin Tracked");
        repo.upsert(&policy).await.unwrap();

        let first_peer = Uuid::new_v4();
        repo.set_origin_peer_id_if_unset(policy.id, first_peer)
            .await
            .unwrap();
        let (origin,): (Option<String>,) =
            sqlx::query_as("SELECT origin_peer_id FROM policies WHERE id = ?")
                .bind(policy.id.to_string())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(origin, Some(first_peer.to_string()));

        let second_peer = Uuid::new_v4();
        repo.set_origin_peer_id_if_unset(policy.id, second_peer)
            .await
            .unwrap();
        let (origin,): (Option<String>,) =
            sqlx::query_as("SELECT origin_peer_id FROM policies WHERE id = ?")
                .bind(policy.id.to_string())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(origin, Some(first_peer.to_string()));

        let mut updated = policy.clone();
        updated.name = "Renamed".to_string();
        repo.upsert(&updated).await.unwrap();
        let (origin,): (Option<String>,) =
            sqlx::query_as("SELECT origin_peer_id FROM policies WHERE id = ?")
                .bind(policy.id.to_string())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(origin, Some(first_peer.to_string()));
    }

    #[tokio::test]
    async fn get_sync_metadata_missing_row_returns_none() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPolicyRepo::new(pool);
        assert!(repo
            .get_sync_metadata(Uuid::new_v4())
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn apply_synced_writes_the_caller_supplied_metadata_verbatim() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPolicyRepo::new(pool.clone());
        let policy = sample_policy("Synced In");
        let origin_peer_id = Uuid::new_v4();
        let claimed_updated_at = Utc::now().trunc_subsecs(3) - chrono::Duration::hours(2);

        repo.apply_synced(
            &policy,
            SyncMetadata {
                updated_at: claimed_updated_at,
                origin_peer_id: Some(origin_peer_id),
                deleted_at: None,
            },
        )
        .await
        .expect("apply_synced");

        let fetched = repo.find_by_id(policy.id).await.unwrap();
        assert_eq!(fetched, Some(policy.clone()));
        let metadata = repo.get_sync_metadata(policy.id).await.unwrap().unwrap();
        assert_eq!(metadata.updated_at, claimed_updated_at);
        assert_eq!(metadata.origin_peer_id, Some(origin_peer_id));
        assert_eq!(metadata.deleted_at, None);
    }

    #[tokio::test]
    async fn apply_synced_can_write_a_tombstone_and_updates_existing_rows() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPolicyRepo::new(pool.clone());
        let policy = sample_policy("Synced Tombstone");
        let origin_peer_id = Uuid::new_v4();
        let first = Utc::now().trunc_subsecs(3) - chrono::Duration::hours(1);
        repo.apply_synced(
            &policy,
            SyncMetadata {
                updated_at: first,
                origin_peer_id: Some(origin_peer_id),
                deleted_at: None,
            },
        )
        .await
        .unwrap();

        let deleted_at = Utc::now().trunc_subsecs(3);
        repo.apply_synced(
            &policy,
            SyncMetadata {
                updated_at: deleted_at,
                origin_peer_id: Some(origin_peer_id),
                deleted_at: Some(deleted_at),
            },
        )
        .await
        .unwrap();

        assert!(repo.find_by_id(policy.id).await.unwrap().is_none());
        let metadata = repo.get_sync_metadata(policy.id).await.unwrap().unwrap();
        assert_eq!(metadata.deleted_at, Some(deleted_at));
    }

    #[tokio::test]
    async fn list_updated_since_none_returns_every_row_including_soft_deleted() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPolicyRepo::new(pool.clone());
        let kept = sample_policy("Kept");
        let tombstoned = sample_policy("Tombstoned For Sync");
        repo.upsert(&kept).await.unwrap();
        repo.upsert(&tombstoned).await.unwrap();
        repo.delete(tombstoned.id).await.unwrap();

        let rows = repo.list_updated_since(None).await.unwrap();
        let ids: Vec<Uuid> = rows.iter().map(|(policy, _)| policy.id).collect();
        assert!(ids.contains(&kept.id));
        assert!(
            ids.contains(&tombstoned.id),
            "a soft-deleted row must still be reported so its tombstone can propagate"
        );
        let (_, tombstoned_meta) = rows
            .iter()
            .find(|(policy, _)| policy.id == tombstoned.id)
            .unwrap();
        assert!(tombstoned_meta.deleted_at.is_some());
    }

    #[tokio::test]
    async fn list_updated_since_a_cursor_excludes_rows_at_or_before_it() {
        // Explicit, well-separated `updated_at` values via `apply_synced`,
        // rather than two back-to-back `upsert`s, so the cursor comparison
        // isn't at the mercy of two writes landing in the same millisecond
        // of server-clock precision -- same reasoning as the identical test
        // in `crate::repo::user`.
        let pool = test_sqlite_pool().await;
        let repo = SqlxPolicyRepo::new(pool.clone());
        let now = Utc::now().trunc_subsecs(3);
        let old = sample_policy("Already Synced");
        let cursor = now - chrono::Duration::minutes(10);
        repo.apply_synced(
            &old,
            SyncMetadata {
                updated_at: cursor,
                origin_peer_id: None,
                deleted_at: None,
            },
        )
        .await
        .unwrap();

        let fresh = sample_policy("Freshly Changed");
        repo.apply_synced(
            &fresh,
            SyncMetadata {
                updated_at: now,
                origin_peer_id: None,
                deleted_at: None,
            },
        )
        .await
        .unwrap();

        let rows = repo.list_updated_since(Some(cursor)).await.unwrap();
        let ids: Vec<Uuid> = rows.iter().map(|(policy, _)| policy.id).collect();
        assert!(
            !ids.contains(&old.id),
            "a row at or before the cursor must not be re-reported"
        );
        assert!(ids.contains(&fresh.id));
    }

    #[tokio::test]
    async fn list_updated_since_orders_oldest_first() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPolicyRepo::new(pool.clone());
        let now = Utc::now().trunc_subsecs(3);
        let older = sample_policy("Older Write");
        let newer = sample_policy("Newer Write");
        repo.apply_synced(
            &newer,
            SyncMetadata {
                updated_at: now,
                origin_peer_id: None,
                deleted_at: None,
            },
        )
        .await
        .unwrap();
        repo.apply_synced(
            &older,
            SyncMetadata {
                updated_at: now - chrono::Duration::minutes(10),
                origin_peer_id: None,
                deleted_at: None,
            },
        )
        .await
        .unwrap();

        let rows = repo.list_updated_since(None).await.unwrap();
        let position = |id: Uuid| rows.iter().position(|(policy, _)| policy.id == id).unwrap();
        assert!(position(older.id) < position(newer.id));
    }
}
