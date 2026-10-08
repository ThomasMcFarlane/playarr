import Foundation
import PlayarrKit
import XCTest

final class AvailabilityLagTests: XCTestCase {
    private func lag(_ json: String) throws -> AvailabilityLag {
        try JSONDecoder().decode(AvailabilityLag.self, from: Data(json.utf8))
    }

    func testNoSamplesSaysSo() throws {
        let empty = try lag(#"{"average_seconds":null,"sample_count":0,"backfill_count":0,"unknown_count":0,"backfill_threshold_days":14}"#)
        XCTAssertEqual(empty.primaryLine, "No availability data yet")
    }

    func testHeadlineUsesTheLargestWholeUnit() throws {
        XCTAssertEqual(AvailabilityLag.humanDuration(seconds: 90), "2 minutes")
        XCTAssertEqual(AvailabilityLag.humanDuration(seconds: 3600), "1 hour")
        XCTAssertEqual(AvailabilityLag.humanDuration(seconds: 3 * 86_400), "3 days")
        let sampled = try lag(#"{"average_seconds":7200,"sample_count":4,"backfill_count":0,"unknown_count":0,"backfill_threshold_days":14}"#)
        XCTAssertEqual(sampled.primaryLine, "Usually available about 2 hours after release")
    }

    func testDecodesTheServerShape() async throws {
        let transport = StubTransport { _ in
            Data(#"{"average_seconds":null,"sample_count":0,"backfill_count":1,"unknown_count":0,"backfill_threshold_days":14,"samples":[]}"#.utf8)
        }
        let id = UUID()
        let result = try await transport.availabilityLag(workID: id)
        XCTAssertNil(result.averageSeconds)
        XCTAssertEqual(result.backfillCount, 1)
        XCTAssertEqual(transport.calls.first?.path, "/api/v1/catalog/\(id.uuidString.lowercased())/availability-lag")
    }
}
