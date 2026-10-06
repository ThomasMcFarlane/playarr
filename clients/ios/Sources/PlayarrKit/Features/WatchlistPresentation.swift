import Foundation

/// A source-aware thing the viewer can do with a title (`TitleAction`). Disabled
/// actions come with a reason so a client can explain rather than hide them.
public struct TitleAction: Codable, Sendable, Hashable {
    public var action: String
    public var enabled: Bool
    public var mediaFileID: UUID?
    public var positionMs: Int64?
    public var reason: String?
    public var workID: UUID?

    enum CodingKeys: String, CodingKey {
        case action, enabled, reason
        case mediaFileID = "media_file_id"
        case positionMs = "position_ms"
        case workID = "work_id"
    }

    public init(
        action: String,
        enabled: Bool,
        mediaFileID: UUID? = nil,
        positionMs: Int64? = nil,
        reason: String? = nil,
        workID: UUID? = nil
    ) {
        self.action = action
        self.enabled = enabled
        self.mediaFileID = mediaFileID
        self.positionMs = positionMs
        self.reason = reason
        self.workID = workID
    }

    /// The label web shows on the button (`discovery.action.*`).
    public var label: String {
        switch action {
        case "play": "Play"
        case "resume": "Resume"
        case "request": "Request"
        case "record": "Record"
        case "launch": "Launch"
        default: action.capitalized
        }
    }
}

/// One source's claim on a title (`TitleSource`).
public struct TitleSource: Codable, Sendable, Hashable {
    public var source: String
    public var label: String
    public var workID: UUID?
    public var reason: String?

    enum CodingKeys: String, CodingKey {
        case source, label, reason
        case workID = "work_id"
    }

    /// The chip web shows for a source kind (`discovery.source.*`).
    public static func chipLabel(_ source: String) -> String {
        switch source {
        case "library": "Library"
        case "peer": "Peer server"
        case "request": "Requestable"
        case "live_tv": "Live TV"
        case "game": "Game"
        default: source
        }
    }
}

/// The mapping web's `lib/discovery.ts` applies to a watchlist row, so every
/// client picks the same primary action, chips and explanations.
public enum WatchlistPresentation {
    /// Highest priority first: resuming beats starting over, requesting beats recording.
    private static let priority = ["resume", "play", "request", "launch", "record"]

    public static func primaryAction(_ actions: [TitleAction]) -> TitleAction? {
        for kind in priority {
            if let match = actions.first(where: { $0.action == kind && $0.enabled }) { return match }
        }
        return nil
    }

    /// Disabled actions worth explaining (those with a reason), in priority order.
    public static func explainedDisabledActions(_ actions: [TitleAction]) -> [TitleAction] {
        priority.flatMap { kind in
            actions.filter { $0.action == kind && !$0.enabled && ($0.reason?.isEmpty == false) }
        }
    }

    /// Source kinds in first-seen order, without repeats.
    public static func uniqueSourceKinds(_ sources: [TitleSource]) -> [String] {
        var seen: [String] = []
        for source in sources where !seen.contains(source.source) { seen.append(source.source) }
        return seen
    }

    /// The library work a row opens, when one of its sources is the library.
    public static func libraryWorkID(_ title: DiscoveryTitle) -> UUID? {
        guard ["movie", "series", "site", "artist"].contains(title.kind) else { return nil }
        return title.sources?.first(where: { $0.source == "library" && $0.workID != nil })?.workID
    }

    /// Snapshot web sends when a watchlist row's Request button is pressed.
    public static func requestSnapshot(for title: DiscoveryTitle) -> TitleSnapshot {
        TitleSnapshot(
            kind: title.kind,
            title: title.title,
            workID: nil,
            year: title.year,
            posterURL: title.posterURL,
            externalRefs: title.externalRefs ?? []
        )
    }
}
