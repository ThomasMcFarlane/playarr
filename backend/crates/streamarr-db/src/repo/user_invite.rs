use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::any::AnyRow;
use sqlx::Row;
use streamarr_model::UserInvite;
use uuid::Uuid;

use crate::codec::{format_datetime, parse_datetime, parse_uuid};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

/// Durable, one-use storage for administrator-issued account invitations.
#[async_trait]
pub trait UserInviteRepo: Send + Sync {
    async fn create(&self, invite: &UserInvite) -> Result<(), DbError>;

    /// Insert-if-absent by `UserInvite::token_hash` -- `account_sync.rs`
    /// (`streamarr-peer-sync`) calls this for every row a peer gossips via
    /// `GET /api/v1/peer/invites`, which may re-report an invite this node
    /// already knows about on every pass (full, `updated_at`-cursored
    /// gossip, not a diff). An invite's issuance fields (`can_stream`,
    /// `library_allow`, `group_library_allow`, ...) are immutable after
    /// creation, so those never need reconciling -- but `consumed_at`/
    /// `consumed_by_user_id`/`consumed_by_peer_id` are not: a peer that
    /// redeemed this invite locally needs that fact to propagate to a node
    /// that still thinks it's unconsumed, or the "redeemed against two
    /// peers during a partition" race (§3.5, §6.1) is never actually
    /// caught. So on a pre-existing row this additionally adopts the
    /// incoming consumption **only when this node's own copy isn't already
    /// consumed** -- once a row is locally consumed it keeps its own
    /// redemption record regardless of what a later gossip pass reports
    /// (see this method's `SqlxUserInviteRepo` implementation for exactly
    /// what happens to a genuine double-redemption under that rule). This
    /// is a one-way ratchet (unconsumed -> consumed, never back), not full
    /// last-writer-wins by `updated_at` like every other synced table
    /// (§3.5): `UserInvite` never travels its `updated_at` over the wire at
    /// all (kept off the wire/domain type entirely, matching `users`/
    /// `policies`' own `updated_at`, which is DB-only sync bookkeeping too
    /// -- see `crate::repo::user::SyncMetadata`'s doc comment), so a real
    /// timestamp comparison isn't available here; "prefer whichever side
    /// reports consumed" is sufficient because consumption only ever moves
    /// one direction. A genuine double-redemption (two different accounts,
    /// each already consumed independently on two different peers) still
    /// silently keeps each peer's own record rather than reconciling or
    /// logging to `sync_conflict_log` -- `sync_conflict_log`'s
    /// `entity_type` enumeration doesn't include an invite variant yet, and
    /// disabling the losing side's already-created account (§3.5's stated
    /// resolution) needs its own pass; left for future work rather than
    /// silently claimed here.
    async fn upsert(&self, invite: &UserInvite) -> Result<(), DbError>;

    async fn find_valid(
        &self,
        token_hash: &str,
        now: DateTime<Utc>,
    ) -> Result<Option<UserInvite>, DbError>;

    /// Atomically marks an invitation consumed -- setting `consumed_at`/
    /// `consumed_by_user_id`/`consumed_by_peer_id` (and bumping
    /// `updated_at`) -- only when it exists, has not expired, and has not
    /// already been consumed. `true` means this caller consumed it; `false`
    /// covers unknown, expired, and already-consumed tokens without leaking
    /// which case applied. A soft consume (`UPDATE`), not the hard `DELETE`
    /// this replaced: see `UserInvite::consumed_at`'s own doc comment for
    /// why the row has to survive redemption. `consumed_by_peer_id` is
    /// `None` when this node's own identity can't be resolved (best-effort,
    /// same tolerance `UserRepo::set_origin_peer_id_if_unset`'s callers
    /// already apply) -- it never blocks the redemption itself.
    async fn consume(
        &self,
        token_hash: &str,
        now: DateTime<Utc>,
        consumed_by_user_id: Uuid,
        consumed_by_peer_id: Option<Uuid>,
    ) -> Result<bool, DbError>;

