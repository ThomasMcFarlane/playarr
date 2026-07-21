import Foundation

// MARK: - Remembered group of server addresses
//
// Swift mirror of `clients/tv-web/packages/domain/src/knownServers.ts` —
// `docs/architecture/peer-groups.md` §6.4/§7.1, §8 Phase 5. Once a client
// has talked to a peer group, "which server do I talk to" is a priority-
// ordered *list* of addresses that can fail over into one another, not a
// single remembered URL: `AppEnvironment.serverBaseURL` (iOS) and
// `TVAppEnvironment.serverURL` (tvOS) stay exactly as they are today for
// "the address currently in use" — this type layers a remembered *group*
// on top of that single value, the same way `knownServers.ts` layers on
// top of `STORED_API_BASE_URL_KEY` without replacing it.
//
// Lives in `StreamarrKit`, not `StreamarrApp` or the Apple TV app target
// directly, because `PlayarrTV.xcodeproj` consumes this exact package
// product as a local Swift package dependency (see `Package.swift`'s tvOS
// note, and `clients/apple-tv/project.yml`'s `packages.Streamarr` entry) —
// one Swift implementation for both Apple client targets, mirroring how
// one TS module (`knownServers.ts`) already covers every Web/TV-web
// target in the sibling `tv-web` client.

/// One remembered address within a group. Mirrors `KnownServer` in
/// `knownServers.ts` field for field.
public struct KnownServer: Codable, Sendable, Equatable {
    public var url: String
    /// The peer node this address belongs to, per the server's
    /// `PeerAddressEntry.peer_node_id` — `nil` only for an address
    /// remembered before this attribution existed (an older stored group
    /// this install already had on disk) or one that arrived without a
    /// `PeerAddressBundle` at all (`recordSuccess(url:)`'s single-URL
    /// path). `docs/architecture/peer-groups.md` §3.7: refresh tokens are
    /// never synced across peer nodes, so `AccessTokenCoordinator`'s
    /// refresh retry only ever considers addresses whose `peerNodeID`
    /// matches the node that issued the token being refreshed — see
    /// `sameNodeAddresses(in:peerNodeID:)`. A `nil` here never matches,
    /// which is deliberate: unattributed data degrades to "don't retry,"
    /// not "retry everywhere."
    public var peerNodeID: UUID?
    /// The last time this address answered a request successfully, if
    /// ever — `Date.now()`'s Swift analogue.
    public var lastSuccessAt: Date?

    public init(url: String, peerNodeID: UUID? = nil, lastSuccessAt: Date? = nil) {
        self.url = url
        self.peerNodeID = peerNodeID
        self.lastSuccessAt = lastSuccessAt
    }
}

/// A remembered, priority-ordered group of server addresses for one
/// account. Mirrors `KnownServerGroup` in `knownServers.ts` field for
/// field.
public struct KnownServerGroup: Codable, Sendable, Equatable {
    /// `nil` for a standalone (ungrouped) server — mirrors
    /// `PeerAddressBundle.groupID`'s own optionality.
    public var groupID: String?
    public var groupName: String?
    /// Priority-ordered.
    public var servers: [KnownServer]
    /// Fast path: tried before `servers`, so a healthy reconnect skips a
    /// probe round trip entirely.
    public var lastGoodURL: String?

    public init(
        groupID: String? = nil,
        groupName: String? = nil,
        servers: [KnownServer],
        lastGoodURL: String? = nil
    ) {
        self.groupID = groupID
        self.groupName = groupName
        self.servers = servers
        self.lastGoodURL = lastGoodURL
    }
}

public extension KnownServerGroup {
    /// Folds a server's self-healing `peer_addresses` bundle
    /// (`LoginResponse.peerAddresses`/`RefreshResponse.peerAddresses`)
    /// into a `KnownServerGroup`, promoting `successfulURL` (the address
    /// that just answered) to `lastGoodURL`. `bundle.addresses` is always
    /// the server's full, fresh, priority-ordered, node-attributed member
    /// list (see `PeerAddressBundle`'s doc comment), so this
    /// wholesale-replaces `servers` rather than merging entry-by-entry —
    /// mirrors the wholesale `rememberGroup({ servers: ..., lastGoodUrl:
    /// ... })` call `Signup.tsx` makes for an invite-carried bundle,
    /// generalized to any `PeerAddressBundle`. Previously-recorded
    /// `lastSuccessAt` timestamps are preserved for addresses that persist
    /// across the two snapshots; `peerNodeID` always comes fresh from
    /// `bundle` (the server is the one source of truth for attribution).
    static func merging(
        _ bundle: PeerAddressBundle,
        successfulURL: String,
        into existing: KnownServerGroup?
    ) -> KnownServerGroup {
        let previousSuccessByURL = Dictionary(
            uniqueKeysWithValues: (existing?.servers ?? []).map { ($0.url, $0.lastSuccessAt) }
        )
        let now = Date()
        let servers = bundle.addresses.map { entry in
            KnownServer(
                url: entry.url,
                peerNodeID: entry.peerNodeID,
                lastSuccessAt: entry.url == successfulURL ? now : (previousSuccessByURL[entry.url] ?? nil)
            )
        }
        return KnownServerGroup(
            groupID: bundle.groupID?.uuidString,
            groupName: bundle.groupName,
            servers: servers,
            lastGoodURL: successfulURL
        )
    }
}

