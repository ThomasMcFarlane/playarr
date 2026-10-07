@testable import PlayarrApp
import XCTest

final class PlayerStagePhaseTests: XCTestCase {
    /// Pressing Play mounts the player stage immediately: no state before playback is an interstitial.
    func testEveryStateBeforePlaybackIsTheStageNotAnInterstitial() {
        XCTAssertEqual(PlayerStagePhase.resolve(nil), .stage)
        XCTAssertEqual(PlayerStagePhase.resolve(.idle), .stage)
        XCTAssertEqual(PlayerStagePhase.resolve(.loadingPlaybackInfo), .stage)
    }

    func testPlaybackAndErrorsStayInsideThePlayer() {
        XCTAssertEqual(PlayerStagePhase.resolve(.playing), .playing)
        XCTAssertEqual(PlayerStagePhase.resolve(.failed("x")), .failed("x"))
    }
}
