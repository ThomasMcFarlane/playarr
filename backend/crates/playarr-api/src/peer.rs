//! Inbound node-to-node endpoints -- `docs/architecture/peer-groups.md`
//! §3.4/§3.6. [`enroll_handler`] (`POST /api/v1/peer/enroll`) is the join
//! handshake: bearer-authed by the one-shot join token carried in the
//! request body itself, not by [`crate::peer_extractor::PeerSignedRequest`]
//! -- there is no `peer_nodes` row for the caller to sign against yet,
//! since a successful call to this endpoint is exactly what creates one.
//!
//! Every other `/api/v1/peer/*` sync endpoint the design doc's §3.6 table
//! lists -- [`nodes_handler`] (`GET .../nodes`), [`accounts_handler`]
//! (`GET .../accounts?since=`), [`invites_handler`] (`GET .../invites?since=`),
//! [`libraries_handler`] (`GET .../libraries?since=`),
//! [`availability_handler`] (`GET .../availability?since=`), and
//! [`routing_rules_handler`] (`GET .../routing-rules?since=`) -- is
//! [`crate::peer_extractor::PeerSignedRequest`]-gated and is what
//! `playarr_peer_sync::PeerSyncPoller` (`playarr-peer-sync`, §2.6)
//! actually calls on its polling cadence.
//!
//! **Wire-shape discipline.** Every response type below is a deliberate,
//! field-for-field mirror of the shape `playarr_peer_sync`'s own
//! consumer (`account_sync.rs`/`availability_sync.rs`/`membership_sync.rs`/
//! `routing_sync.rs`) already deserializes and is tested against -- never
//! that crate's own wire types reused directly (same reason
//! `admin_peer::join_peer_group_handler`'s doc comment gives for
//! `EnrollResponse`: this crate needs `utoipa::ToSchema` for OpenAPI docs,
//! that crate doesn't depend on `utoipa` at all). Where the domain type
//! itself is already `ToSchema` and carries no secret (`PeerNode`,
//! `Policy`, `GroupLibrary`, `RoutingRule`, `Availability`/
//! `ExternalProvider`/`LeafSelector`/`WorkKind`), the response type reuses
//! it directly -- zero risk of the two shapes drifting apart, because
//! there is only one type. Only `playarr_model::User` (carries
//! `password_hash`) and `UserInvite`/`UserInviteRequest` (mirrored here
//! rather than given `ToSchema` upstream, matching `users.rs`'s own
//! established `UserInviteResponse`/`UserInviteRequestResponse`
//! precedent) are hand-mirrored field-by-field.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{DateTime, Utc};
use playarr_catalog::WorkChildren;
use playarr_db::SyncMetadata;
use playarr_model::{
    Availability, ExternalProvider, GroupLibrary, LeafSelector, PeerAddress, PeerGroup, PeerNode,
    PeerNodeStatus, Policy, RoutingRule, SourceInstanceSyncRow, User, UserInvite,
    UserInviteRequest, UserInviteRequestStatus, WorkKind,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::error::ApiError;
use crate::peer_extractor::PeerSignedRequest;
use crate::physical_path::existing_physical_file;
use crate::AppState;

/// Request body for [`enroll_handler`] -- exactly `docs/architecture/
/// peer-groups.md` §3.4 step 3's `{join_token, peer_id, name, addresses,
/// public_key}`. `admin_peer::join_peer_group_handler` builds and sends
/// this same shape when it drives the client side of this handshake.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct EnrollRequest {
    /// The raw, one-time token an admin on this (the founding/receiving)
    /// node issued via `POST /api/v1/admin/peer-groups/join-tokens`.
    pub join_token: String,
    /// The joining node's own durable `node_identity.peer_id`.
    pub peer_id: Uuid,
    pub name: String,
    #[serde(default)]
    pub addresses: Vec<PeerAddress>,
    /// The joining node's Ed25519 public key, base64.
    pub public_key: String,
}

/// Response body for [`enroll_handler`] -- exactly §3.4 step 4's
/// `{group, members}`, where `members` is this node's **full** current
/// membership (including this node's own `is_self = true` row and the
/// row just inserted for the caller), so the joining node doesn't have to
/// wait for its first sync pass to learn about any third peer that
/// already joined. Reused as-is by `admin_peer::join_peer_group_handler`
/// to deserialize this same shape on the joining node's side, rather than
/// hand-duplicating an identical struct there.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct EnrollResponse {
    pub group: PeerGroup,
    pub members: Vec<PeerNode>,
}

fn invalid_join_token() -> ApiError {
    ApiError::new(
        StatusCode::GONE,
        "invalid_join_token",
        "this join token is invalid, expired, or has already been used",
    )
}

/// Join handshake, called by a joining node's own admin-triggered
/// `POST /api/v1/admin/peer-groups/join` (never called directly by a
/// browser/admin console). Validates the one-shot join token (unexpired,
/// unused, hash match) and name uniqueness within the group, marks the
/// token redeemed, inserts the caller's row into `peer_nodes`, and replies
/// with the full current membership -- `docs/architecture/peer-groups.md`
/// §3.4 steps 3-4.
#[utoipa::path(
    post,
    path = "/api/v1/peer/enroll",
    tag = "peer-groups",
    request_body(content = EnrollRequest, example = json!({
        "join_token": "5f8a1c2e9b3d4f6a8c1e2b3d4f6a8c1e",
        "peer_id": "22222222-2222-4222-8222-222222222222",
        "name": "east",
        "addresses": [
            {"url": "https://east.example.com", "priority": 0, "label": "wan", "client_reachable": true}
        ],
        "public_key": "MCowBQYDK2VwAyEA...base64..."
    })),
    responses(
        (status = 200, description = "Enrolled -- full current group membership returned", body = EnrollResponse),
        (status = 409, description = "A peer with this name already exists in the group"),
        (status = 410, description = "Join token is invalid, expired, or already used")
    )
)]
pub async fn enroll_handler(
    State(state): State<AppState>,
    Json(body): Json<EnrollRequest>,
) -> Result<Json<EnrollResponse>, ApiError> {
    let token_hash = playarr_auth::secret::hash_token(&body.join_token);
    let now = Utc::now();

    let token = state
        .peer_join_token_repo
        .find_valid(&token_hash, now)
        .await
        .map_err(|err| ApiError::internal(format!("failed to validate join token: {err}")))?
        .ok_or_else(invalid_join_token)?;

    // Name uniqueness within the group -- checked (and rejected) before
    // consuming the token, so a colliding name doesn't burn the caller's
    // one shot at it. `peer_nodes` also has a real `UNIQUE (group_id,
    // name)` index (see the migration) as a backstop, but that would
    // surface as an opaque `DbError::Backend` rather than this clear 409.
    let existing = state
        .peer_node_repo
        .list_all()
        .await
        .map_err(|err| ApiError::internal(format!("failed to list peer nodes: {err}")))?;
    if existing
        .iter()
        .any(|node| node.group_id == token.group_id && node.name == body.name)
    {
        return Err(ApiError::conflict(format!(
            "a peer named '{}' already exists in this group",
            body.name
        )));
    }

    // `peer_id` uniqueness, checked the same deliberate way: `upsert` is
    // insert-OR-UPDATE keyed by id, and every peer's id is visible to every
    // other member (returned in `EnrollResponse::members`) -- without this
    // check, a holder of *any* valid join token could claim an
    // already-enrolled peer's `peer_id` with a public key they control,
    // silently overwriting that peer's signing identity for every future
    // `PeerSignedRequest` verification. A colliding id is rejected exactly
    // like a colliding name: before the token is consumed, so it doesn't
    // burn the caller's one shot at a legitimate retry with their own id.
    if existing.iter().any(|node| node.id == body.peer_id) {
        return Err(ApiError::conflict(format!(
            "a peer with id '{}' already exists in this group",
            body.peer_id
        )));
    }

    let consumed = state
        .peer_join_token_repo
        .consume(&token_hash, now, body.peer_id)
        .await
        .map_err(|err| ApiError::internal(format!("failed to redeem join token: {err}")))?;
    if !consumed {
        // Raced against another redemption of the same token between the
        // `find_valid` check above and here -- same non-leaking contract
        // `users::signup_handler` already relies on for `UserInvite`.
        return Err(invalid_join_token());
    }

    let group = state
        .peer_group_repo
        .get(token.group_id)
        .await
        .map_err(|err| ApiError::internal(format!("failed to load peer group: {err}")))?
        .ok_or_else(|| {
            ApiError::internal(format!(
                "join token referenced missing peer group {}",
                token.group_id
            ))
        })?;

    let joining_node = PeerNode {
        id: body.peer_id,
        group_id: token.group_id,
        name: body.name.clone(),
        addresses: body.addresses,
        public_key: body.public_key,
        // `is_self` is per-database, never taken from the caller's own
        // claim: this row is *this* node's record of the OTHER node that
        // just joined, so it is never this node's own self row.
        is_self: false,
        status: PeerNodeStatus::Active,
        last_seen_at: Some(now),
        last_sync_error: None,
        joined_at: now,
        updated_at: now,
    };
    state
        .peer_node_repo
        .upsert(&joining_node)
        .await
        .map_err(|err| ApiError::internal(format!("failed to persist joining peer: {err}")))?;

    let members = state
        .peer_node_repo
        .list_all()
        .await
        .map_err(|err| ApiError::internal(format!("failed to list peer nodes: {err}")))?;

    tracing::info!(
        peer_id = %body.peer_id,
        peer_name = %body.name,
        group_id = %token.group_id,
        "peer enrolled into group"
    );

    Ok(Json(EnrollResponse { group, members }))
}

// ---------------------------------------------------------------------
// Shared `?since=` cursor handling
// ---------------------------------------------------------------------

/// Query params shared by every `?since=`-cursored sync endpoint (§3.6's
/// table). `since` is the opaque `server_time` a previous response
/// returned, echoed back verbatim; omitted (or absent) means "every row."
#[derive(Debug, Deserialize, ToSchema, utoipa::IntoParams)]
pub struct SinceQueryParams {
    pub since: Option<String>,
}

