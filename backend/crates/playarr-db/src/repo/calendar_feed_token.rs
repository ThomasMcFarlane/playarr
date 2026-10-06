//! Revocable per-user tokens behind the external iCal subscription URL.
//! Only the SHA-256 of a token is stored (computed by the caller).

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::DbPool;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CalendarFeedTokenInfo {
    /// The sealed token (opaque to this repository); `None` for rows created
    /// before the token could be shown again.
    pub token_encrypted: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

#[async_trait]
pub trait CalendarFeedTokenRepo: Send + Sync {
    /// Revokes the user's active token (if any) and stores the new hash, atomically.
    /// `token_encrypted` is the sealed token kept so the link can be shown again.
    async fn rotate(
        &self,
        user_id: Uuid,
        token_hash: &str,
        token_encrypted: Option<&str>,
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
}

impl SqlxCalendarFeedTokenRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl CalendarFeedTokenRepo for SqlxCalendarFeedTokenRepo {
    async fn rotate(
        &self,
        user_id: Uuid,
        token_hash: &str,
        token_encrypted: Option<&str>,
        now: DateTime<Utc>,
    ) -> Result<(), DbError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE calendar_feed_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
        .bind(format_datetime(now))
        .bind(user_id.to_string())
        .execute(&mut *tx)
        .await?;
        sqlx::query("INSERT INTO calendar_feed_tokens (token_hash, user_id, created_at, token_encrypted) VALUES (?, ?, ?, ?)")
        .bind(token_hash)
        .bind(user_id.to_string())
        .bind(format_datetime(now))
        .bind(token_encrypted)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    async fn revoke(&self, user_id: Uuid, now: DateTime<Utc>) -> Result<bool, DbError> {
        let result = sqlx::query("UPDATE calendar_feed_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
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
        let row = sqlx::query("SELECT created_at, last_used_at, token_encrypted FROM calendar_feed_tokens WHERE user_id = ? AND revoked_at IS NULL")
        .bind(user_id.to_string())
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            let created_at: String = row.try_get("created_at")?;
            let last_used_at: Option<String> = row.try_get("last_used_at")?;
            let token_encrypted: Option<String> = row.try_get("token_encrypted")?;
            Ok(CalendarFeedTokenInfo {
                token_encrypted,
                created_at: parse_datetime(&created_at)?,
                last_used_at: last_used_at.as_deref().map(parse_datetime).transpose()?,
            })
        })
        .transpose()
    }

    async fn resolve(&self, token_hash: &str, now: DateTime<Utc>) -> Result<Option<Uuid>, DbError> {
        let row = sqlx::query(
            "SELECT user_id FROM calendar_feed_tokens WHERE token_hash = ? AND revoked_at IS NULL",
        )
        .bind(token_hash)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else { return Ok(None) };
        let user_id: String = row.try_get("user_id")?;
        sqlx::query("UPDATE calendar_feed_tokens SET last_used_at = ? WHERE token_hash = ?")
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
        repo.rotate(user, "hash-a", None, now).await.unwrap();
        assert_eq!(repo.resolve("hash-a", now).await.unwrap(), Some(user));
        repo.rotate(user, "hash-b", Some("sealed-b"), now)
            .await
            .unwrap();
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
    async fn sealed_token_is_returned_for_the_active_row_only() {
        let (repo, user) = setup().await;
        let now = Utc::now();
        repo.rotate(user, "hash-a", None, now).await.unwrap();
        assert_eq!(
            repo.active_for_user(user)
                .await
                .unwrap()
                .unwrap()
                .token_encrypted,
            None
        );
        repo.rotate(user, "hash-b", Some("sealed-b"), now)
            .await
            .unwrap();
        assert_eq!(
            repo.active_for_user(user)
                .await
                .unwrap()
                .unwrap()
                .token_encrypted
                .as_deref(),
            Some("sealed-b")
        );
    }

    #[tokio::test]
    async fn revoke_stops_resolution_and_reports_absence() {
        let (repo, user) = setup().await;
        let now = Utc::now();
        assert!(!repo.revoke(user, now).await.unwrap());
        repo.rotate(user, "hash-a", None, now).await.unwrap();
        assert!(repo.revoke(user, now).await.unwrap());
        assert_eq!(repo.resolve("hash-a", now).await.unwrap(), None);
        assert!(repo.active_for_user(user).await.unwrap().is_none());
    }
}
