#if os(macOS)
import AppKit
import CoreGraphics
import Foundation
import SwiftUI
import XCTest
@testable import PlayarrTV

/// The Mac's arrow-key focus: geometric moves, the web TV rules.
final class MacFocusEngineTests: XCTestCase {
    private func card(_ x: CGFloat, _ y: CGFloat, w: CGFloat = 200, h: CGFloat = 300) -> CGRect {
        CGRect(x: x, y: y, width: w, height: h)
    }

    func testDownLandsOnTheCardVisuallyBelowNotTheSameIndex() {
        // The top rail is scrolled: the focused card sits at x 900. The lower rail starts at x 100.
        let focused = card(900, 100)
        let below = (0..<8).map { (UUID(), card(100 + CGFloat($0) * 220, 500)) }
        let pick = MacFocusEngine.nearest(from: focused, direction: .down, in: below)
        XCTAssertEqual(pick, below[4].0) // x 980, centre 1000 = the focused centre
    }

    func testDownPrefersTheNearestRowOverACloserCentreFurtherDown() {
        let focused = card(900, 100)
        let nextRow = (UUID(), card(600, 500))
        let rowAfter = (UUID(), card(900, 900))
        XCTAssertEqual(MacFocusEngine.nearest(from: focused, direction: .down, in: [nextRow, rowAfter]), nextRow.0)
    }

    func testRightStaysInTheRowAndTakesTheNearestCard() {
        let focused = card(100, 100)
        let next = (UUID(), card(320, 100))
        let later = (UUID(), card(540, 100))
        let otherRow = (UUID(), card(330, 500))
        XCTAssertEqual(MacFocusEngine.nearest(from: focused, direction: .right, in: [later, otherRow, next]), next.0)
    }

    func testLeftFromTheRailHeadReachesTheNav() {
        let focused = card(300, 400)
        let nav = (UUID(), CGRect(x: 20, y: 120, width: 60, height: 60))
        XCTAssertEqual(MacFocusEngine.nearest(from: focused, direction: .left, in: [nav]), nav.0)
    }

    func testNothingAheadKeepsFocus() {
        let focused = card(100, 100)
        XCTAssertNil(MacFocusEngine.nearest(from: focused, direction: .up, in: [(UUID(), card(400, 500))]))
    }

    /// A real window: hover-free keyboard focus lands on a target, and Right moves it to the next button.
    /// Needs an active session (CI); skipped where no window can become key (a locked Mac).
    @MainActor
    func testArrowMovesKeyboardFocusInAWindow() async throws {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 960, height: 540),
                              styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = NSHostingView(rootView: MacTVStage {
            HStack(spacing: 200) {
                Button("First") {}
                Button("Second") {}
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .macFocusLayer()
        })
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        window.makeFirstResponder(window.contentView)
        defer { window.orderOut(nil) }
        let engine = MacFocusEngine.shared
        func wait(_ condition: () -> Bool) async -> Bool {
            for _ in 0..<40 {
                if condition() { return true }
                try? await Task.sleep(for: .milliseconds(100))
            }
            return condition()
        }
        guard await wait({ window.isKeyWindow }) else { throw XCTSkip("no key window in this session") }
        let registered = await wait({ engine.targets.values.filter { $0.layer == engine.topLayer }.count == 2 })
        XCTAssertTrue(registered, "both buttons are focus targets in the top layer")
        let settled = await wait({ engine.focusedID != nil })
        XCTAssertTrue(settled, "the settle step focuses the layer's first target")
        let first = engine.focusedID
        engine.move(.right)
        let moved = await wait({ engine.focusedID != nil && engine.focusedID != first })
        XCTAssertTrue(moved, "Right moves focus")
        engine.move(.left)
        let back = await wait({ engine.focusedID == first })
        XCTAssertTrue(back, "Left comes back")
    }
}
#endif
