use async_trait::async_trait;
use chrono::{DateTime, Utc};
use playarr_model::{MediaPlaybackPreferences, ProfileAvatarPreference, Sensitive, User};
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{bool_from_i64, bool_to_i64, format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

/// Sync-only metadata for one row: `updated_at`/`origin_peer_id`/
/// `deleted_at` -- deliberately kept off `playarr_model::User`/
/// `playarr_model::Policy` themselves (see this module's own doc
/// comment). Shared by [`UserRepo`] and `crate::repo::policy::PolicyRepo`
/// (both tables carry the identical three sync columns, added by the same
/// migration) rather than duplicated per table. `playarr-peer-sync`'s
/// `account_sync` reads this via [`UserRepo::get_sync_metadata`]/
/// `PolicyRepo::get_sync_metadata` before ever writing an incoming synced
/// row, to decide an LWW winner (`docs/architecture/peer-groups.md` §3.5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SyncMetadata {
    pub updated_at: DateTime<Utc>,
    /// The peer whose admin actually created this row -- `None` for a row
    /// created locally before this node ever joined a group, or synced in
    /// from a peer that itself hadn't recorded an origin yet.
    pub origin_peer_id: Option<Uuid>,
    /// `Some` means this row is a tombstone (soft-deleted) -- see
    /// `UserRepo::delete`'s own doc comment.
    pub deleted_at: Option<DateTime<Utc>>,
}

/// CRUD + lookup surface over [`playarr_model::User`] -- real, durable
/// user accounts. This is the persistence half of moving Playarr Server off
/// `trusted-network` auto-admin (source-IP allowlist login) and onto real
/// username/password accounts: `playarr_auth::login::evaluate_login`
/// already handles `AuthMode::FullAccount` (including real Argon2id
/// password hashing via `playarr_auth::login::hash_password` /
/// `Argon2PasswordVerifier`), but today the only account store behind it is
/// `playarr_auth::login::InMemoryUserDirectory`, which starts empty on
/// every boot. This trait is that directory's real backing store.
///
/// `updated_at`/`deleted_at`/`origin_peer_id` (added by
/// `backend/migrations/{postgres/0036,sqlite/0033}_peer_sync_state.sql`,
/// nullable and additive -- see `docs/architecture/peer-groups.md` §2.2)
/// exist purely for cross-node sync bookkeeping and are deliberately not
/// read into [`playarr_model::User`] here: nothing in this crate's public
/// surface needs them yet, that's Phase 2's sync protocol layer's job.
/// [`SqlxUserRepo`] is still the only thing allowed to write them, so the
/// invariants live here: `upsert` always stamps `updated_at` with the
/// current server time (never a caller-supplied value), `delete` sets
/// `deleted_at` instead of removing the row, and `origin_peer_id` is set
/// exactly once, by [`UserRepo::set_origin_peer_id_if_unset`].
#[async_trait]
pub trait UserRepo: Send + Sync {
    async fn list_all(&self) -> Result<Vec<User>, DbError>;

    async fn find_by_id(&self, id: Uuid) -> Result<Option<User>, DbError>;

    /// The login path's primary lookup: username is the natural key a
    /// login request arrives with, before anything else about the account
    /// is known.
    async fn find_by_username(&self, username: &str) -> Result<Option<User>, DbError>;

    /// Insert-or-update by `User::id`. Always stamps `updated_at` with the
    /// current server time -- see this module's own doc comment -- never a
    /// caller-supplied value, so a client can't backdate a write to lose a
    /// last-writer-wins race it should have won.
    async fn upsert(&self, user: &User) -> Result<(), DbError>;

    /// Soft-deletes by setting `deleted_at`, rather than a hard `DELETE` --
    /// see this module's own doc comment. A no-op (returns
    /// [`DbError::NotFound`]) if the row doesn't exist or is already
    /// deleted, exactly like the hard delete this replaced.
    async fn delete(&self, id: Uuid) -> Result<(), DbError>;

    /// Defaults `origin_peer_id` to `peer_id` on a row that doesn't have
    /// one yet -- called by `playarr-api`'s local-creation handlers
    /// immediately after `upsert` on a freshly-inserted row, never by
    /// `upsert` itself: an *update* must never overwrite a row's existing
    /// origin claim (whether set locally on first create, or by a future
    /// sync write claiming a different origin peer). See
    /// `docs/architecture/peer-groups.md` §2.2's scope note. A no-op if
    /// the row already has an `origin_peer_id`.
    async fn set_origin_peer_id_if_unset(&self, id: Uuid, peer_id: Uuid) -> Result<(), DbError>;

