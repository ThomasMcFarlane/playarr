use async_trait::async_trait;
use chrono::{DateTime, Utc};
use streamarr_model::UserInvite;

use crate::codec::format_datetime;
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

/// Durable, one-use storage for administrator-issued account invitations.
#[async_trait]
pub trait UserInviteRepo: Send + Sync {
    async fn create(&self, invite: &UserInvite) -> Result<(), DbError>;

    async fn is_valid(&self, token_hash: &str, now: DateTime<Utc>) -> Result<bool, DbError>;

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

#[async_trait]
impl UserInviteRepo for SqlxUserInviteRepo {
    async fn create(&self, invite: &UserInvite) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO user_invites (token_hash, created_by, created_at, expires_at) \
                 VALUES (?, ?, ?, ?)"
            }
            Backend::Postgres => {
                "INSERT INTO user_invites (token_hash, created_by, created_at, expires_at) \
                 VALUES ($1, $2, $3, $4)"
            }
        };
        sqlx::query(sql)
            .bind(&invite.token_hash)
            .bind(invite.created_by.to_string())
            .bind(format_datetime(invite.created_at))
            .bind(format_datetime(invite.expires_at))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn is_valid(&self, token_hash: &str, now: DateTime<Utc>) -> Result<bool, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT 1 AS valid FROM user_invites WHERE token_hash = ? AND expires_at > ?"
            }
            Backend::Postgres => {
                "SELECT 1 AS valid FROM user_invites WHERE token_hash = $1 AND expires_at > $2"
            }
        };
        let row = sqlx::query(sql)
            .bind(token_hash)
            .bind(format_datetime(now))
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.is_some())
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
        };
        let repo = SqlxUserInviteRepo::new(pool);
        repo.create(&invite).await.unwrap();

        assert!(repo.is_valid(&invite.token_hash, now).await.unwrap());
        assert!(repo.consume(&invite.token_hash, now).await.unwrap());
        assert!(!repo.is_valid(&invite.token_hash, now).await.unwrap());
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
        };
        let repo = SqlxUserInviteRepo::new(pool);
        repo.create(&invite).await.unwrap();

        assert!(!repo.is_valid(&invite.token_hash, now).await.unwrap());
        assert!(!repo.consume(&invite.token_hash, now).await.unwrap());
    }
}
