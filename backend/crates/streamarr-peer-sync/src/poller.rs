//! `PeerSyncPoller` -- one instance per non-self row in `peer_node_repo.
//! list_others()` (§2.1's fan-out target list), driving every sync phase
//! against one specific peer on a fixed interval. Shape copied 1:1 from
//! `streamarr_arr_sync::poller::ReconciliationPoller` (§3.2), including
//! reuse of its `SyncRunStatus`/`SyncStatusReporter` types as-is.
//!
//! Each tick wraps a full cycle in `ClusterCoordinator::try_lock("peer-sync:
//! {peer_node_id}", ..)`, exactly the way arr-sync locks
//! `"arr-sync:<source_instance_id>"` -- so a peer node that is itself
//! internally Tier-2/3-scaled never double-polls the same remote peer. A
//! cycle tries every one of that peer's known addresses, priority-ordered,
//! running membership -> accounts -> invites -> libraries -> availability ->
//! routing_rules sync at whichever address answers; the whole cycle only
//! counts as failed once every address has failed. On success, `peer_nodes.
//! status` flips back to `Active` (if it wasn't already) and `last_seen_at`
//! advances; on `STREAMARR_PEER_UNREACHABLE_THRESHOLD` (default 3)
//! consecutive full-cycle failures, `status` flips to `Unreachable` and
//! `last_sync_error` records the last error. Already-synced data is left
//! as-is either way -- the same best-effort philosophy `arr-sync`'s own
//! `best_effort` flag already encodes: a poll failure never rolls back or
//! discards what a previous, successful pass already applied. A single
//! cycle's failure never stops the poller itself -- [`PeerSyncPoller::run`]
//! loops forever, matching that same best-effort spirit at the task level.
//!
//! **Phase isolation, stated explicitly.** Each phase below commits its own
//! writes to the database as it runs, independently of every other phase --
//! there is no single wrapping transaction across the whole cycle. So when
//! a later phase fails (including a brand-new `routing_rules` phase added
//! after `availability`), every phase that already completed in this same
//! cycle keeps exactly what it already applied; nothing here is rolled back
//! or corrupted by a different phase's failure. The one remaining coupling
//! is that a genuinely transient failure in an *earlier* phase (network
//! blip, pool exhaustion -- never a single bad row, see the next paragraph)
//! still short-circuits the phases sequenced after it *for this address,
//! this tick* via `?`: harmless by the same best-effort reasoning above,
//! since the whole cycle (and therefore every phase) is retried in full on
//! the very next tick, and a phase's own cursor never advances past work it
//! didn't actually complete.
//!
//! That short-circuit is deliberately narrow, not a general "one phase can
//! block another forever" gap: `account_sync::sync_accounts`'s own doc
//! comment documents the motivating failure mode this already guards
//! against -- a single colliding row's database constraint violation must
//! never propagate as a hard error (which, unhandled, would have taken
//! every *other* row on that page, and every later phase in this exact
//! sequence, down with it on every retry, forever, since the cursor can't
//! advance past an unapplied page). That fix isolates the bad row inside
//! its own phase instead: logged to `sync_conflict_log` and skipped, cursor
//! still advances, later phases still run this same tick. `routing_sync`
//! needs no such handling of its own -- see that module's own doc comment
//! for why `routing_rules` has no secondary unique constraint a synced row
//! could ever collide on.

use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use streamarr_arr_sync::poller::{SyncRunStatus, SyncStatusReporter};
use streamarr_coordination::ClusterCoordinator;
use streamarr_db::{
    GroupLibraryRepo, PeerLeafAvailabilityRepo, PeerNodeRepo, PeerSyncStateRepo, PolicyRepo,
    RoutingRuleRepo, SyncConflictLogRepo, UserInviteRepo, UserInviteRequestRepo, UserRepo,
    WorkRepo,
};
use streamarr_model::PeerNodeStatus;
use uuid::Uuid;

use crate::peer_client::{addresses_by_priority, PeerClient, PeerClientError};
use crate::{account_sync, availability_sync, membership_sync, routing_sync};

/// Default poll interval in seconds -- `STREAMARR_PEER_SYNC_INTERVAL_SECS`.
/// Read by `backend/src/main.rs`'s boot wiring (a later stage, deliberately
/// not this crate: every other `STREAMARR_*_SECS` var in this codebase is
/// parsed at the boot boundary via `std::env::var`, e.g. `STREAMARR_
/// TRANSCODE_SESSION_IDLE_TTL_SECS`, not inside the poller/service crate
/// itself -- `PeerSyncPoller::new` takes an already-resolved
/// `poll_interval: Duration`, matching `ReconciliationPoller::new`'s own
/// shape exactly).
pub const DEFAULT_PEER_SYNC_INTERVAL_SECS: u64 = 60;

