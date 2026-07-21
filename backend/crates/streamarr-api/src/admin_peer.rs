//! Admin-driven node/group identity endpoints -- `docs/architecture/
//! peer-groups.md` §3.4's "Founding a group" and "Joining" steps 1-2 (steps
//! 3-4, the receiving node's side of the handshake, are
//! [`crate::peer::enroll_handler`]). Every handler here is
//! [`AdminUser`]-gated, matching `admin.rs`'s own source-instance
//! endpoints.
//!
//! Routes:
//! - `PUT /api/v1/admin/peer-nodes/self` -- [`update_self_peer_node_handler`]
//! - `POST /api/v1/admin/peer-groups` -- [`found_peer_group_handler`]
//! - `POST /api/v1/admin/peer-groups/join-tokens` -- [`create_peer_join_token_handler`]
//! - `POST /api/v1/admin/peer-groups/join` -- [`join_peer_group_handler`]
//! - `DELETE /api/v1/admin/peer-groups/self` -- [`leave_peer_group_handler`]
//! - `GET /api/v1/admin/peer-nodes` -- [`list_peer_nodes_handler`]
//! - `GET /api/v1/admin/peer-nodes/{id}/sync-status` -- [`peer_node_sync_status_handler`]
//! - `GET /api/v1/admin/peer-groups/self/address-bundle` -- [`address_bundle_handler`]
//!
//! Removing another member remains a separate operator action. Leaving
//! this node's own group is explicit so local detachment can also reset
//! token issuance and preserve the self profile for another create/join.
//!
//! [`peer_address_bundle`]/[`peer_addresses_for_response`] (Phase 4,
//! `docs/architecture/peer-groups.md` §6.1) back [`address_bundle_handler`]
//! below plus two other callers outside this module: `login.rs`/
//! `refresh.rs`'s `peer_addresses` response field (§7.1) and `oauth.rs`'s
//! `verification_uri_complete` `servers=` param (§6.3) -- one function, one
//! shape, three call sites, never a grouped/ungrouped branch duplicated in
//! any of them.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use base64::Engine;
use chrono::{DateTime, Duration, Utc};
use ed25519_dalek::SigningKey;
use serde::{Deserialize, Serialize};
use streamarr_model::{NodeIdentity, PeerAddress, PeerGroup, PeerNode, PeerNodeStatus, Sensitive};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth_extractor::AdminUser;
use crate::error::ApiError;
use crate::peer::EnrollResponse;
use crate::AppState;

/// Node-name + address profile staged by [`update_self_peer_node_handler`]
/// before this node has founded or joined a group. `peer_nodes.group_id`
/// is `NOT NULL` (see `docs/architecture/peer-groups.md` §2.1's schema),
/// so there is nowhere durable to place a self [`PeerNode`] row until
/// [`found_peer_group_handler`]/[`join_peer_group_handler`] actually mint
/// one. Deliberately in-memory-only rather than a new migration column: an
/// admin runs §3.4's founding/joining steps back-to-back in one sitting,
/// and a process restart in the narrow window between them (a rare,
/// self-inflicted gap) just means redoing the one `PUT` call, not a
/// durability bug. Once a self `PeerNode` row exists,
/// `update_self_peer_node_handler` writes straight through to it instead
/// (see that handler's own doc comment) and this cell is never consulted
/// again.
#[derive(Debug, Clone)]
pub struct PendingSelfPeerProfile {
    pub name: String,
    pub addresses: Vec<PeerAddress>,
}

/// 32 bytes of `Uuid::new_v4()`-sourced entropy, used directly as an
/// Ed25519 seed. `Uuid::new_v4` draws from the OS CSPRNG -- the same
/// reasoning `streamarr_auth::secret::opaque_token`'s own doc comment
/// gives for not pulling in a dedicated `rand`/`OsRng` dependency just to
/// reformat the same underlying entropy source.
fn generate_ed25519_seed() -> [u8; 32] {
    let mut seed = [0u8; 32];
    seed[..16].copy_from_slice(Uuid::new_v4().as_bytes());
    seed[16..].copy_from_slice(Uuid::new_v4().as_bytes());
    seed
}

fn signing_key_from_seed_b64(seed_b64: &str) -> Result<SigningKey, ApiError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(seed_b64)
        .map_err(|_| ApiError::internal("stored Ed25519 private key is not valid base64"))?;
    let seed: [u8; 32] = bytes
        .try_into()
        .map_err(|_| ApiError::internal("stored Ed25519 private key has the wrong length"))?;
    Ok(SigningKey::from_bytes(&seed))
}

fn public_key_b64(signing_key: &SigningKey) -> String {
    base64::engine::general_purpose::STANDARD.encode(signing_key.verifying_key().to_bytes())
}

/// Returns this node's [`NodeIdentity`], minting a fresh Ed25519 keypair +
/// `peer_id` on first use if none exists yet. The `node_identity`
/// migration's own comment describes `peer_id` as "generated once, first
/// boot, never regenerated": `backend/src/main.rs`'s `boot_api` calls this
/// exact function at process boot (before the router is ever handed a
/// request) so that invariant holds from the very first boot, not just from
/// the first time an admin founds or joins a group. The handlers below
/// (`found_peer_group_handler`/`join_peer_group_handler`) also call it, as
/// a defensive fallback -- always a no-op read by the time they run, since
/// boot has already minted the row, but kept so neither handler assumes
/// anything about *when* boot ran. Either way the invariant holds: once
/// minted, this identity is never regenerated, and an already-present row
/// (including its `group_id`) is always loaded as-is, never overwritten.
pub async fn ensure_node_identity(
    node_identity_repo: &Arc<dyn streamarr_db::NodeIdentityRepo>,
) -> Result<NodeIdentity, ApiError> {
    if let Some(identity) = node_identity_repo
        .get()
        .await
        .map_err(|err| ApiError::internal(format!("failed to load node identity: {err}")))?
    {
        return Ok(identity);
    }

    let identity = NodeIdentity {
        peer_id: Uuid::new_v4(),
        private_key: Sensitive::new(
            base64::engine::general_purpose::STANDARD.encode(generate_ed25519_seed()),
        ),
        group_id: None,
        created_at: Utc::now(),
    };
    node_identity_repo
        .put(&identity)
        .await
        .map_err(|err| ApiError::internal(format!("failed to persist node identity: {err}")))?;
    Ok(identity)
}

