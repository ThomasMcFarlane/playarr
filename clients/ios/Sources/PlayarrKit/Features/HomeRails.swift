import Foundation

/// One server-computed Home rail (`HomeRailResponse`). The server omits empty
/// rails, orders them per the viewer's preferences and localises `title`.
public struct ServerHomeRail: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    /// `recently_added`, `recently_released`, `top_unwatched`, `rediscover`,
    /// `seasonal` or `custom`. Kept as a string so a newer server kind still renders.
    public let kind: String
    public let library: String?
    public let title: String
    public let titleKey: String
    public let viewID: String?
    public let items: [Work]
    public let total: Int64

    enum CodingKeys: String, CodingKey {
        case id, kind, library, title
        case titleKey = "title_key"
        case viewID = "view_id"
        case items, total
    }

    public init(
        id: String,
        kind: String,
        library: String? = nil,
        title: String,
        titleKey: String = "",
        viewID: String? = nil,
        items: [Work],
        total: Int64? = nil
    ) {
        self.id = id
        self.kind = kind
        self.library = library
        self.title = title
        self.titleKey = titleKey
        self.viewID = viewID
        self.items = items
        self.total = total ?? Int64(items.count)
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = try c.decode(String.self, forKey: .kind)
        library = try c.decodeIfPresent(String.self, forKey: .library)
        title = try c.decode(String.self, forKey: .title)
        titleKey = try c.decodeIfPresent(String.self, forKey: .titleKey) ?? ""
        viewID = try c.decodeIfPresent(String.self, forKey: .viewID)
        items = try c.decodeIfPresent([Work].self, forKey: .items) ?? []
        total = try c.decodeIfPresent(Int64.self, forKey: .total) ?? Int64(items.count)
    }
}

/// `GET /api/v1/home/rails` response body.
public struct ServerHomeRailsResponse: Codable, Sendable {
    public let rails: [ServerHomeRail]
    public let lang: String

    enum CodingKeys: String, CodingKey {
        case rails, lang
    }

    public init(rails: [ServerHomeRail], lang: String = "en") {
        self.rails = rails
        self.lang = lang
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        rails = try c.decodeIfPresent([ServerHomeRail].self, forKey: .rails) ?? []
        lang = try c.decodeIfPresent(String.self, forKey: .lang) ?? "en"
    }
}

public struct HomeRailsClient: Sendable {
    private let transport: PlayarrRequestTransport

    public init(transport: PlayarrRequestTransport) {
        self.transport = transport
    }

    /// Languages the server can title rails in; anything else falls back to English.
    public static let supportedLanguages: [String] = ["en", "th", "ja"]

    /// Maps a BCP 47 locale identifier (for example `th-TH`) to a supported rail language.
    public static func railLanguage(forLocaleIdentifier identifier: String) -> String {
        let base = identifier
            .split(whereSeparator: { $0 == "-" || $0 == "_" })
            .first
            .map { String($0).lowercased() } ?? "en"
        return supportedLanguages.contains(base) ? base : "en"
    }

    /// Fetches the viewer's rails. Returns `nil` when the server predates the
    /// endpoint (404) so callers can fall back to the legacy Home, and drops
    /// any rail with no items defensively.
    public func fetchRails(language: String? = nil) async -> Result<[ServerHomeRail]?, Error> {
        do {
            var query: [URLQueryItem] = []
            if let language { query.append(URLQueryItem(name: "lang", value: language)) }
            let response: ServerHomeRailsResponse = try await transport.getJSON("/api/v1/home/rails", query: query)
            return .success(response.rails.filter { !$0.items.isEmpty })
        } catch APIError.notFound {
            return .success(nil)
        } catch {
            return .failure(error)
        }
    }
}
