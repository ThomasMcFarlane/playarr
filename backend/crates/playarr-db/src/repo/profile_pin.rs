use async_trait::async_trait;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::format_datetime;
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

/// Durable profile-PIN hashes, deliberately separate from user passwords.
#[async_trait]
pub trait ProfilePinRepo: Send + Sync {
    async fn find_hash(&self, user_id: Uuid) -> Result<Option<String>, DbError>;

    async fn upsert_hash(&self, user_id: Uuid, pin_hash: &str) -> Result<(), DbError>;

    async fn delete(&self, user_id: Uuid) -> Result<(), DbError>;
}

pub struct SqlxProfilePinRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxProfilePinRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }
}

#[async_trait]
impl ProfilePinRepo for SqlxProfilePinRepo {
    async fn find_hash(&self, user_id: Uuid) -> Result<Option<String>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "SELECT pin_hash FROM profile_pins WHERE user_id = ?",
            Backend::Postgres => "SELECT pin_hash FROM profile_pins WHERE user_id = $1",
        };
        let row = sqlx::query(sql)
            .bind(user_id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.map(|row| row.try_get("pin_hash"))
            .transpose()
            .map_err(Into::into)
    }

    async fn upsert_hash(&self, user_id: Uuid, pin_hash: &str) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO profile_pins (user_id, pin_hash, updated_at) VALUES (?, ?, ?) \
                 ON CONFLICT (user_id) DO UPDATE SET \
                 pin_hash = excluded.pin_hash, updated_at = excluded.updated_at"
            }
            Backend::Postgres => {
                "INSERT INTO profile_pins (user_id, pin_hash, updated_at) VALUES ($1, $2, $3) \
                 ON CONFLICT (user_id) DO UPDATE SET \
                 pin_hash = EXCLUDED.pin_hash, updated_at = EXCLUDED.updated_at"
            }
        };
        sqlx::query(sql)
            .bind(user_id.to_string())
            .bind(pin_hash)
            .bind(format_datetime(chrono::Utc::now()))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete(&self, user_id: Uuid) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "DELETE FROM profile_pins WHERE user_id = ?",
            Backend::Postgres => "DELETE FROM profile_pins WHERE user_id = $1",
        };
        sqlx::query(sql)
            .bind(user_id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use playarr_model::{Policy, Sensitive, User};

    use super::*;
    use crate::pool::test_sqlite_pool;
    use crate::repo::{PolicyRepo, SqlxPolicyRepo, SqlxUserRepo, UserRepo};

    #[tokio::test]
    async fn pin_hash_round_trips_and_updates() {
        let pool = test_sqlite_pool().await;
        let policy = Policy {
            id: Uuid::new_v4(),
            name: "PIN test".to_string(),
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
            username: "pin-user".to_string(),
            display_name: "PIN User".to_string(),
            email: None,
            password_hash: Sensitive::new("password-hash".to_string()),
            policy_id: policy.id,
            created_at: Utc::now(),
            disabled: false,
            preferred_audio_language: playarr_model::DEFAULT_PREFERRED_AUDIO_LANGUAGE.to_string(),
        };
        SqlxUserRepo::new(pool.clone()).upsert(&user).await.unwrap();

        let repo = SqlxProfilePinRepo::new(pool.clone());
        assert_eq!(repo.find_hash(user.id).await.unwrap(), None);
        repo.upsert_hash(user.id, "hash-one").await.unwrap();
        assert_eq!(
            repo.find_hash(user.id).await.unwrap().as_deref(),
            Some("hash-one")
        );
        repo.upsert_hash(user.id, "hash-two").await.unwrap();
        assert_eq!(
            repo.find_hash(user.id).await.unwrap().as_deref(),
            Some("hash-two")
        );
    }

    // `SqlxUserRepo::delete` used to be a hard `DELETE`, which the schema's
    // `profile_pins.user_id ... REFERENCES users (id) ON DELETE CASCADE`
    // rode along with for free -- this test used to be named
    // `..._and_cascades_with_user` and asserted the PIN hash vanished
    // alongside the user. `docs/architecture/peer-groups.md` §2.2 requires
    // `UserRepo::delete` to become a soft delete instead (the row must
    // survive, with `deleted_at` set, so it can propagate as a tombstone
    // rather than a peer merely lagging on sync looking like a delete) --
    // and a row that's never actually removed cannot fire an `ON DELETE`
    // trigger. This is a deliberate, accepted consequence of that change,
    // not a bug: `find_hash` takes a bare `user_id` and was never wired
    // through `UserRepo::find_by_id`'s `deleted_at IS NULL` filter, so
    // this row simply becomes unreachable through every normal lookup
    // path the moment its owning user is soft-deleted, exactly like every
    // other table that used to cascade off `users` (see this crate's
    // migrations for the full list) -- reconciling all of them with
    // `deleted_at` is out of this change's scope.
    #[tokio::test]
    async fn pin_hash_survives_a_soft_deleted_user() {
        let pool = test_sqlite_pool().await;
        let policy = Policy {
            id: Uuid::new_v4(),
            name: "PIN test".to_string(),
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
            username: "pin-user-2".to_string(),
            display_name: "PIN User 2".to_string(),
            email: None,
            password_hash: Sensitive::new("password-hash".to_string()),
            policy_id: policy.id,
            created_at: Utc::now(),
            disabled: false,
            preferred_audio_language: playarr_model::DEFAULT_PREFERRED_AUDIO_LANGUAGE.to_string(),
        };
        SqlxUserRepo::new(pool.clone()).upsert(&user).await.unwrap();

        let repo = SqlxProfilePinRepo::new(pool.clone());
        repo.upsert_hash(user.id, "hash-one").await.unwrap();

        SqlxUserRepo::new(pool.clone())
            .delete(user.id)
            .await
            .unwrap();

        // The user itself is gone through every normal repo lookup ...
        assert_eq!(
            SqlxUserRepo::new(pool).find_by_id(user.id).await.unwrap(),
            None
        );
        // ... but the PIN row underneath it was never actually removed.
        assert_eq!(
            repo.find_hash(user.id).await.unwrap().as_deref(),
            Some("hash-one")
        );
    }
}