/// This node's own [`streamarr_peer_sync::PeerIdentity`] -- the Ed25519
/// signing identity every Phase 3 outbound node-to-node call
/// (`playback::forward_negotiation_to_peer`,
/// `media::proxy_stream_media_handler`) signs with, built from
/// [`ensure_node_identity`]'s stored seed. Mints a fresh identity on first
/// use, same as every other caller of `ensure_node_identity` -- see that
/// function's own doc comment; in practice always a no-op read, since
/// `backend/src/main.rs`'s `boot_api` already calls `ensure_node_identity`
/// before ever serving a request.
pub async fn own_peer_identity(
    state: &AppState,
) -> Result<streamarr_peer_sync::PeerIdentity, ApiError> {
    let identity = ensure_node_identity(&state.node_identity_repo).await?;
    streamarr_peer_sync::PeerIdentity::from_seed_b64(
        identity.peer_id,
        identity.private_key.expose_secret(),
    )
    .map_err(|err| ApiError::internal(format!("invalid stored Ed25519 private key: {err}")))
}

fn already_grouped() -> ApiError {
    ApiError::conflict("this node has already founded or joined a peer group")
}

fn missing_self_profile() -> ApiError {
    ApiError::bad_request(
        "call PUT /api/v1/admin/peer-nodes/self to set this node's name and addresses first",
    )
}

/// Request body for [`update_self_peer_node_handler`].
#[derive(Debug, Deserialize, ToSchema)]
pub struct SelfPeerNodeRequest {
    pub name: String,
    #[serde(default)]
    pub addresses: Vec<PeerAddress>,
}

/// Response body for [`update_self_peer_node_handler`]. Every field but
/// `name`/`addresses` is `None` until this node has actually founded or
/// joined a group (see [`PendingSelfPeerProfile`]'s doc comment) --
/// deliberately a distinct, all-nullable shape rather than reusing
/// [`PeerNode`] with fabricated placeholder values for the fields that
/// genuinely don't exist yet.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SelfPeerNodeResponse {
    pub id: Option<Uuid>,
    pub group_id: Option<Uuid>,
    pub name: String,
    pub addresses: Vec<PeerAddress>,
    pub public_key: Option<String>,
    pub status: Option<PeerNodeStatus>,
}

/// Sets this node's own display name and reachable addresses --
/// `docs/architecture/peer-groups.md` §3.4's founding step 1 / joining
/// step 2. Callable at any time: before this node has founded/joined a
/// group, the values are only staged in memory (see
/// [`PendingSelfPeerProfile`]); afterward, this writes straight through to
/// the persisted self [`PeerNode`] row (e.g. to rename this node or add a
/// new address later).
#[utoipa::path(
    put,
    path = "/api/v1/admin/peer-nodes/self",
    tag = "peer-groups",
    request_body(content = SelfPeerNodeRequest, example = json!({
        "name": "home",
        "addresses": [
            {"url": "https://home.example.com", "priority": 0, "label": "wan", "client_reachable": true},
            {"url": "http://192.168.1.10:8080", "priority": 1, "label": "lan", "client_reachable": false}
        ]
    })),
    responses(
        (status = 200, description = "Self profile set or updated", body = SelfPeerNodeResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn update_self_peer_node_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<SelfPeerNodeRequest>,
) -> Result<Json<SelfPeerNodeResponse>, ApiError> {
    let identity = state
        .node_identity_repo
        .get()
        .await
        .map_err(|err| ApiError::internal(format!("failed to load node identity: {err}")))?;

    if let Some(identity) = identity.filter(|identity| identity.group_id.is_some()) {
        // Already grouped: the self row is real and persisted -- update it
        // in place rather than touching the pending-profile cell (which is
        // no longer consulted once a self row exists).
        let mut self_node = state
            .peer_node_repo
            .get(identity.peer_id)
            .await
            .map_err(|err| ApiError::internal(format!("failed to load self peer node: {err}")))?
            .ok_or_else(|| {
                ApiError::internal(
                    "node_identity has a group_id but no matching self peer_nodes row exists",
                )
            })?;
        self_node.name = body.name;
        self_node.addresses = body.addresses;
        self_node.updated_at = Utc::now();
        state
            .peer_node_repo
            .upsert(&self_node)
            .await
            .map_err(|err| {
                ApiError::internal(format!("failed to persist self peer node: {err}"))
            })?;

        tracing::info!(peer_id = %self_node.id, "updated self peer node profile");
        return Ok(Json(SelfPeerNodeResponse {
            id: Some(self_node.id),
            group_id: Some(self_node.group_id),
            name: self_node.name,
            addresses: self_node.addresses,
            public_key: Some(self_node.public_key),
            status: Some(self_node.status),
        }));
    }

    *state.pending_self_peer_profile.lock().unwrap() = Some(PendingSelfPeerProfile {
        name: body.name.clone(),
        addresses: body.addresses.clone(),
    });

    tracing::info!(name = %body.name, "staged self peer node profile (not yet grouped)");
    Ok(Json(SelfPeerNodeResponse {
        id: None,
        group_id: None,
        name: body.name,
        addresses: body.addresses,
        public_key: None,
        status: None,
    }))
}

/// Request body for [`found_peer_group_handler`].
#[derive(Debug, Deserialize, ToSchema)]
pub struct FoundPeerGroupRequest {
    pub name: String,
}

/// Response body for [`found_peer_group_handler`].
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct FoundPeerGroupResponse {
    pub group: PeerGroup,
    pub self_node: PeerNode,
}

/// Founds a brand-new peer group with this node as its first (and, until
/// another node joins, only) member -- `docs/architecture/peer-groups.md`
/// §3.4's founding step 2. Mints this node's Ed25519 keypair + `peer_id`
/// if it doesn't have one yet, and requires `PUT /api/v1/admin/
/// peer-nodes/self` to have been called first (400 otherwise).
#[utoipa::path(
    post,
    path = "/api/v1/admin/peer-groups",
    tag = "peer-groups",
    request_body(content = FoundPeerGroupRequest, example = json!({"name": "Home Group"})),
    responses(
        (status = 200, description = "Group founded, this node is its first member", body = FoundPeerGroupResponse),
        (status = 400, description = "This node's name/addresses have not been set yet (call PUT .../peer-nodes/self first)"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 409, description = "This node has already founded or joined a peer group")
    )
)]
pub async fn found_peer_group_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<FoundPeerGroupRequest>,
) -> Result<Json<FoundPeerGroupResponse>, ApiError> {
    let mut identity = ensure_node_identity(&state.node_identity_repo).await?;
    if identity.group_id.is_some() {
        return Err(already_grouped());
    }

    let pending = state
        .pending_self_peer_profile
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(missing_self_profile)?;

    let signing_key = signing_key_from_seed_b64(identity.private_key.expose_secret())?;
    let now = Utc::now();

    let group = PeerGroup {
        id: Uuid::new_v4(),
        name: body.name,
        created_at: now,
    };
    state
        .peer_group_repo
        .create(&group)
        .await
        .map_err(|err| ApiError::internal(format!("failed to create peer group: {err}")))?;

    identity.group_id = Some(group.id);
    state
        .node_identity_repo
        .put(&identity)
        .await
        .map_err(|err| ApiError::internal(format!("failed to persist node identity: {err}")))?;

    let self_node = PeerNode {
        id: identity.peer_id,
        group_id: group.id,
        name: pending.name,
        addresses: pending.addresses,
        public_key: public_key_b64(&signing_key),
        is_self: true,
        status: PeerNodeStatus::Active,
        last_seen_at: Some(now),
        last_sync_error: None,
        joined_at: now,
        updated_at: now,
    };
    state
        .peer_node_repo
        .upsert(&self_node)
        .await
        .map_err(|err| ApiError::internal(format!("failed to persist self peer node: {err}")))?;

    state
        .jwt
        .activate_group_identity(&identity)
        .map_err(|err| {
            ApiError::internal(format!("failed to activate grouped JWT identity: {err}"))
        })?;

    *state.pending_self_peer_profile.lock().unwrap() = None;

    tracing::info!(group_id = %group.id, peer_id = %self_node.id, "founded peer group");
    Ok(Json(FoundPeerGroupResponse { group, self_node }))
}

