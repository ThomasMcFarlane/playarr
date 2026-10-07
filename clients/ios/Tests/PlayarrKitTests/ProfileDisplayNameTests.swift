import Foundation
import PlayarrKit
import XCTest

final class ProfileDisplayNameTests: XCTestCase {
    private let viewer = UUID()
    private let guardian = UUID()

    private func profiles(currentIsViewer: Bool = true) -> [AvailableProfile] {
        [
            AvailableProfile(id: guardian, username: "fx-guardian", displayName: "Fixture Guardian", pinLocked: true, isCurrent: !currentIsViewer),
            AvailableProfile(id: viewer, username: "fx-viewer", displayName: "Fixture Viewer", pinLocked: false, isCurrent: currentIsViewer),
        ]
    }

    func testShowsTheDisplayNameNotTheUsername() {
        XCTAssertEqual(ProfileDisplayName.resolve(profiles: profiles(), currentUserID: viewer), "Fixture Viewer")
    }

    func testMatchesTheSignedInUserBeforeTheCurrentFlag() {
        XCTAssertEqual(
            ProfileDisplayName.resolve(profiles: profiles(currentIsViewer: false), currentUserID: viewer),
            "Fixture Viewer"
        )
    }

    func testFallsBackToTheCurrentFlagWithoutAUserId() {
        XCTAssertEqual(ProfileDisplayName.resolve(profiles: profiles(), currentUserID: nil), "Fixture Viewer")
    }

    func testKeepsTheFallbackWhenTheListIsEmptyOrBlank() {
        XCTAssertEqual(ProfileDisplayName.resolve(profiles: [], currentUserID: viewer, fallback: "Kept"), "Kept")
        let blank = [AvailableProfile(id: viewer, username: "fx-viewer", displayName: "  ", pinLocked: false, isCurrent: true)]
        XCTAssertEqual(ProfileDisplayName.resolve(profiles: blank, currentUserID: viewer, fallback: "Kept"), "Kept")
        XCTAssertNil(ProfileDisplayName.resolve(profiles: [], currentUserID: nil))
    }
}
