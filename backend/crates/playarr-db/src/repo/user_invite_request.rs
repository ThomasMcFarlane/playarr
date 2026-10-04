use async_trait::async_trait;
use chrono::{DateTime, Utc};
use playarr_model::{UserInvite, UserInviteRequest, UserInviteRequestStatus};
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{decode_err, format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

fn status_to_str(status: UserInviteRequestStatus) -> &'static str {
    match status {
        UserInviteRequestStatus::Pending => "pending",
        UserInviteRequestStatus::Approved => "approved",
        UserInviteRequestStatus::Denied => "denied",
        UserInviteRequestStatus::Generated => "generated",
    }
}

fn status_from_str(value: &str) -> Result<UserInviteRequestStatus, DbError> {
    match value {
        "pending" => Ok(UserInviteRequestStatus::Pending),
        "approved" => Ok(UserInviteRequestStatus::Approved),
        "denied" => Ok(UserInviteRequestStatus::Denied),
        "generated" => Ok(UserInviteRequestStatus::Generated),
        _ => Err(decode_err(format!(
            "unknown invite request status {value:?}"
        ))),
    }
}

fn from_row(row: &AnyRow) -> Result<UserInviteRequest, DbError> {
    let id: String = row.try_get("id")?;
    let user_id: String = row.try_get("user_id")?;
    let message: Option<String> = row.try_get("message")?;
    let status: String = row.try_get("status")?;
    let requested_at: String = row.try_get("requested_at")?;
    let reviewed_by: Option<String> = row.try_get("reviewed_by")?;
    let reviewed_at: Option<String> = row.try_get("reviewed_at")?;
    let generated_at: Option<String> = row.try_get("generated_at")?;
    let can_stream: i64 = row.try_get("can_stream")?;
    let library_allow: String = row.try_get("library_allow")?;
    let group_library_allow: String = row.try_get("group_library_allow")?;
    Ok(UserInviteRequest {
        id: parse_uuid(&id)?,
        user_id: parse_uuid(&user_id)?,
        message,
        status: status_from_str(&status)?,
        requested_at: parse_datetime(&requested_at)?,
        reviewed_by: reviewed_by.map(|value| parse_uuid(&value)).transpose()?,
        reviewed_at: reviewed_at
            .map(|value| parse_datetime(&value))
            .transpose()?,
        generated_at: generated_at
            .map(|value| parse_datetime(&value))
            .transpose()?,
        can_stream: can_stream != 0,
        library_allow: serde_json::from_str(&library_allow)?,
        group_library_allow: serde_json::from_str(&group_library_allow)?,
    })
}

const COLUMNS: &str = "id, user_id, message, status, requested_at, reviewed_by, reviewed_at, \
                        generated_at, can_stream, library_allow, group_library_allow";

#[async_trait]
pub trait UserInviteRequestRepo: Send + Sync {
    async fn create(&self, request: &UserInviteRequest) -> Result<(), DbError>;

    /// Insert-or-update by `UserInviteRequest::id` -- `account_sync.rs`
    /// (`playarr-peer-sync`) calls this for every row a peer gossips via
    /// `GET /api/v1/peer/invites`. Unlike `UserInviteRepo::upsert` (which,
    /// as of §2.5's invite-portability work, ratchets a `user_invites` row
    /// toward consumed but otherwise leaves an existing row untouched -- see
    /// that method's own doc comment), a request's `status`/`reviewed_*`/
    /// `generated_at` genuinely can move forward between sync passes
    /// (`review`/`generate_invite` on whichever peer an admin is using) --
    /// `user_invite_requests` (unlike `user_invites`) still has no
    /// `updated_at` column, so this always applies the incoming row rather
    /// than comparing timestamps: acceptable because there is exactly one
    /// admin-driven state machine per request (`pending` ->
    /// `approved`/`denied` -> `generated`), not concurrent independent
    /// writers, so the latest gossip is always at least as advanced as what
    /// this node already has.
    async fn upsert(&self, request: &UserInviteRequest) -> Result<(), DbError>;

