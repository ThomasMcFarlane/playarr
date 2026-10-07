import XCTest
@testable import PlayarrTV

/// Locks the pieces of the web parity work that are pure functions.
final class TVWebParityTests: XCTestCase {
    /// Same values as the web's `defaultProfileAvatarPreset` (hash of the user id modulo six presets).
    func testAvatarPresetFollowsTheWebHash() {
        XCTAssertEqual(TVProfileAvatar.presetIndex(for: "user-1"), 1)
        XCTAssertEqual(TVProfileAvatar.presetIndex(for: "user-2"), 2)
        XCTAssertEqual(TVProfileAvatar.presetIndex(for: "aefbc393-ee42-4de9-81d5-6177f8738cff"), 2)
        XCTAssertEqual(TVProfileAvatar.presetIndex(for: "00000000-0000-4000-8000-000000000001"), 5)
        XCTAssertEqual(TVProfileAvatar.presetIndex(for: ""), 0)
    }

    func testSVGPathParsesRelativeAndImplicitCommands() {
        let box = TVSVGPath.parse("M10 10h20v20h-20Z").boundingRect
        XCTAssertEqual(box.minX, 10, accuracy: 0.001)
        XCTAssertEqual(box.maxX, 30, accuracy: 0.001)
        XCTAssertEqual(box.maxY, 30, accuracy: 0.001)
        // `m` followed by more pairs continues with relative line-tos.
        let moved = TVSVGPath.parse("m5 5 10 0 0 10").boundingRect
        XCTAssertEqual(moved.maxX, 15, accuracy: 0.001)
        XCTAssertEqual(moved.maxY, 15, accuracy: 0.001)
    }

    func testRuntimeAndDateFormatsMatchTheWeb() {
        XCTAssertEqual(TVWebFormat.runtime(ms: 6_000), "1 min")
        XCTAssertEqual(TVWebFormat.runtime(ms: 104 * 60_000), "1h 44m")
        XCTAssertEqual(TVWebFormat.runtime(ms: 120 * 60_000), "2h")
        XCTAssertNil(TVWebFormat.runtime(ms: nil))
        XCTAssertEqual(TVWebFormat.date("2020-06-01"), "1 Jun 2020")
        XCTAssertEqual(TVWebFormat.clock(ms: 125_000), "2:05")
    }

    func testTitleWrapBreaksAtWordBoundaries() {
        let lines = TVTextWrap.lines(
            "Sample Series 1",
            fontName: "AvenirNext-DemiBold",
            size: 69.12,
            kern: -4.98,
            width: 379.5
        )
        XCTAssertEqual(lines.joined(separator: " "), "Sample Series 1")
        XCTAssertGreaterThan(lines.count, 1)
    }
}

/// Player remote behaviour: BACK sequence, SELECT on the scrubber, focus across seeks, direct mount.
final class TVPlayerInteractionTests: XCTestCase {
    func testBackClosesMenuThenControlsThenExits() {
        var state = TVPlayerInteraction()
        state.openQualityMenu()
        XCTAssertEqual(state.back(), .closedMenu)
        XCTAssertEqual(state.focus, .quality, "focus returns to the control that opened the panel")
        XCTAssertTrue(state.controlsVisible)
        XCTAssertEqual(state.back(), .hidControls)
        XCTAssertEqual(state.back(), .exit)
    }

    func testBackWithControlsOpenHidesThemFirst() {
        var state = TVPlayerInteraction()
        XCTAssertEqual(state.back(), .hidControls)
        XCTAssertFalse(state.controlsVisible)
        XCTAssertEqual(state.back(), .exit)
    }

    func testSelectOnScrubberOnlyTogglesPlayPause() {
        var state = TVPlayerInteraction(focus: .scrubber)
        XCTAssertEqual(state.select(), .togglePlayPause)
        XCTAssertEqual(state.focus, .scrubber)
        XCTAssertFalse(state.menuOpen)
    }

    func testSelectWithHiddenControlsOnlyRevealsThem() {
        var state = TVPlayerInteraction(focus: .scrubber, controlsVisible: false)
        XCTAssertNil(state.select())
        XCTAssertTrue(state.controlsVisible)
    }

    func testScrubberKeepsFocusAcrossRepeatedSeeks() {
        var state = TVPlayerInteraction(focus: .scrubber)
        for _ in 0..<20 {
            state.seeked()
            XCTAssertEqual(state.focus, .scrubber)
        }
    }

    func testPlayMountsTheChromeDirectlyWithOnlyASpinnerWhileNegotiating() {
        XCTAssertEqual(TVPlayerStage.resolve(.idle), .chrome(videoAttached: false, spinner: true))
        XCTAssertEqual(TVPlayerStage.resolve(.negotiating), .chrome(videoAttached: false, spinner: true))
        XCTAssertEqual(TVPlayerStage.resolve(.ready), .chrome(videoAttached: true, spinner: false))
        XCTAssertEqual(TVPlayerStage.resolve(.failed("x")), .failed("x"))
    }
}
