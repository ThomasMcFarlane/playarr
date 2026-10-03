//! `playarr-coordination` — cross-node mutual exclusion and leader
//! election, abstracted behind [`ClusterCoordinator`] so the rest of the
//! backend (the arr-sync poller, the Tdarr dispatcher, anything that must
//! run on exactly one node at a time) doesn't need to know whether it's
//! deployed as [`playarr_config::DeploymentTier::SingleNode`] or a
//! multi-node Postgres cluster.
//!
//! Two implementations ship here:
//! - [`SingleNodeCoordinator`]: in-process, always-leader. Correct by
//!   construction for a single-node deployment — there is no other node to
//!   contend with, so "acquire a lock" only needs to protect concurrent
//!   *tasks* within this one process.
//! - [`PostgresCoordinator`]: backed by Postgres session-level advisory
//!   locks (mutual exclusion, `pg_try_advisory_lock`/`pg_advisory_unlock`
//!   keyed by `hashtext(key)`) and a `cluster_leader` heartbeat table
//!   (leader election, upsert-on-expiry). See the `sql` module for the
//!   exact statements.
// `async_trait` expansions trip clippy::double_must_use on current stable.
#![allow(clippy::double_must_use)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum CoordinationError {
    #[error("coordination backend error: {0}")]
    Backend(String),
    #[error("lock table poisoned")]
    Poisoned,
}

/// Shared `sqlx::Error` (or any other displayable backend failure) ->
/// [`CoordinationError`] mapping, pulled out into its own function so it
/// can be unit tested directly (see `tests::backend_error_wraps_the_underlying_display_message`)
/// without needing a real `sqlx::Error`, which normally requires an actual
/// failed connection/query to construct.
fn backend_error(err: impl std::fmt::Display) -> CoordinationError {
    CoordinationError::Backend(err.to_string())
}

/// A held lock. Release is RAII (`Drop`), not a separate async trait
/// method — releasing a `tokio::sync::Mutex` guard, and issuing
/// `pg_advisory_unlock` on a connection Postgres is about to hand back to
/// its pool, are both synchronous-enough operations that forcing callers
/// through an explicit `async fn unlock(...)` would only add a footgun
/// (forgetting to call it). The concrete release mechanism is opaque and
/// backend-specific; this type only exists to keep it alive until dropped.
pub struct LockGuard {
    pub key: String,
    _release_on_drop: Box<dyn std::any::Any + Send>,
}

/// Cross-node coordination primitives: mutual exclusion ([`try_lock`]) and
/// leader election ([`campaign_leader`]/[`renew_leadership`]/[`is_leader`]).
/// Both concerns live on one trait because they share a backend (whatever
/// [`DeploymentTier`] is in play) and a caller — e.g. the arr-sync poller
/// campaigns for leadership of the "poll sonarr" role, then still wants a
/// short-lived `try_lock` around each individual reconciliation pass so a
/// slow renewal doesn't cause two nodes to run the same pass concurrently.
///
/// [`try_lock`]: ClusterCoordinator::try_lock
/// [`campaign_leader`]: ClusterCoordinator::campaign_leader
/// [`renew_leadership`]: ClusterCoordinator::renew_leadership
/// [`is_leader`]: ClusterCoordinator::is_leader
/// [`DeploymentTier`]: playarr_config::DeploymentTier
#[async_trait]
pub trait ClusterCoordinator: Send + Sync {
    /// Non-blocking attempt to acquire a named, TTL-bounded exclusive
    /// lock. Returns `Ok(None)` (not an error) when someone else holds it
    /// — contention is the expected, common case, not exceptional.
    async fn try_lock(
        &self,
        key: &str,
        ttl: Duration,
    ) -> Result<Option<LockGuard>, CoordinationError>;

    /// Attempts to become leader for `role` (e.g. `"arr-sync:sonarr"`,
    /// `"transcode-dispatcher"`). Non-blocking: returns whether *this call*
    /// won or renewed leadership, and never blocks waiting for another
    /// node's lease to expire.
    async fn campaign_leader(&self, role: &str, ttl: Duration) -> Result<bool, CoordinationError>;

