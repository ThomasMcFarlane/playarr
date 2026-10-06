//! `playarr-coordination` — cross-node mutual exclusion and leader
//! election, abstracted behind [`ClusterCoordinator`] so the rest of the
//! backend (the arr-sync poller, the Tdarr dispatcher, anything that must
//! run on exactly one node at a time) codes against one trait.
//!
//! One implementation ships here, [`SingleNodeCoordinator`]: in-process,
//! always-leader. Playarr is SQLite-only (ADR 0002): every node owns its
//! own database and nodes cooperate through peer sync, so there is no shared
//! state to elect a leader over, and "acquire a lock" only needs to protect
//! concurrent *tasks* within this one process.
// `async_trait` expansions trip clippy::double_must_use on current stable.
#![allow(clippy::double_must_use)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;

#[derive(Debug, thiserror::Error)]
pub enum CoordinationError {
    #[error("lock table poisoned")]
    Poisoned,
}

/// A held lock. Release is RAII (`Drop`), not a separate async trait
/// method — forcing callers through an explicit `async fn unlock(...)`
/// would only add a footgun (forgetting to call it). The concrete release
/// mechanism is opaque; this type only exists to keep it alive until
/// dropped.
pub struct LockGuard {
    pub key: String,
    _release_on_drop: Box<dyn std::any::Any + Send>,
}

/// Cross-node coordination primitives: mutual exclusion ([`try_lock`]) and
/// leader election ([`campaign_leader`]/[`renew_leadership`]/[`is_leader`]).
/// Both concerns live on one trait because they share a caller: e.g. the arr-sync poller
/// campaigns for leadership of the "poll sonarr" role, then still wants a
/// short-lived `try_lock` around each individual reconciliation pass so a
/// slow renewal doesn't cause two nodes to run the same pass concurrently.
///
/// [`try_lock`]: ClusterCoordinator::try_lock
/// [`campaign_leader`]: ClusterCoordinator::campaign_leader
/// [`renew_leadership`]: ClusterCoordinator::renew_leadership
/// [`is_leader`]: ClusterCoordinator::is_leader
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

/// In-process coordinator.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn try_lock_is_exclusive_per_key_until_the_guard_drops() {
        let coordinator = SingleNodeCoordinator::new();
        let ttl = Duration::from_secs(5);

        let first = coordinator.try_lock("job", ttl).await.unwrap();
        assert!(first.is_some());
        assert!(coordinator.try_lock("job", ttl).await.unwrap().is_none());
        assert!(coordinator.try_lock("other", ttl).await.unwrap().is_some());

        drop(first);
        assert!(coordinator.try_lock("job", ttl).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn this_node_is_always_the_leader() {
        let coordinator = SingleNodeCoordinator::new();
        let ttl = Duration::from_secs(5);
        assert!(coordinator.campaign_leader("role", ttl).await.unwrap());
        assert!(coordinator.renew_leadership("role", ttl).await.unwrap());
        assert!(coordinator.is_leader("role"));
    }
}
