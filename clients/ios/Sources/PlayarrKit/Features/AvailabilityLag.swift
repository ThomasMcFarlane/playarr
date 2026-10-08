import Foundation

/// Presentation helpers for `AvailabilityLag` (`GET /api/v1/catalog/{id}/availability-lag`).
public extension AvailabilityLag {
    /// The headline shown on a title page.
    var primaryLine: String {
        guard let averageSeconds else { return "No availability data yet" }
        return "Usually available about \(Self.humanDuration(seconds: averageSeconds)) after release"
    }

    /// Whole-unit duration such as "2 hours" or "3 days".
    static func humanDuration(seconds: Int64) -> String {
        let minute: Int64 = 60
        let hour: Int64 = 3600
        let day: Int64 = 86_400
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