    /// Extends this node's existing leadership of `role` by `ttl`. Returns
    /// `Ok(false)` if leadership was lost (lease expired, or stolen after
    /// this node stalled past its TTL) rather than an error — callers
    /// should treat that as "stop doing leader-only work", not a fault.
    async fn renew_leadership(&self, role: &str, ttl: Duration) -> Result<bool, CoordinationError>;

    /// Cheap, local, non-blocking read of whether this node currently
    /// believes it leads `role`. Does not itself contact the coordination
    /// backend — it reflects the outcome of the most recent
    /// `campaign_leader`/`renew_leadership` call, so it can be stale by up
    /// to one renewal interval under backend unavailability.
    fn is_leader(&self, role: &str) -> bool;
}

/// In-process coordinator for [`playarr_config::DeploymentTier::SingleNode`].
/// Locks are real (`tokio::sync::Mutex`, guarding concurrent tasks within
/// this one process); leadership is trivially and permanently `true` for
/// every role, because a single node has no peers to lose an election to.
pub struct SingleNodeCoordinator {
    locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

impl SingleNodeCoordinator {
    pub fn new() -> Self {
        Self {
            locks: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for SingleNodeCoordinator {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ClusterCoordinator for SingleNodeCoordinator {
    async fn try_lock(
        &self,
        key: &str,
        _ttl: Duration,
    ) -> Result<Option<LockGuard>, CoordinationError> {
        let mutex = {
            let mut locks = self.locks.lock().map_err(|_| CoordinationError::Poisoned)?;
            locks
                .entry(key.to_string())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
                .clone()
        };

        match mutex.try_lock_owned() {
            Ok(guard) => Ok(Some(LockGuard {
                key: key.to_string(),
                _release_on_drop: Box::new(guard),
            })),
            Err(_would_block) => Ok(None),
        }
    }

    async fn campaign_leader(
        &self,
        _role: &str,
        _ttl: Duration,
    ) -> Result<bool, CoordinationError> {
        // Single node, no peers: this process is unconditionally the
        // leader of every role it campaigns for.
        Ok(true)
    }

    async fn renew_leadership(
        &self,
        _role: &str,
        _ttl: Duration,
    ) -> Result<bool, CoordinationError> {
        Ok(true)
    }

    fn is_leader(&self, _role: &str) -> bool {
        true
    }
}

/// Literal SQL sent by [`PostgresCoordinator`], pulled out as named
/// constants so the query-building logic can be unit tested (see the
/// `tests` module) without a live Postgres server — we can assert on the
/// exact text we send, even though we can't assert on what Postgres would
/// do with it in this crate's test suite.
mod sql {
    /// Session-level advisory lock, keyed by `hashtext(key)`. `hashtext`
    /// returns `int4`; Postgres implicitly widens that to the `int8` the
    /// single-argument `pg_try_advisory_lock` overload expects, so no
    /// explicit cast is needed. Non-blocking: returns `true`/`false`
    /// immediately rather than waiting for the lock to free up.
    pub const TRY_ADVISORY_LOCK: &str = "SELECT pg_try_advisory_lock(hashtext($1))";

    /// Releases the lock `TRY_ADVISORY_LOCK` took, on the *same* connection
    /// — session-level advisory locks are tied to the backend session that
    /// acquired them, not to the value of `key` alone. Must hash `key`
    /// through the exact same `hashtext(...)` expression the lock call
    /// used, or it targets a different lock id and silently fails to
    /// release anything.
    pub const ADVISORY_UNLOCK: &str = "SELECT pg_advisory_unlock(hashtext($1))";

    /// Upsert-on-expiry leader election. A returned row means the caller
    /// now holds (or still holds) the lease for `role`; zero rows means
    /// another node's unexpired lease blocked the `WHERE` clause and the
    /// `ON CONFLICT` update never applied.
    ///
    /// Bind order: `$1` = role, `$2` = node_id, `$3` = ttl (as an
    /// `INTERVAL` — `std::time::Duration` binds directly to Postgres
    /// `INTERVAL` via sqlx).
    pub const CAMPAIGN_LEADER: &str = "\
INSERT INTO cluster_leader (role, node_id, expires_at)
VALUES ($1, $2, now() + $3::interval)
ON CONFLICT (role) DO UPDATE
SET node_id = excluded.node_id, expires_at = excluded.expires_at
WHERE cluster_leader.expires_at < now()
   OR cluster_leader.node_id = excluded.node_id
RETURNING node_id";

    /// Extends an existing, still-owned, unexpired lease. Zero rows
    /// affected means the lease already lapsed (and possibly was claimed by
    /// another node) before this renewal landed — the caller must treat
    /// that as leadership lost, not retry the update.
    ///
    /// Bind order: `$1` = role, `$2` = node_id, `$3` = ttl (as an
    /// `INTERVAL`).
    pub const RENEW_LEADERSHIP: &str = "\
UPDATE cluster_leader
SET expires_at = now() + $3::interval
WHERE role = $1 AND node_id = $2 AND expires_at > now()";
}

/// RAII release mechanism boxed inside [`LockGuard`]'s opaque
/// `_release_on_drop` field for [`PostgresCoordinator::try_lock`]. Holds
/// onto exactly the [`sqlx::pool::PoolConnection`] the lock was acquired
/// on (advisory locks are session-scoped, not pool-scoped) and only
/// returns it to the pool after explicitly unlocking on that same
/// connection.
///
/// `Drop` can't run `async` code directly (there is no stable
/// `AsyncDrop`), so this spawns a short-lived task to issue
/// `pg_advisory_unlock` and then lets the connection's own `Drop` return it
/// to the pool. That requires an active Tokio runtime at the point the
/// guard is dropped — true for every real caller (the arr-sync poller, the
/// transcode dispatcher, and everything else in this backend runs inside
/// `#[tokio::main]`) but would panic if a `LockGuard` were ever dropped
/// outside one.
///
/// TODO: if a non-Tokio drop site ever becomes real, replace the per-drop
/// `tokio::spawn` with a bounded `mpsc` channel drained by one
/// release-worker task owned by `PostgresCoordinator`, so release doesn't
/// depend on being able to spawn at the drop call site.
struct PgAdvisoryLockRelease {
    key: String,
    conn: Option<sqlx::pool::PoolConnection<sqlx::Postgres>>,
}

impl Drop for PgAdvisoryLockRelease {
    fn drop(&mut self) {
        let Some(mut conn) = self.conn.take() else {
            return;
        };
        let key = std::mem::take(&mut self.key);

        tokio::spawn(async move {
            match sqlx::query(sql::ADVISORY_UNLOCK)
                .bind(&key)
                .execute(&mut *conn)
                .await
            {
                Ok(_) => {
                    // `conn` drops here and returns to the pool, now
                    // unlocked and safe for another caller to reuse.
                }
                Err(err) => {
                    tracing::warn!(
                        key = %key,
                        error = %err,
                        "failed to release postgres advisory lock; closing \
                         the connection instead of returning it to the pool \
                         so a possibly-still-locked session can't be handed \
                         to an unrelated caller"
                    );
                    conn.close_on_drop();
                }
            }
        });
    }
}

/// Multi-node coordinator for [`playarr_config::DeploymentTier::MultiNodePostgres`]
/// and [`playarr_config::DeploymentTier::MultiNodePostgresRedis`] (Redis
/// has no bearing on coordination — Postgres is the coordination backend
/// in both multi-node tiers; Redis only changes `playarr-cache`).
pub struct PostgresCoordinator {
    pool: sqlx::PgPool,
    /// Stable identifier for this process, used as the value written into
    /// the leadership heartbeat table so a node can distinguish "I still
    /// hold this lease" from "someone else grabbed it after mine expired".
    node_id: Uuid,
    /// Local cache of the last-known leadership outcome per role, so
    /// `is_leader` can be a cheap, synchronous, non-blocking read as the
    /// trait requires. Written by `campaign_leader`/`renew_leadership`.
    leadership: Mutex<HashMap<String, bool>>,
}

impl PostgresCoordinator {
    pub fn new(pool: sqlx::PgPool, node_id: Uuid) -> Self {
        Self {
            pool,
            node_id,
            leadership: Mutex::new(HashMap::new()),
        }
    }

    fn set_leadership(&self, role: &str, held: bool) -> Result<(), CoordinationError> {
        let mut leadership = self
            .leadership
            .lock()
            .map_err(|_| CoordinationError::Poisoned)?;
        leadership.insert(role.to_string(), held);
        Ok(())
    }
}

#[async_trait]
impl ClusterCoordinator for PostgresCoordinator {
    async fn try_lock(
        &self,
        key: &str,
        _ttl: Duration,
    ) -> Result<Option<LockGuard>, CoordinationError> {
        // TTL is not enforced by the advisory-lock layer itself: Postgres
        // session-level advisory locks have no built-in expiry, they live
        // until explicitly unlocked or the session ends. Note that the
        // sibling `SingleNodeCoordinator::try_lock` doesn't enforce `ttl`
        // either — both implementations treat it as documentation of
        // caller intent rather than something the coordinator itself
        // polices. A hard timeout here would need a background watchdog
        // racing the explicit `Drop` release (double-unlock and
        // release-connection-still-in-use are the obvious footguns); a
        // caller that needs a hard bound should wrap the guarded work in
        // its own `tokio::time::timeout`.
        //
        // TODO: revisit if a real caller needs the coordinator itself to
        // force-expire a stuck lock rather than relying on the holder's own
        // timeout.
        let mut conn = self.pool.acquire().await.map_err(backend_error)?;

        let (acquired,): (bool,) = sqlx::query_as(sql::TRY_ADVISORY_LOCK)
            .bind(key)
            .fetch_one(&mut *conn)
            .await
            .map_err(backend_error)?;

        if !acquired {
            // Someone else holds it. `conn` drops here and returns to the
            // pool untouched — this session never took the lock.
            return Ok(None);
        }

        Ok(Some(LockGuard {
            key: key.to_string(),
            _release_on_drop: Box::new(PgAdvisoryLockRelease {
                key: key.to_string(),
                conn: Some(conn),
            }),
        }))
    }

    async fn campaign_leader(&self, role: &str, ttl: Duration) -> Result<bool, CoordinationError> {
        let node_id = self.node_id.to_string();

        let row: Option<(String,)> = sqlx::query_as(sql::CAMPAIGN_LEADER)
            .bind(role)
            .bind(&node_id)
            .bind(ttl)
            .fetch_optional(&self.pool)
            .await
            .map_err(backend_error)?;

        let won = row.is_some();
        self.set_leadership(role, won)?;
        Ok(won)
    }

    async fn renew_leadership(&self, role: &str, ttl: Duration) -> Result<bool, CoordinationError> {
        let node_id = self.node_id.to_string();

        let result = sqlx::query(sql::RENEW_LEADERSHIP)
            .bind(role)
            .bind(&node_id)
            .bind(ttl)
            .execute(&self.pool)
            .await
            .map_err(backend_error)?;

        let renewed = result.rows_affected() > 0;
        self.set_leadership(role, renewed)?;
        Ok(renewed)
    }

    fn is_leader(&self, role: &str) -> bool {
        self.leadership
            .lock()
            .map(|map| map.get(role).copied().unwrap_or(false))
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Advisory-lock contention (two sessions racing `pg_try_advisory_lock`
    // for real) and lease-expiry semantics (a row's `expires_at` actually
    // lapsing under concurrent `ON CONFLICT` upserts) can only be verified
    // against a real Postgres server, and are deliberately NOT covered
    // here — per the task constraints for this crate, no Postgres instance
    // is spun up in this test suite. What *is* covered, without a
    // database:
    //   - the literal SQL text `PostgresCoordinator` sends (`sql` module),
    //   - the local `is_leader` cache, which is pure in-process state,
    //   - the `sqlx::Error -> CoordinationError::Backend` mapping every
    //     fallible method here uses, via the pulled-out `backend_error`
    //     helper (see the note further down for why this is deterministic
    //     where an actual failed-connection test wasn't).
    // Integration tests exercising real advisory-lock contention and real
    // lease-expiry races belong in a separate suite gated behind a live
    // `DATABASE_URL`, not here.

    #[test]
    fn try_advisory_lock_uses_hashtext_of_the_key() {
        assert_eq!(
            sql::TRY_ADVISORY_LOCK,
            "SELECT pg_try_advisory_lock(hashtext($1))"
        );
    }

    #[test]
    fn advisory_unlock_hashes_the_same_key_the_lock_used() {
        assert_eq!(
            sql::ADVISORY_UNLOCK,
            "SELECT pg_advisory_unlock(hashtext($1))"
        );
    }

    #[test]
    fn campaign_leader_upsert_only_overwrites_expired_or_self_owned_rows() {
        let sql = sql::CAMPAIGN_LEADER;
        assert!(sql.contains("INSERT INTO cluster_leader (role, node_id, expires_at)"));
        assert!(sql.contains("VALUES ($1, $2, now() + $3::interval)"));
        assert!(sql.contains("ON CONFLICT (role) DO UPDATE"));
        assert!(sql.contains("SET node_id = excluded.node_id, expires_at = excluded.expires_at"));
        assert!(sql.contains("cluster_leader.expires_at < now()"));
        assert!(sql.contains("cluster_leader.node_id = excluded.node_id"));
        assert!(sql.contains("RETURNING node_id"));
    }

    #[test]
    fn renew_leadership_only_touches_rows_this_node_still_owns_and_unexpired() {
        let sql = sql::RENEW_LEADERSHIP;
        assert!(sql.contains("UPDATE cluster_leader"));
        assert!(sql.contains("SET expires_at = now() + $3::interval"));
        assert!(sql.contains("WHERE role = $1 AND node_id = $2 AND expires_at > now()"));
    }

    fn lazy_pool() -> sqlx::PgPool {
        // `connect_lazy` only parses the URL and builds the pool struct —
        // it never opens a socket — so this is safe to construct without a
        // running Postgres anywhere nearby. It still spins up the pool's
        // internal maintenance task via `tokio::spawn`, though, so it needs
        // an active Tokio runtime to construct (hence `#[tokio::test]`
        // below rather than a plain `#[test]`, even though nothing here
        // ever awaits).
        sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://localhost/playarr_test_placeholder")
            .expect("connect_lazy should not touch the network")
    }

    #[tokio::test]
    async fn is_leader_defaults_to_false_for_an_unknown_role() {
        let coordinator = PostgresCoordinator::new(lazy_pool(), Uuid::new_v4());
        assert!(!coordinator.is_leader("arr-sync:sonarr"));
    }

    #[tokio::test]
    async fn is_leader_reflects_the_cached_outcome_of_the_last_campaign_or_renew() {
        let coordinator = PostgresCoordinator::new(lazy_pool(), Uuid::new_v4());

        coordinator.set_leadership("arr-sync:sonarr", true).unwrap();
        assert!(coordinator.is_leader("arr-sync:sonarr"));

        coordinator
            .set_leadership("arr-sync:sonarr", false)
            .unwrap();
        assert!(!coordinator.is_leader("arr-sync:sonarr"));

        // Unrelated roles are unaffected by another role's state.
        assert!(!coordinator.is_leader("transcode-dispatcher"));
    }

    // NOTE: we deliberately do NOT test a real failed connection (e.g. a
    // pool pointed at a closed local port) here. That was tried during
    // development and turned out to be environment-dependent: on some
    // sandboxed/firewalled hosts a connect attempt to a closed port is
    // blackholed rather than fast-`ECONNREFUSED`'d, so the test just hangs
    // until its timeout instead of exercising the error path — which is
    // exactly the kind of network-behavior-dependent flakiness unit tests
    // in this crate need to avoid. `backend_error` below covers the same
    // `sqlx::Error -> CoordinationError` mapping deterministically instead,
    // and real connection-failure behavior is covered by whatever runs
    // this crate's methods against an actually-live (or actually-down)
    // Postgres in integration testing.
    #[test]
    fn backend_error_wraps_the_underlying_display_message() {
        match backend_error("connection refused") {
            CoordinationError::Backend(msg) => assert_eq!(msg, "connection refused"),
            other => panic!("expected CoordinationError::Backend, got {other:?}"),
        }
    }
}
