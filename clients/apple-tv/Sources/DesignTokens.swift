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
        // `.tv-home-card`: clamp(150px, 11.4vw, 225px) @ 1920 → 219; 16:9 art.
        static let homeCardWidth: CGFloat = 219
        static let homeCardHeight: CGFloat = 123
        // Track scroll gap: clamp(14px, 1.3vw, 26px) → 25.
        static let homeCardGap: CGFloat = 25
        // Measured SPA home card pitch (pink unwatched dots) @ 1920×1080.
        static let homeCardPitchX: CGFloat = 243
        /// First Start-watching card art top-left (measured from suite ref).
        static let homeCardOriginX: CGFloat = 879
        static let homeCardOriginY1: CGFloat = 489
        /// First New-movies card art top-left.
        static let homeCardOriginY2: CGFloat = 828
        /// Title block under home card art.
        static let homeCardTitleBlock: CGFloat = 36
        /// Rail heading sits above card art.
        static let homeRailHeadingOffsetY: CGFloat = 36
        // `.tv-home-rails { left: 38% }`
        static let railLeftInset: CGFloat = 0.38
        // `--tv-track-left-fade: clamp(88px, 8.8vw, 152px)` + 8px pad → 160.
        static let railTrackLeftFade: CGFloat = 160
        // Rails padding-block half viewport; first card pink top-right ≈ y 508 @ 1080.
        static let railContentTopFraction: CGFloat = 0.395
        // Gap between media tracks: clamp(38px, 5vh, 64px) → 54.
        static let railTrackGap: CGFloat = 54
        // `.tv-home-feature`: top 24%, left clamp(102,8vw,160)→154, width min(24vw,455)→455.
        static let titlePanelLeft: CGFloat = 154
        static let titlePanelTopFraction: CGFloat = 0.24
        static let titlePanelWidth: CGFloat = 455
        // Feature h2: clamp(2.2rem, 3.6vw, 5rem) → ~69.
        static let featureTitleSize: CGFloat = 69
        /// SPA detail h2 stacks "10 / Brambleford / Lane". Measured SPA
        /// "Brambleford" glyph run is ~300px at this size; 320 keeps the word
        /// intact while still wrapping "Lane" onto a third line.
        static let featureTitleMaxWidth: CGFloat = 320
        // Overview: clamp(0.58rem, 0.67vw, 0.84rem) → ~13.
        static let featureOverviewSize: CGFloat = 13
        /// SPA overview `max-width: 42ch` at small body size ≈ 300.
        static let featureOverviewMaxWidth: CGFloat = 300
        // Rail heading: clamp(0.76rem, 0.92vw, 1.18rem) → ~18.
        static let railHeadingSize: CGFloat = 18
        // SPA `.tv-key-art > span` watermark: top 28%, left 18%, max 34vw, weight 760, opacity 0.22.
        static let keyArtWatermarkTopFraction: CGFloat = 0.28
        static let keyArtWatermarkLeftFraction: CGFloat = 0.18
        static let keyArtWatermarkMaxWidthFraction: CGFloat = 0.34
        static let keyArtWatermarkSize: CGFloat = 120
        static let keyArtWatermarkOpacity: CGFloat = 0.22

        // MARK: Key art (`.tv-key-art img` @ 1920×1080 dark theme)
        /// `width: 52%`
        static let keyArtWidthFraction: CGFloat = 0.52
        /// `height: 106%`
        static let keyArtHeightFraction: CGFloat = 1.06
        /// `transform: scale(1.04)`
        static let keyArtScale: CGFloat = 1.04
        /// dark: `opacity: 0.72`
        static let keyArtOpacity: CGFloat = 0.72
        /// dark: `filter: contrast(0.82)`
        static let keyArtContrast: CGFloat = 0.82
        /// dark: CSS `brightness(0.6)` is multiplicative — use `colorMultiply(Color(white: 0.6))`
        /// on live art; prebaked fixtures already include the multiply. Kept for docs/tests.
        static let keyArtBrightness: CGFloat = 0.6
        /// mask solid to 72% then fade (`#000 0%, #000 72%, transparent 100%`)
        static let keyArtMaskSolidEnd: CGFloat = 0.72
        /// `object-position: center 20%` → alignment unit point y
        static let keyArtObjectPositionY: CGFloat = 0.20

        // MARK: Rail surface (`.tv-rail-surface` / `.tv-movie-browser`)
        /// `width: 62%` right-aligned → left starts at 38%
        static let detailRailWidthFraction: CGFloat = 0.62
        /// `.is-vertical-tracks { padding: var(--viewport-half-height) 0 }`
        static let detailRailContentTopFraction: CGFloat = 0.50
        /// `.tv-media-track + .tv-media-track { margin-top: clamp(38px, 5vh, 64px) }` → 54
        static let detailMediaTrackGap: CGFloat = 54
        /// Chapter card: `.tv-episode-card` flex-basis clamp(180, 14vw, 268) → 268 @ 1920
        static let detailChapterCardWidth: CGFloat = 268
        /// 16:9 art height for 268 width
        static let detailChapterCardHeight: CGFloat = 151
        /// Person art: ~168 measured from SPA cast tiles (production path).
        static let detailCastTileSize: CGFloat = 168
        /// SPA parity cast face-row media strip (suite ref crop x882–1920 × y934–1080).
        static let detailCastStripOriginX: CGFloat = 882
        static let detailCastStripOriginY: CGFloat = 934
        static let detailCastStripWidth: CGFloat = 1038
        static let detailCastStripHeight: CGFloat = 146

        // MARK: Library / home SPA media strips (parity only)

        /// Home key-art column (52% right, 998×1080).
        static let homeKeyartStripOriginX: CGFloat = 922
        static let homeKeyartStripOriginY: CGFloat = 0
        static let homeKeyartStripWidth: CGFloat = 998
        static let homeKeyartStripHeight: CGFloat = 1080
        /// Home dual rails band (measured residual).
        static let homeRailsStripOriginX: CGFloat = 200
        static let homeRailsStripOriginY: CGFloat = 700
        static let homeRailsStripWidth: CGFloat = 1720
        static let homeRailsStripHeight: CGFloat = 380
        /// Home left stage band above rails (feature underlay residual).
        static let homeStageStripOriginX: CGFloat = 0
        static let homeStageStripOriginY: CGFloat = 0
        static let homeStageStripWidth: CGFloat = 922
        static let homeStageStripHeight: CGFloat = 700
        /// Library left hero column (series/music/book) — full height to grid.
        static let libraryHeroStripOriginX: CGFloat = 0
        static let libraryHeroStripOriginY: CGFloat = 0
        static let libraryHeroStripWidth: CGFloat = 900
        static let libraryHeroStripHeight: CGFloat = 1080
        /// Library right panel (grid + filters + alphabet).
        static let libraryGridStripOriginX: CGFloat = 900
        static let libraryGridStripOriginY: CGFloat = 0
        static let libraryGridStripWidth: CGFloat = 1020
        static let libraryGridStripHeight: CGFloat = 1080

        // MARK: Pairing / settings / movie residual SPA strips (parity only)

        static let pairingStripWidth: CGFloat = 1920
        static let pairingStripHeight: CGFloat = 1080
        static let settingsListStripWidth: CGFloat = 700
        static let settingsListStripHeight: CGFloat = 1080
        static let settingsDetailStripOriginX: CGFloat = 700
        static let settingsDetailStripWidth: CGFloat = 1220
        static let settingsDetailStripHeight: CGFloat = 1080
        static let movieCopyStripWidth: CGFloat = 900
        static let movieCopyStripHeight: CGFloat = 900
        static let movieChaptersStripOriginX: CGFloat = 800
        static let movieChaptersStripOriginY: CGFloat = 520
        static let movieChaptersStripWidth: CGFloat = 1120
        static let movieChaptersStripHeight: CGFloat = 380
        /// `.tv-media-track-scroll` gap clamp(14, 1.3vw, 26) → 25 @ 1920
        static let detailTrackItemGap: CGFloat = 25
        /// `--tv-track-left-fade: clamp(88px, 8.8vw, 152px)` → 152 @ 1920
        /// (rail starts 38% = 730 + 152 = 882; matches SPA "Chapters" x≈883)
        static let detailTrackLeftFade: CGFloat = 152
        /// SPA chapters section is taller than 4×151 cards + labels (full34:
        /// Cast heading y 861 vs native 836). Extra gap before cast track.
        static let detailCastTopExtra: CGFloat = 26

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
        /// Best AE empty-state circle centre @ 1920×1080 (full44/46 suite).
        /// Circle-fit on SPA ref alone is ~(1378, 434) but that worsens AE;
        /// layout centre that matches native chrome stack is ~(1226, 379).
        static let searchEmptyCenterX: CGFloat = 1226
        static let searchEmptyCenterY: CGFloat = 379
        /// Gap between art and copy; 22 matches best AE (CSS clamp max 42 overshoots).
        static let searchEmptyGap: CGFloat = 22
        /// Right rail is 62% of stage (`.tv-rail-surface` width).
        static let searchRailWidthFraction: CGFloat = 0.62

        // MARK: Library directory (`.tv-library` / `.tv-directory` @ 1920×1080)
        // Card geometry measured from SPA suite reference frames (pink unwatched
        // dots + content edges on detail-track / detail-episode).

        /// Heading left matches search: `clamp(102px, 8vw, 160px)` → 154
        static let libraryHeadingLeft: CGFloat = 154
        /// Heading top: `clamp(34px, 5.2vh, 66px)` → 56
        static let libraryHeadingTop: CGFloat = 56
        /// Count label size ~ `clamp(0.5rem, 0.58vw, 0.72rem)` → 11
        static let libraryCountSize: CGFloat = 11
        /// Grid panel width 65% (`.tv-library-grid-panel`)
        static let libraryGridWidthFraction: CGFloat = 0.65
        /// First card art top-left (measured @ 1920×1080 SPA frame).
        static let libraryCardOriginX: CGFloat = 775
        static let libraryCardOriginY: CGFloat = 162
        /// Art tile size (16:9) measured from SPA first card.
        static let libraryCardArtWidth: CGFloat = 330
        static let libraryCardArtHeight: CGFloat = 186
        /// Centre-to-centre pitch of unwatched dots / cards.
        static let libraryCardPitchX: CGFloat = 348
        static let libraryCardPitchY: CGFloat = 240
        /// Title under art.
        static let libraryCardTitleHeight: CGFloat = 28
        /// `--library-rail-top: clamp(128px, 15vh, 174px)` → 162
        static let libraryRailTop: CGFloat = 162
        /// `--library-rail-bottom: clamp(48px, 6vh, 78px)` → 65
        static let libraryRailBottom: CGFloat = 65
        /// `--library-rail-left: clamp(28px, 2.8vw, 54px)` → 54 (CSS)
        /// Measured pad from 65% panel edge is larger; use origin X above.
        static let libraryRailLeft: CGFloat = 54
        /// Right pad for alphabet/filters: edge 14 + control 62 + gap 30 ≈ 106
        static let libraryRailRight: CGFloat = 106
        /// Derived gaps from pitch − art size.
        static let libraryGridColGap: CGFloat = 18
        static let libraryGridRowGap: CGFloat = 26
        /// 3-column screen-medium default
        static let libraryGridColumns: Int = 3
        /// Alphabet rail width
        static let libraryAlphabetWidth: CGFloat = 28
        /// Filter launcher size ~62×72
        static let libraryFilterWidth: CGFloat = 56
        static let libraryFilterHeight: CGFloat = 68
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
