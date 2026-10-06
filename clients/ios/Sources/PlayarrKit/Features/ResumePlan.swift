import Foundation

/// Swift mirror of the smart Start/Resume schemas in
/// `backend/openapi/playarr.yaml` (`ResumePlan`, `ResumeOption`,
/// `ResumeChoiceRequest`). The rules live on the server
/// (`docs/architecture/smart-resume.md`); clients only render the plan.
public enum ResumeAction: String, Codable, Hashable, Sendable {
    case start
    case resume
    case restart
    /// A value this client does not know; treated like `resume`.
    case unknown

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ResumeAction(rawValue: raw) ?? .unknown
    }
}

public enum ResumeOptionKind: String, Codable, Hashable, Sendable {
    case unfinished
    case missedEpisode = "missed_episode"
    case continueFromLastWatched = "continue_from_last_watched"
    case nextInSeries = "next_in_series"
    case startOver = "start_over"
    case unknown

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ResumeOptionKind(rawValue: raw) ?? .unknown
    }

    /// Short caption saying why a chooser option is offered.
    public var caption: String {
        switch self {
        case .unfinished: return "Unfinished"
        case .missedEpisode: return "Missed episode"
        case .continueFromLastWatched: return "Continue from last watched"
        case .nextInSeries: return "Next in series"
        case .startOver: return "Start over"
        case .unknown: return "Episode"
        }
    }
}

public struct ResumeOption: Codable, Hashable, Identifiable, Sendable {
    public var kind: ResumeOptionKind
    public var episodeID: UUID
    public var mediaFileID: UUID
    public var seasonNumber: Int
    public var episodeNumber: Int
    public var episodeNumberEnd: Int?
    /// `S01E05`, or `S01E01-E02` for a multi-episode file.
    public var label: String
    public var title: String?
    public var positionMS: Int64
    public var durationMS: Int64
    public var progressPercent: Int
    public var lastWatchedAt: String?
    public var anchorEpisodeID: UUID?

    public var id: String { "\(kind.rawValue)-\(episodeID.uuidString)" }

    enum CodingKeys: String, CodingKey {
        case kind
        case episodeID = "episode_id"
        case mediaFileID = "media_file_id"
        case seasonNumber = "season_number"
        case episodeNumber = "episode_number"
        case episodeNumberEnd = "episode_number_end"
        case label
        case title
        case positionMS = "position_ms"
        case durationMS = "duration_ms"
        case progressPercent = "progress_percent"
        case lastWatchedAt = "last_watched_at"
        case anchorEpisodeID = "anchor_episode_id"
    }

    public init(
        kind: ResumeOptionKind,
        episodeID: UUID,
        mediaFileID: UUID,
        seasonNumber: Int,
        episodeNumber: Int,
        episodeNumberEnd: Int? = nil,
        label: String,
        title: String? = nil,
        positionMS: Int64 = 0,
        durationMS: Int64 = 0,
        progressPercent: Int = 0,
        lastWatchedAt: String? = nil,
        anchorEpisodeID: UUID? = nil
    ) {
        self.kind = kind
        self.episodeID = episodeID
        self.mediaFileID = mediaFileID
        self.seasonNumber = seasonNumber
        self.episodeNumber = episodeNumber
        self.episodeNumberEnd = episodeNumberEnd
        self.label = label
        self.title = title
        self.positionMS = positionMS
        self.durationMS = durationMS
        self.progressPercent = progressPercent
        self.lastWatchedAt = lastWatchedAt
        self.anchorEpisodeID = anchorEpisodeID
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = try c.decode(ResumeOptionKind.self, forKey: .kind)
        episodeID = try c.decode(UUID.self, forKey: .episodeID)
        mediaFileID = try c.decode(UUID.self, forKey: .mediaFileID)
        seasonNumber = try c.decode(Int.self, forKey: .seasonNumber)
        episodeNumber = try c.decode(Int.self, forKey: .episodeNumber)
        episodeNumberEnd = try c.decodeIfPresent(Int.self, forKey: .episodeNumberEnd)
        label = try c.decode(String.self, forKey: .label)
        title = try c.decodeIfPresent(String.self, forKey: .title)
        positionMS = try c.decodeIfPresent(Int64.self, forKey: .positionMS) ?? 0
        durationMS = try c.decodeIfPresent(Int64.self, forKey: .durationMS) ?? 0
        progressPercent = try c.decodeIfPresent(Int.self, forKey: .progressPercent) ?? 0
        lastWatchedAt = try c.decodeIfPresent(String.self, forKey: .lastWatchedAt)
        anchorEpisodeID = try c.decodeIfPresent(UUID.self, forKey: .anchorEpisodeID)
    }
}

