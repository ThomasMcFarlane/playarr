import Foundation

/// Lifecycle of a request, identical across systems (`RequestStatus`).
public enum RequestStatus: String, Codable, Sendable, Hashable, CaseIterable {
    case pending, approved, declined, available, failed

    /// The wording web shows (`pages.requests.status.*`).
    public var label: String {
        switch self {
        case .pending: "Waiting for approval"
        case .approved: "Approved"
        case .declined: "Declined"
        case .available: "Available"
        case .failed: "Failed"
        }
    }
}

/// A request as shown to a signed-in user (`RequestView`). Only the requester
/// (and administrators) see a requester's name.
public struct RequestView: Codable, Sendable, Hashable, Identifiable {
    public var id: UUID
    public var title: String
    public var kind: String
    public var year: Int32?
    public var seasons: [Int32]
    public var status: RequestStatus
    public var statusNote: String?
    public var origin: String
    public var mine: Bool
    public var requestedBy: String?
    public var posterURL: String?
    public var systems: [String]
    public var createdAt: Date
    public var updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id, title, kind, year, seasons, status, origin, mine, systems
        case statusNote = "status_note"
        case requestedBy = "requested_by"
        case posterURL = "poster_url"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    /// "Requested by you" / "Requested by <name>", or nil when the server names nobody.
    public var requesterLabel: String? {
        guard let requestedBy, !requestedBy.isEmpty else { return nil }
        return mine ? "Requested by you" : "Requested by \(requestedBy)"
    }
}

/// `RequestResult`: what the request provider answered to a new request.
public struct RequestResult: Codable, Sendable, Hashable {
    public var status: String
    public var providerInstanceID: UUID
    public var requestID: UUID?
    public var requestStatus: RequestStatus?

    enum CodingKeys: String, CodingKey {
        case status
        case providerInstanceID = "provider_instance_id"
        case requestID = "request_id"
        case requestStatus = "request_status"
    }
}

/// Requests API: list the caller's requests and ask for a title.
///
/// Web offers a viewer one action, "Request" (`POST /api/v1/discover/request`).
/// The server decides whether the caller may, so a refusal surfaces as the
/// server's own error text. Administrators use the same call; they also get
/// everyone's requests from the list (`mine: false`).
public struct RequestsClient: Sendable {
    private let transport: any PlayarrRequestTransport

    public init(transport: any PlayarrRequestTransport) {
        self.transport = transport
    }

    /// `GET /api/v1/requests`, newest first. `mine` is only sent when given:
    /// `false` asks an administrator for every request, `true` for their own.
    public func list(mine: Bool? = nil) async throws -> [RequestView] {
        let query = mine.map { [URLQueryItem(name: "mine", value: $0 ? "true" : "false")] } ?? []
        return try await transport.getJSON("/api/v1/requests", query: query)
    }

    /// `POST /api/v1/discover/request`.
    public func request(_ snapshot: TitleSnapshot) async throws -> RequestResult {
        try await transport.sendJSON(method: "POST", "/api/v1/discover/request", body: snapshot)
    }
}