/// Parses `since` as Unix-epoch milliseconds. Deliberately not RFC 3339:
/// [`cursor`] below builds the `since=` value the caller echoes back via a
/// plain, unescaped `format!("...?since={cursor}")` (see
/// `playarr_peer_sync::account_sync`/`availability_sync`'s own `sync_*`
/// functions) -- an RFC 3339 UTC offset's `+` would be silently
/// misinterpreted as an encoded space the moment it round-trips through
/// standard `application/x-www-form-urlencoded` query decoding (which is
/// exactly what `axum::extract::Query` uses). A plain decimal integer has
/// no such character to misinterpret.
fn parse_since(raw: Option<&str>) -> Result<Option<DateTime<Utc>>, ApiError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let millis: i64 = raw
        .parse()
        .map_err(|_| ApiError::bad_request("since must be a Unix-epoch-milliseconds integer"))?;
    DateTime::<Utc>::from_timestamp_millis(millis)
        .map(Some)
        .ok_or_else(|| ApiError::bad_request("since is out of range"))
}

/// Builds the `server_time` cursor for a response captured at `now`
/// (captured once, before any repository read, at the top of each
/// handler): every row this handler could possibly return has an
/// `updated_at`/`created_at`/`requested_at` stamped from the server clock
/// no later than the moment its write committed, which is necessarily
/// before `now` was captured here -- so a next call's `since=<this cursor>`
/// is guaranteed not to skip anything that existed at the time of this
/// response, matching the safety `UserRepo::list_updated_since`'s own doc
/// comment describes ("resume from last row's updated_at").
fn cursor(now: DateTime<Utc>) -> String {
    now.timestamp_millis().to_string()
}

/// This node's own peer group id, from `node_identity.group_id`. Every
/// handler below is [`PeerSignedRequest`]-gated, which already guarantees
/// a `peer_nodes` row exists for the caller -- and `peer_nodes.group_id`
/// is `NOT NULL` -- so this node necessarily has a group by the time any
/// of these handlers run; `internal` (not a 4xx) is the honest response if
/// that invariant is somehow violated.
async fn this_node_group_id(state: &AppState) -> Result<Uuid, ApiError> {
    state
        .node_identity_repo
        .get()
        .await
        .map_err(|err| ApiError::internal(format!("failed to load node identity: {err}")))?
        .and_then(|identity| identity.group_id)
        .ok_or_else(|| {
            ApiError::internal(
                "this node has no peer group, but received a validly peer-signed request",
            )
        })
}

async fn this_node_peer_id(state: &AppState) -> Result<Uuid, ApiError> {
    state
        .node_identity_repo
        .get()
        .await
        .map_err(|err| ApiError::internal(format!("failed to load node identity: {err}")))?
        .map(|identity| identity.peer_id)
        .ok_or_else(|| ApiError::internal("node identity is missing"))
}

// ---------------------------------------------------------------------
// GET /api/v1/peer/nodes
// ---------------------------------------------------------------------

/// Response body for [`nodes_handler`] -- `docs/architecture/peer-groups.md`
/// §3.6: "full `peer_nodes` (small; always full-refresh gossip)". No
/// `since`/`server_time` -- `playarr_peer_sync::membership_sync`'s own
/// `NodesResponse` doc comment explains why membership has no
/// corresponding `peer_sync_state.entity` cursor to persist.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct NodesResponse {
    pub rows: Vec<PeerNode>,
}

/// Full current `peer_nodes` membership (including this node's own
/// `is_self = true` row) -- always a full refresh, never filtered. This is
/// how a third node's membership (learned via a *different* peer's
/// `enroll` call) eventually converges everywhere without a fresh `enroll`
/// round trip (§3.4 step 6).
#[utoipa::path(
    get,
    path = "/api/v1/peer/nodes",
    tag = "peer-groups",
    responses(
        (status = 200, description = "Full current peer_nodes membership, including self", body = NodesResponse),
        (status = 401, description = "Missing/invalid peer signature, or an unknown/left peer")
    )
)]
pub async fn nodes_handler(
    State(state): State<AppState>,
    _peer: PeerSignedRequest,
) -> Result<Json<NodesResponse>, ApiError> {
    let rows = state
        .peer_node_repo
        .list_all()
        .await
        .map_err(|err| ApiError::internal(format!("failed to list peer nodes: {err}")))?;
    Ok(Json(NodesResponse { rows }))
}

/// Receives a signed notification that the calling node is leaving the
/// group. A peer may only mark its own authenticated identity as left;
/// removing somebody else remains an administrator action.
#[utoipa::path(
    delete,
    path = "/api/v1/peer/nodes/{id}",
    tag = "peer-groups",
    params(("id" = Uuid, Path, description = "Leaving peer node id")),
    responses(
        (status = 204, description = "Leaving peer marked as left"),
        (status = 400, description = "Signed peer id does not match the path id"),
        (status = 401, description = "Missing/invalid peer signature, or an unknown/left peer")
    )
)]
pub async fn leave_notification_handler(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    peer: PeerSignedRequest,
) -> Result<StatusCode, ApiError> {
    if peer.peer.id != id {
        return Err(ApiError::bad_request("a peer may only mark itself as left"));
    }
    let mut leaving = peer.peer;
    leaving.status = PeerNodeStatus::Left;
    leaving.updated_at = Utc::now();
    state
        .peer_node_repo
        .upsert(&leaving)
        .await
        .map_err(|err| ApiError::internal(format!("failed to mark leaving peer: {err}")))?;
    tracing::info!(peer_id = %id, "peer left group");
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------
// GET /api/v1/peer/accounts?since=
// ---------------------------------------------------------------------

/// Wire shape of one `users` row on `GET /api/v1/peer/accounts` --
/// field-for-field identical to `playarr_peer_sync::account_sync::
/// UserSyncRow`'s flattened wire shape (`playarr_model::User`'s own
/// fields plus the three sync-only columns). Not `User` itself flattened
/// via `#[serde(flatten)]`: `User` is deliberately not `ToSchema`-derived
/// (it carries `password_hash` -- see that type's own doc comment); this
/// is the one narrow, deliberate exception to "never on an HTTP response"
/// that field's doc comment warns about -- the design doc's §3.1 table
/// explicitly lists `password_hash` as one of the few fields that DOES
/// sync between group peers ("already a hash, replicating it is exactly
/// what makes a password valid on every node"), and this type is never
/// reachable from any browser-facing route, only from a
/// [`PeerSignedRequest`]-gated node-to-node call.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PeerUserRow {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub email: Option<String>,
    pub password_hash: String,
    pub policy_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub disabled: bool,
    pub preferred_audio_language: String,
    pub updated_at: DateTime<Utc>,
    pub origin_peer_id: Option<Uuid>,
    pub deleted_at: Option<DateTime<Utc>>,
}

impl PeerUserRow {
    fn new(user: User, meta: SyncMetadata) -> Self {
        Self {
            id: user.id,
            username: user.username,
            display_name: user.display_name,
            email: user.email,
            password_hash: user.password_hash.into_inner(),
            policy_id: user.policy_id,
            created_at: user.created_at,
            disabled: user.disabled,
            preferred_audio_language: user.preferred_audio_language,
            updated_at: meta.updated_at,
            origin_peer_id: meta.origin_peer_id,
            deleted_at: meta.deleted_at,
        }
    }
}

/// Wire shape of one `policies` row on `GET /api/v1/peer/accounts` --
/// field-for-field identical to `playarr_peer_sync::account_sync::
/// PolicySyncRow`. `Policy` carries no secret, so (unlike [`PeerUserRow`])
/// this flattens the real `playarr_model::Policy` directly: one type,
/// zero risk of the two shapes drifting apart.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PeerPolicyRow {
    #[serde(flatten)]
    pub policy: Policy,
    pub updated_at: DateTime<Utc>,
    pub origin_peer_id: Option<Uuid>,
    pub deleted_at: Option<DateTime<Utc>>,
}

/// Response body for [`accounts_handler`] -- `docs/architecture/
/// peer-groups.md` §3.6: `{users, policies}` upserts/tombstones.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct AccountsResponse {
    pub users: Vec<PeerUserRow>,
    pub policies: Vec<PeerPolicyRow>,
    pub server_time: String,
}

/// `users`/`policies` upserted or soft-deleted since `since` (every row,
/// oldest first, when omitted) -- the read behind
/// `playarr_peer_sync::account_sync::sync_accounts`. Tombstoned rows are
/// included (`deleted_at` set), never filtered out: see
/// `UserRepo::list_updated_since`'s own doc comment for why a lagging peer
/// must never see a delete as mere absence.
#[utoipa::path(
    get,
    path = "/api/v1/peer/accounts",
    tag = "peer-groups",
    params(SinceQueryParams),
    responses(
        (status = 200, description = "users/policies upserted or tombstoned since the given cursor", body = AccountsResponse),
        (status = 400, description = "Malformed since cursor"),
        (status = 401, description = "Missing/invalid peer signature, or an unknown/left peer")
    )
)]
pub async fn accounts_handler(
    State(state): State<AppState>,
    Query(params): Query<SinceQueryParams>,
    _peer: PeerSignedRequest,
) -> Result<Json<AccountsResponse>, ApiError> {
    let since = parse_since(params.since.as_deref())?;
    let now = Utc::now();

    let users = state
        .user_repo
        .list_updated_since(since)
        .await
        .map_err(|err| ApiError::internal(format!("failed to list users for peer sync: {err}")))?
        .into_iter()
        .map(|(user, meta)| PeerUserRow::new(user, meta))
        .collect();

    let policies = state
        .policy_repo
        .list_updated_since(since)
        .await
        .map_err(|err| ApiError::internal(format!("failed to list policies for peer sync: {err}")))?
        .into_iter()
        .map(|(policy, meta)| PeerPolicyRow {
            policy,
            updated_at: meta.updated_at,
            origin_peer_id: meta.origin_peer_id,
            deleted_at: meta.deleted_at,
        })
        .collect();

    Ok(Json(AccountsResponse {
        users,
        policies,
        server_time: cursor(now),
    }))
}

// ---------------------------------------------------------------------
// GET /api/v1/peer/invites?since=
// ---------------------------------------------------------------------

