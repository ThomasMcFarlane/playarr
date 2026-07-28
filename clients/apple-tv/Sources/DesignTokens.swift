import SwiftUI

/// Design tokens for Apple TV.
///
/// **Stage palette** mirrors the live deployed SPA dark theme
/// (`clients/tv-web/web/src/styles/global.css` `:root[data-theme="dark"]`),
/// which is the visual reference at `https://playarr.example.com`.
///
/// **Arr palette** (`Hex.arr*`) mirrors `@playarr-tv/design-tokens` for
/// ui-tv / *arr-family accents (brand primary blue, focus ring).
enum DesignTokens {
    /// Live SPA dark stage (Gleb Kuznetsov TV surface).
    enum Stage {
        static let bg = SwiftUI.Color(red: 0x15 / 255, green: 0x13 / 255, blue: 0x15 / 255) // #151315
        static let surface = SwiftUI.Color(red: 0x1b / 255, green: 0x18 / 255, blue: 0x1b / 255) // #1b181b
        static let surfaceStrong = SwiftUI.Color(red: 0x21 / 255, green: 0x1d / 255, blue: 0x21 / 255) // #211d21
        static let surfaceSoft = SwiftUI.Color(red: 0x31 / 255, green: 0x2a / 255, blue: 0x30 / 255) // #312a30
        static let ink = SwiftUI.Color(red: 0xf4 / 255, green: 0xf0 / 255, blue: 0xf1 / 255) // #f4f0f1
        static let inkSoft = SwiftUI.Color(red: 0xc5 / 255, green: 0xb8 / 255, blue: 0xbd / 255) // #c5b8bd
        static let inkMuted = SwiftUI.Color(red: 0x88 / 255, green: 0x7a / 255, blue: 0x82 / 255) // #887a82
        static let accentSoft = SwiftUI.Color(red: 0x67 / 255, green: 0x59 / 255, blue: 0x61 / 255) // #675961
        static let brandPink = SwiftUI.Color(red: 0xcf / 255, green: 0x31 / 255, blue: 0x57 / 255) // #cf3157
        static let danger = SwiftUI.Color(red: 0xee / 255, green: 0x92 / 255, blue: 0x97 / 255)
        static let success = SwiftUI.Color(red: 0x7f / 255, green: 0xc0 / 255, blue: 0x9d / 255)
    }

    /// *arr design-tokens package (ui-tv shells).
    enum Arr {
        static let backgroundBase = SwiftUI.Color(red: 0x20 / 255, green: 0x20 / 255, blue: 0x20 / 255)
        static let backgroundElevated = SwiftUI.Color(red: 0x2a / 255, green: 0x2a / 255, blue: 0x2a / 255)
        static let backgroundRaised = SwiftUI.Color(red: 0x33 / 255, green: 0x33 / 255, blue: 0x33 / 255)
        static let textPrimary = SwiftUI.Color(red: 0xcc / 255, green: 0xcc / 255, blue: 0xcc / 255)
        static let textSecondary = SwiftUI.Color(red: 0x99 / 255, green: 0x99 / 255, blue: 0x99 / 255)
        static let brandPrimary = SwiftUI.Color(red: 0x5d / 255, green: 0x9c / 255, blue: 0xec / 255)
        static let brandAccent = SwiftUI.Color(red: 0xe5 / 255, green: 0x48 / 255, blue: 0x4d / 255)
        static let stateError = SwiftUI.Color(red: 0xf0 / 255, green: 0x50 / 255, blue: 0x50 / 255)
        static let stateSuccess = SwiftUI.Color(red: 0x27 / 255, green: 0xc2 / 255, blue: 0x4c / 255)
    }

    // Back-compat aliases used across views (map to stage for live parity).
    enum Color {
        static let backgroundBase = Stage.bg
        static let backgroundElevated = Stage.surface
        static let backgroundRaised = Stage.surfaceSoft
        static let backgroundOverlay = SwiftUI.Color.black.opacity(0.7)
        static let backgroundInputDisabled = Stage.surfaceStrong
        static let textPrimary = Stage.ink
        static let textSecondary = Stage.inkSoft
        static let textDisabled = Stage.inkMuted
        static let textHelp = Stage.inkMuted
        static let textInverse = SwiftUI.Color.white
        static let brandPrimary = Stage.brandPink
        static let brandPrimaryHover = Stage.brandPink
        static let brandPrimaryPressed = Stage.brandPink
        static let brandAccent = Stage.brandPink
        static let focusRing = Stage.brandPink
        static let focusRingOffset = Stage.surface
        static let stateSuccess = Stage.success
        static let stateWarning = SwiftUI.Color.orange
        static let stateError = Stage.danger
        static let stateInfo = Arr.brandPrimary
        static let stateQueue = Arr.brandPrimary
        static let borderDefault = Stage.inkMuted.opacity(0.4)
        static let shadow = SwiftUI.Color.black
    }

    enum Spacing {
        static let none: CGFloat = 0
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 16
        static let lg: CGFloat = 24
        static let xl: CGFloat = 32
        static let xxl: CGFloat = 48
        static let xxxl: CGFloat = 64
    }

