package io.streamarr.shared.auth.model

import kotlinx.serialization.Serializable

/**
 * Remembered group of server addresses -- `docs/architecture/
 * peer-groups.md` §6.4/§7.1, the Android mirror of `clients/tv-web/
 * packages/domain/src/knownServers.ts`. Supersedes reasoning about "the"
 * server as a single URL (`io.streamarr.shared.data.config.
 * ServerConfigStore`'s single `baseUrl`, left alone by this file exactly
 * as `knownServers.ts` leaves `apiBaseUrl` alone): once a client has
 * talked to a peer group, "which server do I talk to" is a
 * priority-ordered *list* of addresses that can fail over into one
 * another, not one URL.
 *
 * Persisted purely as local app state (`KnownServerGroupStore`) -- this
 * type is never itself sent or received on the wire, so its JSON field
 * names don't need to track the server's snake_case convention the way
 * [PeerAddressBundle] does; see [KnownServerGroupStore.rememberPeerAddresses]
 * for where the two actually meet.
 */
@Serializable
data class KnownServerGroup(
    /** Absent for a standalone (ungrouped) server -- mirrors [PeerAddressBundle]'s own optionality. */
    val groupId: String? = null,
    val groupName: String? = null,
    /** Priority-ordered. */
    val servers: List<KnownServer> = emptyList(),
    /** Fast path: tried before [servers], so a healthy reconnect skips a probe round trip entirely. */
    val lastGoodUrl: String? = null,
)

/** One remembered address within a [KnownServerGroup]. */
@Serializable
data class KnownServer(
    val url: String,
    /** Epoch-millis of the last time this address answered a request successfully, if ever. */
    val lastSuccessAt: Long? = null,
    /**
     * The peer node this address belongs to (`PeerAddressEntry::peer_node_id`),
     * if known -- absent for a group remembered before this attribution
     * existed, or an entry whose origin genuinely isn't known. See
     * [sameNodeCandidateUrls] for the one place this actually matters:
     * a refresh token issued by one peer node can never be redeemed by
     * another (`docs/architecture/peer-groups.md` §3.7), so only
     * same-`peerNodeId` addresses are worth retrying a refresh against.
     */
    val peerNodeId: String? = null,
)

/**
 * The order candidate addresses in [this] would be tried in, with **no**
 * regard to which peer node each one belongs to: [KnownServerGroup.lastGoodUrl]
 * first (the common "still the same server" fast path), then
 * [KnownServerGroup.servers] in priority order, de-duplicated. Correct for
 * anything that's valid at *any* group member -- [resolveReachableServer]'s
 * general reachability probing, and `SessionManager`'s fresh-login retry
 * (accounts/policies sync across the whole group, §3.7/Phase 2, so a login
 * that fails at one member is worth retrying at any other). **Not** correct
 * for retrying a refresh token -- see [sameNodeCandidateUrls] for that case.
 */
fun KnownServerGroup.candidateUrls(): List<String> {
    val candidates = LinkedHashSet<String>()
    lastGoodUrl?.let { candidates.add(it) }
    servers.forEach { candidates.add(it.url) }
    return candidates.toList()
}

/**
 * Candidate addresses worth retrying a refresh token that [issuingPeerNodeId]
 * issued: only [servers] attributed to that same peer node (plus
 * [KnownServerGroup.lastGoodUrl] when it too belongs to that node),
 * priority-ordered, de-duplicated -- the same ordering [candidateUrls] uses,
 * just filtered to the one node whose database could possibly recognize
 * this token. Per `docs/architecture/peer-groups.md` §3.7, refresh tokens
 * are never synced between peers, so a *different* node's address is
 * guaranteed to 401 -- not worth the round trip, and excluded here rather
 * than left for the caller to discover the hard way.
 *
 * Returns an **empty** list -- never falls back to [candidateUrls] -- when
 * no [servers] entry carries a matching [KnownServer.peerNodeId]: either
 * this group predates address attribution, or genuinely no remembered
 * address belongs to the issuing node. Either way there is nothing safe to
 * retry, and `SessionRefresher` treats that exactly like having no group
 * remembered at all.
 */
fun KnownServerGroup.sameNodeCandidateUrls(issuingPeerNodeId: String): List<String> {
    val sameNodeUrls = servers.filter { it.peerNodeId == issuingPeerNodeId }.map { it.url }
    val candidates = LinkedHashSet<String>()
    if (lastGoodUrl != null && lastGoodUrl in sameNodeUrls) candidates.add(lastGoodUrl)
    candidates.addAll(sameNodeUrls)
    return candidates.toList()
}

/**
 * Resolves to the first reachable address in [group]: `lastGoodUrl` first,
 * then `servers` in priority order (see [candidateUrls]). Returns `null`
 * once every candidate address has failed [probe] -- callers treat that as
 * "fall through to asking the user again," not a case this function
 * itself has a further fallback for. Mirrors `knownServers.ts`'s
 * `resolveReachableServer`, except returning `null` instead of throwing:
 * idiomatic here, where every caller up the stack
 * (`SessionManager.ensureAccessToken`, `SessionRefresher.refreshAccessToken`)
 * already works in nullable-token terms rather than exceptions for this
 * same "expected, recoverable failure" case.
 */
suspend fun resolveReachableServer(group: KnownServerGroup, probe: suspend (String) -> Boolean): String? {
    for (url in group.candidateUrls()) {
        if (probe(url)) return url
    }
    return null
}