/// Wire shape of one `user_invites` row on `GET /api/v1/peer/invites` --
/// field-for-field identical to `playarr_model::UserInvite`'s own
/// `Serialize` output (which is exactly what `playarr_peer_sync::
/// account_sync::InvitesResponse` consumes -- that type uses `UserInvite`
/// directly, not a wrapper). Mirrored here rather than adding `ToSchema`
/// to `UserInvite` itself, matching `users.rs`'s own established
/// `UserInviteResponse`/`UserInviteRequestResponse` precedent of never
/// deriving a schema straight off these domain types.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PeerInviteRow {
    pub token_hash: String,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub can_stream: bool,
    pub library_allow: Vec<Uuid>,
    pub group_library_allow: Vec<Uuid>,
    pub consumed_at: Option<DateTime<Utc>>,
    pub consumed_by_user_id: Option<Uuid>,
    pub consumed_by_peer_id: Option<Uuid>,
}

impl From<UserInvite> for PeerInviteRow {
    fn from(invite: UserInvite) -> Self {
        Self {
            token_hash: invite.token_hash,
            created_by: invite.created_by,
            created_at: invite.created_at,
            expires_at: invite.expires_at,
            can_stream: invite.can_stream,
            library_allow: invite.library_allow,
            group_library_allow: invite.group_library_allow,
            consumed_at: invite.consumed_at,
            consumed_by_user_id: invite.consumed_by_user_id,
            consumed_by_peer_id: invite.consumed_by_peer_id,
        }
    }
}

/// Wire shape of one `user_invite_requests` row -- mirrors
/// `playarr_model::UserInviteRequest`, same rationale as
/// [`PeerInviteRow`].
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PeerInviteRequestRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub message: Option<String>,
    pub status: UserInviteRequestStatus,
    pub requested_at: DateTime<Utc>,
    pub reviewed_by: Option<Uuid>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub generated_at: Option<DateTime<Utc>>,
    pub can_stream: bool,
    pub library_allow: Vec<Uuid>,
    pub group_library_allow: Vec<Uuid>,
}

impl From<UserInviteRequest> for PeerInviteRequestRow {
    fn from(request: UserInviteRequest) -> Self {
        Self {
            id: request.id,
            user_id: request.user_id,
            message: request.message,
            status: request.status,
            requested_at: request.requested_at,
            reviewed_by: request.reviewed_by,
            reviewed_at: request.reviewed_at,
            generated_at: request.generated_at,
            can_stream: request.can_stream,
            library_allow: request.library_allow,
            group_library_allow: request.group_library_allow,
        }
    }
}

/// Response body for [`invites_handler`] -- `docs/architecture/
/// peer-groups.md` §3.6: `user_invites`/`user_invite_requests` rows.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct InvitesResponse {
    pub invites: Vec<PeerInviteRow>,
    pub invite_requests: Vec<PeerInviteRequestRow>,
    pub server_time: String,
}

/// `user_invites`/`user_invite_requests` rows created/requested/consumed
/// since `since` -- the read behind `playarr_peer_sync::account_sync::
/// sync_invites`. `user_invites` cursors on `updated_at` (creation *or*
/// consumption -- see `UserInviteRepo::list_updated_since`'s doc comment);
/// `user_invite_requests` still has no `updated_at` and cursors on
/// `requested_at` only (see `UserInviteRequestRepo::list_requested_since`'s
/// doc comment). The consumer side (`sync_invites`) applies both plain
/// append/forward-apply, not full last-writer-wins -- see that function's
/// own doc comment.
#[utoipa::path(
    get,
    path = "/api/v1/peer/invites",
    tag = "peer-groups",
    params(SinceQueryParams),
    responses(
        (status = 200, description = "user_invites/user_invite_requests rows created/requested/consumed since the given cursor", body = InvitesResponse),
        (status = 400, description = "Malformed since cursor"),
        (status = 401, description = "Missing/invalid peer signature, or an unknown/left peer")
    )
)]
pub async fn invites_handler(
    State(state): State<AppState>,
    Query(params): Query<SinceQueryParams>,
    _peer: PeerSignedRequest,
) -> Result<Json<InvitesResponse>, ApiError> {
    let since = parse_since(params.since.as_deref())?;
    let now = Utc::now();

    let invites = state
        .user_invite_repo
        .list_updated_since(since)
        .await
        .map_err(|err| ApiError::internal(format!("failed to list invites for peer sync: {err}")))?
        .into_iter()
        .map(PeerInviteRow::from)
        .collect();

    let invite_requests = state
        .user_invite_request_repo
        .list_requested_since(since)
        .await
        .map_err(|err| {
            ApiError::internal(format!(
                "failed to list invite requests for peer sync: {err}"
            ))
        })?
        .into_iter()
        .map(PeerInviteRequestRow::from)
        .collect();

    Ok(Json(InvitesResponse {
        invites,
        invite_requests,
        server_time: cursor(now),
    }))
}

// ---------------------------------------------------------------------
// GET /api/v1/peer/libraries?since=
// ---------------------------------------------------------------------

/// Response body for [`libraries_handler`] -- `docs/architecture/
/// peer-groups.md` §3.6: complete `source_instances` rows plus
/// `group_libraries`.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct LibrariesResponse {
    pub source_instances: Vec<SourceInstanceSyncRow>,
    pub group_libraries: Vec<GroupLibrary>,
    pub server_time: String,
}

/// This node's own complete `source_instances` + this group's
/// `group_libraries`, both updated since `since` -- the read behind
/// `playarr_peer_sync::account_sync::sync_libraries`.
#[utoipa::path(
    get,
    path = "/api/v1/peer/libraries",
    tag = "peer-groups",
    params(SinceQueryParams),
    responses(
        (status = 200, description = "source_instances + group_libraries updated since the given cursor", body = LibrariesResponse),
        (status = 400, description = "Malformed since cursor"),
        (status = 401, description = "Missing/invalid peer signature, or an unknown/left peer")
    )
)]
pub async fn libraries_handler(
    State(state): State<AppState>,
    Query(params): Query<SinceQueryParams>,
    _peer: PeerSignedRequest,
) -> Result<Json<LibrariesResponse>, ApiError> {
    let since = parse_since(params.since.as_deref())?;
    let now = Utc::now();
    let self_peer_id = this_node_peer_id(&state).await?;

    let source_instances = state
        .source_instance_repo
        .list_updated_since(since)
        .await
        .map_err(|err| {
            ApiError::internal(format!(
                "failed to list source instances for peer sync: {err}"
            ))
        })?
        .into_iter()
        .map(|(instance, metadata)| {
            SourceInstanceSyncRow::from_instance(
                instance,
                metadata.updated_at,
                metadata.origin_peer_id.or(Some(self_peer_id)),
                metadata.deleted_at,
            )
        })
        .collect();

    let group_id = this_node_group_id(&state).await?;
    let group_libraries = state
        .group_library_repo
        .list_updated_since(group_id, since)
        .await
        .map_err(|err| {
            ApiError::internal(format!(
                "failed to list group libraries for peer sync: {err}"
            ))
        })?;

    Ok(Json(LibrariesResponse {
        source_instances,
        group_libraries,
        server_time: cursor(now),
    }))
}

// ---------------------------------------------------------------------
// GET /api/v1/peer/availability?since=
// ---------------------------------------------------------------------

/// Wire shape of one derived leaf-availability row -- field-for-field
/// identical to `playarr_peer_sync::availability_sync::AvailabilityRow`.
/// Reuses `playarr_model::{ExternalProvider, Availability, LeafSelector,
/// WorkKind}` directly (all `ToSchema`, none secret): one shared type on
/// both ends for each of those fields, so there is nothing for this DTO's
/// definition to drift out of sync with.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PeerAvailabilityRow {
    pub media_file_id: Uuid,
    pub source_instance_id: Uuid,
    pub path: String,
    pub provider: ExternalProvider,
    pub external_id: String,
    pub leaf_selector: LeafSelector,
    pub group_library_id: Option<Uuid>,
    pub availability: Availability,
    pub container: Option<String>,
    pub codec: Option<String>,
    pub bitrate: Option<u64>,
    pub size_bytes: Option<u64>,
    pub duration_ms: Option<u64>,
    pub updated_at: DateTime<Utc>,
    pub title: String,
    pub kind: WorkKind,
    pub release_date: Option<DateTime<Utc>>,
}

/// Response body for [`availability_handler`].
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct AvailabilityResponse {
    pub rows: Vec<PeerAvailabilityRow>,
    pub server_time: String,
}

