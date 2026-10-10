//! Signed push transport for peer sync.
//!
//! Pull remains the normal reconciliation path. This aggregate exchange lets
//! a node which can make outbound requests, but cannot accept inbound ones,
//! publish the same entity pages to a reachable peer. The receiver uses the
//! exact same conflict resolution and cursor updates as a pulled page.

use std::sync::Arc;

use chrono::{DateTime, Utc};
use playarr_db::{
    GroupLibraryRepo, PeerLeafAvailabilityRepo, PeerNodeRepo, PeerSyncStateRepo, PolicyRepo,
    RoutingRuleRepo, SourceInstanceRepo, SyncConflictLogRepo, UserInviteRepo,
    UserInviteRequestRepo, UserRepo, WorkRepo,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{account_sync, availability_sync, membership_sync, routing_sync};

/// All entity pages published in one signed outbound request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushSyncRequest {
    pub membership: membership_sync::NodesResponse,
    pub accounts: account_sync::AccountsResponse,
    pub invites: account_sync::InvitesResponse,
    pub libraries: account_sync::LibrariesResponse,
    /// The sender's whole inventory. Left out ("unchanged") only when the
    /// receiver told the sender, in its answer to an earlier push, that it
    /// already holds the snapshot with `availability_digest`; a receiver that
    /// predates this field never says so, so it always gets the rows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub availability: Option<availability_sync::AvailabilityResponse>,
    /// [`availability_sync::wire_digest`] of the sender's current inventory.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub availability_digest: Option<String>,
    pub routing_rules: routing_sync::RoutingRulesResponse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushSyncResponse {
    pub accepted_at: DateTime<Utc>,
    /// [`availability_sync::wire_digest`] of the inventory this node now holds
    /// for the sender, if the sender declared one. Absent from a receiver that
    /// predates the field, which tells the sender to keep sending rows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub availability_digest: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum PushSyncError {
    #[error(transparent)]
    Membership(#[from] crate::peer_client::PeerClientError),
    #[error(transparent)]
    Account(#[from] account_sync::AccountSyncError),
    #[error(transparent)]
    Availability(#[from] availability_sync::AvailabilitySyncError),
    #[error(transparent)]
    Routing(#[from] routing_sync::RoutingSyncError),
}

/// Applies a pushed exchange as if each page had been pulled from `source_peer_id`.
#[allow(clippy::too_many_arguments)]
pub async fn apply_push(
    request: PushSyncRequest,
    source_peer_id: Uuid,
    self_peer_id: Uuid,
    peer_node_repo: &Arc<dyn PeerNodeRepo>,
    user_repo: &Arc<dyn UserRepo>,
    policy_repo: &Arc<dyn PolicyRepo>,
    group_library_repo: &Arc<dyn GroupLibraryRepo>,
    source_instance_repo: &Arc<dyn SourceInstanceRepo>,
    user_invite_repo: &Arc<dyn UserInviteRepo>,
    user_invite_request_repo: &Arc<dyn UserInviteRequestRepo>,
    work_repo: &Arc<dyn WorkRepo>,
    availability_repo: &Arc<dyn PeerLeafAvailabilityRepo>,
    routing_rule_repo: &Arc<dyn RoutingRuleRepo>,
    sync_state_repo: &Arc<dyn PeerSyncStateRepo>,
    conflict_log_repo: &Arc<dyn SyncConflictLogRepo>,
) -> Result<PushSyncResponse, PushSyncError> {
    membership_sync::apply_membership(
        peer_node_repo,
        self_peer_id,
        request.membership,
        "peer-push",
    )
    .await?;
    account_sync::apply_accounts_response(
        request.accounts,
        source_peer_id,
        self_peer_id,
        user_repo,
        policy_repo,
        sync_state_repo,
        conflict_log_repo,
    )
    .await?;
    account_sync::apply_invites_response(
        request.invites,
        source_peer_id,
        user_invite_repo,
        user_invite_request_repo,
        sync_state_repo,
    )
    .await?;
    account_sync::apply_libraries_response(
        request.libraries,
        source_peer_id,
        self_peer_id,
        group_library_repo,
        source_instance_repo,
        sync_state_repo,
        conflict_log_repo,
    )
    .await?;
    // "Unchanged" (no rows) applies nothing. Either way the answer names the
    // digest recorded with the stored rows, which a sender whose own digest
    // differs takes as "send the rows next time".
    if let Some(availability) = request.availability {
        availability_sync::apply_availability_response(
            availability,
            source_peer_id,
            work_repo,
            availability_repo,
            sync_state_repo,
        )
        .await?;
    }
    let held_digest = availability_repo
        .held_wire_digest(source_peer_id)
        .await
        .map_err(availability_sync::AvailabilitySyncError::from)?;
    routing_sync::apply_routing_rules_response(
        request.routing_rules,
        source_peer_id,
        self_peer_id,
        routing_rule_repo,
        sync_state_repo,
        conflict_log_repo,
    )
    .await?;

    Ok(PushSyncResponse {
        accepted_at: Utc::now(),
        availability_digest: held_digest,
    })
}
