import XCTest
@testable import PlayarrTV

/// Structural lock: Apple TV design tokens must stay byte-identical to
/// `clients/tv-web/packages/design-tokens/src/index.ts` hex values used by
/// the web/ui-tv reference surface.
final class DesignTokensTests: XCTestCase {
    func testBackgroundBaseMatchesDesignTokens() {
        XCTAssertEqual(DesignTokens.Hex.backgroundBase, "#202020")
    }

    func testBrandPrimaryMatchesDesignTokens() {
        XCTAssertEqual(DesignTokens.Hex.brandPrimary, "#5d9cec")
        XCTAssertEqual(DesignTokens.Hex.focusRing, "#5d9cec")
    }

    func testTextPrimaryMatchesDesignTokens() {
        XCTAssertEqual(DesignTokens.Hex.textPrimary, "#cccccc")
        XCTAssertEqual(DesignTokens.Hex.textSecondary, "#999999")
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
    }

    func testFocusMotionMatchesDesignTokens() {
        XCTAssertEqual(DesignTokens.FocusMotion.restScale, 1)
        XCTAssertEqual(DesignTokens.FocusMotion.focusScale, 1.08, accuracy: 0.0001)
        XCTAssertEqual(DesignTokens.FocusMotion.transitionSeconds, 0.15, accuracy: 0.0001)
    }

    func testWorkTileDimensionsMatchUiTvBrowseScreen() {
        XCTAssertEqual(TVTheme.workTileWidth, 240)
        XCTAssertEqual(TVTheme.workTileHeight, 135)
    }

    func testCanvasIs1920x1080() {
        XCTAssertEqual(TVTheme.canvasWidth, 1920)
        XCTAssertEqual(TVTheme.canvasHeight, 1080)
    }

    func testRadiusScaleMatchesDesignTokens() {
        XCTAssertEqual(DesignTokens.Radius.sm, 4)
        XCTAssertEqual(DesignTokens.Radius.md, 6)
        XCTAssertEqual(DesignTokens.Radius.card, 3)
        XCTAssertEqual(DesignTokens.Radius.button, 4)
    }

    func testBrandAccentAndErrorMatchDesignTokens() {
        XCTAssertEqual(DesignTokens.Hex.brandAccent, "#e5484d")
        XCTAssertEqual(DesignTokens.Hex.stateError, "#f05050")
        XCTAssertEqual(DesignTokens.Hex.stateSuccess, "#27c24c")
    }
}
