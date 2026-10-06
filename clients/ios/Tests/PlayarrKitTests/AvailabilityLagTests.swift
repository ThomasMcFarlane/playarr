import Foundation
import PlayarrKit
import XCTest

final class AvailabilityLagTests: XCTestCase {
    func testNoSamplesSaysSo() {
        XCTAssertEqual(AvailabilityLag().primaryLine, "No availability data yet")
    }

    func testHeadlineUsesTheLargestWholeUnit() {
        XCTAssertEqual(AvailabilityLag.humanDuration(seconds: 90), "2 minutes")
        XCTAssertEqual(AvailabilityLag.humanDuration(seconds: 3600), "1 hour")
        XCTAssertEqual(AvailabilityLag.humanDuration(seconds: 3 * 86_400), "3 days")
        XCTAssertEqual(
            AvailabilityLag(averageSeconds: 7200, sampleCount: 4).primaryLine,
            "Usually available about 2 hours after release"
        )
    }

    func testDecodesTheServerShape() async throws {
        let transport = StubTransport { _ in
            Data(#"{"average_seconds":null,"sample_count":0,"backfill_count":1,"unknown_count":0,"backfill_threshold_days":14,"samples":[]}"#.utf8)
        }
        let id = UUID()
        let lag = try await transport.availabilityLag(workID: id)
        XCTAssertNil(lag.averageSeconds)
        XCTAssertEqual(lag.backfillCount, 1)
        XCTAssertEqual(transport.calls.first?.path, "/api/v1/catalog/\(id.uuidString.lowercased())/availability-lag")
    }
}