/// Default join-token TTL -- `docs/architecture/peer-groups.md` §3.4's
/// "15-minute default TTL, single-use".
const PEER_JOIN_TOKEN_TTL: Duration = Duration::minutes(15);

/// Response body for [`create_peer_join_token_handler`]. Mirrors
/// `users::UserInviteResponse`'s exact shape -- the raw token is returned
/// exactly once and never again.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PeerJoinTokenResponse {
    pub join_token: String,
    pub expires_at: DateTime<Utc>,
}

/// Issues a single-use, 15-minute join token for another node to redeem
/// via `POST /api/v1/peer/enroll` -- `docs/architecture/peer-groups.md`
/// §3.4's joining step 1, run by an admin on the **already-grouped**
/// (founding, or previously joined) node.
#[utoipa::path(
    post,
    path = "/api/v1/admin/peer-groups/join-tokens",
    tag = "peer-groups",
    responses(
        (status = 200, description = "Join token issued", body = PeerJoinTokenResponse, example = json!({
            "join_token": "5f8a1c2e9b3d4f6a8c1e2b3d4f6a8c1e",
            "expires_at": "2026-07-21T12:15:00Z"
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 409, description = "This node has not founded or joined a peer group yet")
    )
)]
pub async fn create_peer_join_token_handler(
    State(state): State<AppState>,
    admin: AdminUser,
) -> Result<Json<PeerJoinTokenResponse>, ApiError> {
    let group_id = state
        .node_identity_repo
        .get()
        .await
        .map_err(|err| ApiError::internal(format!("failed to load node identity: {err}")))?
        .and_then(|identity| identity.group_id)
        .ok_or_else(|| {
            ApiError::conflict("this node has not founded or joined a peer group yet")
        })?;

    let raw_token = streamarr_auth::secret::opaque_token();
    let now = Utc::now();
    let expires_at = now + PEER_JOIN_TOKEN_TTL;
    state
        .peer_join_token_repo
        .create(&streamarr_db::PeerJoinToken {
            token_hash: streamarr_auth::secret::hash_token(&raw_token),
            group_id,
            created_by: admin.user_id,
            created_at: now,
            expires_at,
            redeemed_by_peer_id: None,
        })
        .await
        .map_err(|err| ApiError::internal(format!("failed to persist join token: {err}")))?;

    tracing::info!(created_by = %admin.user_id, %group_id, %expires_at, "created peer group join token");
    Ok(Json(PeerJoinTokenResponse {
        join_token: raw_token,
        expires_at,
    }))
}

/// Request body for [`join_peer_group_handler`].
#[derive(Debug, Deserialize, ToSchema)]
pub struct JoinPeerGroupRequest {
    /// Base URL of a node already in the target group, e.g.
    /// `"https://home.example.com"` -- the doc's "bootstrap address".
    pub seed_address: String,
    pub join_token: String,
}

