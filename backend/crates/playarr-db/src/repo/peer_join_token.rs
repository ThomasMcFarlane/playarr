//! Single-use, short-TTL, admin-issued group join tokens -- Phase 1 of
//! `docs/architecture/peer-groups.md` (see that document's §2.1 for the
//! table itself and §3.4 for the join flow this backs).
//!
//! Mirrors [`crate::repo::UserInviteRepo`]/`SqlxUserInviteRepo`'s
//! `token_hash` create/find_valid/consume shape as closely as the schema
//! allows (see `backend/crates/playarr-db/src/repo/user_invite.rs`), with
//! two differences the `peer_join_tokens` table itself drives:
//!
//! - a token here is scoped to a `group_id` rather than carrying its own
//!   grant fields (`can_stream`/`library_allow`), and
//! - redemption is *recorded*, not deleted: `redeemed_by_peer_id` starts
//!   `NULL` and is set exactly once, so the founding node keeps an audit
//!   trail of which peer actually joined through which token, matching
//!   §3.4 step 4's "marks it redeemed" language. `consume` below is
//!   therefore an `UPDATE ... WHERE redeemed_by_peer_id IS NULL`, not a
//!   `DELETE`, but keeps `UserInviteRepo::consume`'s exact contract: it
//!   only succeeds once, atomically, and never leaks *why* a given attempt
//!   failed (unknown hash, expired, or already redeemed all just return
//!   `false`).
//!
//! [`PeerJoinToken`] does not (yet) have a home in `playarr-model` the
//! way `UserInvite`/`NodeIdentity`/`PeerNode` do -- `playarr-model/src/
//! peer.rs` defines every other Phase 1 type but this one. It is kept
//! local to this module rather than added there, so this change stays
//! scoped to a single file (three sibling repos land in the same directory
//! in parallel right now); promoting it to `playarr-model` is a natural
//! follow-up for whichever pass wires this repo into `mod.rs`/`AppState`.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

/// One admin-issued, single-use invitation for another node to join a
/// `playarr_model::PeerGroup` -- see `docs/architecture/peer-groups.md`
/// §3.4. Column-for-column mirror of the `peer_join_tokens` table
/// (`backend/migrations/{postgres/0035,sqlite/0032}_node_identity.sql`).
#[derive(Debug, Clone, PartialEq)]
pub struct PeerJoinToken {
    /// Hash of the raw, one-time token handed to the joining admin -- the
    /// raw value itself is never persisted, same discipline as
    /// `UserInvite::token_hash`.
    pub token_hash: String,
    pub group_id: Uuid,
    /// The admin user who minted this token.
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    /// `None` until a joining peer redeems this token; set exactly once.
    pub redeemed_by_peer_id: Option<Uuid>,
}

/// Durable, one-use storage for administrator-issued peer-group join
/// tokens. Mirrors [`crate::repo::UserInviteRepo`]'s shape -- see this
/// module's own doc comment for the two places the schema forces a
/// difference.
#[async_trait]
pub trait PeerJoinTokenRepo: Send + Sync {
    async fn create(&self, token: &PeerJoinToken) -> Result<(), DbError>;

    /// Valid = exists, has not expired, and has not already been redeemed.
    async fn find_valid(
        &self,
        token_hash: &str,
        now: DateTime<Utc>,
    ) -> Result<Option<PeerJoinToken>, DbError>;

    /// Atomically marks a token redeemed by `redeemed_by_peer_id`, only
    /// when it exists, has not expired, and has not already been redeemed.
    /// `true` means this caller redeemed it; `false` covers unknown,
    /// expired, and already-redeemed tokens without leaking which case
    /// applied -- the same non-leaking contract as `UserInviteRepo::consume`.
    async fn consume(
        &self,
        token_hash: &str,
        now: DateTime<Utc>,
        redeemed_by_peer_id: Uuid,
    ) -> Result<bool, DbError>;
}

pub struct SqlxPeerJoinTokenRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxPeerJoinTokenRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }
}

fn from_row(row: &AnyRow) -> Result<PeerJoinToken, DbError> {
    let token_hash: String = row.try_get("token_hash")?;
    let group_id: String = row.try_get("group_id")?;
    let created_by: String = row.try_get("created_by")?;
    let created_at: String = row.try_get("created_at")?;
    let expires_at: String = row.try_get("expires_at")?;
    let redeemed_by_peer_id: Option<String> = row.try_get("redeemed_by_peer_id")?;
    Ok(PeerJoinToken {
        token_hash,
        group_id: parse_uuid(&group_id)?,
        created_by: parse_uuid(&created_by)?,
        created_at: parse_datetime(&created_at)?,
        expires_at: parse_datetime(&expires_at)?,
        redeemed_by_peer_id: redeemed_by_peer_id.as_deref().map(parse_uuid).transpose()?,
    })
}

const COLUMNS: &str =
    "token_hash, group_id, created_by, created_at, expires_at, redeemed_by_peer_id";

#[async_trait]
impl PeerJoinTokenRepo for SqlxPeerJoinTokenRepo {
    async fn create(&self, token: &PeerJoinToken) -> Result<(), DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO peer_join_tokens \
                 (token_hash, group_id, created_by, created_at, expires_at, redeemed_by_peer_id) \
                 VALUES (?, ?, ?, ?, ?, ?)"
            }
            Backend::Postgres => {
                "INSERT INTO peer_join_tokens \
                 (token_hash, group_id, created_by, created_at, expires_at, redeemed_by_peer_id) \
                 VALUES ($1, $2, $3, $4, $5, $6)"
            }
        };
        sqlx::query(sql)
            .bind(&token.token_hash)
            .bind(token.group_id.to_string())
            .bind(token.created_by.to_string())
            .bind(format_datetime(token.created_at))
            .bind(format_datetime(token.expires_at))
            .bind(token.redeemed_by_peer_id.map(|id| id.to_string()))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn find_valid(
        &self,
        token_hash: &str,
        now: DateTime<Utc>,
    ) -> Result<Option<PeerJoinToken>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => format!(
                "SELECT {COLUMNS} FROM peer_join_tokens \
                 WHERE token_hash = ? AND expires_at > ? AND redeemed_by_peer_id IS NULL"
            ),
            Backend::Postgres => format!(
                "SELECT {COLUMNS} FROM peer_join_tokens \
                 WHERE token_hash = $1 AND expires_at > $2 AND redeemed_by_peer_id IS NULL"
            ),
        };
        let row = sqlx::query(&sql)
            .bind(token_hash)
            .bind(format_datetime(now))
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(from_row).transpose()
    }

    async fn consume(
        &self,
        token_hash: &str,
        now: DateTime<Utc>,
        redeemed_by_peer_id: Uuid,
    ) -> Result<bool, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "UPDATE peer_join_tokens SET redeemed_by_peer_id = ? \
                 WHERE token_hash = ? AND expires_at > ? AND redeemed_by_peer_id IS NULL"
            }
            Backend::Postgres => {
                "UPDATE peer_join_tokens SET redeemed_by_peer_id = $1 \
                 WHERE token_hash = $2 AND expires_at > $3 AND redeemed_by_peer_id IS NULL"
            }
        };
        let result = sqlx::query(sql)
            .bind(redeemed_by_peer_id.to_string())
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
    use playarr_model::{Policy, Sensitive, User};

    use super::*;
    use crate::pool::test_sqlite_pool;
    use crate::repo::{PolicyRepo, SqlxPolicyRepo, SqlxUserRepo, UserRepo};

    /// `peer_join_tokens.created_by`/`group_id` are real `REFERENCES`
    /// foreign keys (see `0032_node_identity.sql`), and sqlx-sqlite enables
    /// `PRAGMA foreign_keys = ON` by default -- so every test needs real
    /// parent rows first. `created_by` goes through the real
    /// `PolicyRepo`/`UserRepo` (mirroring `user_invite::tests::seed_admin`);
    /// `group_id` bypasses the not-yet-implemented `PeerGroupRepo` with a
    /// minimal direct insert, mirroring `download_ticket::tests::seed_user`'s
    /// own bypass pattern for an out-of-scope parent table.
    async fn seed_admin(pool: &DbPool) -> Uuid {
        let policy = Policy {
            id: Uuid::new_v4(),
            name: "Peer join token test admin".to_string(),
            library_allow: vec![],
            group_library_allow: vec![],
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
            household: Default::default(),
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
            username: "peer-join-token-admin".to_string(),
            display_name: "Peer Join Token Admin".to_string(),
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

    async fn seed_group(pool: &DbPool) -> Uuid {
        let group_id = Uuid::new_v4();
        sqlx::query("INSERT INTO peer_groups (id, name, created_at) VALUES (?, ?, ?)")
            .bind(group_id.to_string())
            .bind("Test Group")
            .bind(format_datetime(Utc::now()))
            .execute(pool)
            .await
            .expect("insert parent peer_groups row");
        group_id
    }

    #[tokio::test]
    async fn join_token_is_redeemed_once_before_expiry() {
        let pool = test_sqlite_pool().await;
        let created_by = seed_admin(&pool).await;
        let group_id = seed_group(&pool).await;
        let now = Utc::now();
        let token = PeerJoinToken {
            token_hash: "token-hash".to_string(),
            group_id,
            created_by,
            created_at: now,
            expires_at: now + Duration::minutes(15),
            redeemed_by_peer_id: None,
        };
        let repo = SqlxPeerJoinTokenRepo::new(pool);
        repo.create(&token).await.unwrap();

        let persisted = repo
            .find_valid(&token.token_hash, now)
            .await
            .unwrap()
            .expect("token should be valid");
        assert_eq!(persisted.token_hash, token.token_hash);
        assert_eq!(persisted.group_id, token.group_id);
        assert_eq!(persisted.created_by, token.created_by);
        assert_eq!(persisted.redeemed_by_peer_id, None);

        let redeeming_peer_id = Uuid::new_v4();
        assert!(repo
            .consume(&token.token_hash, now, redeeming_peer_id)
            .await
            .unwrap());

        // Redeemed: no longer valid, but the row survives (audit trail),
        // unlike `UserInviteRepo::consume`'s delete.
        assert!(repo
            .find_valid(&token.token_hash, now)
            .await
            .unwrap()
            .is_none());
        assert!(!repo
            .consume(&token.token_hash, now, Uuid::new_v4())
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn expired_join_token_cannot_be_redeemed() {
        let pool = test_sqlite_pool().await;
        let created_by = seed_admin(&pool).await;
        let group_id = seed_group(&pool).await;
        let now = Utc::now();
        let token = PeerJoinToken {
            token_hash: "expired-token-hash".to_string(),
            group_id,
            created_by,
            created_at: now - Duration::hours(1),
            expires_at: now - Duration::minutes(1),
            redeemed_by_peer_id: None,
        };
        let repo = SqlxPeerJoinTokenRepo::new(pool);
        repo.create(&token).await.unwrap();

        assert!(repo
            .find_valid(&token.token_hash, now)
            .await
            .unwrap()
            .is_none());
        assert!(!repo
            .consume(&token.token_hash, now, Uuid::new_v4())
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn unknown_join_token_cannot_be_redeemed() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerJoinTokenRepo::new(pool);
        let now = Utc::now();

        assert!(repo
            .find_valid("does-not-exist", now)
            .await
            .unwrap()
            .is_none());
        assert!(!repo
            .consume("does-not-exist", now, Uuid::new_v4())
            .await
            .unwrap());
    }
}