/// Derives this node's own `peer_leaf_availability`-shaped rows, live, from
/// its own `WorkRepo`/`MediaFileRepo`/`SourceInstanceRepo` (joined to
/// `group_library_id` via `source_instances.group_library_id`) --
/// `docs/architecture/peer-groups.md` §3.6's table entry for this
/// endpoint. This is deliberately **not** a read of the local
/// `peer_leaf_availability` table: that table only ever stores what OTHER
/// peers report (see `playarr_db::repo::peer_leaf_availability`'s own
/// module doc comment: "Never written for `peer_node_id` = self"). `since`
/// has no meaning here and is ignored (see [`availability_handler`]'s own
/// doc comment) -- every call recomputes the full, current set.
/// A replicated `MediaFile` row is only catalogue metadata: its source path,
/// after applying this peer's root mapping when configured, must also resolve
/// to a regular file visible to this process before the leaf is advertised.
///
/// Per-leaf tree shape (season/episode numbers, disc/track numbers, a
/// book's ordinal position) comes from `AppState::catalog`
/// (`CatalogService::get_by_id`), the same already-tested "full kind-
/// specific tree" read `catalog.rs`'s own `get_work_handler` uses --
/// deliberately reused rather than re-querying `seasons`/`episodes`/
/// `albums`/`tracks`/`books` directly from this crate, which has never
/// touched a raw `DbPool` in a production handler (see this crate's own
/// `repo/mod.rs`-equivalent discipline: depend on repository/service
/// traits, not `sqlx`, outside `playarr-db` itself). Container/codec/
/// bitrate/size/duration and `source_instance_id` (for the
/// `group_library_id` join) come from the underlying `MediaFile` row
/// itself, via `MediaFileRepo::get_by_id`, since `CatalogService`'s tree
/// doesn't carry those fields.
///
/// Only works carrying at least one `ExternalRef` are represented (§4.2:
/// the external ref is the only thing portable across peers at all -- a
/// work with zero refs has nothing to key a wire row on). Of a work's
/// (possibly several) external refs, only the first (stored
/// provider-sorted -- see `SqlxWorkRepo::load_external_refs`) is used per
/// leaf: a deliberate simplification over emitting one row per
/// `(leaf, ref)` pair, kept fully deterministic by that same stored
/// ordering.
///
/// One work/leaf that fails to resolve (e.g. deleted between the initial
/// `list_work_ids` scan and this read) is logged and skipped, never fails
/// the whole response -- the same best-effort philosophy `arr-sync`'s own
/// `best_effort` flag already encodes.
/// The `(media_file_id, LeafSelector)` pair for every playable leaf in
/// `detail`'s kind-specific tree -- the exact per-kind walk
/// [`derive_own_availability`] needs for every work in the whole catalog,
/// factored out so a *single*-work caller (`playback::resolve_leaf_identity`,
/// Phase 3's routing-context gathering, and `playback::
/// resolve_local_media_file_for_leaf`, the `RemoteOnlyWork` lookup direction)
/// can reuse the identical mapping instead of re-deriving it -- one algorithm
/// for "what `LeafSelector` does this `media_file_id` have" in both
/// directions, never two independently maintained ones. Pure, no I/O of its
/// own: `detail` is already fully resolved by the caller.
pub(crate) fn leaf_selectors_for(
    detail: &playarr_catalog::WorkDetail,
) -> Vec<(Uuid, LeafSelector)> {
    let mut leaves: Vec<(Uuid, LeafSelector)> = Vec::new();
    match &detail.children {
        WorkChildren::Movie => {
            if let Some(media_file_id) = detail.media_file_id {
                leaves.push((media_file_id, LeafSelector::Movie));
            }
        }
        WorkChildren::Series(seasons) => {
            for season_detail in seasons {
                let Ok(season_number) = u32::try_from(season_detail.season.season_number) else {
                    continue;
                };
                for episode_detail in &season_detail.episodes {
                    let Some(media_file_id) = episode_detail.media_file_id else {
                        continue;
                    };
                    let Ok(episode_number) = u32::try_from(episode_detail.episode.episode_number)
                    else {
                        continue;
                    };
                    leaves.push((
                        media_file_id,
                        LeafSelector::Episode {
                            season: season_number,
                            episode: episode_number,
                        },
                    ));
                }
            }
        }
        WorkChildren::Artist(albums) => {
            for album_detail in albums {
                for track_detail in &album_detail.tracks {
                    let Some(media_file_id) = track_detail.media_file_id else {
                        continue;
                    };
                    leaves.push((
                        media_file_id,
                        LeafSelector::Track {
                            disc: Some(track_detail.track.disc_number),
                            track: track_detail.track.track_number,
                        },
                    ));
                }
            }
        }
        WorkChildren::Author(books) => {
            for (index, book_detail) in books.iter().enumerate() {
                let Some(media_file_id) = book_detail.media_file_id else {
                    continue;
                };
                leaves.push((
                    media_file_id,
                    LeafSelector::Book {
                        index: index as u32,
                    },
                ));
            }
        }
    }
    leaves
}

async fn derive_own_availability(
    state: &AppState,
    now: DateTime<Utc>,
) -> Result<Vec<PeerAvailabilityRow>, ApiError> {
    let self_peer_id = this_node_peer_id(state).await?;
    let sources: HashMap<Uuid, playarr_model::SourceInstance> = state
        .source_instance_repo
        .list_all()
        .await
        .map_err(|err| ApiError::internal(format!("failed to list source instances: {err}")))?
        .into_iter()
        .map(|instance| (instance.id, instance))
        .collect();

    let work_ids =
        state.media_file_repo.list_work_ids().await.map_err(|err| {
            ApiError::internal(format!("failed to list media file work ids: {err}"))
        })?;

    let mut rows = Vec::new();
    for work_id in work_ids {
        let work = match state.work_repo.get(work_id).await {
            Ok(work) => work,
            Err(err) => {
                tracing::warn!(%work_id, error = %err, "skipping work while deriving live peer availability");
                continue;
            }
        };
        let Some(external_ref) = work.external_refs.first() else {
            continue;
        };

        let detail = match state.catalog.get_by_id(work_id, None).await {
            Ok(detail) => detail,
            Err(err) => {
                tracing::warn!(%work_id, error = %err, "skipping work while deriving live peer availability");
                continue;
            }
        };

        let leaves = leaf_selectors_for(&detail);

        for (media_file_id, leaf_selector) in leaves {
            let media_file = match state.media_file_repo.get_by_id(media_file_id).await {
                Ok(file) => file,
                Err(err) => {
                    tracing::warn!(%media_file_id, error = %err, "skipping leaf while deriving live peer availability");
                    continue;
                }
            };
            let Some(source) = sources.get(&media_file.source_instance_id) else {
                continue;
            };
            let reported_path = media_file.path.to_string_lossy().into_owned();
            if existing_physical_file(source, self_peer_id, &reported_path)
                .await
                .is_none()
            {
                continue;
            }

            rows.push(PeerAvailabilityRow {
                media_file_id: media_file.id,
                source_instance_id: media_file.source_instance_id,
                path: reported_path,
                provider: external_ref.provider.clone(),
                external_id: external_ref.external_id.clone(),
                leaf_selector,
                group_library_id: source.group_library_id,
                // Replicated catalogue rows are not proof that this peer
                // holds the media. A row only reaches this point after its
                // peer-mapped physical path was verified as a regular file.
                availability: Availability::Available,
                container: Some(media_file.container.clone()),
                codec: Some(media_file.codec.clone()),
                bitrate: media_file.bitrate,
                size_bytes: Some(media_file.size_bytes),
                duration_ms: media_file.duration_ms,
                updated_at: now,
                title: work.title.clone(),
                kind: work.kind,
                release_date: work.release_date,
            });
        }
    }

    Ok(rows)
}

/// This peer's own leaf availability, derived live -- see
/// [`derive_own_availability`]'s doc comment. `since` is accepted (for
/// wire compatibility with every other `?since=` endpoint the poller
/// calls identically) but ignored: there is no per-leaf `updated_at` to
/// filter on, so every call is already a full, safe-to-reapply refresh,
/// the same full-refresh strategy §3.6 uses for `GET /api/v1/peer/nodes`.
#[utoipa::path(
    get,
    path = "/api/v1/peer/availability",
    tag = "peer-groups",
    params(SinceQueryParams),
    responses(
        (status = 200, description = "This peer's own leaf-level availability, derived live from its own MediaFileRepo", body = AvailabilityResponse),
        (status = 401, description = "Missing/invalid peer signature, or an unknown/left peer")
    )
)]
pub async fn availability_handler(
    State(state): State<AppState>,
    Query(_params): Query<SinceQueryParams>,
    _peer: PeerSignedRequest,
) -> Result<Json<AvailabilityResponse>, ApiError> {
    let now = Utc::now();
    let rows = derive_own_availability(&state, now).await?;
    Ok(Json(AvailabilityResponse {
        rows,
        server_time: cursor(now),
    }))
}

// ---------------------------------------------------------------------
// GET /api/v1/peer/routing-rules?since=
// ---------------------------------------------------------------------

/// Response body for [`routing_rules_handler`] -- `docs/architecture/
/// peer-groups.md` §3.6: `routing_rules` rows. `RoutingRule` is reused
/// directly (see this module's own "wire-shape discipline" doc comment):
/// it carries no secret and already stamps its own `created_at`/
/// `updated_at`, so there is no separate sync-metadata envelope to define
/// here the way [`PeerUserRow`]/[`PeerPolicyRow`] need for `User`/`Policy`.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct RoutingRulesResponse {
    pub rows: Vec<RoutingRule>,
    pub server_time: String,
}

/// This group's `routing_rules` updated since `since` (every row, oldest
/// first, when omitted) -- the read behind `playarr_peer_sync::
/// routing_sync::sync_routing_rules`. Plain last-writer-wins by
/// `updated_at` on the consumer side, no origin-gating: see that module's
/// own doc comment for why a routing preference isn't a privilege-bearing
/// field the way `Policy`'s `is_admin`/`can_stream`/... are.
#[utoipa::path(
    get,
    path = "/api/v1/peer/routing-rules",
    tag = "peer-groups",
    params(SinceQueryParams),
    responses(
        (status = 200, description = "routing_rules rows updated since the given cursor", body = RoutingRulesResponse),
        (status = 400, description = "Malformed since cursor"),
        (status = 401, description = "Missing/invalid peer signature, or an unknown/left peer")
    )
)]
pub async fn routing_rules_handler(
    State(state): State<AppState>,
    Query(params): Query<SinceQueryParams>,
    _peer: PeerSignedRequest,
) -> Result<Json<RoutingRulesResponse>, ApiError> {
    let since = parse_since(params.since.as_deref())?;
    let now = Utc::now();

    let group_id = this_node_group_id(&state).await?;
    let rows = state
        .routing_rule_repo
        .list_updated_since(group_id, since)
        .await
        .map_err(|err| {
            ApiError::internal(format!("failed to list routing rules for peer sync: {err}"))
        })?;

    Ok(Json(RoutingRulesResponse {
        rows,
        server_time: cursor(now),
    }))
}

// ---------------------------------------------------------------------
// POST /api/v1/peer/sync-push
// ---------------------------------------------------------------------