/// Joins an existing peer group by calling another member's
/// `POST /api/v1/peer/enroll` -- `docs/architecture/peer-groups.md` §3.4's
/// joining step 2 (which itself triggers steps 3-4 over the network).
/// Mints this node's Ed25519 keypair + `peer_id` if it doesn't have one
/// yet, and requires `PUT /api/v1/admin/peer-nodes/self` to have been
/// called first (400 otherwise). On success, persists `group_id` into this
/// node's own `node_identity` and upserts every member the seed node
/// reported (including that node itself) into this node's own
/// `peer_nodes` -- correcting `is_self` to reflect *this* node's own
/// perspective rather than trusting the flag as reported by the seed node.
#[utoipa::path(
    post,
    path = "/api/v1/admin/peer-groups/join",
    tag = "peer-groups",
    request_body(content = JoinPeerGroupRequest, example = json!({
        "seed_address": "https://home.example.com",
        "join_token": "5f8a1c2e9b3d4f6a8c1e2b3d4f6a8c1e"
    })),
    responses(
        (status = 200, description = "Joined -- full current group membership returned", body = EnrollResponse),
        (status = 400, description = "This node's name/addresses have not been set yet (call PUT .../peer-nodes/self first)"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 409, description = "This node has already founded or joined a peer group"),
        (status = 502, description = "The seed node could not be reached, or rejected the join token")
    )
)]
pub async fn join_peer_group_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<JoinPeerGroupRequest>,
) -> Result<Json<EnrollResponse>, ApiError> {
    let identity = ensure_node_identity(&state.node_identity_repo).await?;
    if identity.group_id.is_some() {
        return Err(already_grouped());
    }

    let pending = state
        .pending_self_peer_profile
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(missing_self_profile)?;

    // The client side of §3.4 steps 3-5 (network call + local persistence)
    // lives in `streamarr-peer-sync::enroll` -- this handler drives it
    // rather than re-implementing "make a signed/token-authed request to a
    // peer, then persist the result" a second time (see that crate's own
    // module doc comment on the dependency direction this relies on).
    let peer_identity = streamarr_peer_sync::PeerIdentity::from_seed_b64(
        identity.peer_id,
        identity.private_key.expose_secret(),
    )
    .map_err(|err| ApiError::internal(format!("invalid stored Ed25519 private key: {err}")))?;
    let peer_client = streamarr_peer_sync::PeerClient::new(reqwest::Client::new(), peer_identity);

    let enrolled = streamarr_peer_sync::join_group(
        &peer_client,
        &state.node_identity_repo,
        &state.peer_group_repo,
        &state.peer_node_repo,
        std::slice::from_ref(&body.seed_address),
        body.join_token,
        pending.name,
        pending.addresses,
        identity,
    )
    .await
    .map_err(|err| {
        ApiError::bad_gateway(format!("failed to join via {}: {err}", body.seed_address))
    })?;

    let joined_identity = ensure_node_identity(&state.node_identity_repo).await?;
    state
        .jwt
        .activate_group_identity(&joined_identity)
        .map_err(|err| {
            ApiError::internal(format!("failed to activate grouped JWT identity: {err}"))
        })?;

    *state.pending_self_peer_profile.lock().unwrap() = None;

    // `streamarr_peer_sync::EnrollResponse` and this module's own
    // `EnrollResponse` (re-exported from `crate::peer`) are deliberately
    // distinct types carrying the identical shape -- see `streamarr-peer-
    // sync::enroll`'s own doc comment for why they aren't shared. This
    // handler's response still needs the local, `ToSchema`-deriving type
    // for the OpenAPI doc this route publishes.
    Ok(Json(EnrollResponse {
        group: enrolled.group,
        members: enrolled.members,
    }))
}

/// Result of leaving this node's current peer group. Unreachable peers do
/// not block local detachment, but the counts make partial notification
/// visible to the administrator.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct LeavePeerGroupResponse {
    pub group_id: Uuid,
    pub notified_peers: usize,
    pub unreachable_peers: usize,
}

/// Leaves this node's current peer group. Reachable members are notified
/// with this node's signed identity first; local group-scoped metadata is
/// then removed and token issuance returns to standalone mode. The durable
/// peer id/keypair is retained, and this node's name/addresses are staged
/// for the next create or join operation.
#[utoipa::path(
    delete,
    path = "/api/v1/admin/peer-groups/self",
    tag = "peer-groups",
    responses(
        (status = 200, description = "This node left its peer group", body = LeavePeerGroupResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 409, description = "This node has not founded or joined a peer group")
    )
)]
pub async fn leave_peer_group_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<LeavePeerGroupResponse>, ApiError> {
    let mut identity = ensure_node_identity(&state.node_identity_repo).await?;
    let group_id = identity
        .group_id
        .ok_or_else(|| ApiError::conflict("this node has not founded or joined a peer group"))?;
    let self_node = state
        .peer_node_repo
        .get(identity.peer_id)
        .await
        .map_err(|err| ApiError::internal(format!("failed to load self peer node: {err}")))?
        .ok_or_else(|| ApiError::internal("grouped node has no self peer row"))?;

    let peer_client = streamarr_peer_sync::PeerClient::new(
        state.peer_http.clone(),
        own_peer_identity(&state).await?,
    );
    let path = format!("/api/v1/peer/nodes/{}", identity.peer_id);
    let peers = state
        .peer_node_repo
        .list_others()
        .await
        .map_err(|err| ApiError::internal(format!("failed to list peer nodes: {err}")))?;
    let mut notified_peers = 0;
    let mut unreachable_peers = 0;
    for peer in peers {
        let mut notified = false;
        for address in streamarr_peer_sync::peer_client::addresses_by_priority(&peer.addresses) {
            let attempt = tokio::time::timeout(
                std::time::Duration::from_secs(3),
                peer_client.signed_delete(address, &path),
            )
            .await;
            if matches!(attempt, Ok(Ok(()))) {
                notified = true;
                break;
            }
        }
        if notified {
            notified_peers += 1;
        } else {
            unreachable_peers += 1;
            tracing::warn!(peer_id = %peer.id, "peer could not be notified before this node left its group");
        }
    }

    identity.group_id = None;
    state
        .node_identity_repo
        .put(&identity)
        .await
        .map_err(|err| ApiError::internal(format!("failed to detach node identity: {err}")))?;
    if let Err(err) = state.peer_group_repo.delete(group_id).await {
        identity.group_id = Some(group_id);
        if let Err(rollback_err) = state.node_identity_repo.put(&identity).await {
            tracing::error!(%rollback_err, "failed to restore node identity after peer-group delete failed");
        }
        return Err(ApiError::internal(format!(
            "failed to remove local peer-group state: {err}"
        )));
    }

    *state.pending_self_peer_profile.lock().unwrap() = Some(PendingSelfPeerProfile {
        name: self_node.name,
        addresses: self_node.addresses,
    });
    state.jwt.deactivate_group_identity();

    tracing::info!(%group_id, notified_peers, unreachable_peers, "left peer group");
    Ok(Json(LeavePeerGroupResponse {
        group_id,
        notified_peers,
        unreachable_peers,
    }))
}