    /// Reads `updated_at`/`origin_peer_id`/`deleted_at` for `id`, regardless
    /// of soft-delete state (unlike `find_by_id`, which filters `deleted_at
    /// IS NULL`) -- `account_sync.rs` needs to see a tombstoned row's
    /// metadata too, to decide whether an incoming peer's write (including a
    /// tombstone) should win. `None` if no row with this id has ever
    /// existed.
    async fn get_sync_metadata(&self, id: Uuid) -> Result<Option<SyncMetadata>, DbError>;

    /// Applies an already-LWW-resolved incoming row from a peer. Unlike
    /// [`Self::upsert`] (which always stamps the server's own clock and
    /// never touches `origin_peer_id`/`deleted_at`), this writes the
    /// caller-supplied `metadata` verbatim -- the whole point being that a
    /// synced write's `updated_at` must stay the *origin* peer's claimed
    /// time, not this node's receipt time, so the next hop's LWW comparison
    /// (this row, gossiped onward to a third peer) stays meaningful. Callers
    /// (`account_sync.rs`) are responsible for having already decided this
    /// write should win before calling this -- this method itself does no
    /// comparison and unconditionally overwrites.
    async fn apply_synced(&self, user: &User, metadata: SyncMetadata) -> Result<(), DbError>;

    /// Every row whose `updated_at` is strictly greater than `since` (every
    /// row, oldest first, when `since` is `None`), paired with its
    /// [`SyncMetadata`] -- the read behind `GET /api/v1/peer/accounts?since=`
    /// (`docs/architecture/peer-groups.md` §3.6): `playarr-api`'s handler
    /// wraps each pair into an `account_sync::UserSyncRow` for the wire.
    /// Unlike every other read path on this trait, this one deliberately
    /// does **not** filter `deleted_at IS NULL` -- a soft-deleted row must
    /// still be reported so the tombstone propagates to peers (§3.5: "never
    /// a delete inferred from absence"). Ordered by `updated_at` (then `id`
    /// as a stable tie-breaker for rows sharing one timestamp) so the
    /// caller can safely resume from the last row's `updated_at` as its next
    /// cursor.
    async fn list_updated_since(
        &self,
        since: Option<DateTime<Utc>>,
    ) -> Result<Vec<(User, SyncMetadata)>, DbError>;

    async fn get_media_playback_preferences(
        &self,
        user_id: Uuid,
        media_file_id: Uuid,
    ) -> Result<Option<MediaPlaybackPreferences>, DbError>;

    /// Every per-file playback choice stored for `user_id` (the portable
    /// export reads these; never another user's rows).
    async fn list_media_playback_preferences(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<MediaPlaybackPreferences>, DbError>;

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
            // `playarr_auth::login::hash_password`), not a plaintext
            // secret -- `Sensitive::new` here only stops it leaking via
            // `Debug`/`Display`, it doesn't encrypt anything by itself.
            password_hash: Sensitive::new(password_hash),
            policy_id: parse_uuid(&policy_id)?,
            created_at: parse_datetime(&created_at)?,
            disabled: bool_from_i64(disabled),
            preferred_audio_language,
        })
    }

    /// Same row shape as [`Self::from_row`], plus the three sync-only
    /// columns (see this module's own doc comment) parsed into a
    /// [`SyncMetadata`] -- shared by [`UserRepo::list_updated_since`]'s
    /// implementation below and, in spirit, `Self::get_sync_metadata`'s own
    /// parsing (kept separate there since that query doesn't select the
    /// rest of the row).
    fn from_row_with_metadata(row: &AnyRow) -> Result<(User, SyncMetadata), DbError> {
        let user = Self::from_row(row)?;
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
        Ok((user, metadata))
    }
}