/// Accepts the same signed entity pages as the pull endpoints, in one
/// aggregate request. This is the receiving half of outbound-only node
/// support: a node behind NAT publishes to a reachable peer, while its
/// existing pull poller retrieves changes in the opposite direction.
#[utoipa::path(
    post,
    path = "/api/v1/peer/sync-push",
    tag = "peer-groups",
    responses(
        (status = 200, description = "Pushed peer sync pages accepted"),
        (status = 400, description = "Malformed pushed sync payload"),
        (status = 401, description = "Missing/invalid peer signature, or an unknown/left peer")
    )
)]
pub async fn push_sync_handler(
    State(state): State<AppState>,
    peer: PeerSignedRequest,
) -> Result<Json<playarr_peer_sync::PushSyncResponse>, ApiError> {
    let request: playarr_peer_sync::PushSyncRequest = serde_json::from_slice(&peer.body)
        .map_err(|err| ApiError::bad_request(format!("invalid peer sync push: {err}")))?;
    let self_peer_id = state
        .node_identity_repo
        .get()
        .await
        .map_err(|err| ApiError::internal(format!("failed to load node identity: {err}")))?
        .ok_or_else(|| ApiError::internal("node identity is missing"))?
        .peer_id;

    let response = playarr_peer_sync::apply_push(
        request,
        peer.peer.id,
        self_peer_id,
        &state.peer_node_repo,
        &state.user_repo,
        &state.policy_repo,
        &state.group_library_repo,
        &state.source_instance_repo,
        &state.user_invite_repo,
        &state.user_invite_request_repo,
        &state.work_repo,
        &state.peer_leaf_availability_repo,
        &state.routing_rule_repo,
        &state.peer_sync_state_repo,
        &state.sync_conflict_log_repo,
    )
    .await
    .map_err(|err| ApiError::internal(format!("failed to apply peer sync push: {err}")))?;

    // Make pushed rows visible through the normal Admin source endpoint
    // immediately, without waiting for the worker supervisor's next tick.
    let active =
        state.source_instance_repo.list_all().await.map_err(|err| {
            ApiError::internal(format!("failed to refresh source instances: {err}"))
        })?;
    let active_ids: HashSet<Uuid> = active.iter().map(|instance| instance.id).collect();
    for instance in active {
        state.source_instances.upsert(instance);
    }
    for existing in state.source_instances.all() {
        if !active_ids.contains(&existing.id) {
            state.source_instances.remove(existing.id);
        }
    }

    Ok(Json(response))
}

async fn build_push_request(
    state: &AppState,
    since: Option<DateTime<Utc>>,
) -> Result<playarr_peer_sync::PushSyncRequest, ApiError> {
    use playarr_peer_sync::{account_sync, availability_sync, membership_sync, routing_sync};

    let now = Utc::now();
    let server_time = cursor(now);
    let group_id = this_node_group_id(state).await?;
    let self_peer_id = this_node_peer_id(state).await?;

    let membership = membership_sync::NodesResponse {
        rows: state
            .peer_node_repo
            .list_all()
            .await
            .map_err(|err| ApiError::internal(format!("failed to list peer nodes: {err}")))?,
    };
    let accounts = account_sync::AccountsResponse {
        users: state
            .user_repo
            .list_updated_since(since)
            .await
            .map_err(|err| ApiError::internal(format!("failed to list users: {err}")))?
            .into_iter()
            .map(|(user, metadata)| account_sync::UserSyncRow {
                user,
                updated_at: metadata.updated_at,
                origin_peer_id: metadata.origin_peer_id,
                deleted_at: metadata.deleted_at,
            })
            .collect(),
        policies: state
            .policy_repo
            .list_updated_since(since)
            .await
            .map_err(|err| ApiError::internal(format!("failed to list policies: {err}")))?
            .into_iter()
            .map(|(policy, metadata)| account_sync::PolicySyncRow {
                policy,
                updated_at: metadata.updated_at,
                origin_peer_id: metadata.origin_peer_id,
                deleted_at: metadata.deleted_at,
            })
            .collect(),
        server_time: server_time.clone(),
    };
    let invites = account_sync::InvitesResponse {
        invites: state
            .user_invite_repo
            .list_updated_since(since)
            .await
            .map_err(|err| ApiError::internal(format!("failed to list invites: {err}")))?,
        invite_requests: state
            .user_invite_request_repo
            .list_requested_since(since)
            .await
            .map_err(|err| ApiError::internal(format!("failed to list invite requests: {err}")))?,
        server_time: server_time.clone(),
    };
    let libraries = account_sync::LibrariesResponse {
        source_instances: state
            .source_instance_repo
            .list_updated_since(since)
            .await
            .map_err(|err| ApiError::internal(format!("failed to list source instances: {err}")))?
            .into_iter()
            .map(|(instance, metadata)| {
                SourceInstanceSyncRow::from_instance(
                    instance,
                    metadata.updated_at,
                    metadata.origin_peer_id.or(Some(self_peer_id)),
                    metadata.deleted_at,
                )
            })
            .collect(),
        group_libraries: state
            .group_library_repo
            .list_updated_since(group_id, since)
            .await
            .map_err(|err| ApiError::internal(format!("failed to list group libraries: {err}")))?,
        server_time: server_time.clone(),
    };
    let availability = availability_sync::AvailabilityResponse {
        rows: derive_own_availability(state, now)
            .await?
            .into_iter()
            .map(|row| availability_sync::AvailabilityRow {
                media_file_id: row.media_file_id,
                source_instance_id: row.source_instance_id,
                path: row.path,
                provider: row.provider,
                external_id: row.external_id,
                leaf_selector: row.leaf_selector,
                group_library_id: row.group_library_id,
                availability: row.availability,
                container: row.container,
                codec: row.codec,
                bitrate: row.bitrate,
                size_bytes: row.size_bytes,
                duration_ms: row.duration_ms,
                updated_at: row.updated_at,
                title: row.title,
                kind: row.kind,
                release_date: row.release_date,
            })
            .collect(),
        server_time: server_time.clone(),
    };
    let routing_rules = routing_sync::RoutingRulesResponse {
        rows: state
            .routing_rule_repo
            .list_updated_since(group_id, since)
            .await
            .map_err(|err| ApiError::internal(format!("failed to list routing rules: {err}")))?,
        server_time,
    };

    Ok(playarr_peer_sync::PushSyncRequest {
        membership,
        accounts,
        invites,
        libraries,
        availability,
        routing_rules,
    })
}

/// Continuously publishes this node's local changes to every reachable peer.
/// Pull remains active independently, so one successful outbound direction is
/// enough for two-way convergence when the remote node cannot dial back.
pub async fn run_push_sync_loop(
    state: AppState,
    peer_client: playarr_peer_sync::PeerClient,
    poll_interval: Duration,
) {
    let mut interval = tokio::time::interval(poll_interval);
    loop {
        interval.tick().await;
        let peers = match state.peer_node_repo.list_others().await {
            Ok(peers) => peers,
            Err(err) => {
                tracing::warn!(error = %err, "failed to list peers for push sync");
                continue;
            }
        };

        for peer in peers.into_iter().filter(is_active_push_target) {
            let lock_key = format!("peer-push:{}", peer.id);
            let _guard = match state.coordinator.try_lock(&lock_key, poll_interval).await {
                Ok(Some(guard)) => guard,
                Ok(None) => continue,
                Err(err) => {
                    tracing::warn!(peer_node_id = %peer.id, error = %err, "failed to acquire peer push lock");
                    continue;
                }
            };
            let push_cursor = match state.peer_sync_state_repo.get(peer.id, "push").await {
                Ok(value) => value.and_then(|value| value.cursor),
                Err(err) => {
                    tracing::warn!(peer_node_id = %peer.id, error = %err, "failed to load push cursor");
                    continue;
                }
            };
            let since = match parse_since(push_cursor.as_deref()) {
                Ok(since) => since,
                Err(err) => {
                    tracing::warn!(peer_node_id = %peer.id, error = %err.body.message, "stored push cursor is invalid");
                    continue;
                }
            };
            let request = match build_push_request(&state, since).await {
                Ok(request) => request,
                Err(err) => {
                    tracing::warn!(peer_node_id = %peer.id, error = %err.body.message, "failed to build push sync payload");
                    continue;
                }
            };
            let next_cursor = request.accounts.server_time.clone();
            let mut delivered = false;
            for address in peer_client.addresses_for_peer(peer.id, &peer.addresses) {
                match peer_client
                    .signed_post::<_, playarr_peer_sync::PushSyncResponse>(
                        &address,
                        "/api/v1/peer/sync-push",
                        &request,
                    )
                    .await
                {
                    Ok(_) => {
                        delivered = true;
                        break;
                    }
                    Err(err) => tracing::warn!(
                        peer_node_id = %peer.id,
                        %address,
                        error = %err,
                        "peer push failed at this address; trying the next one"
                    ),
                }
            }
            if delivered {
                if let Err(err) = state
                    .peer_sync_state_repo
                    .upsert(&playarr_db::PeerSyncState {
                        peer_node_id: peer.id,
                        entity: "push".to_string(),
                        cursor: Some(next_cursor),
                        last_synced_at: Some(Utc::now()),
                    })
                    .await
                {
                    tracing::warn!(peer_node_id = %peer.id, error = %err, "push succeeded but its cursor could not be saved");
                }
            }
        }
    }
}