/// Every known member of this node's peer group, including this node's
/// own `is_self = true` row.
#[utoipa::path(
    get,
    path = "/api/v1/admin/peer-nodes",
    tag = "peer-groups",
    responses(
        (status = 200, description = "Every known peer node, including self", body = Vec<PeerNode>),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn list_peer_nodes_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<Vec<PeerNode>>, ApiError> {
    Ok(Json(state.peer_node_repo.list_all().await.map_err(
        |err| ApiError::internal(format!("failed to list peer nodes: {err}")),
    )?))
}

/// One peer node's most recently reported sync outcome -- mirrors
/// `admin::SourceInstanceSyncStatusResponse`'s exact shape. Serialize-only,
/// matching that type -- nothing in this crate ever deserializes it (the
/// `status: Option<&'static str>` field can't derive `Deserialize` without
/// forcing a `'static` borrow out of the input buffer).
#[derive(Debug, Serialize, ToSchema)]
pub struct PeerSyncStatusResponse {
    pub peer_node_id: Uuid,
    pub name: String,
    /// Always `None` in Phase 1. `PeerSyncPoller` (`docs/architecture/
    /// peer-groups.md` §3.6) does not exist yet -- there is no real sync
    /// run to report. This is a deliberate stub matching `admin
    /// ::sync_status_handler`'s own "unreported" shape (`status: None`
    /// together with every other field below), not a fabricated
    /// "succeeded"/"never synced" value. Phase 2 wires a real
    /// `SyncStatusReporter` through here in place of this stub.
    pub status: Option<&'static str>,
    pub error: Option<String>,
    pub detail: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
}

/// A single peer node's last-known sync status -- always the "never
/// reported" shape in Phase 1; see [`PeerSyncStatusResponse::status`]'s
/// doc comment.
#[utoipa::path(
    get,
    path = "/api/v1/admin/peer-nodes/{id}/sync-status",
    tag = "peer-groups",
    params(("id" = Uuid, Path, description = "Peer node id")),
    responses(
        (status = 200, description = "Last-known sync status (always unreported in Phase 1)", body = PeerSyncStatusResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin"),
        (status = 404, description = "No peer node with this id")
    )
)]
pub async fn peer_node_sync_status_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<Json<PeerSyncStatusResponse>, ApiError> {
    let node = state
        .peer_node_repo
        .get(id)
        .await
        .map_err(|err| ApiError::internal(format!("failed to load peer node {id}: {err}")))?
        .ok_or_else(|| ApiError::not_found(format!("no peer node with id {id}")))?;

    Ok(Json(PeerSyncStatusResponse {
        peer_node_id: node.id,
        name: node.name,
        status: None,
        error: None,
        detail: None,
        started_at: None,
        finished_at: None,
    }))
}

// ---------------------------------------------------------------------
// Address bundle -- docs/architecture/peer-groups.md §6.1
// ---------------------------------------------------------------------

/// One [`PeerAddressBundle`] entry: a single reachable URL attributed to
/// the `peer_nodes` row (or, before grouping, this node's own
/// `node_identity`) it belongs to. This attribution is the entire point of
/// [`PeerAddressBundle`] not being a bare `Vec<String>`: per
/// `docs/architecture/peer-groups.md` §3.7, refresh tokens are never synced
/// across peer nodes -- only accounts/policies are -- so a client retrying
/// a failed refresh needs to know whether a given URL is *another address
/// of the same node* that issued the token (worth retrying) or a
/// genuinely different node (guaranteed to 401, since that node's own
/// database has no record of a token it never issued).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PeerAddressEntry {
    pub peer_node_id: Uuid,
    pub url: String,
}

/// Every reachable address this node -- or, once grouped, this node's
/// entire peer group -- can currently be reached at. `docs/architecture/
/// peer-groups.md` §6.1. Built fresh on every call, never cached/stored on
/// another row (see that section's "Deliberate simplification" note about
/// `UserInvite` not snapshotting one of these): the live membership table
/// is always the source of truth.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PeerAddressBundle {
    /// `None` for a standalone deployment that has never founded or
    /// joined a peer group.
    pub group_id: Option<Uuid>,
    pub group_name: Option<String>,
    /// Every `status = Active` member's `client_reachable` addresses, each
    /// attributed to the peer node it belongs to, flattened and
    /// priority-ordered (lower `PeerAddress::priority` first). Empty --
    /// never an error -- when nothing is configured yet.
    pub addresses: Vec<PeerAddressEntry>,
}

/// Every `client_reachable` address, attributed to the `peer_node_id` it
/// came from and priority-ordered (lower first). Shared by both branches of
/// [`peer_address_bundle`]: a real group's flattened member list, and a
/// standalone node's staged [`PendingSelfPeerProfile`] -- one filter/sort
/// implementation for both, per §6.1's "one code path" requirement.
fn client_reachable_addresses<'a>(
    addresses: impl IntoIterator<Item = (Uuid, &'a PeerAddress)>,
) -> Vec<PeerAddressEntry> {
    let mut ranked: Vec<(i32, PeerAddressEntry)> = addresses
        .into_iter()
        .filter(|(_, address)| address.client_reachable)
        .map(|(peer_node_id, address)| {
            (
                address.priority,
                PeerAddressEntry {
                    peer_node_id,
                    url: address.url.clone(),
                },
            )
        })
        .collect();
    ranked.sort_by_key(|(priority, _)| *priority);
    ranked.into_iter().map(|(_, entry)| entry).collect()
}

