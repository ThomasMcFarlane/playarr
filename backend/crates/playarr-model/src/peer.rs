//! Node & group identity -- Phase 1 of `docs/architecture/peer-groups.md`
//! (see that document's §2.1 for the full design and rationale).
//!
//! [`NodeIdentity`] is this installation's own durable, private identity;
//! [`PeerGroup`] is the set of peer nodes that have agreed to sync; each
//! member (including this node itself) is a [`PeerNode`]. Deliberately
//! **not** named around `node_id`: that token already means "this
//! ephemeral process's replica identity" elsewhere in the codebase
//! (`AppState.node_id`) -- see the
//! design doc's §1.1 for the naming collision this avoids. Every field
//! here is additive and nullable/absent for a single, ungrouped node.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::sensitive::Sensitive;

/// This node's own private state. Singleton -- exactly one row exists,
/// keyed by a fixed sentinel id (same pattern as
/// [`crate::system_settings::SystemSettings`]).
#[derive(Debug, Clone, PartialEq)]
pub struct NodeIdentity {
    pub peer_id: Uuid,
    /// Ed25519 seed. Never `Serialize`d into any API response --
    /// `Sensitive<T>` only redacts `Debug`/`Display` (see
    /// playarr-model/src/sensitive.rs's own doc comment), it does NOT
    /// suppress `Serialize`, so callers must never place this on any DTO
    /// that reaches an HTTP response body, the same discipline already
    /// required of `SourceInstance.api_key_encrypted`.
    pub private_key: Sensitive<String>,
    pub group_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

/// A set of peer nodes that have agreed to sync with each other.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PeerGroup {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
}

/// A [`PeerNode`]'s membership state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum PeerNodeStatus {
    Active,
    Unreachable,
    Left,
}

/// One reachable address for a [`PeerNode`], as asserted by that peer's
/// own operator.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PeerAddress {
    pub url: String,
    /// Lower sorts first -- same convention as `SourceInstance::priority`.
    pub priority: i32,
    pub label: String, // "lan" | "wan" | "relay", informational
    /// Operator-asserted, never auto-detected (NAT/firewall topology
    /// cannot be reliably guessed -- same philosophy already used for
    /// `PLAYARR_ACME_DOMAIN`). Drives `DeliveryMode::Auto`, see §5.3.
    pub client_reachable: bool,
}

/// One known member of a [`PeerGroup`], including a row for this node
/// itself (`is_self = true`) so every "list the whole membership picture"
/// query (admin UI, sync fan-out target list) is one query, not "self plus
/// the other peers".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PeerNode {
    pub id: Uuid,
    pub group_id: Uuid,
    pub name: String,
    pub addresses: Vec<PeerAddress>,
    pub public_key: String, // Ed25519, base64
    pub is_self: bool,
    pub status: PeerNodeStatus,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub last_sync_error: Option<String>,
    pub joined_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
