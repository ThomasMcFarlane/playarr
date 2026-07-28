//! Routing rules -- Phase 3 of `docs/architecture/peer-groups.md` (see that
//! document's §2.4 for the full design and rationale, and §5 for how a
//! rule is evaluated and delivered).
//!
//! A [`RoutingRule`] is the operator-configured policy that decides, for a
//! given ([`GroupLibrary`](crate::group_library::GroupLibrary), user) pair,
//! which peer(s) should serve a stream and how (§5.2's evaluation point).
//! Every field here is additive; a single, ungrouped node -- or a grouped
//! node with no matching rule -- never reads this table and falls back to
//! today's exact `ServeLocally` behavior unchanged (§5.2).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// One routing policy row. `group_library_id = None` matches any library;
/// `user_id = None` matches any user. Among rules that match equally
/// specifically, `priority` is the tiebreak (higher wins -- see §5.2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct RoutingRule {
    pub id: Uuid,
    pub group_id: Uuid,
    pub group_library_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub priority: i32,
    /// `peer_nodes.id` values, ordered most-preferred first.
    pub preferred_nodes: Vec<Uuid>,
    pub delivery_mode: DeliveryMode,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// How a stream resolved to a remote peer should actually reach the
/// client -- see §5.3 for the redirect-vs-proxy tradeoff this encodes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum DeliveryMode {
    /// Compute Redirect if the resolved peer has at least one
    /// client_reachable address, else Proxy -- per request, not a fixed
    /// choice at rule-authoring time. Default.
    Auto,
    Redirect,
    Proxy,
}