/// Builds this node's current [`PeerAddressBundle`] -- `docs/architecture/
/// peer-groups.md` §6.1. **One code path, not a grouped/ungrouped
/// branch**, per that section's own explicit invariant:
///
/// - **Grouped** (`node_identity.group_id.is_some()`): every active
///   member's (including this node's own self row) `client_reachable`
///   addresses, flattened and priority-ordered.
/// - **Standalone** (never founded/joined a group): `peer_nodes.group_id`
///   is `NOT NULL` (see the migration), so there is no persisted self row
///   to read yet -- the only place this node's own address can live before
///   founding/joining is [`PendingSelfPeerProfile`], staged by `PUT
///   /api/v1/admin/peer-nodes/self`. The identical `client_reachable`/
///   priority treatment applies to whatever is staged there, each entry
///   attributed to this node's own `node_identity.peer_id` -- minted via
///   [`ensure_node_identity`] if it doesn't exist yet (in practice always a
///   no-op read, since `backend/src/main.rs`'s `boot_api` already calls
///   `ensure_node_identity` before ever serving a request; see that
///   function's own doc comment). A node that has never called that
///   endpoint at all has genuinely no known address yet: this returns an
///   **empty** `addresses` list in that case, never an error -- there is
///   nothing wrong, just nothing configured.
pub async fn peer_address_bundle(state: &AppState) -> Result<PeerAddressBundle, ApiError> {
    let identity = state
        .node_identity_repo
        .get()
        .await
        .map_err(|err| ApiError::internal(format!("failed to load node identity: {err}")))?;

    let group_id = identity.as_ref().and_then(|identity| identity.group_id);

    let Some(group_id) = group_id else {
        let pending = state.pending_self_peer_profile.lock().unwrap().clone();
        let addresses = match pending {
            Some(pending) => {
                let peer_node_id = match identity {
                    Some(identity) => identity.peer_id,
                    None => {
                        ensure_node_identity(&state.node_identity_repo)
                            .await?
                            .peer_id
                    }
                };
                client_reachable_addresses(
                    pending
                        .addresses
                        .iter()
                        .map(|address| (peer_node_id, address)),
                )
            }
            None => Vec::new(),
        };
        return Ok(PeerAddressBundle {
            group_id: None,
            group_name: None,
            addresses,
        });
    };

    let group = state
        .peer_group_repo
        .get(group_id)
        .await
        .map_err(|err| ApiError::internal(format!("failed to load peer group: {err}")))?;

    let members = state
        .peer_node_repo
        .list_all()
        .await
        .map_err(|err| ApiError::internal(format!("failed to list peer nodes: {err}")))?;
    let addresses = client_reachable_addresses(
        members
            .iter()
            .filter(|node| node.status == PeerNodeStatus::Active)
            .flat_map(|node| node.addresses.iter().map(move |address| (node.id, address))),
    );

    Ok(PeerAddressBundle {
        group_id: Some(group_id),
        group_name: group.map(|group| group.name),
        addresses,
    })
}

/// `docs/architecture/peer-groups.md` §7.1's self-healing `peer_addresses`
/// field on `POST /api/v1/auth/{login,refresh}` responses. Deliberately
/// `None` for a standalone node rather than always attaching the full
/// [`peer_address_bundle`]: a standalone node's own address is already the
/// exact address the client just successfully talked to, so there is
/// nothing to "heal," and skipping the (cheap, but non-zero)
/// `peer_group_repo`/`peer_node_repo` reads on literally every login/
/// refresh call for the overwhelmingly common single-node deployment is
/// worth the one extra branch. A grouped node's bundle can genuinely
/// change (a peer added, removed, or re-addressed) between logins, which
/// is exactly the case this field exists to self-heal without a separate
/// "refresh my address book" round trip.
pub async fn peer_addresses_for_response(
    state: &AppState,
) -> Result<Option<PeerAddressBundle>, ApiError> {
    let bundle = peer_address_bundle(state).await?;
    Ok(bundle.group_id.is_some().then_some(bundle))
}

