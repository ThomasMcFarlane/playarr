import Foundation

/// Release Calendar API: the aggregated window plus the external iCal subscription.
public struct CalendarClient: Sendable {
    private let transport: PlayarrRequestTransport

    public init(transport: PlayarrRequestTransport) {
        self.transport = transport
    }

    /// `GET /api/v1/calendar`. The server rejects spans over 92 days.
    public func calendar(
        start: String,
        end: String,
        kinds: Set<CalendarMediaKind> = [],
        sourceInstanceID: UUID? = nil
    ) async throws -> CalendarResponse {
        var query = [
            URLQueryItem(name: "start", value: start),
            URLQueryItem(name: "end", value: end)
        ]
        if !kinds.isEmpty {
            let joined = kinds.map(\.rawValue).sorted().joined(separator: ",")
            query.append(URLQueryItem(name: "kind", value: joined))
        }
        if let sourceInstanceID {
            query.append(URLQueryItem(name: "source_instance_id", value: sourceInstanceID.uuidString.lowercased()))
        }
        return try await transport.getJSON("/api/v1/calendar", query: query)
    }

    public func feedStatus() async throws -> CalendarFeedStatus {
        try await transport.getJSON("/api/v1/calendar/feed")
    }

    /// Creates a new subscription; any previous token stops working.
    public func createFeed() async throws -> CalendarFeedCreated {
        let data = try await transport.requestData(
            method: "POST", path: "/api/v1/calendar/feed", query: [], body: nil, expectedStatuses: [200, 201]
        )
        do {
            return try PlayarrJSONCoding.makeDecoder().decode(CalendarFeedCreated.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }

    public func revokeFeed() async throws {
        try await transport.sendNoContent(method: "DELETE", "/api/v1/calendar/feed", expectedStatuses: [200, 204])
    }
}
