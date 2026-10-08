import Foundation

extension TitleSnapshot {
    /// The snapshot web builds for a library title page.
    public init(work: Work) {
        let year = work.releaseDate.flatMap { Int32($0.prefix(4)) }
        self.init(
            kind: work.kind.rawValue,
            title: work.title,
            workID: work.id,
            year: year,
            posterURL: nil,
            externalRefs: work.externalRefs
        )
    }
}

/// The merged real-world title the server answers with (`DiscoveryTitle`).
public struct DiscoveryTitle: Codable, Sendable, Hashable, Identifiable {
    public var titleKey: String
    public var kind: String
    public var title: String
    public var year: Int32?
    public var overview: String?
    public var posterURL: String?
    public var externalRefs: [ExternalRef]?
    public var sources: [TitleSource]?
    public var id: String { titleKey }

    enum CodingKeys: String, CodingKey {
        case kind, title, year, overview, sources
        case externalRefs = "external_refs"
        case titleKey = "title_key"
        case posterURL = "poster_url"
    }
}

/// `ResolvedTitle`: whether the title is on the caller's watchlist.
public struct ResolvedTitle: Codable, Sendable, Hashable {
    public var title: DiscoveryTitle
    public var inWatchlist: Bool
    public var actions: [TitleAction]?

    enum CodingKeys: String, CodingKey {
        case title, actions
        case inWatchlist = "in_watchlist"
    }
}

/// One watchlist row: the resolved title plus when it was added.
public struct WatchlistEntry: Codable, Sendable, Hashable, Identifiable {
    public var title: DiscoveryTitle
    public var inWatchlist: Bool
    public var actions: [TitleAction]?
    public var addedAt: Date
    public var id: String { title.titleKey }

    enum CodingKeys: String, CodingKey {
        case title, actions
        case inWatchlist = "in_watchlist"
        case addedAt = "added_at"
    }
}

struct WatchlistResponse: Decodable, Sendable {
    var items: [WatchlistEntry]
}

/// Watchlist API: list, resolve, add and remove.
public struct WatchlistClient: Sendable {
    private let transport: any PlayarrRequestTransport

    public init(transport: any PlayarrRequestTransport) {
        self.transport = transport
    }

    public func list() async throws -> [WatchlistEntry] {
        let response: WatchlistResponse = try await transport.getJSON("/api/v1/watchlist")
        return response.items
    }

    /// `POST /api/v1/discover/resolve`: learn the title key and whether it is listed.
    public func resolve(_ snapshot: TitleSnapshot) async throws -> ResolvedTitle {
        try await transport.sendJSON(method: "POST", "/api/v1/discover/resolve", body: snapshot)
    }

    /// `POST /api/v1/watchlist` (idempotent).
    public func add(_ snapshot: TitleSnapshot) async throws -> ResolvedTitle {
        try await transport.sendJSON(method: "POST", "/api/v1/watchlist", body: snapshot)
    }

    /// `DELETE /api/v1/watchlist/{title_key}`.
    public func remove(titleKey: String) async throws {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove("/")
        let encoded = titleKey.addingPercentEncoding(withAllowedCharacters: allowed) ?? titleKey
        try await transport.sendNoContent(
            method: "DELETE", "/api/v1/watchlist/\(encoded)", expectedStatuses: [200, 204]
        )
    }
}