/// Default consecutive-full-cycle-failure threshold before a peer flips to
/// `Unreachable` -- `STREAMARR_PEER_UNREACHABLE_THRESHOLD`. Same "read at
/// the boot boundary, passed in already-resolved" convention as
/// [`DEFAULT_PEER_SYNC_INTERVAL_SECS`].
pub const DEFAULT_PEER_UNREACHABLE_THRESHOLD: u32 = 3;

#[derive(Debug, thiserror::Error)]
pub enum PollError {
    #[error("no address is known for this peer")]
    NoAddresses,
    #[error("peer node {0} is no longer known locally")]
    UnknownPeer(Uuid),
    #[error(transparent)]
    PeerClient(#[from] PeerClientError),
    #[error(transparent)]
    Account(#[from] account_sync::AccountSyncError),
    #[error(transparent)]
    Availability(#[from] availability_sync::AvailabilitySyncError),
    #[error(transparent)]
    Routing(#[from] routing_sync::RoutingSyncError),
    #[error(transparent)]
    Coordination(#[from] streamarr_coordination::CoordinationError),
    #[error(transparent)]
    Db(#[from] streamarr_db::DbError),
}

/// One reconciliation loop, bound to a single peer node. Constructed once
/// per row `peer_node_repo.list_others()` returns; `backend/src/main.rs`'s
/// boot wiring (not built here, see §9.1's `boot_worker` hydration
/// prerequisite this same change must land alongside) is the intended
/// caller of [`PeerSyncPoller::new`]/[`PeerSyncPoller::run`].
pub struct PeerSyncPoller {
    self_peer_id: Uuid,
    peer_node_id: Uuid,
    peer_client: PeerClient,
    poll_interval: Duration,
    unreachable_threshold: u32,
    coordinator: Arc<dyn ClusterCoordinator>,
    peer_node_repo: Arc<dyn PeerNodeRepo>,
    user_repo: Arc<dyn UserRepo>,
    policy_repo: Arc<dyn PolicyRepo>,
    group_library_repo: Arc<dyn GroupLibraryRepo>,
    user_invite_repo: Arc<dyn UserInviteRepo>,
    user_invite_request_repo: Arc<dyn UserInviteRequestRepo>,
    work_repo: Arc<dyn WorkRepo>,
    availability_repo: Arc<dyn PeerLeafAvailabilityRepo>,
    routing_rule_repo: Arc<dyn RoutingRuleRepo>,
    sync_state_repo: Arc<dyn PeerSyncStateRepo>,
    conflict_log_repo: Arc<dyn SyncConflictLogRepo>,
    status_reporter: Option<Arc<dyn SyncStatusReporter>>,
    consecutive_failures: u32,
}

impl PeerSyncPoller {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        self_peer_id: Uuid,
        peer_node_id: Uuid,
        peer_client: PeerClient,
        poll_interval: Duration,
        unreachable_threshold: u32,
        coordinator: Arc<dyn ClusterCoordinator>,
        peer_node_repo: Arc<dyn PeerNodeRepo>,
        user_repo: Arc<dyn UserRepo>,
        policy_repo: Arc<dyn PolicyRepo>,
        group_library_repo: Arc<dyn GroupLibraryRepo>,
        user_invite_repo: Arc<dyn UserInviteRepo>,
        user_invite_request_repo: Arc<dyn UserInviteRequestRepo>,
        work_repo: Arc<dyn WorkRepo>,
        availability_repo: Arc<dyn PeerLeafAvailabilityRepo>,
        routing_rule_repo: Arc<dyn RoutingRuleRepo>,
        sync_state_repo: Arc<dyn PeerSyncStateRepo>,
        conflict_log_repo: Arc<dyn SyncConflictLogRepo>,
    ) -> Self {
        Self {
            self_peer_id,
            peer_node_id,
            peer_client,
            poll_interval,
            unreachable_threshold,
            coordinator,
            peer_node_repo,
            user_repo,
            policy_repo,
            group_library_repo,
            user_invite_repo,
            user_invite_request_repo,
            work_repo,
            availability_repo,
            routing_rule_repo,
            sync_state_repo,
            conflict_log_repo,
            status_reporter: None,
            consecutive_failures: 0,
        }
    }

    /// Opts this poller into reporting every cycle's outcome to `reporter`
    /// -- see [`SyncStatusReporter`]. Same builder-opt-in shape as
    /// `ReconciliationPoller::with_status_reporter`.
    pub fn with_status_reporter(mut self, reporter: Arc<dyn SyncStatusReporter>) -> Self {
        self.status_reporter = Some(reporter);
        self
    }

    /// Runs forever, one cycle per `poll_interval` tick (the first tick
    /// fires immediately, same as `ReconciliationPoller::run`). Never
    /// returns/exits on a cycle failure -- see this module's own doc
    /// comment's "best-effort" note; only a caller externally aborting the
    /// spawned task stops this loop.
    pub async fn run(mut self) {
        let mut interval = tokio::time::interval(self.poll_interval);
        loop {
            interval.tick().await;
            self.reconcile_with_lock().await;
        }
    }

    async fn reconcile_with_lock(&mut self) {
        let lock_key = format!("peer-sync:{}", self.peer_node_id);
        let guard = match self
            .coordinator
            .try_lock(&lock_key, self.poll_interval)
            .await
        {
            Ok(Some(guard)) => guard,
            Ok(None) => {
                tracing::debug!(
                    peer_node_id = %self.peer_node_id,
                    "another node already holds the peer-sync lock for this peer; skipping this tick"
                );
                return;
            }
            Err(err) => {
                tracing::warn!(
                    peer_node_id = %self.peer_node_id,
                    error = %err,
                    "failed to acquire the peer-sync coordination lock; skipping this tick"
                );
                return;
            }
        };

        if let Some(reporter) = &self.status_reporter {
            reporter.report(
                self.peer_node_id,
                SyncRunStatus::Running {
                    started_at: Utc::now(),
                    detail: None,
                },
            );
        }

        let outcome = self.reconcile_all().await;

        if let Some(reporter) = &self.status_reporter {
            let status = match &outcome {
                Ok(()) => SyncRunStatus::Succeeded {
                    finished_at: Utc::now(),
                },
                Err(err) => SyncRunStatus::Failed {
                    error: err.to_string(),
                    finished_at: Utc::now(),
                },
            };
            reporter.report(self.peer_node_id, status);
        }

        if let Err(err) = outcome {
            tracing::warn!(
                peer_node_id = %self.peer_node_id,
                error = %err,
                "peer sync cycle failed on every known address for this peer"
            );
        }

        drop(guard);
    }

    /// Tries every one of this peer's known addresses, priority-ordered,
    /// running the full phase sequence at whichever one answers first --
    /// §3.6's "tries the next address... before giving up the cycle."
    async fn reconcile_all(&mut self) -> Result<(), PollError> {
        let peer = self
            .peer_node_repo
            .get(self.peer_node_id)
            .await?
            .ok_or(PollError::UnknownPeer(self.peer_node_id))?;
        let addresses = addresses_by_priority(&peer.addresses);
        if addresses.is_empty() {
            self.mark_failure(&peer, &PollError::NoAddresses).await?;
            return Err(PollError::NoAddresses);
        }

        let mut last_err = None;
        for address in &addresses {
            match self.run_cycle_at_address(address).await {
                Ok(()) => {
                    self.mark_success(&peer).await?;
                    return Ok(());
                }
                Err(err) => {
                    tracing::warn!(
                        peer_node_id = %self.peer_node_id,
                        address = %address,
                        error = %err,
                        "peer sync cycle failed against this address; trying the next one"
                    );
                    last_err = Some(err);
                }
            }
        }

        let err = last_err.expect("the loop above ran at least once since addresses is non-empty");
        self.mark_failure(&peer, &err).await?;
        Err(err)
    }

    /// One full phase sequence against a single address: membership ->
    /// accounts -> invites -> libraries -> availability -> routing_rules,
    /// short-circuiting on the first phase that fails (the caller treats
    /// that as this address having failed for this cycle, not a partial
    /// success) -- see this module's own doc comment for why that
    /// short-circuit is safe (every phase already committed independently,
    /// nothing is rolled back or corrupted, and a failed tick is retried in
    /// full on the next one).
    async fn run_cycle_at_address(&self, base_url: &str) -> Result<(), PollError> {
        membership_sync::sync_membership(
            &self.peer_client,
            &self.peer_node_repo,
            self.self_peer_id,
            base_url,
        )
        .await?;
        account_sync::sync_accounts(
            &self.peer_client,
            base_url,
            self.peer_node_id,
            self.self_peer_id,
            &self.user_repo,
            &self.policy_repo,
            &self.sync_state_repo,
            &self.conflict_log_repo,
        )
        .await?;
        account_sync::sync_invites(
            &self.peer_client,
            base_url,
            self.peer_node_id,
            &self.user_invite_repo,
            &self.user_invite_request_repo,
            &self.sync_state_repo,
        )
        .await?;
        account_sync::sync_libraries(
            &self.peer_client,
            base_url,
            self.peer_node_id,
            self.self_peer_id,
            &self.group_library_repo,
            &self.sync_state_repo,
            &self.conflict_log_repo,
        )
        .await?;
        availability_sync::sync_availability(
            &self.peer_client,
            base_url,
            self.peer_node_id,
            &self.work_repo,
            &self.availability_repo,
            &self.sync_state_repo,
        )
        .await?;
        routing_sync::sync_routing_rules(
            &self.peer_client,
            base_url,
            self.peer_node_id,
            self.self_peer_id,
            &self.routing_rule_repo,
            &self.sync_state_repo,
            &self.conflict_log_repo,
        )
        .await?;
        Ok(())
    }

    async fn mark_success(&mut self, peer: &streamarr_model::PeerNode) -> Result<(), PollError> {
        self.consecutive_failures = 0;
        let mut updated = peer.clone();
        updated.status = PeerNodeStatus::Active;
        updated.last_sync_error = None;
        updated.last_seen_at = Some(Utc::now());
        updated.updated_at = Utc::now();
        self.peer_node_repo.upsert(&updated).await?;
        Ok(())
    }

    async fn mark_failure(
        &mut self,
        peer: &streamarr_model::PeerNode,
        err: &PollError,
    ) -> Result<(), PollError> {
        self.consecutive_failures += 1;
        if self.consecutive_failures >= self.unreachable_threshold {
            let mut updated = peer.clone();
            updated.status = PeerNodeStatus::Unreachable;
            updated.last_sync_error = Some(err.to_string());
            updated.updated_at = Utc::now();
            self.peer_node_repo.upsert(&updated).await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use base64::Engine;
    use chrono::Utc;
    use serde_json::json;
    use streamarr_coordination::SingleNodeCoordinator;
    use streamarr_model::{PeerAddress, PeerNode};
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::signing::PeerIdentity;

    struct Harness {
        pool: streamarr_db::DbPool,
        peer_node_repo: Arc<dyn PeerNodeRepo>,
        user_repo: Arc<dyn UserRepo>,
        policy_repo: Arc<dyn PolicyRepo>,
        group_library_repo: Arc<dyn GroupLibraryRepo>,
        user_invite_repo: Arc<dyn UserInviteRepo>,
        user_invite_request_repo: Arc<dyn UserInviteRequestRepo>,
        work_repo: Arc<dyn WorkRepo>,
        availability_repo: Arc<dyn PeerLeafAvailabilityRepo>,
        routing_rule_repo: Arc<dyn RoutingRuleRepo>,
        sync_state_repo: Arc<dyn PeerSyncStateRepo>,
        conflict_log_repo: Arc<dyn SyncConflictLogRepo>,
    }

    async fn harness() -> Harness {
        sqlx::any::install_default_drivers();
        let pool = sqlx::any::AnyPoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        streamarr_db::run_migrations(&pool, false).await.unwrap();
        Harness {
            pool: pool.clone(),
            peer_node_repo: Arc::new(streamarr_db::repo::SqlxPeerNodeRepo::new(pool.clone())),
            user_repo: Arc::new(streamarr_db::repo::SqlxUserRepo::new(pool.clone())),
            policy_repo: Arc::new(streamarr_db::repo::SqlxPolicyRepo::new(pool.clone())),
            group_library_repo: Arc::new(streamarr_db::repo::SqlxGroupLibraryRepo::new(
                pool.clone(),
            )),
            user_invite_repo: Arc::new(streamarr_db::repo::SqlxUserInviteRepo::new(pool.clone())),
            user_invite_request_repo: Arc::new(streamarr_db::repo::SqlxUserInviteRequestRepo::new(
                pool.clone(),
            )),
            work_repo: Arc::new(streamarr_db::repo::SqlxWorkRepo::new(pool.clone())),
            availability_repo: Arc::new(streamarr_db::repo::SqlxPeerLeafAvailabilityRepo::new(
                pool.clone(),
            )),
            routing_rule_repo: Arc::new(streamarr_db::repo::SqlxRoutingRuleRepo::new(pool.clone())),
            sync_state_repo: Arc::new(streamarr_db::repo::SqlxPeerSyncStateRepo::new(pool.clone())),
            conflict_log_repo: Arc::new(streamarr_db::repo::SqlxSyncConflictLogRepo::new(pool)),
        }
    }

    fn peer_client() -> PeerClient {
        let seed_b64 = base64::engine::general_purpose::STANDARD.encode([21u8; 32]);
        let identity = PeerIdentity::from_seed_b64(Uuid::new_v4(), &seed_b64).unwrap();
        PeerClient::new(reqwest::Client::new(), identity)
    }

    #[allow(clippy::too_many_arguments)]
    fn poller(
        harness: &Harness,
        self_peer_id: Uuid,
        peer_node_id: Uuid,
        unreachable_threshold: u32,
    ) -> PeerSyncPoller {
        PeerSyncPoller::new(
            self_peer_id,
            peer_node_id,
            peer_client(),
            Duration::from_secs(60),
            unreachable_threshold,
            Arc::new(SingleNodeCoordinator::new()),
            harness.peer_node_repo.clone(),
            harness.user_repo.clone(),
            harness.policy_repo.clone(),
            harness.group_library_repo.clone(),
            harness.user_invite_repo.clone(),
            harness.user_invite_request_repo.clone(),
            harness.work_repo.clone(),
            harness.availability_repo.clone(),
            harness.routing_rule_repo.clone(),
            harness.sync_state_repo.clone(),
            harness.conflict_log_repo.clone(),
        )
    }

    async fn seed_peer(
        harness: &Harness,
        peer_node_id: Uuid,
        group_id: Uuid,
        addresses: Vec<PeerAddress>,
    ) {
        sqlx::query("INSERT INTO peer_groups (id, name, created_at) VALUES (?, ?, ?)")
            .bind(group_id.to_string())
            .bind("test group")
            .bind(Utc::now().to_rfc3339())
            .execute(&harness.pool)
            .await
            .unwrap();
        let now = Utc::now();
        harness
            .peer_node_repo
            .upsert(&PeerNode {
                id: peer_node_id,
                group_id,
                name: "remote".to_string(),
                addresses,
                public_key: "pubkey".to_string(),
                is_self: false,
                status: PeerNodeStatus::Active,
                last_seen_at: None,
                last_sync_error: None,
                joined_at: now,
                updated_at: now,
            })
            .await
            .unwrap();
    }

    /// Mounts every endpoint one full `run_cycle_at_address` pass calls,
    /// each responding with an empty-but-valid body.
    async fn mount_empty_peer_endpoints(mock: &MockServer) {
        Mock::given(method("GET"))
            .and(path("/api/v1/peer/nodes"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"rows": []})))
            .mount(mock)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v1/peer/accounts"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "users": [], "policies": [], "server_time": "cursor",
            })))
            .mount(mock)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v1/peer/invites"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "invites": [], "invite_requests": [], "server_time": "cursor",
            })))
            .mount(mock)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v1/peer/libraries"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "group_libraries": [], "server_time": "cursor",
            })))
            .mount(mock)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v1/peer/availability"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "rows": [], "server_time": "cursor",
            })))
            .mount(mock)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v1/peer/routing-rules"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "rows": [], "server_time": "cursor",
            })))
            .mount(mock)
            .await;
    }

    #[tokio::test]
    async fn a_successful_cycle_marks_the_peer_active_and_updates_last_seen_at() {
        let mock = MockServer::start().await;
        mount_empty_peer_endpoints(&mock).await;
        let harness = harness().await;
        let self_peer_id = Uuid::new_v4();
        let peer_node_id = Uuid::new_v4();
        let group_id = Uuid::new_v4();
        seed_peer(
            &harness,
            peer_node_id,
            group_id,
            vec![PeerAddress {
                url: mock.uri(),
                priority: 0,
                label: "wan".to_string(),
                client_reachable: true,
            }],
        )
        .await;

        let mut poller = poller(&harness, self_peer_id, peer_node_id, 3);
        poller.reconcile_all().await.expect("cycle succeeds");

        let updated = harness
            .peer_node_repo
            .get(peer_node_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(updated.status, PeerNodeStatus::Active);
        assert!(updated.last_seen_at.is_some());
        assert!(updated.last_sync_error.is_none());
        assert_eq!(poller.consecutive_failures, 0);
    }

    #[tokio::test]
    async fn falls_back_to_the_second_address_when_the_first_is_unreachable() {
        let mock = MockServer::start().await;
        mount_empty_peer_endpoints(&mock).await;
        let harness = harness().await;
        let self_peer_id = Uuid::new_v4();
        let peer_node_id = Uuid::new_v4();
        let group_id = Uuid::new_v4();
        seed_peer(
            &harness,
            peer_node_id,
            group_id,
            vec![
                PeerAddress {
                    url: "http://127.0.0.1:1".to_string(),
                    priority: 0,
                    label: "lan".to_string(),
                    client_reachable: false,
                },
                PeerAddress {
                    url: mock.uri(),
                    priority: 1,
                    label: "wan".to_string(),
                    client_reachable: true,
                },
            ],
        )
        .await;

        let mut poller = poller(&harness, self_peer_id, peer_node_id, 3);
        poller
            .reconcile_all()
            .await
            .expect("cycle succeeds via the fallback address");

        let updated = harness
            .peer_node_repo
            .get(peer_node_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(updated.status, PeerNodeStatus::Active);
    }

    #[tokio::test]
    async fn flips_to_unreachable_only_after_the_configured_number_of_consecutive_failures() {
        let harness = harness().await;
        let self_peer_id = Uuid::new_v4();
        let peer_node_id = Uuid::new_v4();
        let group_id = Uuid::new_v4();
        seed_peer(
            &harness,
            peer_node_id,
            group_id,
            vec![PeerAddress {
                url: "http://127.0.0.1:1".to_string(),
                priority: 0,
                label: "lan".to_string(),
                client_reachable: false,
            }],
        )
        .await;

        let mut poller = poller(&harness, self_peer_id, peer_node_id, 3);

        poller
            .reconcile_all()
            .await
            .expect_err("cycle fails: nothing reachable");
        let after_one = harness
            .peer_node_repo
            .get(peer_node_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            after_one.status,
            PeerNodeStatus::Active,
            "must not flip on the first failure"
        );

        poller.reconcile_all().await.expect_err("cycle fails again");
        let after_two = harness
            .peer_node_repo
            .get(peer_node_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            after_two.status,
            PeerNodeStatus::Active,
            "must not flip on the second failure"
        );

        poller
            .reconcile_all()
            .await
            .expect_err("cycle fails a third time");
        let after_three = harness
            .peer_node_repo
            .get(peer_node_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            after_three.status,
            PeerNodeStatus::Unreachable,
            "must flip after reaching the threshold"
        );
        assert!(after_three.last_sync_error.is_some());
    }

    #[tokio::test]
    async fn a_success_after_failures_resets_the_consecutive_failure_count_and_reactivates() {
        let mock = MockServer::start().await;
        mount_empty_peer_endpoints(&mock).await;
        let harness = harness().await;
        let self_peer_id = Uuid::new_v4();
        let peer_node_id = Uuid::new_v4();
        let group_id = Uuid::new_v4();
        seed_peer(
            &harness,
            peer_node_id,
            group_id,
            vec![PeerAddress {
                url: mock.uri(),
                priority: 0,
                label: "wan".to_string(),
                client_reachable: true,
            }],
        )
        .await;
        // Start already `Unreachable` with a stale error, as if a prior
        // poller instance had already tripped the threshold.
        let mut node = harness
            .peer_node_repo
            .get(peer_node_id)
            .await
            .unwrap()
            .unwrap();
        node.status = PeerNodeStatus::Unreachable;
        node.last_sync_error = Some("stale failure".to_string());
        harness.peer_node_repo.upsert(&node).await.unwrap();

        let mut poller = poller(&harness, self_peer_id, peer_node_id, 3);
        poller.consecutive_failures = 2;
        poller.reconcile_all().await.expect("cycle succeeds");

        assert_eq!(poller.consecutive_failures, 0);
        let updated = harness
            .peer_node_repo
            .get(peer_node_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(updated.status, PeerNodeStatus::Active);
        assert!(updated.last_sync_error.is_none());
    }

    #[tokio::test]
    async fn a_peer_with_no_addresses_fails_without_panicking() {
        let harness = harness().await;
        let self_peer_id = Uuid::new_v4();
        let peer_node_id = Uuid::new_v4();
        let group_id = Uuid::new_v4();
        seed_peer(&harness, peer_node_id, group_id, vec![]).await;

        let mut poller = poller(&harness, self_peer_id, peer_node_id, 3);
        let err = poller
            .reconcile_all()
            .await
            .expect_err("no addresses to try");
        assert!(matches!(err, PollError::NoAddresses));
    }
}