    /// Every row whose `updated_at` is strictly greater than `since` (every
    /// row, oldest first, when `since` is `None`) -- the read behind `GET
    /// /api/v1/peer/invites?since=`'s `invites` half (`docs/architecture/
    /// peer-groups.md` §3.1/§3.6). Cursors on `updated_at`, not `created_at`
    /// (a prior phase's choice, before `updated_at` existed on this table):
    /// an invite's issuance fields are immutable, but `consume` now mutates
    /// `consumed_at`/`consumed_by_*`/`updated_at` on an already-existing
    /// row (see this trait's own `consume`/`upsert` doc comments), and a
    /// `created_at`-only cursor would never re-report a row whose
    /// redemption happened after the cursor already advanced past its
    /// creation -- exactly the propagation `upsert`'s consumption ratchet
    /// depends on to ever see a peer's redemption at all. Ordered by
    /// `updated_at` (then `token_hash` as a stable tie-breaker) so the
    /// caller can safely resume from the last row's `updated_at`.
    async fn list_updated_since(
        &self,
        since: Option<DateTime<Utc>>,
    ) -> Result<Vec<UserInvite>, DbError>;
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
    let group_library_allow: String = row.try_get("group_library_allow")?;
    let consumed_at: Option<String> = row.try_get("consumed_at")?;
    let consumed_by_user_id: Option<String> = row.try_get("consumed_by_user_id")?;
    let consumed_by_peer_id: Option<String> = row.try_get("consumed_by_peer_id")?;
    Ok(UserInvite {
        token_hash,
        created_by: parse_uuid(&created_by)?,
        created_at: parse_datetime(&created_at)?,
        expires_at: parse_datetime(&expires_at)?,
        can_stream: can_stream != 0,
        library_allow: serde_json::from_str(&library_allow)?,
        group_library_allow: serde_json::from_str(&group_library_allow)?,
        consumed_at: consumed_at.as_deref().map(parse_datetime).transpose()?,
        consumed_by_user_id: consumed_by_user_id.as_deref().map(parse_uuid).transpose()?,
        consumed_by_peer_id: consumed_by_peer_id.as_deref().map(parse_uuid).transpose()?,
    })
}

const COLUMNS: &str = "token_hash, created_by, created_at, expires_at, can_stream, library_allow, \
                        group_library_allow, consumed_at, consumed_by_user_id, consumed_by_peer_id";

