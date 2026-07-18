import Foundation
import StreamarrKit
import XCTest

final class AppUpdateEvaluatorTests: XCTestCase {
    private let compatibility = CompatibilityEntry(
        platform: .ios,
        latestVersion: "1.4.0",
        minSupportedVersion: "1.2.0"
    )

    func testBlocksVersionsBelowMinimum() {
        XCTAssertEqual(
            AppUpdateEvaluator.evaluate(installedVersion: "1.1.9", entry: compatibility),
            .blocked(minSupportedVersion: "1.2.0")
        )
    }

    func testNudgesSupportedOutdatedVersions() {
        XCTAssertEqual(
            AppUpdateEvaluator.evaluate(installedVersion: "1.3.2", entry: compatibility),
            .softNudge(latestVersion: "1.4.0")
        )
    }

    func testAcceptsCurrentAndNewerVersions() {
        XCTAssertEqual(
            AppUpdateEvaluator.evaluate(installedVersion: "1.4", entry: compatibility),
            .upToDate
        )
        XCTAssertEqual(
            AppUpdateEvaluator.evaluate(installedVersion: "2.0.0", entry: compatibility),
            .upToDate
        )
    }
}