public struct ResumePlan: Codable, Hashable, Identifiable, Sendable {
    public var seriesWorkID: UUID
    public var action: ResumeAction
    /// Deterministic server-side reason code (for logs and tests).
    public var reason: String
    public var needsChoice: Bool
    public var askReasons: [String]
    public var target: ResumeOption?
    public var options: [ResumeOption]

    public var id: UUID { seriesWorkID }

    /// True when the chooser must be shown (several options to pick from).
    public var isStacked: Bool { needsChoice && options.count > 1 }

    /// What a plain tap plays when no choice is needed.
    public var playableTarget: ResumeOption? { target ?? options.first }

    /// Label of the series primary button.
    public var buttonLabel: String {
        switch action {
        case .start: return "Start"
        case .resume, .unknown: return "Resume"
        case .restart: return "Watch again"
        }
    }

    enum CodingKeys: String, CodingKey {
        case seriesWorkID = "series_work_id"
        case action
        case reason
        case needsChoice = "needs_choice"
        case askReasons = "ask_reasons"
        case target
        case options
    }

    public init(
        seriesWorkID: UUID,
        action: ResumeAction,
        reason: String = "",
        needsChoice: Bool = false,
        askReasons: [String] = [],
        target: ResumeOption? = nil,
        options: [ResumeOption] = []
    ) {
        self.seriesWorkID = seriesWorkID
        self.action = action
        self.reason = reason
        self.needsChoice = needsChoice
        self.askReasons = askReasons
        self.target = target
        self.options = options
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        seriesWorkID = try c.decode(UUID.self, forKey: .seriesWorkID)
        action = try c.decode(ResumeAction.self, forKey: .action)
        reason = try c.decodeIfPresent(String.self, forKey: .reason) ?? ""
        needsChoice = try c.decodeIfPresent(Bool.self, forKey: .needsChoice) ?? false
        askReasons = try c.decodeIfPresent([String].self, forKey: .askReasons) ?? []
        target = try c.decodeIfPresent(ResumeOption.self, forKey: .target)
        options = try c.decodeIfPresent([ResumeOption].self, forKey: .options) ?? []
    }
}

public struct ResumeChoiceRequest: Codable, Hashable, Sendable {
    public var kind: ResumeOptionKind
    public var episodeID: UUID

    enum CodingKeys: String, CodingKey {
        case kind
        case episodeID = "episode_id"
    }

    public init(kind: ResumeOptionKind, episodeID: UUID) {
        self.kind = kind
        self.episodeID = episodeID
    }
}

/// Client for the smart Start/Resume endpoints. Every call degrades to `nil`
/// or an empty list when the server does not offer the contract (404/501), so
/// callers fall back to the previous behaviour.
public struct ResumePlanClient: Sendable {
    private let transport: any PlayarrRequestTransport

    public init(transport: any PlayarrRequestTransport) {
        self.transport = transport
    }

    /// `GET /api/v1/catalog/{id}/resume-plan`.
    public func plan(seriesID: UUID) async throws -> ResumePlan? {
        do {
            return try await transport.getJSON(Self.path(seriesID, "resume-plan"), as: ResumePlan.self)
        } catch let error as APIError where Self.isUnsupported(error) {
            return nil
        }
    }

    /// `POST /api/v1/catalog/{id}/resume-plan/choice`; returns the updated plan.
    @discardableResult
    public func recordChoice(seriesID: UUID, option: ResumeOption) async throws -> ResumePlan? {
        do {
            let body = ResumeChoiceRequest(kind: option.kind, episodeID: option.episodeID)
            return try await transport.sendJSON(
                method: "POST",
                Self.path(seriesID, "resume-plan/choice"),
                body: body,
                as: ResumePlan.self
            )
        } catch let error as APIError where Self.isUnsupported(error) {
            return nil
        }
    }

    /// `GET /api/v1/playback/resume-plans`: series with history, newest first.
    public func plans() async throws -> [ResumePlan] {
        do {
            return try await transport.getJSON("/api/v1/playback/resume-plans", as: [ResumePlan].self)
        } catch let error as APIError where Self.isUnsupported(error) {
            return []
        }
    }

    private static func path(_ seriesID: UUID, _ tail: String) -> String {
        "/api/v1/catalog/\(seriesID.uuidString.lowercased())/\(tail)"
    }

    private static func isUnsupported(_ error: APIError) -> Bool {
        switch error {
        case .notFound: return true
        case .http(let status, _, _): return status == 501
        default: return false
        }
    }
}
