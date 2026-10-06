import Foundation

/// `GET /api/v1/catalog/{id}/availability-lag`: how long a title usually takes to appear after release.
public struct AvailabilityLag: Codable, Sendable, Hashable {
    public var averageSeconds: Int64?
    public var sampleCount: Int32
    public var backfillCount: Int32
    public var unknownCount: Int32
    public var backfillThresholdDays: Int32

    enum CodingKeys: String, CodingKey {
        case averageSeconds = "average_seconds"
        case sampleCount = "sample_count"
        case backfillCount = "backfill_count"
        case unknownCount = "unknown_count"
        case backfillThresholdDays = "backfill_threshold_days"
    }

    public init(
        averageSeconds: Int64? = nil,
        sampleCount: Int32 = 0,
        backfillCount: Int32 = 0,
        unknownCount: Int32 = 0,
        backfillThresholdDays: Int32 = 0
    ) {
        self.averageSeconds = averageSeconds
        self.sampleCount = sampleCount
        self.backfillCount = backfillCount
        self.unknownCount = unknownCount
        self.backfillThresholdDays = backfillThresholdDays
    }

    /// The headline shown on a title page.
    public var primaryLine: String {
        guard let averageSeconds else { return "No availability data yet" }
        return "Usually available about \(Self.humanDuration(seconds: averageSeconds)) after release"
    }

    /// Whole-unit duration such as "2 hours" or "3 days".
    public static func humanDuration(seconds: Int64) -> String {
        let minute: Int64 = 60, hour: Int64 = 3600, day: Int64 = 86_400
        func unit(_ value: Int64, _ name: String) -> String { "\(value) \(name)\(value == 1 ? "" : "s")" }
        if seconds >= day { return unit((seconds + day / 2) / day, "day") }
        if seconds >= hour { return unit((seconds + hour / 2) / hour, "hour") }
        return unit(max(1, (seconds + minute / 2) / minute), "minute")
    }
}

public extension PlayarrRequestTransport {
    func availabilityLag(workID: UUID) async throws -> AvailabilityLag {
        try await getJSON("/api/v1/catalog/\(workID.uuidString.lowercased())/availability-lag")
    }
}
