use async_trait::async_trait;
use sqlx::any::AnyRow;
use sqlx::Row;
use streamarr_model::{MediaPlaybackPreferences, ProfileAvatarPreference, Sensitive, User};
use uuid::Uuid;

use crate::codec::{bool_from_i64, bool_to_i64, format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

/// CRUD + lookup surface over [`streamarr_model::User`] -- real, durable
/// user accounts. This is the persistence half of moving Streamarr off
/// `trusted-network` auto-admin (source-IP allowlist login) and onto real
/// username/password accounts: `streamarr_auth::login::evaluate_login`
/// already handles `AuthMode::FullAccount` (including real Argon2id
/// password hashing via `streamarr_auth::login::hash_password` /
/// `Argon2PasswordVerifier`), but today the only account store behind it is
/// `streamarr_auth::login::InMemoryUserDirectory`, which starts empty on
/// every boot. This trait is that directory's real backing store.
#[async_trait]
pub trait UserRepo: Send + Sync {
    async fn list_all(&self) -> Result<Vec<User>, DbError>;

    async fn find_by_id(&self, id: Uuid) -> Result<Option<User>, DbError>;

    /// The login path's primary lookup: username is the natural key a
    /// login request arrives with, before anything else about the account
    /// is known.
    async fn find_by_username(&self, username: &str) -> Result<Option<User>, DbError>;

    /// Insert-or-update by `User::id`.
    async fn upsert(&self, user: &User) -> Result<(), DbError>;

    async fn delete(&self, id: Uuid) -> Result<(), DbError>;

    async fn get_media_playback_preferences(
        &self,
        user_id: Uuid,
        media_file_id: Uuid,
    ) -> Result<Option<MediaPlaybackPreferences>, DbError>;

    async fn upsert_media_playback_preferences(
        &self,
        user_id: Uuid,
        preferences: &MediaPlaybackPreferences,
    ) -> Result<(), DbError>;

    async fn get_profile_avatar(
        &self,
        user_id: Uuid,
    ) -> Result<Option<ProfileAvatarPreference>, DbError>;

    async fn upsert_profile_avatar(
        &self,
        user_id: Uuid,
        preference: &ProfileAvatarPreference,
    ) -> Result<(), DbError>;
}

pub struct SqlxUserRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxUserRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }

    fn from_row(row: &AnyRow) -> Result<User, DbError> {
        let id: String = row.try_get("id")?;
        let username: String = row.try_get("username")?;
        let display_name: String = row.try_get("display_name")?;
        let email: Option<String> = row.try_get("email")?;
        let password_hash: String = row.try_get("password_hash")?;
        let policy_id: String = row.try_get("policy_id")?;
        let created_at: String = row.try_get("created_at")?;
        let disabled: i64 = row.try_get("disabled")?;
        let preferred_audio_language: String = row.try_get("preferred_audio_language")?;

        Ok(User {
            id: parse_uuid(&id)?,
            username,
            display_name,
            email,
            // Already an Argon2id PHC hash string (see
            // `streamarr_auth::login::hash_password`), not a plaintext
            // secret -- `Sensitive::new` here only stops it leaking via
            // `Debug`/`Display`, it doesn't encrypt anything by itself.
            password_hash: Sensitive::new(password_hash),
            policy_id: parse_uuid(&policy_id)?,
            created_at: parse_datetime(&created_at)?,
            disabled: bool_from_i64(disabled),
            preferred_audio_language,
        })
    }
}

#[async_trait]
impl UserRepo for SqlxUserRepo {
    async fn list_all(&self) -> Result<Vec<User>, DbError> {
        let sql = "SELECT id, username, display_name, email, password_hash, policy_id, \
                    created_at, disabled, preferred_audio_language FROM users ORDER BY username";
        let rows = sqlx::query(sql).fetch_all(&self.pool).await?;
        rows.iter().map(Self::from_row).collect()
    }