    enum Radius {
        static let none: CGFloat = 0
        static let sm: CGFloat = 4
        static let md: CGFloat = 6
        static let lg: CGFloat = 8
        static let full: CGFloat = 9999
        static let card: CGFloat = 12
        static let button: CGFloat = 4
        static let input: CGFloat = 9999 // pill search field
        static let badge: CGFloat = 2
        static let pill: CGFloat = 9999
        static let modal: CGFloat = 6
        static let navItem: CGFloat = 18
    }

    enum TypeScale {
        static let microSize: CGFloat = 11
        static let captionSize: CGFloat = 12
        static let bodySize: CGFloat = 14
        static let subtitleSize: CGFloat = 18
        static let titleSize: CGFloat = 24
        static let displaySize: CGFloat = 50
        static let heroTitleSize: CGFloat = 72

        static let microWeight: Font.Weight = .regular
        static let captionWeight: Font.Weight = .regular
        static let bodyWeight: Font.Weight = .regular
        static let bodyEmphasisWeight: Font.Weight = .bold
        static let subtitleWeight: Font.Weight = .light
        static let titleWeight: Font.Weight = .bold
        static let displayWeight: Font.Weight = .semibold
    }

    enum FocusMotion {
        static let restScale: CGFloat = 1
        static let focusScale: CGFloat = 1.08
        static let transitionSeconds: Double = 0.15
    }

    /// Shell layout from `.app-shell` CSS custom properties at 1920×1080
    /// (`--viewport-unit: 1vh` → 10.8px).
    enum Shell {
        static let canvasWidth: CGFloat = 1920
        static let canvasHeight: CGFloat = 1080
        /// 1vh at 1080p — CSS `--viewport-unit`.
        static let viewportUnit: CGFloat = 10.8
        /// `clamp(18px, 2.2vw, 44px)` @ 1920 → 42.24
        static let navEdge: CGFloat = 42
        static let navItemSize: CGFloat = 64
        /// `0.4rem` ≈ 6.4px at 16px root
        static let navPaddingInline: CGFloat = 6
        /// Gap inside `.app-nav-group` (0.6rem)
        static let navGroupGap: CGFloat = 10
        static let navGroupRadius: CGFloat = 22
        static let navGroupPadding: CGFloat = 7
        static let userAvatarSize: CGFloat = 34
        /// `clamp(34px, 5.2vh, 66px)` @ 1080 → 56
        static let headerTop: CGFloat = 56
        /// `clamp(30px, 2.35vw, 42px)` → 42
        static let logoSize: CGFloat = 42
        static let homeCardWidth: CGFloat = 220
        static let homeCardHeight: CGFloat = 124
        static let homeCardGap: CGFloat = 18
        static let railLeftInset: CGFloat = 0.38 // fraction of width
        static let titlePanelLeft: CGFloat = 200
        static let titlePanelTopFraction: CGFloat = 0.31
        static let titlePanelWidth: CGFloat = 480

        // MARK: Search page (`.tv-library-heading` + `.tv-search-copy` @ 1920×1080)

        /// `clamp(102px, 8vw, 160px)` → 154
        static let searchContentLeft: CGFloat = 154
        /// Heading top: `clamp(34px, 5.2vh, 66px)` → 56
        static let searchHeadingTop: CGFloat = 56
        /// h1: `clamp(1.2rem, 1.75vw, 2.35rem)` → ~34
        static let searchTitleSize: CGFloat = 34
        /// Back button: `clamp(38px, 2.8vw, 50px)` → 50
        static let searchBackSize: CGFloat = 50
        /// Copy top: `clamp(86px, 12vh, 142px)` → 130
        static let searchCopyTop: CGFloat = 130
        /// `min(31vw, 590px)` → 590
        static let searchCopyWidth: CGFloat = 590
        /// Form margin-top: `clamp(28px, 4vh, 52px)` → 43
        static let searchFormTopGap: CGFloat = 43
        /// Form min-height: `clamp(54px, 5vw, 76px)` → 76
        static let searchFormHeight: CGFloat = 76
        /// Filter control margin-top: `clamp(12px, 1.8vh, 22px)` → 19
        static let searchFilterTopGap: CGFloat = 19
        /// Prompt margin-top: `clamp(36px, 5vh, 66px)` → 54
        static let searchPromptTopGap: CGFloat = 54
        /// Empty-state art circle: `clamp(86px, 8vw, 132px)` → 132
        static let searchEmptyArtSize: CGFloat = 132
        /// Right rail is 62% of stage (`.tv-rail-surface` width).
        static let searchRailWidthFraction: CGFloat = 0.62
    }

    /// Hex lock strings for unit tests (stage + arr).
    enum Hex {
        static let backgroundBase = "#151315"
        static let backgroundElevated = "#1b181b"
        static let backgroundRaised = "#312a30"
        static let textPrimary = "#f4f0f1"
        static let textSecondary = "#c5b8bd"
        static let brandPrimary = "#cf3157"
        static let brandAccent = "#cf3157"
        static let focusRing = "#cf3157"
        static let stateError = "#ee9297"
        static let stateSuccess = "#7fc09d"
        static let borderDefault = "#887a82"
        // arr package lock
        static let arrBackgroundBase = "#202020"
        static let arrBrandPrimary = "#5d9cec"
        static let arrTextPrimary = "#cccccc"
    }
}
