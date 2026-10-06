import Foundation

/// Wire models for `GET /api/v1/calendar` and the `/api/v1/calendar/feed`
/// subscription endpoints (`docs/architecture/release-calendar.md`).
///
/// Day values (`date`, `start`, `end`) are `YYYY-MM-DD` strings in UTC. They are kept as strings
/// so no time zone can shift them; use `CalendarDays` to do arithmetic on them.
public enum CalendarMediaKind: String, Sendable, Hashable, CaseIterable {
    case episode
    case movie
    case album
    case book
}

public struct CalendarEntrySource: Codable, Sendable, Equatable, Hashable {
    public let sourceInstanceID: UUID
    public let sourceName: String
    public let sourceKind: String
    public let arrID: Int64

    public init(sourceInstanceID: UUID, sourceName: String, sourceKind: String, arrID: Int64) {
        self.sourceInstanceID = sourceInstanceID
        self.sourceName = sourceName
        self.sourceKind = sourceKind
        self.arrID = arrID
    }

    enum CodingKeys: String, CodingKey {
        case sourceInstanceID = "source_instance_id"
        case sourceName = "source_name"
        case sourceKind = "source_kind"
        case arrID = "arr_id"
    }
}

public struct CalendarEntry: Codable, Sendable, Equatable, Hashable, Identifiable {
    public let id: String
    /// `episode`, `movie`, `album` or `book`; kept raw so a newer server never breaks decoding.
    public let mediaKind: String
    /// `air`, `cinema`, `digital`, `physical` or `release`.
    public let releaseType: String
    public let title: String
    public let subtitle: String?
    public let seasonNumber: Int?
    public let episodeNumber: Int?
    /// UTC day of the release (`YYYY-MM-DD`).
    public let date: String
    public let releaseAt: Date?
    public let monitored: Bool
    public let hasFile: Bool
    public let posterURL: String?
    public let workID: UUID?
    public let averageLagSeconds: Int64?
    public let sources: [CalendarEntrySource]

    public init(
        id: String,
        mediaKind: String,
        releaseType: String = "air",
        title: String,
        subtitle: String? = nil,
        seasonNumber: Int? = nil,
        episodeNumber: Int? = nil,
        date: String,
        releaseAt: Date? = nil,
        monitored: Bool = false,
        hasFile: Bool = false,
        posterURL: String? = nil,
        workID: UUID? = nil,
        averageLagSeconds: Int64? = nil,
        sources: [CalendarEntrySource] = []
    ) {
        self.id = id
        self.mediaKind = mediaKind
        self.releaseType = releaseType
        self.title = title
        self.subtitle = subtitle
        self.seasonNumber = seasonNumber
        self.episodeNumber = episodeNumber
        self.date = date
        self.releaseAt = releaseAt
        self.monitored = monitored
        self.hasFile = hasFile
        self.posterURL = posterURL
        self.workID = workID
        self.averageLagSeconds = averageLagSeconds
        self.sources = sources
    }

    public var kind: CalendarMediaKind? { CalendarMediaKind(rawValue: mediaKind) }

    enum CodingKeys: String, CodingKey {
        case id
        case mediaKind = "media_kind"
        case releaseType = "release_type"
        case title
        case subtitle
        case seasonNumber = "season_number"
        case episodeNumber = "episode_number"
        case date
        case releaseAt = "release_at"
        case monitored
        case hasFile = "has_file"
        case posterURL = "poster_url"
        case workID = "work_id"
        case averageLagSeconds = "average_lag_seconds"
        case sources
    }
}

public struct CalendarSourceStatus: Codable, Sendable, Equatable, Hashable, Identifiable {
    public let sourceInstanceID: UUID
    public let name: String
    public let kind: String
    /// `ok`, `unreachable`, `rejected` or `error`.
    public let status: String
    public let error: String?
    public let entryCount: Int

    public var id: UUID { sourceInstanceID }
    public var isOK: Bool { status == "ok" }

    public init(sourceInstanceID: UUID, name: String, kind: String, status: String, error: String? = nil, entryCount: Int = 0) {
        self.sourceInstanceID = sourceInstanceID
        self.name = name
        self.kind = kind
        self.status = status
        self.error = error
        self.entryCount = entryCount
    }

    enum CodingKeys: String, CodingKey {
        case sourceInstanceID = "source_instance_id"
        case name
        case kind
        case status
        case error
        case entryCount = "entry_count"
    }
}

public struct CalendarResponse: Codable, Sendable, Equatable {
    public let start: String
    public let end: String
    public let entries: [CalendarEntry]
    public let sources: [CalendarSourceStatus]

    public init(start: String, end: String, entries: [CalendarEntry], sources: [CalendarSourceStatus] = []) {
        self.start = start
        self.end = end
        self.entries = entries
        self.sources = sources
    }
}

public struct CalendarFeedStatus: Codable, Sendable, Equatable {
    public let active: Bool
    public let createdAt: Date?
    public let lastUsedAt: Date?

    public init(active: Bool, createdAt: Date? = nil, lastUsedAt: Date? = nil) {
        self.active = active
        self.createdAt = createdAt
        self.lastUsedAt = lastUsedAt
    }

    enum CodingKeys: String, CodingKey {
        case active
        case createdAt = "created_at"
        case lastUsedAt = "last_used_at"
    }
}

public struct CalendarFeedCreated: Codable, Sendable, Equatable {
    /// Full subscription URL. The server returns it once; it stores only a hash.
    public let url: String
    public let token: String
    public let createdAt: Date

    public init(url: String, token: String, createdAt: Date) {
        self.url = url
        self.token = token
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case url
        case token
        case createdAt = "created_at"
    }
}
