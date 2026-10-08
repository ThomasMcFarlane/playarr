import Foundation

/// One rail in the viewer's Home layout (`RailPreferenceEntry`).
public struct RailPreferenceEntry: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let kind: String
    public let title: String
    public var hidden: Bool

    public init(id: String, kind: String, title: String, hidden: Bool) {
        self.id = id
        self.kind = kind
        self.title = title
        self.hidden = hidden
    }
}

struct RailPreferencesResponse: Codable, Sendable {
    var rails: [RailPreferenceEntry]
}

struct RailPreferencesRequest: Codable, Sendable {
    var order: [String]
    var hidden: [String]
}

/// Pure list edits behind the Customise Home screen (mirrors web `homeRailPrefs.ts`).
public enum HomeRailEdits {
    /// Moves a rail one place up (-1) or down (+1); unchanged at the ends.
    public static func move(_ entries: [RailPreferenceEntry], id: String, by direction: Int) -> [RailPreferenceEntry] {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return entries }
        let target = index + direction
        guard target >= 0, target < entries.count else { return entries }
        var next = entries
        next.swapAt(index, target)
        return next
    }

    public static func toggle(_ entries: [RailPreferenceEntry], id: String) -> [RailPreferenceEntry] {
        entries.map { entry in
            var copy = entry
            if entry.id == id { copy.hidden.toggle() }
            return copy
        }
    }
}

/// `GET`, `PUT` and `DELETE /api/v1/home/rails/preferences`.
public struct HomeRailPreferencesClient: Sendable {
    private let transport: any PlayarrRequestTransport

    public init(transport: any PlayarrRequestTransport) {
        self.transport = transport
    }

    public func load(language: String?) async throws -> [RailPreferenceEntry] {
        var query: [URLQueryItem] = []
        if let language { query.append(URLQueryItem(name: "lang", value: language)) }
        let response: RailPreferencesResponse = try await transport.getJSON(
            "/api/v1/home/rails/preferences", query: query
        )
        return response.rails
    }

    /// Saves the full order plus the hidden set.
    public func save(_ entries: [RailPreferenceEntry]) async throws {
        let body = RailPreferencesRequest(
            order: entries.map(\.id),
            hidden: entries.filter(\.hidden).map(\.id)
        )
        let _: RailPreferencesResponse = try await transport.sendJSON(
            method: "PUT", "/api/v1/home/rails/preferences", body: body
        )
    }

    public func reset() async throws {
        try await transport.sendNoContent(
            method: "DELETE", "/api/v1/home/rails/preferences", expectedStatuses: [200, 204]
        )
    }
}
