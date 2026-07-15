import Foundation

// MIRROR NOTE: see the note at the top of Work.swift — `series.rs` did not
// exist on disk at scaffold time, only `pub use series::{Episode, Season,
// Series}` in `lib.rs`. Fields below are inferred, not verified.

/// A TV/episodic show. Distinct from `Work` because a series has its own
/// season/episode hierarchy under it; `seriesID` on `Season`/`Episode` ties
/// back to this, and `workID` links the series to its catalog-level `Work`
/// record (poster art, external refs, availability, etc. all live on the
/// `Work`, not duplicated here).
public struct Series: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var workID: UUID
    public var title: String
    public var sortTitle: String
    public var overview: String?
    public var firstAirDate: Date?
    public var status: SeriesStatus
    public var seasonCount: Int
    public var episodeCount: Int
    public var genres: [String]
    public var createdAt: Date
    public var updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case workID = "work_id"
        case title
        case sortTitle = "sort_title"
        case overview
        case firstAirDate = "first_air_date"
        case status
        case seasonCount = "season_count"
        case episodeCount = "episode_count"
        case genres
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    public init(
        id: UUID,
        workID: UUID,
        title: String,
        sortTitle: String,
        overview: String? = nil,
        firstAirDate: Date? = nil,
        status: SeriesStatus,
        seasonCount: Int = 0,
        episodeCount: Int = 0,
        genres: [String] = [],
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.workID = workID
        self.title = title
        self.sortTitle = sortTitle
        self.overview = overview
        self.firstAirDate = firstAirDate
        self.status = status
        self.seasonCount = seasonCount
        self.episodeCount = episodeCount
        self.genres = genres
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public enum SeriesStatus: String, Codable, Sendable, CaseIterable, Hashable {
    case continuing
    case ended
    case cancelled
}

public struct Season: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var seriesID: UUID
    public var seasonNumber: Int
    public var title: String?
    public var overview: String?
    public var episodeCount: Int
    public var images: [ImageAsset]

    enum CodingKeys: String, CodingKey {
        case id
        case seriesID = "series_id"
        case seasonNumber = "season_number"
        case title
        case overview
        case episodeCount = "episode_count"
        case images
    }

    public init(
        id: UUID,
        seriesID: UUID,
        seasonNumber: Int,
        title: String? = nil,
        overview: String? = nil,
        episodeCount: Int = 0,
        images: [ImageAsset] = []
    ) {
        self.id = id
        self.seriesID = seriesID
        self.seasonNumber = seasonNumber
        self.title = title
        self.overview = overview
        self.episodeCount = episodeCount
        self.images = images
    }
}

public struct Episode: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var seasonID: UUID
    public var seriesID: UUID
    public var episodeNumber: Int
    public var title: String
    public var overview: String?
    public var airDate: Date?
    public var runtimeMinutes: Int?
    public var images: [ImageAsset]

    enum CodingKeys: String, CodingKey {
        case id
        case seasonID = "season_id"
        case seriesID = "series_id"
        case episodeNumber = "episode_number"
        case title
        case overview
        case airDate = "air_date"
        case runtimeMinutes = "runtime_minutes"
        case images
    }

    public init(
        id: UUID,
        seasonID: UUID,
        seriesID: UUID,
        episodeNumber: Int,
        title: String,
        overview: String? = nil,
        airDate: Date? = nil,
        runtimeMinutes: Int? = nil,
        images: [ImageAsset] = []
    ) {
        self.id = id
        self.seasonID = seasonID
        self.seriesID = seriesID
        self.episodeNumber = episodeNumber
        self.title = title
        self.overview = overview
        self.airDate = airDate
        self.runtimeMinutes = runtimeMinutes
        self.images = images
    }
}