    async fn find_by_id(&self, id: Uuid) -> Result<Option<UserInviteRequest>, DbError>;
    async fn find_latest_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Option<UserInviteRequest>, DbError>;
    async fn list_all(&self) -> Result<Vec<UserInviteRequest>, DbError>;
    #[allow(clippy::too_many_arguments)]
    async fn review(
        &self,
        id: Uuid,
        reviewer_id: Uuid,
        status: UserInviteRequestStatus,
        reviewed_at: DateTime<Utc>,
        can_stream: bool,
        library_allow: &[Uuid],
        group_library_allow: &[Uuid],
    ) -> Result<bool, DbError>;
    /// Atomically consumes an approved request and persists its final bearer
    /// invitation, so concurrent Generate clicks cannot mint two QR codes.
    async fn generate_invite(
        &self,
        id: Uuid,
        user_id: Uuid,
        generated_at: DateTime<Utc>,
        invite: &UserInvite,
    ) -> Result<bool, DbError>;

    /// Every row whose `requested_at` is strictly greater than `since`
    /// (every row, oldest first, when `since` is `None`) -- the read behind
    /// `GET /api/v1/peer/invites?since=`'s `invite_requests` half
    /// (`docs/architecture/peer-groups.md` §3.1/§3.6). Cursors on
    /// `requested_at`, not `updated_at`: unlike `user_invites`
    /// (`UserInviteRepo::list_updated_since`), this table still has no
    /// `updated_at` column (see this trait's own `upsert` doc comment).
    /// `requested_at` never changes after a request is filed -- only
    /// `status`/`reviewed_*`/`generated_at` move -- so unlike
    /// `UserInviteRepo::list_updated_since` this cursor does **not** track
    /// every field change to a row, only whether the row itself is new to
    /// this cursor position. That's an accepted gap for the same reason
    /// `Self::upsert`'s own doc comment gives for applying every gossiped
    /// row unconditionally rather than diffing: there is one admin-driven
    /// state machine per request, so a peer that already saw this row will
    /// simply re-receive (and safely re-apply) it on a future full-refresh
    /// pass rather than through this cursor -- `account_sync.rs`'s
    /// `sync_invites` doesn't yet track a finer-grained cursor for in-place
    /// state moves, only new rows.
    async fn list_requested_since(
        &self,
        since: Option<DateTime<Utc>>,
    ) -> Result<Vec<UserInviteRequest>, DbError>;
}

pub struct SqlxUserInviteRequestRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxUserInviteRequestRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }
}

#[async_trait]
impl UserInviteRequestRepo for SqlxUserInviteRequestRepo {
    async fn create(&self, request: &UserInviteRequest) -> Result<(), DbError> {
        let library_allow = serde_json::to_string(&request.library_allow)?;
        let group_library_allow = serde_json::to_string(&request.group_library_allow)?;
        let sql = match self.backend {
            Backend::Sqlite => {
                format!("INSERT INTO user_invite_requests ({COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            }
            Backend::Postgres => format!(
                "INSERT INTO user_invite_requests ({COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"
            ),
        };
        sqlx::query(&sql)
            .bind(request.id.to_string())
            .bind(request.user_id.to_string())
            .bind(&request.message)
            .bind(status_to_str(request.status))
            .bind(format_datetime(request.requested_at))
            .bind(request.reviewed_by.map(|id| id.to_string()))
            .bind(request.reviewed_at.map(format_datetime))
            .bind(request.generated_at.map(format_datetime))
            .bind(i64::from(request.can_stream))
            .bind(library_allow)
            .bind(group_library_allow)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn upsert(&self, request: &UserInviteRequest) -> Result<(), DbError> {
        let library_allow = serde_json::to_string(&request.library_allow)?;
        let group_library_allow = serde_json::to_string(&request.group_library_allow)?;
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO user_invite_requests \
                 (id, user_id, message, status, requested_at, reviewed_by, reviewed_at, \
                 generated_at, can_stream, library_allow, group_library_allow) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                 message = excluded.message, status = excluded.status, \
                 requested_at = excluded.requested_at, reviewed_by = excluded.reviewed_by, \
                 reviewed_at = excluded.reviewed_at, generated_at = excluded.generated_at, \
                 can_stream = excluded.can_stream, library_allow = excluded.library_allow, \
                 group_library_allow = excluded.group_library_allow"
            }
            Backend::Postgres => {
                "INSERT INTO user_invite_requests \
                 (id, user_id, message, status, requested_at, reviewed_by, reviewed_at, \
                 generated_at, can_stream, library_allow, group_library_allow) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) \
                 ON CONFLICT (id) DO UPDATE SET \
                 message = excluded.message, status = excluded.status, \
                 requested_at = excluded.requested_at, reviewed_by = excluded.reviewed_by, \
                 reviewed_at = excluded.reviewed_at, generated_at = excluded.generated_at, \
                 can_stream = excluded.can_stream, library_allow = excluded.library_allow, \
                 group_library_allow = excluded.group_library_allow"
            }
        };
        sqlx::query(sql)
            .bind(request.id.to_string())
            .bind(request.user_id.to_string())
            .bind(&request.message)
            .bind(status_to_str(request.status))
            .bind(format_datetime(request.requested_at))
            .bind(request.reviewed_by.map(|id| id.to_string()))
            .bind(request.reviewed_at.map(format_datetime))
            .bind(request.generated_at.map(format_datetime))
            .bind(i64::from(request.can_stream))
            .bind(library_allow)
            .bind(group_library_allow)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn find_by_id(&self, id: Uuid) -> Result<Option<UserInviteRequest>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => format!("SELECT {COLUMNS} FROM user_invite_requests WHERE id = ?"),
            Backend::Postgres => {
                format!("SELECT {COLUMNS} FROM user_invite_requests WHERE id = $1")
            }
        };
        let row = sqlx::query(&sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(from_row).transpose()
    }

    async fn find_latest_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Option<UserInviteRequest>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => format!(
                "SELECT {COLUMNS} FROM user_invite_requests WHERE user_id = ? ORDER BY requested_at DESC LIMIT 1"
            ),
            Backend::Postgres => format!(
                "SELECT {COLUMNS} FROM user_invite_requests WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 1"
            ),
        };
        let row = sqlx::query(&sql)
            .bind(user_id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(from_row).transpose()
    }

