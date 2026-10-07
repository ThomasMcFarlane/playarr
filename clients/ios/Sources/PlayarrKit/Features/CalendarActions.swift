import Foundation

/// A title as the request, watchlist and resolve endpoints take it (`TitleSnapshot` in
/// `backend/openapi/playarr.yaml`). A calendar entry carries one; clients send it back unchanged.
public struct TitleSnapshot: Codable, Sendable, Hashable {
    public var kind: String
    public var title: String
    public var workID: UUID?
    public var year: Int32?
    public var posterURL: String?
    public var externalRefs: [ExternalRef]

    enum CodingKeys: String, CodingKey {
        case kind, title, year
        case workID = "work_id"
        case posterURL = "poster_url"
        case externalRefs = "external_refs"
    }

    public init(
        kind: String,
        title: String,
        workID: UUID? = nil,
        year: Int32? = nil,
        posterURL: String? = nil,
        externalRefs: [ExternalRef] = []
    ) {
        self.kind = kind
        self.title = title
        self.workID = workID
        self.year = year
        self.posterURL = posterURL
        self.externalRefs = externalRefs
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = try c.decode(String.self, forKey: .kind)
        title = try c.decode(String.self, forKey: .title)
        workID = try c.decodeIfPresent(UUID.self, forKey: .workID)
        year = try c.decodeIfPresent(Int32.self, forKey: .year)
        posterURL = try c.decodeIfPresent(String.self, forKey: .posterURL)
        externalRefs = try c.decodeIfPresent([ExternalRef].self, forKey: .externalRefs) ?? []
    }
}

/// One server-computed action on a calendar entry (`CalendarAction`): computed for the caller
/// (library access, household limits, request provider, existing requests, watchlist). Clients
/// show exactly these; a disabled one carries a `reason` to explain it.
public struct CalendarAction: Codable, Sendable, Hashable {
    /// `open`, `play`, `resume`, `request` or `watchlist`; kept raw so a newer server never breaks decoding.
    public let action: String
    public let enabled: Bool
    public let reason: String?
    public let workID: UUID?
    public let mediaFileID: UUID?
    public let positionMs: UInt64?
    /// `watchlist`: already on the caller's watchlist. `request`: already requested.
    public let active: Bool

    public var kind: CalendarActionKind? { CalendarActionKind(rawValue: action) }

    public init(
        action: String,
        enabled: Bool = true,
        reason: String? = nil,
        workID: UUID? = nil,
        mediaFileID: UUID? = nil,
        positionMs: UInt64? = nil,
        active: Bool = false
    ) {
        self.action = action
        self.enabled = enabled
        self.reason = reason
        self.workID = workID
        self.mediaFileID = mediaFileID
        self.positionMs = positionMs
        self.active = active
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        action = try c.decode(String.self, forKey: .action)
        enabled = try c.decode(Bool.self, forKey: .enabled)
        reason = try c.decodeIfPresent(String.self, forKey: .reason)
        workID = try c.decodeIfPresent(UUID.self, forKey: .workID)
        mediaFileID = try c.decodeIfPresent(UUID.self, forKey: .mediaFileID)
        positionMs = try c.decodeIfPresent(UInt64.self, forKey: .positionMs)
        active = try c.decodeIfPresent(Bool.self, forKey: .active) ?? false
    }

    enum CodingKeys: String, CodingKey {
        case action, enabled, reason, active
        case workID = "work_id"
        case mediaFileID = "media_file_id"
        case positionMs = "position_ms"
    }
}

public enum CalendarActionKind: String, Sendable {
    case open, play, resume, request, watchlist
}

public extension CalendarEntry {
    /// The server's action of this kind for the entry, if it offers one.
    func action(_ kind: CalendarActionKind) -> CalendarAction? {
        actions.first { $0.kind == kind }
    }
}
