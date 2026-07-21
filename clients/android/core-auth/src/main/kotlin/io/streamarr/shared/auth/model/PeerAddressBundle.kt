package io.streamarr.shared.auth.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Mirrors `PeerAddressEntry` (`streamarr-api::admin_peer`): one reachable
 * URL attributed to the `peer_nodes` row (or, before grouping, this node's
 * own `node_identity`) it belongs to. This attribution is the entire point
 * of [PeerAddressBundle] not carrying a bare `List<String>` -- per
 * `docs/architecture/peer-groups.md` §3.7, refresh tokens are never synced
 * across peer nodes -- only accounts/policies are (Phase 2) -- so
 * [io.streamarr.shared.auth.SessionRefresher] needs to know whether a given
 * URL is *another address of the same node* that issued the token (worth
 * retrying) or a genuinely different node (guaranteed to 401, since that
 * node's own database has no record of a token it never issued).
 */
@Serializable
data class PeerAddressEntry(
    @SerialName("peer_node_id") val peerNodeId: String,
    val url: String,
)

/**
 * Mirrors `PeerAddressBundle` (`streamarr-api::admin_peer`) -- every
 * address this account's peer group can currently be reached at, attached
 * to [LoginResponse]/`RefreshResponse` so the client can self-heal its
 * remembered [KnownServerGroup] (`docs/architecture/peer-groups.md` §7.1)
 * without a separate "refresh my address book" round trip. `null`/absent
 * on both responses for a standalone (never grouped) node -- see the
 * server's `admin_peer::peer_addresses_for_response` doc comment for why
 * that lookup is skipped, not just returned empty, in that case.
 */
@Serializable
data class PeerAddressBundle(
    /** `null` for a standalone deployment that has never founded or joined a peer group. */
    @SerialName("group_id") val groupId: String? = null,
    @SerialName("group_name") val groupName: String? = null,
    /**
     * Every active member's reachable addresses, each attributed to the
     * peer node it belongs to, flattened and priority-ordered (lower
     * `PeerAddress::priority` first). Empty -- never an error -- when
     * nothing is configured yet.
     */
    val addresses: List<PeerAddressEntry> = emptyList(),
)
