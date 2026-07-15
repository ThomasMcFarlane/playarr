import Foundation

// MIRROR NOTE: see the note at the top of Work.swift — `policy.rs` did not
// exist on disk at scaffold time, only `pub use policy::{AccessWindow,
// Policy, TimeRange, Weekday}` in `lib.rs`. Fields below are inferred, not
// verified.

/// Per-user (or per-user-class) playback/access restrictions — concurrent
/// stream caps, bitrate ceilings, download permission, and time-of-day
/// access windows (e.g. parental controls).
public struct Policy: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var name: String
    public var maxConcurrentStreams: Int?
    public var maxBitrateKbps: Int?
    public var allowDownloads: Bool
    public var allowTranscoding: Bool
    public var accessWindows: [AccessWindow]
    public var createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case maxConcurrentStreams = "max_concurrent_streams"
        case maxBitrateKbps = "max_bitrate_kbps"
        case allowDownloads = "allow_downloads"
        case allowTranscoding = "allow_transcoding"
        case accessWindows = "access_windows"
        case createdAt = "created_at"
    }

    public init(
        id: UUID,
        name: String,
        maxConcurrentStreams: Int? = nil,
        maxBitrateKbps: Int? = nil,
        allowDownloads: Bool = false,
        allowTranscoding: Bool = true,
        accessWindows: [AccessWindow] = [],
        createdAt: Date
    ) {
        self.id = id
        self.name = name
        self.maxConcurrentStreams = maxConcurrentStreams
        self.maxBitrateKbps = maxBitrateKbps
        self.allowDownloads = allowDownloads
        self.allowTranscoding = allowTranscoding
        self.accessWindows = accessWindows
        self.createdAt = createdAt
    }
}

/// A recurring weekly window (e.g. "Monday 15:00-19:00") during which a
/// `Policy` permits playback.
public struct AccessWindow: Codable, Hashable, Sendable {
    public var weekday: Weekday
    public var range: TimeRange

    enum CodingKeys: String, CodingKey {
        case weekday
        case range
    }

    public init(weekday: Weekday, range: TimeRange) {
        self.weekday = weekday
        self.range = range
    }
}

/// A time-of-day range expressed as minutes since midnight (`0..<1440`), to
/// stay timezone-and-DST-agnostic on the wire; the client is responsible
/// for interpreting it against the user's local clock.
public struct TimeRange: Codable, Hashable, Sendable {
    public var startMinuteOfDay: Int
    public var endMinuteOfDay: Int

    enum CodingKeys: String, CodingKey {
        case startMinuteOfDay = "start_minute_of_day"
        case endMinuteOfDay = "end_minute_of_day"
    }

    public init(startMinuteOfDay: Int, endMinuteOfDay: Int) {
        self.startMinuteOfDay = startMinuteOfDay
        self.endMinuteOfDay = endMinuteOfDay
    }
}

public enum Weekday: String, Codable, Sendable, CaseIterable, Hashable {
    case monday
    case tuesday
    case wednesday
    case thursday
    case friday
    case saturday
    case sunday
}