    async fn list_all(&self) -> Result<Vec<UserInviteRequest>, DbError> {
        let sql = format!("SELECT {COLUMNS} FROM user_invite_requests ORDER BY requested_at DESC");
        let rows = sqlx::query(&sql).fetch_all(&self.pool).await?;
        rows.iter().map(from_row).collect()
    }

    #[allow(clippy::too_many_arguments)]
    async fn review(
        &self,
        id: Uuid,
        reviewer_id: Uuid,
        status: UserInviteRequestStatus,
        reviewed_at: DateTime<Utc>,
        can_stream: bool,
        library_allow: &[Uuid],
        group_library_allow: &[Uuid],
    ) -> Result<bool, DbError> {
        debug_assert!(matches!(
            status,
            UserInviteRequestStatus::Approved | UserInviteRequestStatus::Denied
        ));
        let library_allow = serde_json::to_string(library_allow)?;
        let group_library_allow = serde_json::to_string(group_library_allow)?;
        let sql = match self.backend {
            Backend::Sqlite => {
                "UPDATE user_invite_requests SET status = ?, reviewed_by = ?, reviewed_at = ?, can_stream = ?, library_allow = ?, group_library_allow = ? WHERE id = ? AND status = 'pending'"
            }
            Backend::Postgres => {
                "UPDATE user_invite_requests SET status = $1, reviewed_by = $2, reviewed_at = $3, can_stream = $4, library_allow = $5, group_library_allow = $6 WHERE id = $7 AND status = 'pending'"
            }
        };
        let result = sqlx::query(sql)
            .bind(status_to_str(status))
            .bind(reviewer_id.to_string())
            .bind(format_datetime(reviewed_at))
            .bind(i64::from(can_stream))
            .bind(library_allow)
            .bind(group_library_allow)
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() == 1)
    }

    async fn generate_invite(
        &self,
        id: Uuid,
        user_id: Uuid,
        generated_at: DateTime<Utc>,
        invite: &UserInvite,
    ) -> Result<bool, DbError> {
        let library_allow = serde_json::to_string(&invite.library_allow)?;
        let group_library_allow = serde_json::to_string(&invite.group_library_allow)?;
        let mut transaction = self.pool.begin().await?;
        let update_sql = match self.backend {
            Backend::Sqlite => {
                "UPDATE user_invite_requests SET status = 'generated', generated_at = ? WHERE id = ? AND user_id = ? AND status = 'approved'"
            }
            Backend::Postgres => {
                "UPDATE user_invite_requests SET status = 'generated', generated_at = $1 WHERE id = $2 AND user_id = $3 AND status = 'approved'"
            }
        };
        let result = sqlx::query(update_sql)
            .bind(format_datetime(generated_at))
            .bind(id.to_string())
            .bind(user_id.to_string())
            .execute(&mut *transaction)
            .await?;
        if result.rows_affected() != 1 {
            transaction.rollback().await?;
            return Ok(false);
        }

        let insert_sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO user_invites \
                 (token_hash, created_by, created_at, expires_at, can_stream, library_allow, \
                 group_library_allow, updated_at, consumed_at, consumed_by_user_id, consumed_by_peer_id) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            }
            Backend::Postgres => {
                "INSERT INTO user_invites \
                 (token_hash, created_by, created_at, expires_at, can_stream, library_allow, \
                 group_library_allow, updated_at, consumed_at, consumed_by_user_id, consumed_by_peer_id) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"
            }
        };
        sqlx::query(insert_sql)
            .bind(&invite.token_hash)
            .bind(invite.created_by.to_string())
            .bind(format_datetime(invite.created_at))
            .bind(format_datetime(invite.expires_at))
            .bind(i64::from(invite.can_stream))
            .bind(library_allow)
            .bind(group_library_allow)
            // Same `updated_at`-bootstraps-from-`created_at` convention as
            // `UserInviteRepo::create` -- see that method's own comment.
            .bind(format_datetime(invite.created_at))
            .bind(invite.consumed_at.map(format_datetime))
            .bind(invite.consumed_by_user_id.map(|id| id.to_string()))
            .bind(invite.consumed_by_peer_id.map(|id| id.to_string()))
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(true)
    }

    async fn list_requested_since(
        &self,
        since: Option<DateTime<Utc>>,
    ) -> Result<Vec<UserInviteRequest>, DbError> {
        let sql = match (self.backend, since.is_some()) {
            (Backend::Sqlite, true) => format!(
                "SELECT {COLUMNS} FROM user_invite_requests WHERE requested_at > ? \
                 ORDER BY requested_at ASC, id ASC"
            ),
            (Backend::Sqlite, false) => format!(
                "SELECT {COLUMNS} FROM user_invite_requests ORDER BY requested_at ASC, id ASC"
            ),
            (Backend::Postgres, true) => format!(
                "SELECT {COLUMNS} FROM user_invite_requests WHERE requested_at > $1 \
                 ORDER BY requested_at ASC, id ASC"
            ),
            (Backend::Postgres, false) => format!(
                "SELECT {COLUMNS} FROM user_invite_requests ORDER BY requested_at ASC, id ASC"
            ),
        };
        let mut query = sqlx::query(&sql);
        if let Some(since) = since {
            query = query.bind(format_datetime(since));
        }
        let rows = query.fetch_all(&self.pool).await?;
        rows.iter().map(from_row).collect()
    }
}

