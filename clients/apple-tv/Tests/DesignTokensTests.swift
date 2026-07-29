import XCTest
@testable import PlayarrTV

/// Locks the live SPA dark stage palette (playarr.example.com) and arr tokens.
final class DesignTokensTests: XCTestCase {
    func testStageBackgroundMatchesLiveDarkTheme() {
        XCTAssertEqual(DesignTokens.Hex.backgroundBase, "#151315")
        XCTAssertEqual(DesignTokens.Hex.backgroundElevated, "#1b181b")
    }

    func testBrandPinkMatchesLiveAccent() {
        XCTAssertEqual(DesignTokens.Hex.brandPrimary, "#cf3157")
        XCTAssertEqual(DesignTokens.Hex.focusRing, "#cf3157")
    }

    func testInkColoursMatchLiveDarkTheme() {
        XCTAssertEqual(DesignTokens.Hex.textPrimary, "#f4f0f1")
        XCTAssertEqual(DesignTokens.Hex.textSecondary, "#c5b8bd")
    }

    func testArrPackageTokensRemainAvailable() {
        XCTAssertEqual(DesignTokens.Hex.arrBackgroundBase, "#202020")
        XCTAssertEqual(DesignTokens.Hex.arrBrandPrimary, "#5d9cec")
        XCTAssertEqual(DesignTokens.Hex.arrTextPrimary, "#cccccc")
    }

    func testSpacingScaleMatchesDesignTokens() {
        XCTAssertEqual(DesignTokens.Spacing.xs, 4)
        XCTAssertEqual(DesignTokens.Spacing.sm, 8)
        XCTAssertEqual(DesignTokens.Spacing.md, 16)
        XCTAssertEqual(DesignTokens.Spacing.lg, 24)
        XCTAssertEqual(DesignTokens.Spacing.xl, 32)
        XCTAssertEqual(DesignTokens.Spacing.xxl, 48)
        XCTAssertEqual(DesignTokens.Spacing.xxxl, 64)
    }

    func testTypeScaleMatchesDesignTokens() {
        XCTAssertEqual(DesignTokens.TypeScale.bodySize, 14)
        XCTAssertEqual(DesignTokens.TypeScale.titleSize, 24)
        XCTAssertEqual(DesignTokens.TypeScale.displaySize, 50)
        XCTAssertEqual(DesignTokens.TypeScale.heroTitleSize, 72)
    }

    func testFocusMotionMatchesDesignTokens() {
        XCTAssertEqual(DesignTokens.FocusMotion.restScale, 1)
        XCTAssertEqual(DesignTokens.FocusMotion.focusScale, 1.08, accuracy: 0.0001)
        XCTAssertEqual(DesignTokens.FocusMotion.transitionSeconds, 0.15, accuracy: 0.0001)
    }

    func testHomeCardDimensionsMatchLiveRails() {
        XCTAssertEqual(TVTheme.workTileWidth, 220)
        XCTAssertEqual(TVTheme.workTileHeight, 124)
    }

    func testCanvasIs1920x1080() {
        XCTAssertEqual(TVTheme.canvasWidth, 1920)
        XCTAssertEqual(TVTheme.canvasHeight, 1080)
    }

    func testShellNavItemSizeMatchesWeb() {
        XCTAssertEqual(DesignTokens.Shell.navItemSize, 64)
        XCTAssertEqual(DesignTokens.Shell.navEdge, 42)
        XCTAssertEqual(DesignTokens.Shell.searchContentLeft, 154)
        XCTAssertEqual(DesignTokens.Shell.searchCopyTop, 130)
        XCTAssertEqual(DesignTokens.Shell.searchFormHeight, 76)
        XCTAssertEqual(DesignTokens.Shell.homeCardWidth, 219)
        XCTAssertEqual(DesignTokens.Shell.homeCardHeight, 123)
        XCTAssertEqual(DesignTokens.Shell.homeCardGap, 25)
        XCTAssertEqual(DesignTokens.Shell.railLeftInset, 0.38, accuracy: 0.001)
        XCTAssertEqual(DesignTokens.Shell.railTrackLeftFade, 160)
        XCTAssertEqual(DesignTokens.Shell.titlePanelTopFraction, 0.24, accuracy: 0.001)
        XCTAssertEqual(DesignTokens.Shell.titlePanelLeft, 154)
    }

    func testRadiusScale() {
        XCTAssertEqual(DesignTokens.Radius.sm, 4)
        XCTAssertEqual(DesignTokens.Radius.md, 6)
        XCTAssertEqual(DesignTokens.Radius.card, 12)
    }
}