fn is_active_push_target(peer: &PeerNode) -> bool {
    peer.status == PeerNodeStatus::Active
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    use super::*;
    use crate::test_support::test_state;

    #[test]
    fn push_fanout_skips_unreachable_and_left_peers() {
        let mut peer = PeerNode {
            id: Uuid::new_v4(),
            group_id: Uuid::new_v4(),
            name: "remote".to_string(),
            addresses: Vec::new(),
            public_key: "key".to_string(),
            is_self: false,
            status: PeerNodeStatus::Active,
            last_seen_at: None,
            last_sync_error: None,
            joined_at: Utc::now(),
            updated_at: Utc::now(),
        };
        assert!(is_active_push_target(&peer));

        peer.status = PeerNodeStatus::Unreachable;
        assert!(!is_active_push_target(&peer));
        peer.status = PeerNodeStatus::Left;
        assert!(!is_active_push_target(&peer));
    }

    async fn seed_group_and_token(
        state: &crate::test_support::TestState,
        admin_id: Uuid,
    ) -> (Uuid, String) {
        let group = PeerGroup {
            id: Uuid::new_v4(),
            name: "Home Group".to_string(),
            created_at: Utc::now(),
        };
        state.app.peer_group_repo.create(&group).await.unwrap();

        let raw_token = "test-join-token";
        state
            .app
            .peer_join_token_repo
            .create(&playarr_db::PeerJoinToken {
                token_hash: playarr_auth::secret::hash_token(raw_token),
                group_id: group.id,
                created_by: admin_id,
                created_at: Utc::now(),
                expires_at: Utc::now() + chrono::Duration::minutes(15),
                redeemed_by_peer_id: None,
            })
            .await
            .unwrap();

        (group.id, raw_token.to_string())
    }

    fn enroll_request(body: &EnrollRequest) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri("/api/v1/peer/enroll")
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(body).unwrap()))
            .unwrap()
    }

    #[tokio::test]
    async fn signed_leave_notification_marks_only_the_calling_peer_left() {
        let (_router, state) = test_state().await;
        let group = PeerGroup {
            id: Uuid::new_v4(),
            name: "Home Group".to_string(),
            created_at: Utc::now(),
        };
        state.app.peer_group_repo.create(&group).await.unwrap();
        let now = Utc::now();
        let peer = PeerNode {
            id: Uuid::new_v4(),
            group_id: group.id,
            name: "east".to_string(),
            addresses: vec![],
            public_key: "peer-pubkey".to_string(),
            is_self: false,
            status: PeerNodeStatus::Active,
            last_seen_at: Some(now),
            last_sync_error: None,
            joined_at: now,
            updated_at: now,
        };
        state.app.peer_node_repo.upsert(&peer).await.unwrap();

        let status = leave_notification_handler(
            State(state.app.clone()),
            Path(peer.id),
            PeerSignedRequest {
                peer: peer.clone(),
                body: axum::body::Bytes::new(),
            },
        )
        .await
        .unwrap();

        assert_eq!(status, StatusCode::NO_CONTENT);
        assert_eq!(
            state
                .app
                .peer_node_repo
                .get(peer.id)
                .await
                .unwrap()
                .unwrap()
                .status,
            PeerNodeStatus::Left
        );
    }

    #[tokio::test]
    async fn enroll_persists_the_joining_peer_and_returns_full_membership() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        crate::test_support::seed_admin_user(&state, admin_id).await;
        let (group_id, raw_token) = seed_group_and_token(&state, admin_id).await;

        // A self row, as if this node had already founded the group.
        let self_id = Uuid::new_v4();
        let now = Utc::now();
        state
            .app
            .peer_node_repo
            .upsert(&PeerNode {
                id: self_id,
                group_id,
                name: "home".to_string(),
                addresses: vec![],
                public_key: "self-pubkey".to_string(),
                is_self: true,
                status: PeerNodeStatus::Active,
                last_seen_at: Some(now),
                last_sync_error: None,
                joined_at: now,
                updated_at: now,
            })
            .await
            .unwrap();

        let joining_peer_id = Uuid::new_v4();
        let response = router
            .oneshot(enroll_request(&EnrollRequest {
                join_token: raw_token,
                peer_id: joining_peer_id,
                name: "east".to_string(),
                addresses: vec![],
                public_key: "east-pubkey".to_string(),
            }))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: EnrollResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body.group.id, group_id);
        assert_eq!(body.members.len(), 2);
        assert!(body.members.iter().any(|m| m.id == self_id && m.is_self));
        assert!(body
            .members
            .iter()
            .any(|m| m.id == joining_peer_id && !m.is_self));

        let persisted = state
            .app
            .peer_join_token_repo
            .find_valid(
                &playarr_auth::secret::hash_token("test-join-token"),
                Utc::now(),
            )
            .await
            .unwrap();
        assert!(persisted.is_none(), "token must be consumed, not reusable");
    }

    #[tokio::test]
    async fn enroll_rejects_an_unknown_token() {
        let (router, _state) = test_state().await;
        let response = router
            .oneshot(enroll_request(&EnrollRequest {
                join_token: "does-not-exist".to_string(),
                peer_id: Uuid::new_v4(),
                name: "east".to_string(),
                addresses: vec![],
                public_key: "east-pubkey".to_string(),
            }))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::GONE);
    }

    #[tokio::test]
    async fn enroll_rejects_a_colliding_peer_id_without_burning_the_token_or_overwriting_the_key() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        crate::test_support::seed_admin_user(&state, admin_id).await;
        let (group_id, raw_token) = seed_group_and_token(&state, admin_id).await;

        let victim_id = Uuid::new_v4();
        let now = Utc::now();
        state
            .app
            .peer_node_repo
            .upsert(&PeerNode {
                id: victim_id,
                group_id,
                name: "east".to_string(),
                addresses: vec![],
                public_key: "legitimate-pubkey".to_string(),
                is_self: false,
                status: PeerNodeStatus::Active,
                last_seen_at: Some(now),
                last_sync_error: None,
                joined_at: now,
                updated_at: now,
            })
            .await
            .unwrap();

        // An attacker holding a valid (but unrelated) join token tries to
        // re-enroll under the victim's already-taken peer_id, with a public
        // key they control.
        let response = router
            .oneshot(enroll_request(&EnrollRequest {
                join_token: raw_token.clone(),
                peer_id: victim_id,
                name: "east-impostor".to_string(),
                addresses: vec![],
                public_key: "attacker-controlled-pubkey".to_string(),
            }))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);

        let unchanged = state
            .app
            .peer_node_repo
            .get(victim_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            unchanged.public_key, "legitimate-pubkey",
            "the victim's real public key must not be overwritten"
        );

        let still_valid = state
            .app
            .peer_join_token_repo
            .find_valid(&playarr_auth::secret::hash_token(&raw_token), Utc::now())
            .await
            .unwrap();
        assert!(
            still_valid.is_some(),
            "the token must not be burned by a rejected enroll"
        );
    }

    #[tokio::test]
    async fn enroll_rejects_a_colliding_name_without_burning_the_token() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        crate::test_support::seed_admin_user(&state, admin_id).await;
        let (group_id, raw_token) = seed_group_and_token(&state, admin_id).await;

        let now = Utc::now();
        state
            .app
            .peer_node_repo
            .upsert(&PeerNode {
                id: Uuid::new_v4(),
                group_id,
                name: "east".to_string(),
                addresses: vec![],
                public_key: "existing-pubkey".to_string(),
                is_self: false,
                status: PeerNodeStatus::Active,
                last_seen_at: Some(now),
                last_sync_error: None,
                joined_at: now,
                updated_at: now,
            })
            .await
            .unwrap();

        let response = router
            .oneshot(enroll_request(&EnrollRequest {
                join_token: raw_token.clone(),
                peer_id: Uuid::new_v4(),
                name: "east".to_string(),
                addresses: vec![],
                public_key: "new-pubkey".to_string(),
            }))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);

        // The token must still be valid -- the collision was rejected
        // before consuming it.
        let still_valid = state
            .app
            .peer_join_token_repo
            .find_valid(&playarr_auth::secret::hash_token(&raw_token), Utc::now())
            .await
            .unwrap();
        assert!(still_valid.is_some());
    }
}

#[cfg(test)]
mod sync_endpoint_tests {
    use axum::body::Body;
    use axum::http::{Method, Request};
    use base64::Engine;
    use chrono::Duration;
    use ed25519_dalek::{Signer, SigningKey};
    use playarr_model::media::LeafRef;
    use playarr_model::{
        ClientPlatform, ExternalRef, NodeIdentity, Sensitive, SourceInstance, Work,
    };
    use sha2::{Digest, Sha256};
    use tower::ServiceExt;

    use super::*;
    use crate::peer_extractor::{NONCE_HEADER, PEER_ID_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER};
    use crate::test_support::{seed_media_file, test_state, TestState};

    fn signing_key() -> SigningKey {
        SigningKey::from_bytes(&[42u8; 32])
    }

    /// Seeds a `peer_groups` row, an active `peer_nodes` row for `peer_id`
    /// (signed with `key`), and this node's own `node_identity` pointed at
    /// that same group -- everything [`PeerSignedRequest`] plus
    /// `this_node_group_id` need. Deliberately not shared with
    /// `peer_extractor.rs`'s own private `seed_peer` test helper: that
    /// helper is intentionally module-private (same reasoning
    /// `admin_peer.rs`'s doc comment gives for `EnrollResponse` not being
    /// shared 1:1 with `playarr_peer_sync::EnrollResponse` -- distinct
    /// types/helpers per module, identical shape).
    async fn seed_group_and_signed_peer(
        state: &TestState,
        peer_id: Uuid,
        key: &SigningKey,
    ) -> Uuid {
        let group_id = Uuid::new_v4();
        state
            .app
            .peer_group_repo
            .create(&PeerGroup {
                id: group_id,
                name: "test group".to_string(),
                created_at: Utc::now(),
            })
            .await
            .unwrap();

        let now = Utc::now();
        state
            .app
            .peer_node_repo
            .upsert(&PeerNode {
                id: peer_id,
                group_id,
                name: "east".to_string(),
                addresses: vec![PeerAddress {
                    url: "https://east.example.com".to_string(),
                    priority: 0,
                    label: "wan".to_string(),
                    client_reachable: true,
                }],
                public_key: base64::engine::general_purpose::STANDARD
                    .encode(key.verifying_key().to_bytes()),
                is_self: false,
                status: PeerNodeStatus::Active,
                last_seen_at: Some(now),
                last_sync_error: None,
                joined_at: now,
                updated_at: now,
            })
            .await
            .unwrap();

        state
            .app
            .node_identity_repo
            .put(&NodeIdentity {
                peer_id: Uuid::new_v4(),
                private_key: Sensitive::new("unused-in-these-tests".to_string()),
                group_id: Some(group_id),
                created_at: now,
            })
            .await
            .unwrap();

        group_id
    }

    /// Builds a validly-signed `GET` request -- same canonical string
    /// (`method|path|sha256(body)|timestamp|nonce`) `peer_extractor.rs`'s
    /// own (module-private) test helper signs, reimplemented here rather
    /// than reused across the module boundary.
    fn signed_get(path: &str, peer_id: Uuid, key: &SigningKey) -> Request<Body> {
        let body_hash = hex::encode(Sha256::digest(b""));
        let timestamp = Utc::now().timestamp().to_string();
        let nonce = "test-nonce";
        let signed = format!("GET|{path}|{body_hash}|{timestamp}|{nonce}");
        let signature = key.sign(signed.as_bytes());

        Request::builder()
            .method("GET")
            .uri(path)
            .header(PEER_ID_HEADER, peer_id.to_string())
            .header(
                SIGNATURE_HEADER,
                base64::engine::general_purpose::STANDARD.encode(signature.to_bytes()),
            )
            .header(TIMESTAMP_HEADER, timestamp)
            .header(NONCE_HEADER, nonce)
            .body(Body::empty())
            .unwrap()
    }