/// Storage boundary for a remembered `KnownServerGroup`, mirroring
/// `AccessTokenProviding`'s role for token persistence — one small
/// protocol so callers/tests can substitute an in-memory store instead of
/// touching real `UserDefaults`.
public protocol KnownServerGroupStoring: Sendable {
    func currentGroup() async -> KnownServerGroup?
    func remember(_ group: KnownServerGroup) async
    func forget() async
}

public extension KnownServerGroupStoring {
    /// Records a successful call against `url`: bumps that address's
    /// `lastSuccessAt` and promotes it to `lastGoodURL` (the §7.1 fast
    /// path), without physically reordering `servers` itself. A no-op
    /// when no group is remembered yet — mirrors
    /// `knownServers.ts::rememberServerSuccess` exactly, including that it
    /// deliberately never materializes a one-server group out of a bare
    /// URL; that is `remember(_:)`'s job.
    func recordSuccess(url: String) async {
        guard var group = await currentGroup() else { return }
        let now = Date()
        group.servers = group.servers.map { server in
            var server = server
            if server.url == url { server.lastSuccessAt = now }
            return server
        }
        group.lastGoodURL = url
        await remember(group)
    }

    /// Folds a fresh `PeerAddressBundle` (a login/refresh response's
    /// self-healing `peer_addresses`) into whatever group is currently
    /// remembered, then persists the result. See
    /// `KnownServerGroup.merging(_:successfulURL:into:)`.
    func merge(_ bundle: PeerAddressBundle, successfulURL: String) async {
        let existing = await currentGroup()
        await remember(.merging(bundle, successfulURL: successfulURL, into: existing))
    }
}

/// `UserDefaults`-backed `KnownServerGroupStoring` — matches this
/// codebase's existing convention for the single remembered server
/// address (`AppEnvironment.serverBaseURLDefaultsKey` on iOS,
/// `TVAppEnvironment.serverURLKey` on tvOS): a server *address* is
/// configuration, not a secret, so it belongs in `UserDefaults` next to
/// those, not alongside `KeychainTokenStore`'s access/refresh tokens.
///
/// One fixed storage key rather than a per-server one: unlike a session
/// (scoped to one server — see `KeychainTokenStore`'s `account:
/// serverURL`), a known-server *group* is the one address book for this
/// install, independent of which address happens to be current.
public actor UserDefaultsKnownServerGroupStore: KnownServerGroupStoring {
    private static let storageKey = "com.streamarr.knownServerGroup"

    private let defaults: UserDefaults
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func currentGroup() -> KnownServerGroup? {
        guard let data = defaults.data(forKey: Self.storageKey) else { return nil }
        return try? decoder.decode(KnownServerGroup.self, from: data)
    }

    public func remember(_ group: KnownServerGroup) {
        guard let data = try? encoder.encode(group) else { return }
        defaults.set(data, forKey: Self.storageKey)
    }

    public func forget() {
        defaults.removeObject(forKey: Self.storageKey)
    }
}

/// Every candidate address has failed its reachability probe —
/// `resolveReachableServer`'s only error.
public enum KnownServerResolutionError: Error, Sendable {
    case noReachableAddress
}

/// Resolves to the first reachable address in `group`: `lastGoodURL`
/// first (skipping a probe round trip on the common "still the same
/// server" path), then `servers` in priority order. Throws only once
/// every candidate address has failed its probe. Mirrors
/// `knownServers.ts::resolveReachableServer` exactly.
public func resolveReachableServer(
    in group: KnownServerGroup,
    probe: (String) async -> Bool
) async throws -> String {
    var candidates: [String] = []
    if let lastGoodURL = group.lastGoodURL {
        candidates.append(lastGoodURL)
    }
    for server in group.servers where !candidates.contains(server.url) {
        candidates.append(server.url)
    }

    for candidate in candidates {
        if await probe(candidate) { return candidate }
    }

    throw KnownServerResolutionError.noReachableAddress
}

/// Addresses in `group` attributed to `peerNodeID`, same ordering as
/// `resolveReachableServer` (`lastGoodURL` first, then `servers` in
/// priority order) but filtered to entries whose own `KnownServer
/// .peerNodeID` matches — `docs/architecture/peer-groups.md` §3.7: refresh
/// tokens are never synced across peer nodes, so a refresh retry only
/// makes sense against another address of the *same* node that issued the
/// token being refreshed, never a genuinely different one (which is
/// guaranteed to reject a token it never issued). `peerNodeID` is
/// typically the current session's access token's `iss` claim, decoded via
/// `JWTClaims.issuerPeerID(ofAccessToken:)` — a routing hint only, no
/// signature verification. An address with no recorded `peerNodeID`
/// (`nil` — see that property's own doc comment) never matches, so a
/// group with no attribution at all yields an empty list here rather than
/// "every address," a fail-closed default matching this function's whole
/// purpose. `AccessTokenCoordinator`'s refresh-retry loop is the one real
/// caller; `resolveReachableServer` (plain reachability probing, not
/// token-scoped) is deliberately unaffected by any of this.
public func sameNodeAddresses(in group: KnownServerGroup, peerNodeID: UUID) -> [String] {
    var candidates: [String] = []
    if let lastGoodURL = group.lastGoodURL,
       group.servers.first(where: { $0.url == lastGoodURL })?.peerNodeID == peerNodeID {
        candidates.append(lastGoodURL)
    }
    for server in group.servers
    where server.peerNodeID == peerNodeID && !candidates.contains(server.url) {
        candidates.append(server.url)
    }
    return candidates
}