#[cfg(test)]
mod tests {
    use playarr_model::{Policy, Sensitive, User};

    use super::*;
    use crate::pool::test_sqlite_pool;
    use crate::repo::{
        PolicyRepo, SqlxPolicyRepo, SqlxUserInviteRepo, SqlxUserRepo, UserInviteRepo, UserRepo,
    };

    /// `user_invite_requests.user_id` is a real `REFERENCES users (id)`
    /// foreign key, so every test needs a persisted `User` row to point at
    /// -- same approach `user_invite.rs`'s own `seed_admin` helper uses for
    /// `UserInvite::created_by`.
    async fn seed_user(pool: &DbPool) -> Uuid {
        let policy = Policy {
            id: Uuid::new_v4(),
            name: "Invite request test policy".to_string(),
            library_allow: vec![],
            group_library_allow: vec![],
            blocked_folders: vec![],
            max_rating: None,
            blocked_tags: vec![],
            allowed_tags: vec![],
            can_transcode: true,
            can_download: false,
            can_delete: false,
            can_share_public: false,
            can_request: false,
            device_allow: vec![],
            max_concurrent_sessions: None,
            household: Default::default(),
            access_schedule: None,
            can_stream: true,
            is_admin: false,
        };
        SqlxPolicyRepo::new(pool.clone())
            .upsert(&policy)
            .await
            .unwrap();
        let user = User {
            id: Uuid::new_v4(),
            // Unique per call -- some tests seed more than one user (e.g. a
            // requester and a separate reviewer), and `users.username` has
            // a real uniqueness constraint.
            username: format!("invite-requester-{}", Uuid::new_v4()),
            display_name: "Invite Requester".to_string(),
            email: None,
            password_hash: Sensitive::new("hash".to_string()),
            policy_id: policy.id,
            created_at: Utc::now(),
            disabled: false,
            preferred_audio_language: playarr_model::DEFAULT_PREFERRED_AUDIO_LANGUAGE.to_string(),
        };
        SqlxUserRepo::new(pool.clone()).upsert(&user).await.unwrap();
        user.id
    }