#[async_trait]
impl UserRepo for SqlxUserRepo {
    async fn list_all(&self) -> Result<Vec<User>, DbError> {
        // `deleted_at IS NULL` -- soft-deleted rows never resurface through
        // any existing read path (see `delete`'s own doc comment); this
        // keeps that invariant true for the listing surface too.
        let sql = "SELECT id, username, display_name, email, password_hash, policy_id, \
                    created_at, disabled, preferred_audio_language FROM users \
                    WHERE deleted_at IS NULL ORDER BY username";
        let rows = sqlx::query(sql).fetch_all(&self.pool).await?;
        rows.iter().map(Self::from_row).collect()
    }

    async fn find_by_id(&self, id: Uuid) -> Result<Option<User>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id, username, display_name, email, password_hash, policy_id, \
                 created_at, disabled, preferred_audio_language FROM users \
                 WHERE id = ? AND deleted_at IS NULL"
            }
            Backend::Postgres => {
                "SELECT id, username, display_name, email, password_hash, policy_id, \
                 created_at, disabled, preferred_audio_language FROM users \
                 WHERE id = $1 AND deleted_at IS NULL"
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
                 created_at, disabled, preferred_audio_language FROM users \
                 WHERE username = ? AND deleted_at IS NULL"
            }
            Backend::Postgres => {
                "SELECT id, username, display_name, email, password_hash, policy_id, \
                 created_at, disabled, preferred_audio_language FROM users \
                 WHERE username = $1 AND deleted_at IS NULL"
            }
        };
        let row = sqlx::query(sql)
            .bind(username)
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(Self::from_row).transpose()
    }

    async fn upsert(&self, user: &User) -> Result<(), DbError> {
        // `updated_at` is bound once below from the server clock, never
        // from `user` (there is no such field on `User` for a caller to
        // even supply) -- see this module's own doc comment. `origin_
        // peer_id` is deliberately absent from both the column list and
        // `DO UPDATE SET`: omitting it from `INSERT` leaves a fresh row's
        // value `NULL` (set afterward, once, via `set_origin_peer_id_if_
        // unset`), and omitting it from `DO UPDATE SET` means an update
        // through this method can never clobber an existing row's origin
        // claim.
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO users \
                 (id, username, display_name, email, password_hash, policy_id, created_at, disabled, preferred_audio_language, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                 username = excluded.username, display_name = excluded.display_name, \
                 email = excluded.email, password_hash = excluded.password_hash, \
                 policy_id = excluded.policy_id, created_at = excluded.created_at, \
                 disabled = excluded.disabled, \
                 preferred_audio_language = excluded.preferred_audio_language, \
                 updated_at = excluded.updated_at"
            }
            Backend::Postgres => {
                "INSERT INTO users \
                 (id, username, display_name, email, password_hash, policy_id, created_at, disabled, preferred_audio_language, updated_at) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) \
                 ON CONFLICT (id) DO UPDATE SET \
                 username = excluded.username, display_name = excluded.display_name, \
                 email = excluded.email, password_hash = excluded.password_hash, \
                 policy_id = excluded.policy_id, created_at = excluded.created_at, \
                 disabled = excluded.disabled, \
                 preferred_audio_language = excluded.preferred_audio_language, \
                 updated_at = excluded.updated_at"
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
            .bind(format_datetime(chrono::Utc::now()))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete(&self, id: Uuid) -> Result<(), DbError> {
        // Soft delete: sets `deleted_at` instead of removing the row, so
        // the tombstone itself can propagate across the group (§2.2) --
        // `AND deleted_at IS NULL` makes a double-delete behave exactly
        // like the hard delete this replaced (`NotFound` the second time),
        // rather than silently re-stamping `deleted_at` with a later time.
        let sql = match self.backend {
            Backend::Sqlite => {
                "UPDATE users SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL"
            }
            Backend::Postgres => {
                "UPDATE users SET deleted_at = $1 WHERE id = $2 AND deleted_at IS NULL"
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

    async fn set_origin_peer_id_if_unset(&self, id: Uuid, peer_id: Uuid) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "UPDATE users SET origin_peer_id = ? WHERE id = ? AND origin_peer_id IS NULL"
            }
            Backend::Postgres => {
                "UPDATE users SET origin_peer_id = $1 WHERE id = $2 AND origin_peer_id IS NULL"
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
                "SELECT updated_at, origin_peer_id, deleted_at FROM users WHERE id = ?"
            }
            Backend::Postgres => {
                "SELECT updated_at, origin_peer_id, deleted_at FROM users WHERE id = $1"
            }
        };
        let row = sqlx::query(sql)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.map(|row| {
            // `updated_at` is `TEXT NULL` at the schema level (added by an
            // `ALTER TABLE`, so sqlite can't retroactively make it `NOT
            // NULL`), but every row has one by the time this is read: the
            // same migration backfills every pre-existing row's value from
            // `created_at`, and `upsert` has stamped it on every write
            // since (see this module's own doc comment).
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

    async fn apply_synced(&self, user: &User, metadata: SyncMetadata) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO users \
                 (id, username, display_name, email, password_hash, policy_id, created_at, disabled, \
                 preferred_audio_language, updated_at, origin_peer_id, deleted_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (id) DO UPDATE SET \
                 username = excluded.username, display_name = excluded.display_name, \
                 email = excluded.email, password_hash = excluded.password_hash, \
                 policy_id = excluded.policy_id, created_at = excluded.created_at, \
                 disabled = excluded.disabled, \
                 preferred_audio_language = excluded.preferred_audio_language, \
                 updated_at = excluded.updated_at, origin_peer_id = excluded.origin_peer_id, \
                 deleted_at = excluded.deleted_at"
            }
            Backend::Postgres => {
                "INSERT INTO users \
                 (id, username, display_name, email, password_hash, policy_id, created_at, disabled, \
                 preferred_audio_language, updated_at, origin_peer_id, deleted_at) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) \
                 ON CONFLICT (id) DO UPDATE SET \
                 username = excluded.username, display_name = excluded.display_name, \
                 email = excluded.email, password_hash = excluded.password_hash, \
                 policy_id = excluded.policy_id, created_at = excluded.created_at, \
                 disabled = excluded.disabled, \
                 preferred_audio_language = excluded.preferred_audio_language, \
                 updated_at = excluded.updated_at, origin_peer_id = excluded.origin_peer_id, \
                 deleted_at = excluded.deleted_at"
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
            .bind(format_datetime(metadata.updated_at))
            .bind(metadata.origin_peer_id.map(|id| id.to_string()))
            .bind(metadata.deleted_at.map(format_datetime))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn list_updated_since(
        &self,
        since: Option<DateTime<Utc>>,
    ) -> Result<Vec<(User, SyncMetadata)>, DbError> {
        const SELECT: &str = "id, username, display_name, email, password_hash, policy_id, \
                               created_at, disabled, preferred_audio_language, updated_at, \
                               origin_peer_id, deleted_at";
        // Deliberately no `WHERE deleted_at IS NULL` -- see this trait
        // method's own doc comment.
        let sql = match (self.backend, since.is_some()) {
            (Backend::Sqlite, true) => {
                format!("SELECT {SELECT} FROM users WHERE updated_at > ? ORDER BY updated_at ASC, id ASC")
            }
            (Backend::Sqlite, false) => {
                format!("SELECT {SELECT} FROM users ORDER BY updated_at ASC, id ASC")
            }
            (Backend::Postgres, true) => {
                format!("SELECT {SELECT} FROM users WHERE updated_at > $1 ORDER BY updated_at ASC, id ASC")
            }
            (Backend::Postgres, false) => {
                format!("SELECT {SELECT} FROM users ORDER BY updated_at ASC, id ASC")
            }
        };
        let mut query = sqlx::query(&sql);
        if let Some(since) = since {
            query = query.bind(format_datetime(since));
        }
        let rows = query.fetch_all(&self.pool).await?;
        rows.iter().map(Self::from_row_with_metadata).collect()
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

    async fn list_media_playback_preferences(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<MediaPlaybackPreferences>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "SELECT media_file_id, quality_id, audio_track_id, subtitle_track_id \
                 FROM user_media_playback_preferences WHERE user_id = ? ORDER BY media_file_id"
            }
            Backend::Postgres => {
                "SELECT media_file_id, quality_id, audio_track_id, subtitle_track_id \
                 FROM user_media_playback_preferences WHERE user_id = $1 ORDER BY media_file_id"
            }
        };
        let rows = sqlx::query(sql)
            .bind(user_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter()
            .map(|row| {
                let media_file_id: String = row.try_get("media_file_id")?;
                Ok(MediaPlaybackPreferences {
                    media_file_id: parse_uuid(&media_file_id)?,
                    quality_id: row.try_get("quality_id")?,
                    audio_track_id: row.try_get("audio_track_id")?,
                    subtitle_track_id: row.try_get("subtitle_track_id")?,
                })
            })
            .collect()
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
    use chrono::{Duration, SubsecRound, Utc};

    use super::*;
    use crate::pool::test_sqlite_pool;
    use crate::repo::policy::{PolicyRepo, SqlxPolicyRepo};

    /// `users.policy_id` is a real `REFERENCES policies (id)` foreign key
    /// (see `0007_users_policies.sql`), so every test needs a persisted
    /// `Policy` row to point at.
    async fn sample_policy_id(pool: &DbPool) -> Uuid {
        let policy = playarr_model::Policy {
            id: Uuid::new_v4(),
            name: "Default".to_string(),
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
            preferred_audio_language: playarr_model::DEFAULT_PREFERRED_AUDIO_LANGUAGE.to_string(),
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
            Some(preferences.clone())
        );

        // Listing is scoped to the user: another user sees none of these rows.
        let listed = repo.list_media_playback_preferences(user.id).await.unwrap();
        assert_eq!(listed, vec![preferences]);
        let other = sample_user(policy_id, "someone-else");
        repo.upsert(&other).await.unwrap();
        assert!(repo
            .list_media_playback_preferences(other.id)
            .await
            .unwrap()
            .is_empty());
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
            playarr_model::DEFAULT_PREFERRED_AUDIO_LANGUAGE
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
    async fn delete_soft_deletes_the_row_instead_of_removing_it() {
        // `delete_removes_row` above already covers the observable
        // behaviour every existing caller relies on (the row disappears
        // from every read path); this test covers the new invariant this
        // change adds -- the row itself survives as a tombstone, it isn't
        // physically removed (see docs/architecture/peer-groups.md §2.2).
        let pool = test_sqlite_pool().await;
        let policy_id = sample_policy_id(&pool).await;
        let repo = SqlxUserRepo::new(pool.clone());
        let user = sample_user(policy_id, "tombstoned");
        repo.upsert(&user).await.unwrap();

        repo.delete(user.id).await.unwrap();

        let (count, deleted_at): (i64, Option<String>) =
            sqlx::query_as("SELECT COUNT(*), MAX(deleted_at) FROM users WHERE id = ?")
                .bind(user.id.to_string())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 1, "soft delete must not remove the row");
        assert!(deleted_at.is_some());

        // Every existing read path still treats it as gone.
        assert!(repo.find_by_id(user.id).await.unwrap().is_none());
        assert!(repo
            .find_by_username(&user.username)
            .await
            .unwrap()
            .is_none());
        assert!(repo.list_all().await.unwrap().is_empty());

        // A second delete finds nothing left to delete, exactly like the
        // hard delete this replaced.
        let err = repo.delete(user.id).await.unwrap_err();
        assert!(matches!(err, DbError::NotFound));
    }

    #[tokio::test]
    async fn upsert_stamps_updated_at_from_the_server_clock() {
        let pool = test_sqlite_pool().await;
        let policy_id = sample_policy_id(&pool).await;
        let repo = SqlxUserRepo::new(pool.clone());
        // Truncated to millisecond precision to match `format_datetime`'s
        // own storage precision -- otherwise a `before` timestamp with
        // more precision than what actually lands in the column can
        // spuriously compare greater than the truncated `updated_at`.
        let before = Utc::now().trunc_subsecs(3);
        let user = sample_user(policy_id, "freshly-written");

        repo.upsert(&user).await.unwrap();

        let (updated_at,): (Option<String>,) =
            sqlx::query_as("SELECT updated_at FROM users WHERE id = ?")
                .bind(user.id.to_string())
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
        let policy_id = sample_policy_id(&pool).await;
        let repo = SqlxUserRepo::new(pool.clone());
        let user = sample_user(policy_id, "origin-tracked");
        repo.upsert(&user).await.unwrap();

        let first_peer = Uuid::new_v4();
        repo.set_origin_peer_id_if_unset(user.id, first_peer)
            .await
            .unwrap();
        let (origin,): (Option<String>,) =
            sqlx::query_as("SELECT origin_peer_id FROM users WHERE id = ?")
                .bind(user.id.to_string())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(origin, Some(first_peer.to_string()));

        // A later call (e.g. an accidental re-invocation) never clobbers
        // the origin a row already claims.
        let second_peer = Uuid::new_v4();
        repo.set_origin_peer_id_if_unset(user.id, second_peer)
            .await
            .unwrap();
        let (origin,): (Option<String>,) =
            sqlx::query_as("SELECT origin_peer_id FROM users WHERE id = ?")
                .bind(user.id.to_string())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(origin, Some(first_peer.to_string()));

        // Plain `upsert` (an update, not a creation) must not touch
        // `origin_peer_id` either.
        let mut updated = user.clone();
        updated.display_name = "Renamed".to_string();
        repo.upsert(&updated).await.unwrap();
        let (origin,): (Option<String>,) =
            sqlx::query_as("SELECT origin_peer_id FROM users WHERE id = ?")
                .bind(user.id.to_string())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(origin, Some(first_peer.to_string()));
    }

    #[tokio::test]
    async fn get_sync_metadata_reflects_a_locally_created_row() {
        let pool = test_sqlite_pool().await;
        let policy_id = sample_policy_id(&pool).await;
        let repo = SqlxUserRepo::new(pool.clone());
        let before = Utc::now().trunc_subsecs(3);
        let user = sample_user(policy_id, "sync-metadata");
        repo.upsert(&user).await.unwrap();

        let metadata = repo.get_sync_metadata(user.id).await.unwrap().unwrap();
        assert!(metadata.updated_at >= before);
        assert_eq!(metadata.origin_peer_id, None);
        assert_eq!(metadata.deleted_at, None);
    }

    #[tokio::test]
    async fn get_sync_metadata_missing_row_returns_none() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxUserRepo::new(pool);
        assert!(repo
            .get_sync_metadata(Uuid::new_v4())
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn apply_synced_writes_the_caller_supplied_metadata_verbatim() {
        let pool = test_sqlite_pool().await;
        let policy_id = sample_policy_id(&pool).await;
        let repo = SqlxUserRepo::new(pool.clone());
        let user = sample_user(policy_id, "synced-in");
        let origin_peer_id = Uuid::new_v4();
        // Deliberately not "now" -- a synced row's `updated_at` is the
        // *origin* peer's claimed time, which this test picks a fixed value
        // for to prove `apply_synced` doesn't silently restamp it.
        let claimed_updated_at = Utc::now().trunc_subsecs(3) - chrono::Duration::hours(2);

        repo.apply_synced(
            &user,
            SyncMetadata {
                updated_at: claimed_updated_at,
                origin_peer_id: Some(origin_peer_id),
                deleted_at: None,
            },
        )
        .await
        .expect("apply_synced");

        let fetched = repo.find_by_id(user.id).await.unwrap();
        assert_eq!(fetched, Some(user.clone()));
        let metadata = repo.get_sync_metadata(user.id).await.unwrap().unwrap();
        assert_eq!(metadata.updated_at, claimed_updated_at);
        assert_eq!(metadata.origin_peer_id, Some(origin_peer_id));
        assert_eq!(metadata.deleted_at, None);
    }

    #[tokio::test]
    async fn apply_synced_can_write_a_tombstone_and_updates_existing_rows() {
        let pool = test_sqlite_pool().await;
        let policy_id = sample_policy_id(&pool).await;
        let repo = SqlxUserRepo::new(pool.clone());
        let user = sample_user(policy_id, "synced-tombstone");
        let origin_peer_id = Uuid::new_v4();
        let first = Utc::now().trunc_subsecs(3) - chrono::Duration::hours(1);
        repo.apply_synced(
            &user,
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
            &user,
            SyncMetadata {
                updated_at: deleted_at,
                origin_peer_id: Some(origin_peer_id),
                deleted_at: Some(deleted_at),
            },
        )
        .await
        .unwrap();

        // `find_by_id`/`find_by_username`/`list_all` all filter `deleted_at
        // IS NULL` -- a synced tombstone must disappear from those exactly
        // like a locally-issued `delete` does.
        assert!(repo.find_by_id(user.id).await.unwrap().is_none());
        let metadata = repo.get_sync_metadata(user.id).await.unwrap().unwrap();
        assert_eq!(metadata.deleted_at, Some(deleted_at));
    }

    #[tokio::test]
    async fn list_updated_since_none_returns_every_row_including_soft_deleted() {
        let pool = test_sqlite_pool().await;
        let policy_id = sample_policy_id(&pool).await;
        let repo = SqlxUserRepo::new(pool.clone());
        let kept = sample_user(policy_id, "kept");
        let tombstoned = sample_user(policy_id, "tombstoned-for-sync");
        repo.upsert(&kept).await.unwrap();
        repo.upsert(&tombstoned).await.unwrap();
        repo.delete(tombstoned.id).await.unwrap();

        let rows = repo.list_updated_since(None).await.unwrap();
        let ids: Vec<Uuid> = rows.iter().map(|(user, _)| user.id).collect();
        assert!(ids.contains(&kept.id));
        assert!(
            ids.contains(&tombstoned.id),
            "a soft-deleted row must still be reported so its tombstone can propagate"
        );
        let (_, tombstoned_meta) = rows
            .iter()
            .find(|(user, _)| user.id == tombstoned.id)
            .unwrap();
        assert!(tombstoned_meta.deleted_at.is_some());
    }

    #[tokio::test]
    async fn list_updated_since_a_cursor_excludes_rows_at_or_before_it() {
        // Explicit, well-separated `updated_at` values via `apply_synced`
        // (see `list_updated_since_orders_oldest_first`'s own note) so the
        // cursor comparison isn't at the mercy of two writes landing in the
        // same millisecond.
        let pool = test_sqlite_pool().await;
        let policy_id = sample_policy_id(&pool).await;
        let repo = SqlxUserRepo::new(pool.clone());
        let now = Utc::now().trunc_subsecs(3);
        let old = sample_user(policy_id, "already-synced");
        let cursor = now - Duration::minutes(10);
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

        let fresh = sample_user(policy_id, "freshly-changed");
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
        let ids: Vec<Uuid> = rows.iter().map(|(user, _)| user.id).collect();
        assert!(
            !ids.contains(&old.id),
            "a row at or before the cursor must not be re-reported"
        );
        assert!(ids.contains(&fresh.id));
    }

    #[tokio::test]
    async fn list_updated_since_orders_oldest_first() {
        // Uses `apply_synced` with explicit, well-separated `updated_at`
        // values rather than two back-to-back `upsert`s: both calls can
        // land within the same millisecond of server-clock precision,
        // which would make an id-tie-break-dependent assertion flaky.
        let pool = test_sqlite_pool().await;
        let policy_id = sample_policy_id(&pool).await;
        let repo = SqlxUserRepo::new(pool.clone());
        let now = Utc::now().trunc_subsecs(3);
        let older = sample_user(policy_id, "older-write");
        let newer = sample_user(policy_id, "newer-write");
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
                updated_at: now - Duration::minutes(10),
                origin_peer_id: None,
                deleted_at: None,
            },
        )
        .await
        .unwrap();

        let rows = repo.list_updated_since(None).await.unwrap();
        let position = |id: Uuid| rows.iter().position(|(user, _)| user.id == id).unwrap();
        assert!(position(older.id) < position(newer.id));
    }

    #[tokio::test]
    async fn profile_avatar_round_trips_and_updates() {
        let pool = test_sqlite_pool().await;
        let policy_id = sample_policy_id(&pool).await;
        let repo = SqlxUserRepo::new(pool.clone());
        let user = sample_user(policy_id, "avatar-viewer");
        repo.upsert(&user).await.unwrap();

        let preset = playarr_model::ProfileAvatarPreference {
            kind: playarr_model::ProfileAvatarKind::Preset,
            value: "robot".to_string(),
        };
        repo.upsert_profile_avatar(user.id, &preset).await.unwrap();
        assert_eq!(
            repo.get_profile_avatar(user.id).await.unwrap(),
            Some(preset)
        );

        let custom = playarr_model::ProfileAvatarPreference {
            kind: playarr_model::ProfileAvatarKind::Custom,
            value: "data:image/jpeg;base64,YXZhdGFy".to_string(),
        };
        repo.upsert_profile_avatar(user.id, &custom).await.unwrap();
        assert_eq!(
            repo.get_profile_avatar(user.id).await.unwrap(),
            Some(custom)
        );
    }
}
