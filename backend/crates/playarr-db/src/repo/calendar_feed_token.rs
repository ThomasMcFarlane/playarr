//! Revocable per-user tokens behind the external iCal subscription URL.
//! Only the SHA-256 of a token is stored (computed by the caller).

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CalendarFeedTokenInfo {
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

#[async_trait]
pub trait CalendarFeedTokenRepo: Send + Sync {
    /// Revokes the user's active token (if any) and stores the new hash, atomically.
    async fn rotate(
        &self,
        user_id: Uuid,
        token_hash: &str,
        now: DateTime<Utc>,
    ) -> Result<(), DbError>;

    /// Revokes the user's active token. Returns whether one existed.
    async fn revoke(&self, user_id: Uuid, now: DateTime<Utc>) -> Result<bool, DbError>;

    async fn active_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Option<CalendarFeedTokenInfo>, DbError>;

    /// Owner of an active token; stamps `last_used_at`. `None` for unknown or revoked tokens.
    async fn resolve(&self, token_hash: &str, now: DateTime<Utc>) -> Result<Option<Uuid>, DbError>;
}

pub struct SqlxCalendarFeedTokenRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxCalendarFeedTokenRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }

    fn q(&self, sqlite: &'static str, postgres: &'static str) -> &'static str {
        match self.backend {
            Backend::Sqlite => sqlite,
            Backend::Postgres => postgres,
        }
    }
}

#[async_trait]
impl CalendarFeedTokenRepo for SqlxCalendarFeedTokenRepo {
    async fn rotate(
        &self,
        user_id: Uuid,
        token_hash: &str,
        now: DateTime<Utc>,
    ) -> Result<(), DbError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query(self.q(
            "UPDATE calendar_feed_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
            "UPDATE calendar_feed_tokens SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL",
        ))
        .bind(format_datetime(now))
        .bind(user_id.to_string())
        .execute(&mut *tx)
        .await?;
        sqlx::query(self.q(
            "INSERT INTO calendar_feed_tokens (token_hash, user_id, created_at) VALUES (?, ?, ?)",
            "INSERT INTO calendar_feed_tokens (token_hash, user_id, created_at) VALUES ($1, $2, $3)",
        ))
        .bind(token_hash)
        .bind(user_id.to_string())
        .bind(format_datetime(now))
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    async fn revoke(&self, user_id: Uuid, now: DateTime<Utc>) -> Result<bool, DbError> {
        let result = sqlx::query(self.q(
            "UPDATE calendar_feed_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
            "UPDATE calendar_feed_tokens SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL",
        ))
        .bind(format_datetime(now))
        .bind(user_id.to_string())
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn active_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Option<CalendarFeedTokenInfo>, DbError> {
        let row = sqlx::query(self.q(
            "SELECT created_at, last_used_at FROM calendar_feed_tokens WHERE user_id = ? AND revoked_at IS NULL",
            "SELECT created_at, last_used_at FROM calendar_feed_tokens WHERE user_id = $1 AND revoked_at IS NULL",
        ))
        .bind(user_id.to_string())
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            let created_at: String = row.try_get("created_at")?;
            let last_used_at: Option<String> = row.try_get("last_used_at")?;
            Ok(CalendarFeedTokenInfo {
                created_at: parse_datetime(&created_at)?,
                last_used_at: last_used_at.as_deref().map(parse_datetime).transpose()?,
            })
        })
        .transpose()
    }

    async fn resolve(&self, token_hash: &str, now: DateTime<Utc>) -> Result<Option<Uuid>, DbError> {
        let row = sqlx::query(self.q(
            "SELECT user_id FROM calendar_feed_tokens WHERE token_hash = ? AND revoked_at IS NULL",
            "SELECT user_id FROM calendar_feed_tokens WHERE token_hash = $1 AND revoked_at IS NULL",
        ))
        .bind(token_hash)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else { return Ok(None) };
        let user_id: String = row.try_get("user_id")?;
        sqlx::query(self.q(
            "UPDATE calendar_feed_tokens SET last_used_at = ? WHERE token_hash = ?",
            "UPDATE calendar_feed_tokens SET last_used_at = $1 WHERE token_hash = $2",
        ))
        .bind(format_datetime(now))
        .bind(token_hash)
        .execute(&self.pool)
        .await?;
        Ok(Some(parse_uuid(&user_id)?))
    }
}

#[cfg(test)]
mod tests {
    use playarr_model::{Policy, Sensitive, User};

    use super::*;
    use crate::pool::test_sqlite_pool;
    use crate::repo::{PolicyRepo, SqlxPolicyRepo, SqlxUserRepo, UserRepo};

    async fn setup() -> (SqlxCalendarFeedTokenRepo, Uuid) {
        let pool = test_sqlite_pool().await;
        let policy = Policy {
            id: Uuid::new_v4(),
            name: "Calendar test".to_string(),
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
            username: "calendar-user".to_string(),
            display_name: "Calendar User".to_string(),
            email: None,
            password_hash: Sensitive::new("password-hash".to_string()),
            policy_id: policy.id,
            created_at: Utc::now(),
            disabled: false,
            preferred_audio_language: playarr_model::DEFAULT_PREFERRED_AUDIO_LANGUAGE.to_string(),
        };
        SqlxUserRepo::new(pool.clone()).upsert(&user).await.unwrap();
        (SqlxCalendarFeedTokenRepo::new(pool), user.id)
    }

    #[tokio::test]
    async fn rotate_revokes_the_previous_token() {
        let (repo, user) = setup().await;
        let now = Utc::now();
        repo.rotate(user, "hash-a", now).await.unwrap();
        assert_eq!(repo.resolve("hash-a", now).await.unwrap(), Some(user));
        repo.rotate(user, "hash-b", now).await.unwrap();
        assert_eq!(repo.resolve("hash-a", now).await.unwrap(), None);
        assert_eq!(repo.resolve("hash-b", now).await.unwrap(), Some(user));
        assert!(repo
            .active_for_user(user)
            .await
            .unwrap()
            .unwrap()
            .last_used_at
            .is_some());
    }

    #[tokio::test]
    async fn revoke_stops_resolution_and_reports_absence() {
        let (repo, user) = setup().await;
        let now = Utc::now();
        assert!(!repo.revoke(user, now).await.unwrap());
        repo.rotate(user, "hash-a", now).await.unwrap();
        assert!(repo.revoke(user, now).await.unwrap());
        assert_eq!(repo.resolve("hash-a", now).await.unwrap(), None);
        assert!(repo.active_for_user(user).await.unwrap().is_none());
    }
}
