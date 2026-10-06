import Foundation

/// Which family of on-screen data a change touches.
public enum LiveArea: String, CaseIterable, Hashable, Sendable {
    case work
    case progress
    case home
    case library
    case search
    case calendar
    case playlist
    case watchlist
    case downloads
    case household
    case account
    case admin
}

/// A refetchable unit. A `nil` id means every id of the area.
public struct LiveTarget: Hashable, Sendable {
    public var area: LiveArea
    public var id: String?

    public init(_ area: LiveArea, id: String? = nil) {
        self.area = area
        self.id = id
    }
}

/// What to refetch. `everything` (resync) and `poll` (fallback tick, reconnect
/// catch-up) match every consumer.
public struct LiveInvalidation: Equatable, Sendable {
    public var targets: Set<LiveTarget>
    public var everything: Bool
    public var poll: Bool

    public init(targets: Set<LiveTarget> = [], everything: Bool = false, poll: Bool = false) {
        self.targets = targets
        self.everything = everything
        self.poll = poll
    }

    public var affectedAreas: Set<LiveArea> {
        if everything || poll { return Set(LiveArea.allCases) }
        return Set(targets.map(\.area))
    }
}

/// The design doc's event-to-refetch table (`docs/architecture/live-events.md`).
public enum LiveEventMapper {
    /// Targets for a change, or `nil` for an unknown type (ignored).
    public static func targets(for change: LiveChange) -> Set<LiveTarget>? {
        let id: String? = change.entity == "*" ? nil : change.id
        let bulk = change.entity == "*" || change.changed.contains("bulk")
        switch change.type {
        case "watch":
            return [LiveTarget(.work, id: id), LiveTarget(.progress), LiveTarget(.home)]
        case "library":
            if bulk {
                return [
                    LiveTarget(.work), LiveTarget(.library), LiveTarget(.home),
                    LiveTarget(.search), LiveTarget(.calendar), LiveTarget(.playlist),
                ]
            }
            return [LiveTarget(.work, id: id), LiveTarget(.library), LiveTarget(.home), LiveTarget(.search)]
        case "calendar":
            return [LiveTarget(.calendar)]
        case "playlist":
            return [LiveTarget(.playlist, id: id)]
        case "watchlist":
            return [LiveTarget(.watchlist)]
        case "download":
            return [LiveTarget(.downloads)]
        case "household":
            return [LiveTarget(.household)]
        case "account":
            return [
                LiveTarget(.account), LiveTarget(.household), LiveTarget(.library),
                LiveTarget(.home), LiveTarget(.search),
            ]
        case "admin":
            return [LiveTarget(.admin)]
        default:
            return nil
        }
    }

    /// The invalidation an event implies, or `nil` when it needs no refetch.
    public static func invalidation(for event: LiveEvent) -> LiveInvalidation? {
        switch event {
        case .ready:
            return nil
        case .resync:
            return LiveInvalidation(everything: true)
        case .change(let change):
            return targets(for: change).map { LiveInvalidation(targets: $0) }
        }
    }
}
