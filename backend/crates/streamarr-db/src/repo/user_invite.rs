use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::any::AnyRow;
use sqlx::Row;
use streamarr_model::UserInvite;

use crate::codec::{format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

/// Durable, one-use storage for administrator-issued account invitations.
#[async_trait]
pub trait UserInviteRepo: Send + Sync {
    async fn create(&self, invite: &UserInvite) -> Result<(), DbError>;

    async fn find_valid(
        &self,
        token_hash: &str,
        now: DateTime<Utc>,
    ) -> Result<Option<UserInvite>, DbError>;

    /// Atomically removes an invitation only when it exists and has not
    /// expired. `true` means this caller consumed it; `false` covers unknown,
    /// expired, and already-consumed tokens without leaking which case applied.
    async fn consume(&self, token_hash: &str, now: DateTime<Utc>) -> Result<bool, DbError>;
}

pub struct SqlxUserInviteRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxUserInviteRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }
}

fn from_row(row: &AnyRow) -> Result<UserInvite, DbError> {
    let token_hash: String = row.try_get("token_hash")?;
    let created_by: String = row.try_get("created_by")?;
    let created_at: String = row.try_get("created_at")?;
    let expires_at: String = row.try_get("expires_at")?;
    let can_stream: i64 = row.try_get("can_stream")?;
    let library_allow: String = row.try_get("library_allow")?;
    Ok(UserInvite {
        token_hash,
        created_by: parse_uuid(&created_by)?,
        created_at: parse_datetime(&created_at)?,
        expires_at: parse_datetime(&expires_at)?,
        can_stream: can_stream != 0,
        library_allow: serde_json::from_str(&library_allow)?,
    })
}

const COLUMNS: &str = "token_hash, created_by, created_at, expires_at, can_stream, library_allow";

#[async_trait]
impl UserInviteRepo for SqlxUserInviteRepo {
    async fn create(&self, invite: &UserInvite) -> Result<(), DbError> {
        let library_allow = serde_json::to_string(&invite.library_allow)?;
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO user_invites (token_hash, created_by, created_at, expires_at, can_stream, library_allow) \
                 VALUES (?, ?, ?, ?, ?, ?)"
            }
            Backend::Postgres => {
                "INSERT INTO user_invites (token_hash, created_by, created_at, expires_at, can_stream, library_allow) \
                 VALUES ($1, $2, $3, $4, $5, $6)"
            }
        };
        sqlx::query(sql)
            .bind(&invite.token_hash)
            .bind(invite.created_by.to_string())
            .bind(format_datetime(invite.created_at))
            .bind(format_datetime(invite.expires_at))
            .bind(i64::from(invite.can_stream))
            .bind(library_allow)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn find_valid(
        &self,
        token_hash: &str,
        now: DateTime<Utc>,
    ) -> Result<Option<UserInvite>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => format!(
                "SELECT {COLUMNS} FROM user_invites WHERE token_hash = ? AND expires_at > ?"
            ),
            Backend::Postgres => format!(
                "SELECT {COLUMNS} FROM user_invites WHERE token_hash = $1 AND expires_at > $2"
            ),
        };
        let row = sqlx::query(&sql)
            .bind(token_hash)
            .bind(format_datetime(now))
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(from_row).transpose()
    }

    async fn consume(&self, token_hash: &str, now: DateTime<Utc>) -> Result<bool, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "DELETE FROM user_invites WHERE token_hash = ? AND expires_at > ?",
            Backend::Postgres => {
                "DELETE FROM user_invites WHERE token_hash = $1 AND expires_at > $2"
            }
        };
        let result = sqlx::query(sql)
            .bind(token_hash)
            .bind(format_datetime(now))
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() == 1)
    }
}

#[cfg(test)]
mod tests {
    use chrono::Duration;
    use streamarr_model::{Policy, Sensitive, User};
    use uuid::Uuid;

    use super::*;
    use crate::pool::test_sqlite_pool;
    use crate::repo::{PolicyRepo, SqlxPolicyRepo, SqlxUserRepo, UserRepo};

    async fn seed_admin(pool: &DbPool) -> Uuid {
        let policy = Policy {
            id: Uuid::new_v4(),
            name: "Invite test admin".to_string(),
            library_allow: vec![],
            blocked_folders: vec![],
            max_rating: None,
            blocked_tags: vec![],
            allowed_tags: vec![],
            can_transcode: true,
            can_download: true,
            can_delete: false,
            can_share_public: false,
            device_allow: vec![],
            max_concurrent_sessions: None,
            access_schedule: None,
            can_stream: false,
            is_admin: true,
        };
        SqlxPolicyRepo::new(pool.clone())
            .upsert(&policy)
            .await
            .unwrap();
        let user = User {
            id: Uuid::new_v4(),
            username: "invite-admin".to_string(),
            display_name: "Invite Admin".to_string(),
            email: None,
            password_hash: Sensitive::new("hash".to_string()),
            policy_id: policy.id,
            created_at: Utc::now(),
            disabled: false,
            preferred_audio_language: streamarr_model::DEFAULT_PREFERRED_AUDIO_LANGUAGE.to_string(),
        };
        SqlxUserRepo::new(pool.clone()).upsert(&user).await.unwrap();
        user.id
    }

    #[tokio::test]
    async fn invite_is_consumed_once_before_expiry() {
        let pool = test_sqlite_pool().await;
        let created_by = seed_admin(&pool).await;
        let now = Utc::now();
        let invite = UserInvite {
            token_hash: "token-hash".to_string(),
            created_by,
            created_at: now,
            expires_at: now + Duration::hours(24),
            can_stream: true,
            library_allow: vec![Uuid::new_v4()],
        };
        let repo = SqlxUserInviteRepo::new(pool);
        repo.create(&invite).await.unwrap();

        let persisted = repo
            .find_valid(&invite.token_hash, now)
            .await
            .unwrap()
            .expect("invite should be valid");
        assert_eq!(persisted.token_hash, invite.token_hash);
        assert_eq!(persisted.created_by, invite.created_by);
        assert_eq!(persisted.can_stream, invite.can_stream);
        assert_eq!(persisted.library_allow, invite.library_allow);
        assert!(repo.consume(&invite.token_hash, now).await.unwrap());
        assert!(repo
            .find_valid(&invite.token_hash, now)
            .await
            .unwrap()
            .is_none());
        assert!(!repo.consume(&invite.token_hash, now).await.unwrap());
    }

    #[tokio::test]
    async fn expired_invite_cannot_be_consumed() {
        let pool = test_sqlite_pool().await;
        let created_by = seed_admin(&pool).await;
        let now = Utc::now();
        let invite = UserInvite {
            token_hash: "expired-token-hash".to_string(),
            created_by,
            created_at: now - Duration::hours(25),
            expires_at: now - Duration::hours(1),
            can_stream: true,
            library_allow: vec![],
        };
        let repo = SqlxUserInviteRepo::new(pool);
        repo.create(&invite).await.unwrap();

        assert!(repo
            .find_valid(&invite.token_hash, now)
            .await
            .unwrap()
            .is_none());
        assert!(!repo.consume(&invite.token_hash, now).await.unwrap());
    }
}