    async fn find_by_id(&self, id: Uuid) -> Result<Option<User>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, username, display_name, email, password_hash, policy_id, \
                 created_at, disabled, preferred_audio_language FROM users WHERE id = ?"
            }
            Backend::Postgres => {
                "SELECT id, username, display_name, email, password_hash, policy_id, \
                 created_at, disabled, preferred_audio_language FROM users WHERE id = $1"
            }
        };
        let row = sqlx::query(sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(Self::from_row).transpose()
    }

    async fn find_by_username(&self, username: &str) -> Result<Option<User>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, username, display_name, email, password_hash, policy_id, \
                 created_at, disabled, preferred_audio_language FROM users WHERE username = ?"
            }
            Backend::Postgres => {
                "SELECT id, username, display_name, email, password_hash, policy_id, \
                 created_at, disabled, preferred_audio_language FROM users WHERE username = $1"
            }
        };
        let row = sqlx::query(sql)
            .bind(username)
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(Self::from_row).transpose()
    }

    async fn upsert(&self, user: &User) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO users \
                 (id, username, display_name, email, password_hash, policy_id, created_at, disabled, preferred_audio_language) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                 username = excluded.username, display_name = excluded.display_name, \
                 email = excluded.email, password_hash = excluded.password_hash, \
                 policy_id = excluded.policy_id, created_at = excluded.created_at, \
                 disabled = excluded.disabled, \
                 preferred_audio_language = excluded.preferred_audio_language"
            }
            Backend::Postgres => {
                "INSERT INTO users \
                 (id, username, display_name, email, password_hash, policy_id, created_at, disabled, preferred_audio_language) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) \
                 ON CONFLICT (id) DO UPDATE SET \
                 username = excluded.username, display_name = excluded.display_name, \
                 email = excluded.email, password_hash = excluded.password_hash, \
                 policy_id = excluded.policy_id, created_at = excluded.created_at, \
                 disabled = excluded.disabled, \
                 preferred_audio_language = excluded.preferred_audio_language"
            }
        };
        sqlx::query(sql)
            .bind(user.id.to_string())
            .bind(user.username.as_str())
            .bind(user.display_name.as_str())
            .bind(user.email.as_deref())
            .bind(user.password_hash.expose_secret().as_str())
            .bind(user.policy_id.to_string())
            .bind(format_datetime(user.created_at))
            .bind(bool_to_i64(user.disabled))
            .bind(user.preferred_audio_language.as_str())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete(&self, id: Uuid) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "DELETE FROM users WHERE id = ?",
            Backend::Postgres => "DELETE FROM users WHERE id = $1",
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

    async fn get_media_playback_preferences(
        &self,
        user_id: Uuid,
        media_file_id: Uuid,
    ) -> Result<Option<MediaPlaybackPreferences>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT media_file_id, quality_id, audio_track_id, subtitle_track_id \
                 FROM user_media_playback_preferences \
                 WHERE user_id = ? AND media_file_id = ?"
            }
            Backend::Postgres => {
                "SELECT media_file_id, quality_id, audio_track_id, subtitle_track_id \
                 FROM user_media_playback_preferences \
                 WHERE user_id = $1 AND media_file_id = $2"
            }
        };
        let row = sqlx::query(sql)
            .bind(user_id.to_string())
            .bind(media_file_id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.map(|row| {
            let media_file_id: String = row.try_get("media_file_id")?;
            Ok(MediaPlaybackPreferences {
                media_file_id: parse_uuid(&media_file_id)?,
                quality_id: row.try_get("quality_id")?,
                audio_track_id: row.try_get("audio_track_id")?,
                subtitle_track_id: row.try_get("subtitle_track_id")?,
            })
        })
        .transpose()
    }

    async fn upsert_media_playback_preferences(
        &self,
        user_id: Uuid,
        preferences: &MediaPlaybackPreferences,
    ) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO user_media_playback_preferences \
                 (user_id, media_file_id, quality_id, audio_track_id, subtitle_track_id, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (user_id, media_file_id) DO UPDATE SET \
                 quality_id = excluded.quality_id, audio_track_id = excluded.audio_track_id, \
                 subtitle_track_id = excluded.subtitle_track_id, updated_at = excluded.updated_at"
            }
            Backend::Postgres => {
                "INSERT INTO user_media_playback_preferences \
                 (user_id, media_file_id, quality_id, audio_track_id, subtitle_track_id, updated_at) \
                 VALUES ($1, $2, $3, $4, $5, $6) \
                 ON CONFLICT (user_id, media_file_id) DO UPDATE SET \
                 quality_id = EXCLUDED.quality_id, audio_track_id = EXCLUDED.audio_track_id, \
                 subtitle_track_id = EXCLUDED.subtitle_track_id, updated_at = EXCLUDED.updated_at"
            }
        };
        sqlx::query(sql)
            .bind(user_id.to_string())
            .bind(preferences.media_file_id.to_string())
            .bind(preferences.quality_id.as_str())
            .bind(preferences.audio_track_id.as_deref())
            .bind(preferences.subtitle_track_id.as_deref())
            .bind(format_datetime(chrono::Utc::now()))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn get_profile_avatar(
        &self,
        user_id: Uuid,
    ) -> Result<Option<ProfileAvatarPreference>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => "SELECT preference FROM user_profile_avatars WHERE user_id = ?",
            Backend::Postgres => "SELECT preference FROM user_profile_avatars WHERE user_id = $1",
        };
        let row = sqlx::query(sql)
            .bind(user_id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.map(|row| {
            let preference: String = row.try_get("preference")?;
            serde_json::from_str(&preference).map_err(DbError::from)
        })
        .transpose()
    }

    async fn upsert_profile_avatar(
        &self,
        user_id: Uuid,
        preference: &ProfileAvatarPreference,
    ) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO user_profile_avatars (user_id, preference, updated_at) \
                 VALUES (?, ?, ?) \
                 ON CONFLICT (user_id) DO UPDATE SET \
                 preference = excluded.preference, updated_at = excluded.updated_at"
            }
            Backend::Postgres => {
                "INSERT INTO user_profile_avatars (user_id, preference, updated_at) \
                 VALUES ($1, $2, $3) \
                 ON CONFLICT (user_id) DO UPDATE SET \
                 preference = EXCLUDED.preference, updated_at = EXCLUDED.updated_at"
            }
        };
        sqlx::query(sql)
            .bind(user_id.to_string())
            .bind(serde_json::to_string(preference)?)
            .bind(format_datetime(chrono::Utc::now()))
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use chrono::{SubsecRound, Utc};

    use super::*;
    use crate::pool::test_sqlite_pool;
    use crate::repo::policy::{PolicyRepo, SqlxPolicyRepo};

    /// `users.policy_id` is a real `REFERENCES policies (id)` foreign key
    /// (see `0007_users_policies.sql`), so every test needs a persisted
    /// `Policy` row to point at.
    async fn sample_policy_id(pool: &DbPool) -> Uuid {
        let policy = streamarr_model::Policy {
            id: Uuid::new_v4(),
            name: "Default".to_string(),
            library_allow: vec![],
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
            access_schedule: None,
            can_stream: true,
            is_admin: false,
        };
        SqlxPolicyRepo::new(pool.clone())
            .upsert(&policy)
            .await
            .expect("seed policy");
        policy.id
    }

    fn sample_user(policy_id: Uuid, username: &str) -> User {
        User {
            id: Uuid::new_v4(),
            username: username.to_string(),
            display_name: format!("{username} Display"),
            email: Some(format!("{username}@example.com")),
            password_hash: Sensitive::new(
                "$argon2id$v=19$m=19456,t=2,p=1$fakesalt$fakehash".to_string(),
            ),
            policy_id,
            // Storage round-trips through millisecond precision (see
            // `codec::format_datetime`); truncate here so the fixture
            // already matches what a lookup will hand back.
            created_at: Utc::now().trunc_subsecs(3),
            disabled: false,
            preferred_audio_language: streamarr_model::DEFAULT_PREFERRED_AUDIO_LANGUAGE.to_string(),
        }
    }

    #[tokio::test]
    async fn upsert_then_find_by_id_round_trips() {
        let pool = test_sqlite_pool().await;
        let policy_id = sample_policy_id(&pool).await;
        let repo = SqlxUserRepo::new(pool);
        let user = sample_user(policy_id, "alice");

        repo.upsert(&user).await.expect("upsert");
        let fetched = repo.find_by_id(user.id).await.expect("find_by_id");

        assert_eq!(fetched, Some(user));
    }

    #[tokio::test]
    async fn media_playback_preferences_round_trip_and_update() {
        let pool = test_sqlite_pool().await;
        let policy_id = sample_policy_id(&pool).await;
        let repo = SqlxUserRepo::new(pool.clone());
        let user = sample_user(policy_id, "viewer");
        repo.upsert(&user).await.unwrap();

        let work_id = Uuid::new_v4();
        let media_file_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO works \
             (id, kind, title, sort_title, added_at, availability) \
             VALUES (?, 'movie', 'Film', 'Film', ?, 'available')",
        )
        .bind(work_id.to_string())
        .bind(format_datetime(Utc::now()))
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO media_files \
             (id, work_id, leaf_ref, path, container, codec, size_bytes, source_instance_id) \
             VALUES (?, ?, 'work', '/tmp/film.mkv', 'mkv', 'h264', 1, 'source')",
        )
        .bind(media_file_id.to_string())
        .bind(work_id.to_string())
        .execute(&pool)
        .await
        .unwrap();

        let mut preferences = MediaPlaybackPreferences {
            media_file_id,
            quality_id: "original".to_string(),
            audio_track_id: Some("source-audio-2".to_string()),
            subtitle_track_id: None,
        };
        repo.upsert_media_playback_preferences(user.id, &preferences)
            .await
            .unwrap();
        assert_eq!(
            repo.get_media_playback_preferences(user.id, media_file_id)
                .await
                .unwrap(),
            Some(preferences.clone())
        );

        preferences.quality_id = "h264-720p-4mbps".to_string();
        preferences.subtitle_track_id = Some("source-subtitle-4".to_string());
        repo.upsert_media_playback_preferences(user.id, &preferences)
            .await
            .unwrap();
        assert_eq!(
            repo.get_media_playback_preferences(user.id, media_file_id)
                .await
                .unwrap(),
            Some(preferences)
        );
    }

    #[tokio::test]
    async fn database_default_gives_existing_style_rows_english_audio() {
        let pool = test_sqlite_pool().await;
        let policy_id = sample_policy_id(&pool).await;
        let user_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO users \
             (id, username, display_name, email, password_hash, policy_id, created_at, disabled) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(user_id.to_string())
        .bind("legacy-user")
        .bind("Legacy User")
        .bind(Option::<String>::None)
        .bind("$argon2id$v=19$m=19456,t=2,p=1$fakesalt$fakehash")
        .bind(policy_id.to_string())
        .bind(format_datetime(Utc::now()))
        .bind(0_i64)
        .execute(&pool)
        .await
        .unwrap();

        let user = SqlxUserRepo::new(pool)
            .find_by_id(user_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            user.preferred_audio_language,
            streamarr_model::DEFAULT_PREFERRED_AUDIO_LANGUAGE
        );
    }

    #[tokio::test]
    async fn find_by_username_matches_and_misses() {
        let pool = test_sqlite_pool().await;
        let policy_id = sample_policy_id(&pool).await;
        let repo = SqlxUserRepo::new(pool);
        let user = sample_user(policy_id, "bob");
        repo.upsert(&user).await.unwrap();

        let found = repo.find_by_username("bob").await.unwrap();
        assert_eq!(found, Some(user));

        let missing = repo.find_by_username("does-not-exist").await.unwrap();
        assert!(missing.is_none());
    }

    #[tokio::test]
    async fn find_by_id_missing_returns_none() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxUserRepo::new(pool);
        let found = repo.find_by_id(Uuid::new_v4()).await.expect("find_by_id");
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn upsert_updates_existing_row() {
        let pool = test_sqlite_pool().await;
        let policy_id = sample_policy_id(&pool).await;
        let repo = SqlxUserRepo::new(pool);
        let mut user = sample_user(policy_id, "carol");
        repo.upsert(&user).await.unwrap();

        user.display_name = "Carol Renamed".to_string();
        user.disabled = true;
        user.email = None;
        user.password_hash =
            Sensitive::new("$argon2id$v=19$m=19456,t=2,p=1$rotated$rotated".to_string());
        repo.upsert(&user).await.unwrap();

        let fetched = repo.find_by_id(user.id).await.unwrap();
        assert_eq!(fetched, Some(user));
    }

    #[tokio::test]
    async fn list_all_orders_by_username() {
        let pool = test_sqlite_pool().await;
        let policy_id = sample_policy_id(&pool).await;
        let repo = SqlxUserRepo::new(pool);

        repo.upsert(&sample_user(policy_id, "zoe")).await.unwrap();
        repo.upsert(&sample_user(policy_id, "amy")).await.unwrap();
        repo.upsert(&sample_user(policy_id, "mia")).await.unwrap();

        let all = repo.list_all().await.unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].username, "amy");
        assert_eq!(all[1].username, "mia");
        assert_eq!(all[2].username, "zoe");
    }

    #[tokio::test]
    async fn delete_removes_row() {
        let pool = test_sqlite_pool().await;
        let policy_id = sample_policy_id(&pool).await;
        let repo = SqlxUserRepo::new(pool);
        let user = sample_user(policy_id, "doomed");
        repo.upsert(&user).await.unwrap();

        repo.delete(user.id).await.unwrap();
        let found = repo.find_by_id(user.id).await.unwrap();
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn delete_missing_returns_not_found() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxUserRepo::new(pool);
        let err = repo.delete(Uuid::new_v4()).await.unwrap_err();
        assert!(matches!(err, DbError::NotFound));
    }

    #[tokio::test]
    async fn profile_avatar_round_trips_and_updates() {
        let pool = test_sqlite_pool().await;
        let policy_id = sample_policy_id(&pool).await;
        let repo = SqlxUserRepo::new(pool.clone());
        let user = sample_user(policy_id, "avatar-viewer");
        repo.upsert(&user).await.unwrap();

        let preset = streamarr_model::ProfileAvatarPreference {
            kind: streamarr_model::ProfileAvatarKind::Preset,
            value: "robot".to_string(),
        };
        repo.upsert_profile_avatar(user.id, &preset).await.unwrap();
        assert_eq!(
            repo.get_profile_avatar(user.id).await.unwrap(),
            Some(preset)
        );

        let custom = streamarr_model::ProfileAvatarPreference {
            kind: streamarr_model::ProfileAvatarKind::Custom,
            value: "data:image/jpeg;base64,YXZhdGFy".to_string(),
        };
        repo.upsert_profile_avatar(user.id, &custom).await.unwrap();
        assert_eq!(
            repo.get_profile_avatar(user.id).await.unwrap(),
            Some(custom)
        );
    }
}