    fn signed_post<T: Serialize>(
        path: &str,
        payload: &T,
        peer_id: Uuid,
        key: &SigningKey,
    ) -> Request<Body> {
        let body = serde_json::to_vec(payload).unwrap();
        let body_hash = hex::encode(Sha256::digest(&body));
        let timestamp = Utc::now().timestamp().to_string();
        let nonce = "test-push-nonce";
        let signed = format!("POST|{path}|{body_hash}|{timestamp}|{nonce}");
        let signature = key.sign(signed.as_bytes());

        Request::builder()
            .method("POST")
            .uri(path)
            .header(PEER_ID_HEADER, peer_id.to_string())
            .header(
                SIGNATURE_HEADER,
                base64::engine::general_purpose::STANDARD.encode(signature.to_bytes()),
            )
            .header(TIMESTAMP_HEADER, timestamp)
            .header(NONCE_HEADER, nonce)
            .header("content-type", "application/json")
            .body(Body::from(body))
            .unwrap()
    }

    async fn body_json(response: axum::response::Response) -> serde_json::Value {
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn every_sync_endpoint_rejects_an_unsigned_request() {
        let (router, _state) = test_state().await;
        for (method, path) in [
            (Method::GET, "/api/v1/peer/nodes"),
            (Method::GET, "/api/v1/peer/accounts"),
            (Method::GET, "/api/v1/peer/invites"),
            (Method::GET, "/api/v1/peer/libraries"),
            (Method::GET, "/api/v1/peer/availability"),
            (Method::GET, "/api/v1/peer/routing-rules"),
            (Method::POST, "/api/v1/peer/sync-push"),
        ] {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(path)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(
                response.status(),
                StatusCode::UNAUTHORIZED,
                "expected {path} to reject an unsigned request"
            );
        }
    }

    #[tokio::test]
    async fn push_sync_accepts_accounts_from_an_outbound_only_peer() {
        use playarr_peer_sync::{account_sync, availability_sync, membership_sync, routing_sync};

        let (router, state) = test_state().await;
        let peer_id = Uuid::new_v4();
        let key = signing_key();
        seed_group_and_signed_peer(&state, peer_id, &key).await;
        let policy = sample_policy(Uuid::new_v4());
        let user = User {
            id: Uuid::new_v4(),
            username: format!("pushed-{}", Uuid::new_v4()),
            display_name: "Pushed User".to_string(),
            email: None,
            password_hash: Sensitive::new("pushed-password-hash".to_string()),
            policy_id: policy.id,
            created_at: Utc::now(),
            disabled: false,
            preferred_audio_language: "en".to_string(),
        };
        let server_time = Utc::now().timestamp_millis().to_string();
        let payload = playarr_peer_sync::PushSyncRequest {
            membership: membership_sync::NodesResponse {
                rows: state.app.peer_node_repo.list_all().await.unwrap(),
            },
            accounts: account_sync::AccountsResponse {
                users: vec![account_sync::UserSyncRow {
                    user: user.clone(),
                    updated_at: Utc::now(),
                    origin_peer_id: Some(peer_id),
                    deleted_at: None,
                }],
                policies: vec![account_sync::PolicySyncRow {
                    policy,
                    updated_at: Utc::now(),
                    origin_peer_id: Some(peer_id),
                    deleted_at: None,
                }],
                server_time: server_time.clone(),
            },
            invites: account_sync::InvitesResponse {
                invites: vec![],
                invite_requests: vec![],
                server_time: server_time.clone(),
            },
            libraries: account_sync::LibrariesResponse {
                source_instances: vec![],
                group_libraries: vec![],
                server_time: server_time.clone(),
            },
            availability: availability_sync::AvailabilityResponse {
                rows: vec![],
                server_time: server_time.clone(),
            },
            routing_rules: routing_sync::RoutingRulesResponse {
                rows: vec![],
                server_time: server_time.clone(),
            },
        };

        let response = router
            .oneshot(signed_post(
                "/api/v1/peer/sync-push",
                &payload,
                peer_id,
                &key,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let persisted = state
            .app
            .user_repo
            .find_by_id(user.id)
            .await
            .unwrap()
            .expect("pushed user must be applied");
        assert_eq!(persisted.id, user.id);
        assert_eq!(persisted.username, user.username);
        assert_eq!(persisted.policy_id, user.policy_id);
        assert_eq!(
            state
                .app
                .peer_sync_state_repo
                .get(peer_id, "accounts")
                .await
                .unwrap()
                .unwrap()
                .cursor
                .as_deref(),
            Some(server_time.as_str())
        );
    }

    #[tokio::test]
    async fn nodes_handler_returns_full_membership_including_self() {
        let (router, state) = test_state().await;
        let peer_id = Uuid::new_v4();
        let key = signing_key();
        let group_id = seed_group_and_signed_peer(&state, peer_id, &key).await;

        let self_id = Uuid::new_v4();
        let now = Utc::now();
        state
            .app
            .peer_node_repo
            .upsert(&PeerNode {
                id: self_id,
                group_id,
                name: "home".to_string(),
                addresses: vec![],
                public_key: "self-pubkey".to_string(),
                is_self: true,
                status: PeerNodeStatus::Active,
                last_seen_at: Some(now),
                last_sync_error: None,
                joined_at: now,
                updated_at: now,
            })
            .await
            .unwrap();

        let response = router
            .oneshot(signed_get("/api/v1/peer/nodes", peer_id, &key))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = body_json(response).await;
        let rows = body["rows"].as_array().unwrap();
        assert_eq!(rows.len(), 2);
        let ids: Vec<String> = rows
            .iter()
            .map(|r| r["id"].as_str().unwrap().to_string())
            .collect();
        assert!(ids.contains(&self_id.to_string()));
        assert!(ids.contains(&peer_id.to_string()));
    }

    fn sample_policy(id: Uuid) -> Policy {
        Policy {
            id,
            name: "Policy".to_string(),
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
            can_request: false,
            device_allow: vec![ClientPlatform::Web],
            max_concurrent_sessions: None,
            household: Default::default(),
            access_schedule: None,
            can_stream: true,
            is_admin: false,
        }
    }

    #[tokio::test]
    async fn accounts_handler_returns_users_and_policies_with_sync_metadata_and_respects_since() {
        let (router, state) = test_state().await;
        let peer_id = Uuid::new_v4();
        let key = signing_key();
        seed_group_and_signed_peer(&state, peer_id, &key).await;

        let policy_id = Uuid::new_v4();
        state
            .app
            .policy_repo
            .upsert(&sample_policy(policy_id))
            .await
            .unwrap();
        let user = User {
            id: Uuid::new_v4(),
            username: "sync-user".to_string(),
            display_name: "Sync User".to_string(),
            email: None,
            password_hash: Sensitive::new("argon2-hash-value".to_string()),
            policy_id,
            created_at: Utc::now(),
            disabled: false,
            preferred_audio_language: "en".to_string(),
        };
        state.app.user_repo.upsert(&user).await.unwrap();

        let response = router
            .clone()
            .oneshot(signed_get("/api/v1/peer/accounts", peer_id, &key))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = body_json(response).await;
        let users = body["users"].as_array().unwrap();
        let synced_user = users
            .iter()
            .find(|u| u["id"] == user.id.to_string())
            .unwrap();
        // The wire shape is `User`'s own fields flattened alongside the
        // sync-only ones -- exactly what `playarr_peer_sync::account_sync
        // ::UserSyncRow`'s `#[serde(flatten)]` deserializes.
        assert_eq!(synced_user["username"], "sync-user");
        assert_eq!(synced_user["password_hash"], "argon2-hash-value");
        assert!(synced_user["updated_at"].is_string());
        assert!(synced_user["deleted_at"].is_null());

        let policies = body["policies"].as_array().unwrap();
        let synced_policy = policies
            .iter()
            .find(|p| p["id"] == policy_id.to_string())
            .unwrap();
        assert_eq!(synced_policy["name"], "Policy");
        assert!(synced_policy["updated_at"].is_string());

        let server_time = body["server_time"].as_str().unwrap().to_string();
        assert!(
            server_time.parse::<i64>().is_ok(),
            "server_time must be a plain integer cursor"
        );

        // A second pass using the returned cursor must not re-report
        // either row -- proves `since` is actually applied, not ignored.
        let second_path = format!("/api/v1/peer/accounts?since={server_time}");
        let response = router
            .oneshot(signed_get(&second_path, peer_id, &key))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = body_json(response).await;
        assert!(body["users"].as_array().unwrap().is_empty());
        assert!(body["policies"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn invites_handler_returns_invites_and_invite_requests() {
        let (router, state) = test_state().await;
        let peer_id = Uuid::new_v4();
        let key = signing_key();
        seed_group_and_signed_peer(&state, peer_id, &key).await;

        let policy_id = Uuid::new_v4();
        state
            .app
            .policy_repo
            .upsert(&sample_policy(policy_id))
            .await
            .unwrap();
        let admin = User {
            id: Uuid::new_v4(),
            username: "invite-admin".to_string(),
            display_name: "Invite Admin".to_string(),
            email: None,
            password_hash: Sensitive::new("hash".to_string()),
            policy_id,
            created_at: Utc::now(),
            disabled: false,
            preferred_audio_language: "en".to_string(),
        };
        state.app.user_repo.upsert(&admin).await.unwrap();

        let group_library_id = Uuid::new_v4();
        let invite = UserInvite {
            token_hash: "a-token-hash".to_string(),
            created_by: admin.id,
            created_at: Utc::now(),
            expires_at: Utc::now() + Duration::hours(24),
            can_stream: true,
            library_allow: vec![],
            group_library_allow: vec![group_library_id],
            consumed_at: None,
            consumed_by_user_id: None,
            consumed_by_peer_id: None,
        };
        state.app.user_invite_repo.create(&invite).await.unwrap();

        let request = UserInviteRequest {
            id: Uuid::new_v4(),
            user_id: admin.id,
            message: Some("please".to_string()),
            status: UserInviteRequestStatus::Pending,
            requested_at: Utc::now(),
            reviewed_by: None,
            reviewed_at: None,
            generated_at: None,
            can_stream: false,
            library_allow: vec![],
            group_library_allow: vec![],
        };
        state
            .app
            .user_invite_request_repo
            .create(&request)
            .await
            .unwrap();

        let response = router
            .clone()
            .oneshot(signed_get("/api/v1/peer/invites", peer_id, &key))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = body_json(response).await;
        let invites = body["invites"].as_array().unwrap();
        let synced_invite = invites
            .iter()
            .find(|i| i["token_hash"] == "a-token-hash")
            .expect("the invite should be reported");
        // `group_library_allow`/`consumed_at`/`consumed_by_*` round-trip on
        // the wire -- the whole point of `PeerInviteRow` being field-for-
        // field identical to `UserInvite`'s own `Serialize` output (this
        // type's own doc comment): `playarr_peer_sync::account_sync::
        // InvitesResponse` deserializes straight into `UserInvite`, so a
        // field missing here would fail that deserialization outright, not
        // just silently drop the value.
        assert_eq!(
            synced_invite["group_library_allow"],
            serde_json::json!([group_library_id])
        );
        assert!(synced_invite["consumed_at"].is_null());
        let invite_requests = body["invite_requests"].as_array().unwrap();
        assert!(invite_requests
            .iter()
            .any(|r| r["id"] == request.id.to_string()));

        let server_time = body["server_time"].as_str().unwrap().to_string();

        // Consuming the invite after this cursor was taken must re-surface
        // it on the next pass -- proves the handler now cursors `user_
        // invites` on `updated_at` (creation *or* consumption), not just
        // `created_at` (`UserInviteRepo::list_updated_since`'s own doc
        // comment).
        let redeemer_id = Uuid::new_v4();
        // The cursor compares `updated_at` strictly after `server_time`; a fast machine can
        // consume within the same clock tick, so let the clock move on first (flaked in CI
        // once the suite got fast enough).
        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
        assert!(state
            .app
            .user_invite_repo
            .consume(&invite.token_hash, Utc::now(), redeemer_id, None)
            .await
            .unwrap());

        let second_path = format!("/api/v1/peer/invites?since={server_time}");
        let response = router
            .oneshot(signed_get(&second_path, peer_id, &key))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = body_json(response).await;
        let invites = body["invites"].as_array().unwrap();
        let reconsumed = invites
            .iter()
            .find(|i| i["token_hash"] == "a-token-hash")
            .expect("the now-consumed invite must be re-reported past the earlier cursor");
        assert_eq!(reconsumed["consumed_by_user_id"], redeemer_id.to_string());
    }

    #[tokio::test]
    async fn libraries_handler_returns_complete_source_instances_and_group_libraries() {
        let (router, state) = test_state().await;
        let peer_id = Uuid::new_v4();
        let key = signing_key();
        let group_id = seed_group_and_signed_peer(&state, peer_id, &key).await;

        let group_library_id = Uuid::new_v4();
        state
            .app
            .group_library_repo
            .upsert(&GroupLibrary {
                id: group_library_id,
                group_id,
                name: "Movies".to_string(),
                created_at: Utc::now(),
                updated_at: Utc::now(),
            })
            .await
            .unwrap();

        let source_instance = SourceInstance {
            id: Uuid::new_v4(),
            kind: playarr_model::SourceKind::Radarr,
            name: "Main Radarr".to_string(),
            base_url: "https://radarr.internal.example".to_string(),
            api_key_encrypted: Sensitive::new("super-secret-api-key".to_string()),
            priority: 3,
            default_root_folder_id: None,
            folder_mappings: Default::default(),
            default_quality_profile_id: None,
            best_effort: false,
            group_library_id: Some(group_library_id),
        };
        state
            .app
            .source_instance_repo
            .upsert(&source_instance)
            .await
            .unwrap();

        let response = router
            .oneshot(signed_get("/api/v1/peer/libraries", peer_id, &key))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let raw = String::from_utf8(bytes.to_vec()).unwrap();
        let body: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let instances = body["source_instances"].as_array().unwrap();
        let wire_instance = instances
            .iter()
            .find(|i| i["id"] == source_instance.id.to_string())
            .unwrap();
        assert_eq!(wire_instance["name"], "Main Radarr");
        assert_eq!(wire_instance["priority"], 3);
        assert_eq!(
            wire_instance["group_library_id"],
            group_library_id.to_string()
        );
        assert_eq!(wire_instance["base_url"], "https://radarr.internal.example");
        assert_eq!(wire_instance["api_key_encrypted"], "super-secret-api-key");
        let self_peer_id = state
            .app
            .node_identity_repo
            .get()
            .await
            .unwrap()
            .unwrap()
            .peer_id;
        assert_eq!(wire_instance["origin_peer_id"], self_peer_id.to_string());

        let libraries = body["group_libraries"].as_array().unwrap();
        assert!(libraries
            .iter()
            .any(|l| l["id"] == group_library_id.to_string()));
    }

    #[tokio::test]
    async fn availability_handler_derives_rows_live_from_this_nodes_own_media_files() {
        let (router, state) = test_state().await;
        let peer_id = Uuid::new_v4();
        let key = signing_key();
        seed_group_and_signed_peer(&state, peer_id, &key).await;
        let self_peer_id = state
            .app
            .node_identity_repo
            .get()
            .await
            .unwrap()
            .unwrap()
            .peer_id;
        let media_root = tempfile::tempdir().unwrap();
        std::fs::write(media_root.path().join("file.mkv"), b"media").unwrap();

        let group_library_id = Uuid::new_v4();
        let source_instance_id = Uuid::new_v4();
        state
            .app
            .source_instance_repo
            .upsert(&SourceInstance {
                id: source_instance_id,
                kind: playarr_model::SourceKind::Radarr,
                name: "Radarr".to_string(),
                base_url: "https://radarr.example.com".to_string(),
                api_key_encrypted: Sensitive::new("key".to_string()),
                priority: 0,
                default_root_folder_id: Some("/media".to_string()),
                folder_mappings: [(
                    self_peer_id,
                    media_root.path().to_string_lossy().into_owned(),
                )]
                .into_iter()
                .collect(),
                default_quality_profile_id: None,
                best_effort: false,
                group_library_id: Some(group_library_id),
            })
            .await
            .unwrap();

        let work_id = Uuid::new_v4();
        let work = Work {
            id: work_id,
            kind: WorkKind::Movie,
            external_refs: vec![ExternalRef {
                provider: ExternalProvider::Tmdb,
                external_id: "603".to_string(),
            }],
            title: "Sample Movie Kilo".to_string(),
            sort_title: "matrix, the".to_string(),
            overview: None,
            images: vec![],
            genres: vec![],
            tags: vec![],
            added_at: Utc::now(),
            release_date: Some("1999-03-31T00:00:00Z".parse().unwrap()),
            monitored: true,
            availability: Availability::Available,
        };
        state.app.work_repo.upsert(&work).await.unwrap();
        seed_media_file(&state, work_id, LeafRef::Work, source_instance_id).await;

        let response = router
            .clone()
            .oneshot(signed_get("/api/v1/peer/availability", peer_id, &key))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = body_json(response).await;
        let rows = body["rows"].as_array().unwrap();
        assert_eq!(
            rows.len(),
            1,
            "expected exactly one derived leaf row: {rows:?}"
        );
        let row = &rows[0];
        assert_eq!(row["provider"], "tmdb");
        assert_eq!(row["external_id"], "603");
        assert_eq!(row["leaf_selector"], "movie");
        assert_eq!(row["group_library_id"], group_library_id.to_string());
        assert_eq!(row["availability"], "available");
        assert_eq!(row["container"], "mkv");
        assert_eq!(row["codec"], "h264");
        assert_eq!(row["title"], "Sample Movie Kilo");
        assert_eq!(row["kind"], "movie");
        assert!(body["server_time"].as_str().unwrap().parse::<i64>().is_ok());

        std::fs::remove_file(media_root.path().join("file.mkv")).unwrap();
        let response = router
            .oneshot(signed_get("/api/v1/peer/availability", peer_id, &key))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = body_json(response).await;
        assert_eq!(
            body["rows"].as_array().unwrap().len(),
            0,
            "a replicated MediaFile row must not advertise a missing physical file"
        );
    }

    #[tokio::test]
    async fn routing_rules_handler_returns_this_groups_rules_and_respects_since() {
        let (router, state) = test_state().await;
        let peer_id = Uuid::new_v4();
        let key = signing_key();
        let group_id = seed_group_and_signed_peer(&state, peer_id, &key).await;

        let rule = playarr_model::RoutingRule {
            id: Uuid::new_v4(),
            group_id,
            group_library_id: None,
            user_id: None,
            priority: 5,
            preferred_nodes: vec![peer_id],
            delivery_mode: playarr_model::DeliveryMode::Redirect,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        state.app.routing_rule_repo.create(&rule).await.unwrap();

        let response = router
            .clone()
            .oneshot(signed_get("/api/v1/peer/routing-rules", peer_id, &key))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = body_json(response).await;
        let rows = body["rows"].as_array().unwrap();
        let synced_rule = rows
            .iter()
            .find(|r| r["id"] == rule.id.to_string())
            .unwrap();
        assert_eq!(synced_rule["priority"], 5);
        assert_eq!(synced_rule["delivery_mode"], "redirect");
        assert_eq!(
            synced_rule["preferred_nodes"].as_array().unwrap(),
            &[serde_json::Value::String(peer_id.to_string())]
        );

        let server_time = body["server_time"].as_str().unwrap().to_string();
        assert!(
            server_time.parse::<i64>().is_ok(),
            "server_time must be a plain integer cursor"
        );

        // A second pass using the returned cursor must not re-report the
        // already-seen row -- proves `since` is actually applied.
        let second_path = format!("/api/v1/peer/routing-rules?since={server_time}");
        let response = router
            .oneshot(signed_get(&second_path, peer_id, &key))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = body_json(response).await;
        assert!(body["rows"].as_array().unwrap().is_empty());
    }
}