#[async_trait]
impl UserInviteRepo for SqlxUserInviteRepo {
    async fn create(&self, invite: &UserInvite) -> Result<(), DbError> {
        let library_allow = serde_json::to_string(&invite.library_allow)?;
        let group_library_allow = serde_json::to_string(&invite.group_library_allow)?;
        let sql = match self.backend {
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
        sqlx::query(sql)
            .bind(&invite.token_hash)
            .bind(invite.created_by.to_string())
            .bind(format_datetime(invite.created_at))
            .bind(format_datetime(invite.expires_at))
            .bind(i64::from(invite.can_stream))
            .bind(library_allow)
            .bind(group_library_allow)
            // `updated_at` bootstraps from `created_at` -- there is no
            // earlier state to have changed from yet, same convention
            // `0033_peer_sync_state.sql`'s backfill uses for `users`.
            .bind(format_datetime(invite.created_at))
            .bind(invite.consumed_at.map(format_datetime))
            .bind(invite.consumed_by_user_id.map(|id| id.to_string()))
            .bind(invite.consumed_by_peer_id.map(|id| id.to_string()))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn upsert(&self, invite: &UserInvite) -> Result<(), DbError> {
        let library_allow = serde_json::to_string(&invite.library_allow)?;
        let group_library_allow = serde_json::to_string(&invite.group_library_allow)?;
        // `updated_at` is stamped from this node's own receipt clock (never
        // carried on `invite` -- see this method's own trait doc comment):
        // it only has to be monotonic *locally*, since `list_updated_since`
        // is a purely local cursor concern, not a cross-peer timestamp
        // comparison.
        let received_at = format_datetime(Utc::now());
        let sql = match self.backend {
            // The trailing `WHERE` guard is the consumption ratchet this
            // method's trait doc comment describes: on a pre-existing row,
            // only adopt the incoming consumption fields when this node's
            // own copy isn't already consumed. `ON CONFLICT ... DO UPDATE
            // ... WHERE` is a real no-op (not an error) in both SQLite and
            // Postgres when the predicate fails -- same convention
            // `WatchProgressRepo::upsert` already uses for its own
            // conditional upsert.
            Backend::Sqlite => {
                "INSERT INTO user_invites \
                 (token_hash, created_by, created_at, expires_at, can_stream, library_allow, \
                 group_library_allow, updated_at, consumed_at, consumed_by_user_id, consumed_by_peer_id) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (token_hash) DO UPDATE SET \
                 consumed_at = excluded.consumed_at, \
                 consumed_by_user_id = excluded.consumed_by_user_id, \
                 consumed_by_peer_id = excluded.consumed_by_peer_id, \
                 updated_at = excluded.updated_at \
                 WHERE user_invites.consumed_at IS NULL AND excluded.consumed_at IS NOT NULL"
            }
            Backend::Postgres => {
                "INSERT INTO user_invites \
                 (token_hash, created_by, created_at, expires_at, can_stream, library_allow, \
                 group_library_allow, updated_at, consumed_at, consumed_by_user_id, consumed_by_peer_id) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) \
                 ON CONFLICT (token_hash) DO UPDATE SET \
                 consumed_at = excluded.consumed_at, \
                 consumed_by_user_id = excluded.consumed_by_user_id, \
                 consumed_by_peer_id = excluded.consumed_by_peer_id, \
                 updated_at = excluded.updated_at \
                 WHERE user_invites.consumed_at IS NULL AND excluded.consumed_at IS NOT NULL"
            }
        };
        sqlx::query(sql)
            .bind(&invite.token_hash)
            .bind(invite.created_by.to_string())
            .bind(format_datetime(invite.created_at))
            .bind(format_datetime(invite.expires_at))
            .bind(i64::from(invite.can_stream))
            .bind(library_allow)
            .bind(group_library_allow)
            .bind(received_at)
            .bind(invite.consumed_at.map(format_datetime))
            .bind(invite.consumed_by_user_id.map(|id| id.to_string()))
            .bind(invite.consumed_by_peer_id.map(|id| id.to_string()))
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
                "SELECT {COLUMNS} FROM user_invites \
                 WHERE token_hash = ? AND expires_at > ? AND consumed_at IS NULL"
            ),
            Backend::Postgres => format!(
                "SELECT {COLUMNS} FROM user_invites \
                 WHERE token_hash = $1 AND expires_at > $2 AND consumed_at IS NULL"
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
        consumed_by_user_id: Uuid,
        consumed_by_peer_id: Option<Uuid>,
    ) -> Result<bool, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => {
                "UPDATE user_invites SET consumed_at = ?, consumed_by_user_id = ?, \
                 consumed_by_peer_id = ?, updated_at = ? \
                 WHERE token_hash = ? AND expires_at > ? AND consumed_at IS NULL"
            }
            Backend::Postgres => {
                "UPDATE user_invites SET consumed_at = $1, consumed_by_user_id = $2, \
                 consumed_by_peer_id = $3, updated_at = $4 \
                 WHERE token_hash = $5 AND expires_at > $6 AND consumed_at IS NULL"
            }
        };
        let result = sqlx::query(sql)
            .bind(format_datetime(now))
            .bind(consumed_by_user_id.to_string())
            .bind(consumed_by_peer_id.map(|id| id.to_string()))
            .bind(format_datetime(now))
            .bind(token_hash)
            .bind(format_datetime(now))
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() == 1)
    }

    async fn list_updated_since(
        &self,
        since: Option<DateTime<Utc>>,
    ) -> Result<Vec<UserInvite>, DbError> {
        let sql = match (self.backend, since.is_some()) {
            (Backend::Sqlite, true) => format!(
                "SELECT {COLUMNS} FROM user_invites WHERE updated_at > ? \
                 ORDER BY updated_at ASC, token_hash ASC"
            ),
            (Backend::Sqlite, false) => {
                format!(
                    "SELECT {COLUMNS} FROM user_invites ORDER BY updated_at ASC, token_hash ASC"
                )
            }
            (Backend::Postgres, true) => format!(
                "SELECT {COLUMNS} FROM user_invites WHERE updated_at > $1 \
                 ORDER BY updated_at ASC, token_hash ASC"
            ),
            (Backend::Postgres, false) => {
                format!(
                    "SELECT {COLUMNS} FROM user_invites ORDER BY updated_at ASC, token_hash ASC"
                )
            }
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

    /// Every existing test's fixture, plus the new Phase 4 fields, factored
    /// out so adding another field only touches one place.
    fn sample_invite(token_hash: &str, created_by: Uuid, created_at: DateTime<Utc>) -> UserInvite {
        UserInvite {
            token_hash: token_hash.to_string(),
            created_by,
            created_at,
            expires_at: created_at + Duration::hours(24),
            can_stream: true,
            library_allow: vec![],
            group_library_allow: vec![],
            consumed_at: None,
            consumed_by_user_id: None,
            consumed_by_peer_id: None,
        }
    }

    #[tokio::test]
    async fn invite_is_consumed_once_before_expiry() {
        let pool = test_sqlite_pool().await;
        let created_by = seed_admin(&pool).await;
        let now = Utc::now();
        let mut invite = sample_invite("token-hash", created_by, now);
        invite.library_allow = vec![Uuid::new_v4()];
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
        assert_eq!(persisted.consumed_at, None);

        let redeemer_id = Uuid::new_v4();
        let peer_id = Uuid::new_v4();
        assert!(repo
            .consume(&invite.token_hash, now, redeemer_id, Some(peer_id))
            .await
            .unwrap());
        assert!(
            repo.find_valid(&invite.token_hash, now)
                .await
                .unwrap()
                .is_none(),
            "a consumed invite must no longer be valid"
        );
        assert!(!repo
            .consume(
                &invite.token_hash,
                now,
                Uuid::new_v4(),
                Some(Uuid::new_v4())
            )
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn consume_records_who_and_which_peer_redeemed_it() {
        // `find_valid` already proves a consumed invite stops being valid
        // (`invite_is_consumed_once_before_expiry`); this proves the actual
        // redemption bookkeeping (`docs/architecture/peer-groups.md` §2.5)
        // survives on the row rather than the hard `DELETE` this replaced.
        let pool = test_sqlite_pool().await;
        let created_by = seed_admin(&pool).await;
        let now = Utc::now();
        let invite = sample_invite("bookkeeping-token", created_by, now);
        let repo = SqlxUserInviteRepo::new(pool.clone());
        repo.create(&invite).await.unwrap();

        let redeemer_id = Uuid::new_v4();
        let peer_id = Uuid::new_v4();
        assert!(repo
            .consume(&invite.token_hash, now, redeemer_id, Some(peer_id))
            .await
            .unwrap());

        let (consumed_at, consumed_by_user_id, consumed_by_peer_id): (
            Option<String>,
            Option<String>,
            Option<String>,
        ) = sqlx::query_as(
            "SELECT consumed_at, consumed_by_user_id, consumed_by_peer_id FROM user_invites \
             WHERE token_hash = ?",
        )
        .bind(&invite.token_hash)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(consumed_at.is_some());
        assert_eq!(consumed_by_user_id, Some(redeemer_id.to_string()));
        assert_eq!(consumed_by_peer_id, Some(peer_id.to_string()));
    }

    #[tokio::test]
    async fn consume_tolerates_an_unresolvable_peer_identity() {
        // Mirrors `UserRepo::set_origin_peer_id_if_unset`'s own best-effort
        // tolerance: redemption itself must never depend on this node's
        // identity being resolvable.
        let pool = test_sqlite_pool().await;
        let created_by = seed_admin(&pool).await;
        let now = Utc::now();
        let invite = sample_invite("no-peer-identity-token", created_by, now);
        let repo = SqlxUserInviteRepo::new(pool);
        repo.create(&invite).await.unwrap();

        assert!(repo
            .consume(&invite.token_hash, now, Uuid::new_v4(), None)
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn expired_invite_cannot_be_consumed() {
        let pool = test_sqlite_pool().await;
        let created_by = seed_admin(&pool).await;
        let now = Utc::now();
        let mut invite = sample_invite("expired-token-hash", created_by, now - Duration::hours(25));
        invite.expires_at = now - Duration::hours(1);
        let repo = SqlxUserInviteRepo::new(pool);
        repo.create(&invite).await.unwrap();

        assert!(repo
            .find_valid(&invite.token_hash, now)
            .await
            .unwrap()
            .is_none());
        assert!(!repo
            .consume(&invite.token_hash, now, Uuid::new_v4(), None)
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn upsert_inserts_a_new_row_and_silently_no_ops_on_a_repeat() {
        let pool = test_sqlite_pool().await;
        let created_by = seed_admin(&pool).await;
        let now = Utc::now();
        let mut invite = sample_invite("gossiped-token-hash", created_by, now);
        invite.library_allow = vec![Uuid::new_v4()];
        let repo = SqlxUserInviteRepo::new(pool);

        repo.upsert(&invite).await.expect("first upsert inserts");
        let fetched = repo
            .find_valid(&invite.token_hash, now)
            .await
            .unwrap()
            .expect("present after insert");
        assert_eq!(fetched.can_stream, invite.can_stream);
        assert_eq!(fetched.library_allow, invite.library_allow);

        // A second gossip pass reporting the same, still-unconsumed row
        // again is a silent no-op -- it must not error (no unique-constraint
        // violation surfacing as a `DbError::Backend`) and must not change
        // anything.
        repo.upsert(&invite)
            .await
            .expect("repeat upsert is a no-op");
        let still = repo
            .find_valid(&invite.token_hash, now)
            .await
            .unwrap()
            .expect("still present");
        assert_eq!(still, fetched);
    }

    #[tokio::test]
    async fn upsert_adopts_an_incoming_consumption_when_locally_unconsumed() {
        // The scenario `UserInviteRepo::upsert`'s own doc comment describes:
        // this node has the invite (e.g. it issued it) but hasn't seen it
        // redeemed yet; a peer gossips in the fact that *it* served the
        // redemption. That must propagate, or the "redeemed against two
        // peers during a partition" race is never actually caught.
        let pool = test_sqlite_pool().await;
        let created_by = seed_admin(&pool).await;
        let now = Utc::now();
        let invite = sample_invite("propagates-consumption", created_by, now);
        let repo = SqlxUserInviteRepo::new(pool);
        repo.upsert(&invite).await.unwrap();

        let redeemer_id = Uuid::new_v4();
        let peer_id = Uuid::new_v4();
        let mut consumed = invite.clone();
        consumed.consumed_at = Some(now);
        consumed.consumed_by_user_id = Some(redeemer_id);
        consumed.consumed_by_peer_id = Some(peer_id);
        repo.upsert(&consumed).await.unwrap();

        assert!(
            repo.find_valid(&invite.token_hash, now)
                .await
                .unwrap()
                .is_none(),
            "the gossiped-in consumption must make the invite invalid here too"
        );
    }

    #[tokio::test]
    async fn upsert_never_overwrites_this_nodes_own_consumption_record() {
        // The other half of the same doc comment: once *this* node has
        // already recorded its own redemption, a later gossip pass (even
        // one reporting a different, conflicting consumption from a real
        // double-redemption) must not clobber it -- full reconciliation of
        // that conflict is explicitly deferred (see the doc comment), but
        // silently losing this node's own record would be worse than doing
        // nothing.
        let pool = test_sqlite_pool().await;
        let created_by = seed_admin(&pool).await;
        let now = Utc::now();
        let invite = sample_invite("keeps-local-consumption", created_by, now);
        let repo = SqlxUserInviteRepo::new(pool.clone());
        repo.create(&invite).await.unwrap();

        let local_redeemer = Uuid::new_v4();
        let local_peer = Uuid::new_v4();
        repo.consume(&invite.token_hash, now, local_redeemer, Some(local_peer))
            .await
            .unwrap();

        let mut incoming = invite.clone();
        incoming.consumed_at = Some(now);
        incoming.consumed_by_user_id = Some(Uuid::new_v4());
        incoming.consumed_by_peer_id = Some(Uuid::new_v4());
        repo.upsert(&incoming).await.unwrap();

        let (consumed_by_user_id,): (Option<String>,) =
            sqlx::query_as("SELECT consumed_by_user_id FROM user_invites WHERE token_hash = ?")
                .bind(&invite.token_hash)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            consumed_by_user_id,
            Some(local_redeemer.to_string()),
            "this node's own redemption must survive an incoming, differing one"
        );
    }

    #[tokio::test]
    async fn list_updated_since_none_returns_every_row() {
        let pool = test_sqlite_pool().await;
        let created_by = seed_admin(&pool).await;
        let now = Utc::now();
        let repo = SqlxUserInviteRepo::new(pool);
        let first = sample_invite("cursor-first", created_by, now);
        let second = sample_invite("cursor-second", created_by, now);
        repo.create(&first).await.unwrap();
        repo.create(&second).await.unwrap();

        let rows = repo.list_updated_since(None).await.unwrap();
        let hashes: Vec<&str> = rows.iter().map(|row| row.token_hash.as_str()).collect();
        assert!(hashes.contains(&"cursor-first"));
        assert!(hashes.contains(&"cursor-second"));
    }

    #[tokio::test]
    async fn list_updated_since_a_cursor_excludes_rows_at_or_before_it() {
        let pool = test_sqlite_pool().await;
        let created_by = seed_admin(&pool).await;
        let now = Utc::now();
        let repo = SqlxUserInviteRepo::new(pool);
        let cursor = now - Duration::minutes(10);
        let old = sample_invite("already-synced", created_by, cursor);
        let fresh = sample_invite("freshly-issued", created_by, now);
        repo.create(&old).await.unwrap();
        repo.create(&fresh).await.unwrap();

        let rows = repo.list_updated_since(Some(cursor)).await.unwrap();
        let hashes: Vec<&str> = rows.iter().map(|row| row.token_hash.as_str()).collect();
        assert!(
            !hashes.contains(&"already-synced"),
            "a row at or before the cursor must not be re-reported"
        );
        assert!(hashes.contains(&"freshly-issued"));
    }

    #[tokio::test]
    async fn list_updated_since_orders_oldest_first() {
        let pool = test_sqlite_pool().await;
        let created_by = seed_admin(&pool).await;
        let now = Utc::now();
        let repo = SqlxUserInviteRepo::new(pool);
        let older = sample_invite("older-write", created_by, now - Duration::minutes(10));
        let newer = sample_invite("newer-write", created_by, now);
        repo.create(&newer).await.unwrap();
        repo.create(&older).await.unwrap();

        let rows = repo.list_updated_since(None).await.unwrap();
        let position = |hash: &str| rows.iter().position(|row| row.token_hash == hash).unwrap();
        assert!(position("older-write") < position("newer-write"));
    }

    #[tokio::test]
    async fn list_updated_since_reports_a_row_whose_only_change_is_consumption() {
        // The behaviour switching the cursor to `updated_at` is actually
        // for (this trait's own doc comment): a row created well before the
        // cursor, then consumed after it, must still be reported -- a
        // `created_at`-only cursor would have missed this entirely.
        let pool = test_sqlite_pool().await;
        let created_by = seed_admin(&pool).await;
        let now = Utc::now();
        let repo = SqlxUserInviteRepo::new(pool);
        let cursor = now - Duration::minutes(10);
        let invite = sample_invite(
            "consumed-after-cursor",
            created_by,
            cursor - Duration::hours(1),
        );
        repo.create(&invite).await.unwrap();

        // Not yet visible past a cursor taken after creation but before
        // redemption.
        assert!(repo
            .list_updated_since(Some(cursor))
            .await
            .unwrap()
            .is_empty());

        repo.consume(
            &invite.token_hash,
            now,
            Uuid::new_v4(),
            Some(Uuid::new_v4()),
        )
        .await
        .unwrap();

        let rows = repo.list_updated_since(Some(cursor)).await.unwrap();
        assert!(
            rows.iter().any(|row| row.token_hash == invite.token_hash),
            "consumption alone must re-surface the row past a cursor taken before it"
        );
        let reported = rows
            .iter()
            .find(|row| row.token_hash == invite.token_hash)
            .unwrap();
        assert!(reported.consumed_at.is_some());
    }
}