/// This node's current address bundle -- `docs/architecture/
/// peer-groups.md` §6.1. Invite-link/QR builders (`users.rs`/`admin.rs`'s
/// invite-creation handlers, client-side) call this at link-build time
/// instead of reading a single configured base URL directly, so an invite
/// generated on any one member of a group carries every member's
/// client-reachable address, not just the issuing node's own.
#[utoipa::path(
    get,
    path = "/api/v1/admin/peer-groups/self/address-bundle",
    tag = "peer-groups",
    responses(
        (status = 200, description = "This node's (or, once grouped, this group's) current address bundle", body = PeerAddressBundle, example = json!({
            "group_id": "11111111-1111-4111-8111-111111111111",
            "group_name": "Home Group",
            "addresses": [
                {"peer_node_id": "11111111-1111-4111-8111-111111111111", "url": "https://home.example.com"},
                {"peer_node_id": "22222222-2222-4222-8222-222222222222", "url": "https://east.example.com"}
            ]
        })),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn address_bundle_handler(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<PeerAddressBundle>, ApiError> {
    Ok(Json(peer_address_bundle(&state).await?))
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::peer::EnrollRequest;
    use crate::test_support::{bearer_header, mint_access_token, seed_admin_user, test_state};

    fn put_self_request(token: &str, name: &str) -> Request<Body> {
        let body = serde_json::json!({
            "name": name,
            "addresses": [
                {"url": "https://home.example.com", "priority": 0, "label": "wan", "client_reachable": true}
            ]
        });
        Request::builder()
            .method("PUT")
            .uri("/api/v1/admin/peer-nodes/self")
            .header("content-type", "application/json")
            .header("Authorization", bearer_header(token))
            .body(Body::from(body.to_string()))
            .unwrap()
    }

    fn found_group_request(token: &str, name: &str) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri("/api/v1/admin/peer-groups")
            .header("content-type", "application/json")
            .header("Authorization", bearer_header(token))
            .body(Body::from(serde_json::json!({"name": name}).to_string()))
            .unwrap()
    }

    #[tokio::test]
    async fn put_self_stages_profile_when_ungrouped() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let response = router
            .oneshot(put_self_request(&token, "home"))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: SelfPeerNodeResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json.name, "home");
        assert!(json.id.is_none());
        assert!(json.public_key.is_none());
        assert_eq!(
            state
                .app
                .pending_self_peer_profile
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .name,
            "home"
        );
    }

    #[tokio::test]
    async fn found_group_requires_self_profile_first() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let response = router
            .oneshot(found_group_request(&token, "Home Group"))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn founding_a_group_mints_identity_and_self_node() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let response = router
            .clone()
            .oneshot(put_self_request(&token, "home"))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let response = router
            .clone()
            .oneshot(found_group_request(&token, "Home Group"))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: FoundPeerGroupResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json.group.name, "Home Group");
        assert_eq!(json.self_node.name, "home");
        assert!(json.self_node.is_self);
        assert_eq!(json.self_node.group_id, json.group.id);

        let identity = state.app.node_identity_repo.get().await.unwrap().unwrap();
        assert_eq!(identity.group_id, Some(json.group.id));
        assert_eq!(identity.peer_id, json.self_node.id);

        // Founding twice is rejected -- this node is already grouped.
        let response = router
            .oneshot(found_group_request(&token, "Another Group"))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn outbound_only_node_can_found_a_group_without_addresses() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/v1/admin/peer-nodes/self")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(
                        serde_json::json!({"name": "outbound", "addresses": []}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let response = router
            .oneshot(found_group_request(&token, "Outbound Group"))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let founded: FoundPeerGroupResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(founded.self_node.name, "outbound");
        assert!(founded.self_node.addresses.is_empty());
    }

    #[tokio::test]
    async fn leaving_a_group_detaches_locally_and_preserves_the_self_profile() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        router
            .clone()
            .oneshot(put_self_request(&token, "home"))
            .await
            .unwrap();
        let founded = router
            .clone()
            .oneshot(found_group_request(&token, "Home Group"))
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(founded.into_body(), usize::MAX)
            .await
            .unwrap();
        let founded: FoundPeerGroupResponse = serde_json::from_slice(&bytes).unwrap();

        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/api/v1/admin/peer-groups/self")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let left: LeavePeerGroupResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(left.group_id, founded.group.id);
        assert_eq!(left.notified_peers, 0);
        assert_eq!(left.unreachable_peers, 0);

        let identity = state.app.node_identity_repo.get().await.unwrap().unwrap();
        assert_eq!(identity.group_id, None);
        assert!(state
            .app
            .peer_group_repo
            .get(founded.group.id)
            .await
            .unwrap()
            .is_none());
        assert!(state
            .app
            .peer_node_repo
            .list_all()
            .await
            .unwrap()
            .is_empty());
        let pending = state
            .app
            .pending_self_peer_profile
            .lock()
            .unwrap()
            .clone()
            .unwrap();
        assert_eq!(pending.name, "home");
        assert_eq!(pending.addresses, founded.self_node.addresses);

        // The same admin session remains usable, and the preserved profile
        // means another group can be founded without re-entering node data.
        let response = router
            .oneshot(found_group_request(&token, "Replacement Group"))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn list_peer_nodes_reflects_the_self_row_after_founding() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        router
            .clone()
            .oneshot(put_self_request(&token, "home"))
            .await
            .unwrap();
        router
            .clone()
            .oneshot(found_group_request(&token, "Home Group"))
            .await
            .unwrap();

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/peer-nodes")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let nodes: Vec<PeerNode> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(nodes.len(), 1);
        assert!(nodes[0].is_self);
    }

    #[tokio::test]
    async fn sync_status_is_the_unreported_stub_for_a_known_peer() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        router
            .clone()
            .oneshot(put_self_request(&token, "home"))
            .await
            .unwrap();
        let response = router
            .clone()
            .oneshot(found_group_request(&token, "Home Group"))
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let founded: FoundPeerGroupResponse = serde_json::from_slice(&bytes).unwrap();

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/v1/admin/peer-nodes/{}/sync-status",
                        founded.self_node.id
                    ))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let status: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(status["status"].is_null());
        assert!(status["started_at"].is_null());
    }

    #[tokio::test]
    async fn sync_status_404s_for_an_unknown_peer() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let response = router
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/api/v1/admin/peer-nodes/{}/sync-status",
                        Uuid::new_v4()
                    ))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn joining_a_group_calls_the_seed_node_and_persists_membership() {
        let mock = MockServer::start().await;
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        router
            .clone()
            .oneshot(put_self_request(&token, "east"))
            .await
            .unwrap();

        let group = PeerGroup {
            id: Uuid::new_v4(),
            name: "Home Group".to_string(),
            created_at: Utc::now(),
        };
        let self_of_seed = PeerNode {
            id: Uuid::new_v4(),
            group_id: group.id,
            name: "home".to_string(),
            addresses: vec![],
            public_key: "home-pubkey".to_string(),
            is_self: true,
            status: PeerNodeStatus::Active,
            last_seen_at: Some(Utc::now()),
            last_sync_error: None,
            joined_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let east_as_seen_by_home = PeerNode {
            // The seed node's own db necessarily minted this row with
            // whatever peer_id `east` claimed -- reuse a fixed id here and
            // assert this node re-marks it `is_self = true` regardless of
            // what the seed node reported.
            id: Uuid::nil(),
            group_id: group.id,
            name: "east".to_string(),
            addresses: vec![],
            public_key: "east-pubkey".to_string(),
            is_self: false,
            status: PeerNodeStatus::Active,
            last_seen_at: Some(Utc::now()),
            last_sync_error: None,
            joined_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let group_id = group.id;
        Mock::given(method("POST"))
            .and(path("/api/v1/peer/enroll"))
            .respond_with(move |request: &wiremock::Request| {
                let received: EnrollRequest = request.body_json().unwrap();
                let mut member = east_as_seen_by_home.clone();
                member.id = received.peer_id;
                ResponseTemplate::new(200).set_body_json(EnrollResponse {
                    group: group.clone(),
                    members: vec![self_of_seed.clone(), member],
                })
            })
            .mount(&mock)
            .await;

        let join_body = serde_json::json!({
            "seed_address": mock.uri(),
            "join_token": "some-token",
        });
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/admin/peer-groups/join")
                    .header("content-type", "application/json")
                    .header("Authorization", bearer_header(&token))
                    .body(Body::from(join_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let identity = state.app.node_identity_repo.get().await.unwrap().unwrap();
        assert_eq!(identity.group_id, Some(group_id));

        let members = state.app.peer_node_repo.list_all().await.unwrap();
        assert_eq!(members.len(), 2);
        let self_row = members.iter().find(|m| m.id == identity.peer_id).unwrap();
        assert!(
            self_row.is_self,
            "this node's own row must be is_self=true locally"
        );
        let other_row = members.iter().find(|m| m.id != identity.peer_id).unwrap();
        assert!(!other_row.is_self);
    }

    fn address_bundle_request(token: &str) -> Request<Body> {
        Request::builder()
            .uri("/api/v1/admin/peer-groups/self/address-bundle")
            .header("Authorization", bearer_header(token))
            .body(Body::empty())
            .unwrap()
    }

    /// §6.1's explicit "no address configured at all yet" case: a brand
    /// new node that has never called `PUT .../peer-nodes/self` gets an
    /// empty `urls` list back, not an error.
    #[tokio::test]
    async fn address_bundle_is_empty_for_a_fresh_ungrouped_node() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        let response = router
            .oneshot(address_bundle_request(&token))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let bundle: PeerAddressBundle = serde_json::from_slice(&bytes).unwrap();
        assert!(bundle.group_id.is_none());
        assert!(bundle.group_name.is_none());
        assert!(bundle.addresses.is_empty());
    }

    /// An ungrouped node that *has* staged a self profile (but not yet
    /// founded/joined a group) reports that staged, `client_reachable`
    /// address -- and only the `client_reachable` one -- attributed to this
    /// node's own `node_identity.peer_id` (minted on demand here, since
    /// nothing has founded/joined a group yet to mint one earlier).
    #[tokio::test]
    async fn address_bundle_reflects_the_staged_self_profile_before_grouping() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        router
            .clone()
            .oneshot(put_self_request(&token, "home"))
            .await
            .unwrap();

        let response = router
            .oneshot(address_bundle_request(&token))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let bundle: PeerAddressBundle = serde_json::from_slice(&bytes).unwrap();
        assert!(bundle.group_id.is_none());
        let peer_id = state
            .app
            .node_identity_repo
            .get()
            .await
            .unwrap()
            .unwrap()
            .peer_id;
        assert_eq!(
            bundle.addresses,
            vec![PeerAddressEntry {
                peer_node_id: peer_id,
                url: "https://home.example.com".to_string(),
            }]
        );
    }

    /// Once grouped, the bundle flattens every *active* member's
    /// `client_reachable` addresses, priority-ordered, excluding
    /// unreachable/left peers and non-`client_reachable` addresses --
    /// §6.1's full, non-trivial case.
    #[tokio::test]
    async fn address_bundle_flattens_active_members_priority_ordered_once_grouped() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);

        router
            .clone()
            .oneshot(put_self_request(&token, "home"))
            .await
            .unwrap();
        let response = router
            .clone()
            .oneshot(found_group_request(&token, "Home Group"))
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let founded: FoundPeerGroupResponse = serde_json::from_slice(&bytes).unwrap();

        let now = Utc::now();
        let mut east = founded.self_node.clone();
        east.id = Uuid::new_v4();
        east.name = "east".to_string();
        east.is_self = false;
        east.status = PeerNodeStatus::Active;
        east.addresses = vec![
            PeerAddress {
                url: "https://east-lan.example.com".to_string(),
                priority: 1,
                label: "lan".to_string(),
                client_reachable: false,
            },
            PeerAddress {
                url: "https://east-wan.example.com".to_string(),
                priority: 0,
                label: "wan".to_string(),
                client_reachable: true,
            },
        ];
        state.app.peer_node_repo.upsert(&east).await.unwrap();

        let mut west = founded.self_node.clone();
        west.id = Uuid::new_v4();
        west.name = "west".to_string();
        west.is_self = false;
        west.status = PeerNodeStatus::Unreachable;
        west.addresses = vec![PeerAddress {
            url: "https://west.example.com".to_string(),
            priority: 0,
            label: "wan".to_string(),
            client_reachable: true,
        }];
        state.app.peer_node_repo.upsert(&west).await.unwrap();

        let mut north = founded.self_node.clone();
        north.id = Uuid::new_v4();
        north.name = "north".to_string();
        north.is_self = false;
        north.status = PeerNodeStatus::Left;
        north.addresses = vec![PeerAddress {
            url: "https://north.example.com".to_string(),
            priority: 0,
            label: "wan".to_string(),
            client_reachable: true,
        }];
        state.app.peer_node_repo.upsert(&north).await.unwrap();

        let mut self_node = founded.self_node.clone();
        self_node.addresses = vec![PeerAddress {
            url: "https://home.example.com".to_string(),
            priority: 2,
            label: "wan".to_string(),
            client_reachable: true,
        }];
        self_node.updated_at = now;
        state.app.peer_node_repo.upsert(&self_node).await.unwrap();

        let response = router
            .oneshot(address_bundle_request(&token))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let bundle: PeerAddressBundle = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(bundle.group_id, Some(founded.group.id));
        assert_eq!(bundle.group_name, Some("Home Group".to_string()));
        // east's lan address is excluded (client_reachable = false); west
        // and north are excluded entirely (not Active); the two remaining
        // addresses come back priority-ordered, not member-declaration-order,
        // each attributed to the peer_nodes row it actually came from.
        assert_eq!(
            bundle.addresses,
            vec![
                PeerAddressEntry {
                    peer_node_id: east.id,
                    url: "https://east-wan.example.com".to_string(),
                },
                PeerAddressEntry {
                    peer_node_id: self_node.id,
                    url: "https://home.example.com".to_string(),
                },
            ]
        );
    }
}