    fn sample_request(user_id: Uuid) -> UserInviteRequest {
        UserInviteRequest {
            id: Uuid::new_v4(),
            user_id,
            message: Some("please invite me".to_string()),
            status: UserInviteRequestStatus::Pending,
            requested_at: Utc::now(),
            reviewed_by: None,
            reviewed_at: None,
            generated_at: None,
            can_stream: false,
            library_allow: vec![],
            group_library_allow: vec![],
        }
    }

    #[tokio::test]
    async fn upsert_inserts_a_new_row() {
        let pool = test_sqlite_pool().await;
        let user_id = seed_user(&pool).await;
        let repo = SqlxUserInviteRequestRepo::new(pool);
        let request = sample_request(user_id);

        repo.upsert(&request).await.expect("upsert");
        let fetched = repo.find_by_id(request.id).await.unwrap().unwrap();
        assert_eq!(fetched.status, UserInviteRequestStatus::Pending);
        assert_eq!(fetched.message, request.message);
    }

    #[tokio::test]
    async fn upsert_applies_a_later_state_over_an_earlier_gossiped_one() {
        // `account_sync.rs`'s own doc comment on this method: there is one
        // admin-driven state machine per request, so a later gossip pass
        // reporting `approved` must overwrite an earlier `pending` this
        // node already stored, with no timestamp comparison involved.
        let pool = test_sqlite_pool().await;
        let user_id = seed_user(&pool).await;
        // `reviewed_by` is a real `REFERENCES users (id)` foreign key too --
        // needs its own persisted row, distinct from the requester.
        let reviewer_id = seed_user(&pool).await;
        let repo = SqlxUserInviteRequestRepo::new(pool);
        let mut request = sample_request(user_id);
        repo.upsert(&request).await.unwrap();

        request.status = UserInviteRequestStatus::Approved;
        request.reviewed_by = Some(reviewer_id);
        request.reviewed_at = Some(Utc::now());
        request.can_stream = true;
        request.library_allow = vec![Uuid::new_v4()];
        request.group_library_allow = vec![Uuid::new_v4()];
        repo.upsert(&request).await.unwrap();

        let fetched = repo.find_by_id(request.id).await.unwrap().unwrap();
        assert_eq!(fetched.status, UserInviteRequestStatus::Approved);
        assert_eq!(fetched.reviewed_by, Some(reviewer_id));
        assert!(fetched.can_stream);
        assert_eq!(fetched.library_allow, request.library_allow);
        assert_eq!(fetched.group_library_allow, request.group_library_allow);
    }

    #[tokio::test]
    async fn review_persists_group_library_allow() {
        let pool = test_sqlite_pool().await;
        let user_id = seed_user(&pool).await;
        let reviewer_id = seed_user(&pool).await;
        let repo = SqlxUserInviteRequestRepo::new(pool);
        let request = sample_request(user_id);
        repo.create(&request).await.unwrap();

        let library_allow = [Uuid::new_v4()];
        let group_library_allow = [Uuid::new_v4()];
        assert!(repo
            .review(
                request.id,
                reviewer_id,
                UserInviteRequestStatus::Approved,
                Utc::now(),
                true,
                &library_allow,
                &group_library_allow,
            )
            .await
            .unwrap());

        let fetched = repo.find_by_id(request.id).await.unwrap().unwrap();
        assert_eq!(fetched.library_allow, library_allow);
        assert_eq!(fetched.group_library_allow, group_library_allow);
    }

