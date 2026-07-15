//! `streamarr-coordination` — cross-node mutual exclusion and leader
//! election, abstracted behind [`ClusterCoordinator`] so the rest of the
//! backend (the arr-sync poller, the Tdarr dispatcher, anything that must
//! run on exactly one node at a time) doesn't need to know whether it's
//! deployed as [`streamarr_config::DeploymentTier::SingleNode`] or a
//! multi-node Postgres cluster.
//!
//! Two implementations ship here:
//! - [`SingleNodeCoordinator`]: in-process, always-leader. Correct by
//!   construction for a single-node deployment — there is no other node to
//!   contend with, so "acquire a lock" only needs to protect concurrent
//!   *tasks* within this one process.
//! - [`PostgresCoordinator`]: backed by Postgres session-level advisory
//!   locks (mutual exclusion) and a heartbeat table (leader election).
//!   Method bodies are `unimplemented!()` for now; see the SQL comments on
//!   each for the intended approach.

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
/// [`DeploymentTier`]: streamarr_config::DeploymentTier
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

/// In-process coordinator for [`streamarr_config::DeploymentTier::SingleNode`].
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

/// Multi-node coordinator for [`streamarr_config::DeploymentTier::MultiNodePostgres`]
/// and [`streamarr_config::DeploymentTier::MultiNodePostgresRedis`] (Redis
/// has no bearing on coordination — Postgres is the coordination backend
/// in both multi-node tiers; Redis only changes `streamarr-cache`).
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
}

#[async_trait]
impl ClusterCoordinator for PostgresCoordinator {
    async fn try_lock(
        &self,
        _key: &str,
        _ttl: Duration,
    ) -> Result<Option<LockGuard>, CoordinationError> {
        // SELECT pg_try_advisory_lock(hashtextextended($1, 0))
        //
        // Session-level advisory locks are tied to the specific backend
        // connection that took them, not to the logical `pool` — a real
        // implementation must check out one `PoolConnection<Postgres>` via
        // `self.pool.acquire()`, run the lock query on it, and keep that
        // exact connection alive inside the returned `LockGuard` (releasing
        // it — `pg_advisory_unlock(...)` then returning the connection —
        // only on drop). Handing the query through `&self.pool` directly
        // would let sqlx route the unlock (or worse, subsequent unrelated
        // queries) over a *different* pooled connection, which is a no-op
        // against the wrong session and silently fails to release.
        let _ = &self.pool;
        unimplemented!("PostgresCoordinator::try_lock")
    }

    async fn campaign_leader(
        &self,
        _role: &str,
        _ttl: Duration,
    ) -> Result<bool, CoordinationError> {
        // INSERT INTO cluster_leadership (role, node_id, expires_at)
        // VALUES ($1, $2, now() + $3::interval)
        // ON CONFLICT (role) DO UPDATE
        //   SET node_id = excluded.node_id, expires_at = excluded.expires_at
        //   WHERE cluster_leadership.expires_at < now()
        //      OR cluster_leadership.node_id = excluded.node_id
        // RETURNING node_id
        //
        // A returned row means this node now holds (or still holds) the
        // lease; zero rows means another node's unexpired lease blocked the
        // upsert's WHERE clause. `cluster_leadership` is a one-row-per-role
        // heartbeat table, not created by this crate's migrations — it
        // belongs in `streamarr-db`'s Postgres migration set since it's
        // schema, not coordination logic.
        let _ = (&self.pool, self.node_id);
        unimplemented!("PostgresCoordinator::campaign_leader")
    }

    async fn renew_leadership(
        &self,
        _role: &str,
        _ttl: Duration,
    ) -> Result<bool, CoordinationError> {
        // UPDATE cluster_leadership
        // SET expires_at = now() + $3::interval
        // WHERE role = $1 AND node_id = $2 AND expires_at > now()
        //
        // Zero rows affected means the lease already expired (and possibly
        // was claimed by another node) before this renewal landed — the
        // caller must treat that as leadership lost, not retry the update.
        unimplemented!("PostgresCoordinator::renew_leadership")
    }

    fn is_leader(&self, role: &str) -> bool {
        self.leadership
            .lock()
            .map(|map| map.get(role).copied().unwrap_or(false))
            .unwrap_or(false)
    }
}