    #[tokio::test]
    async fn generate_invite_carries_group_library_allow_onto_the_final_invite() {
        let pool = test_sqlite_pool().await;
        let user_id = seed_user(&pool).await;
        let reviewer_id = seed_user(&pool).await;
        let repo = SqlxUserInviteRequestRepo::new(pool.clone());
        let request = sample_request(user_id);
        repo.create(&request).await.unwrap();

        let group_library_allow = vec![Uuid::new_v4()];
        assert!(repo
            .review(
                request.id,
                reviewer_id,
                UserInviteRequestStatus::Approved,
                Utc::now(),
                true,
                &[],
                &group_library_allow,
            )
            .await
            .unwrap());
        let approved = repo.find_by_id(request.id).await.unwrap().unwrap();

        let now = Utc::now();
        let invite = UserInvite {
            token_hash: "generated-token-hash".to_string(),
            created_by: user_id,
            created_at: now,
            expires_at: now + chrono::Duration::hours(24),
            can_stream: approved.can_stream,
            library_allow: approved.library_allow.clone(),
            group_library_allow: approved.group_library_allow.clone(),
            consumed_at: None,
            consumed_by_user_id: None,
            consumed_by_peer_id: None,
        };
        assert!(repo
            .generate_invite(request.id, user_id, now, &invite)
            .await
            .unwrap());

        let invite_repo = SqlxUserInviteRepo::new(pool);
        let persisted = invite_repo
            .find_valid(&invite.token_hash, now)
            .await
            .unwrap()
            .expect("generated invite should be valid");
        assert_eq!(persisted.group_library_allow, group_library_allow);
    }

    #[tokio::test]
    async fn list_requested_since_none_returns_every_row() {
        // Two distinct requesters: `idx_user_invite_requests_one_active`
        // allows only one `pending`/`approved` request per `user_id` at a
        // time (see `0024_user_invite_requests.sql`), so two rows from the
        // same user would collide -- same reason `find_latest_for_user`'s
        // own tests never seed two active requests for one user either.
        let pool = test_sqlite_pool().await;
        let first_user = seed_user(&pool).await;
        let second_user = seed_user(&pool).await;
        let repo = SqlxUserInviteRequestRepo::new(pool);
        let first = sample_request(first_user);
        let second = sample_request(second_user);
        repo.create(&first).await.unwrap();
        repo.create(&second).await.unwrap();

        let rows = repo.list_requested_since(None).await.unwrap();
        let ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
        assert!(ids.contains(&first.id));
        assert!(ids.contains(&second.id));
    }

    #[tokio::test]
    async fn list_requested_since_a_cursor_excludes_rows_at_or_before_it() {
        let pool = test_sqlite_pool().await;
        let old_user = seed_user(&pool).await;
        let fresh_user = seed_user(&pool).await;
        let repo = SqlxUserInviteRequestRepo::new(pool);
        let now = Utc::now();
        let cursor = now - chrono::Duration::minutes(10);
        let mut old = sample_request(old_user);
        old.requested_at = cursor;
        let mut fresh = sample_request(fresh_user);
        fresh.requested_at = now;
        repo.create(&old).await.unwrap();
        repo.create(&fresh).await.unwrap();

        let rows = repo.list_requested_since(Some(cursor)).await.unwrap();
        let ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
        assert!(
            !ids.contains(&old.id),
            "a row at or before the cursor must not be re-reported"
        );
        assert!(ids.contains(&fresh.id));
    }

    #[tokio::test]
    async fn list_requested_since_orders_oldest_first() {
        let pool = test_sqlite_pool().await;
        let older_user = seed_user(&pool).await;
        let newer_user = seed_user(&pool).await;
        let repo = SqlxUserInviteRequestRepo::new(pool);
        let now = Utc::now();
        let mut older = sample_request(older_user);
        older.requested_at = now - chrono::Duration::minutes(10);
        let mut newer = sample_request(newer_user);
        newer.requested_at = now;
        repo.create(&newer).await.unwrap();
        repo.create(&older).await.unwrap();

        let rows = repo.list_requested_since(None).await.unwrap();
        let position = |id: Uuid| rows.iter().position(|row| row.id == id).unwrap();
        assert!(position(older.id) < position(newer.id));
    }
}
