import Observation
import SwiftUI

/// Theme + language preferences matching web `theme.tsx` / `LanguageProvider`
/// (`playarr-theme` / `playarr-language` localStorage). Used by the pairing
/// stage chrome (`TvStageChrome` on web) so the gate has the same controls.
@MainActor
@Observable
final class TVDisplayPreferences {
    enum ThemePreference: String, CaseIterable, Identifiable {
        case system
        case light
        case dark

        var id: String { rawValue }

        var menuLabel: String {
            switch self {
            case .system: return "System"
            case .light: return "Light"
            case .dark: return "Dark"
            }
        }
    }

    enum LanguagePreference: String, CaseIterable, Identifiable {
        case system
        case en
        case ja
        case th

        var id: String { rawValue }

        var menuLabel: String {
            switch self {
            case .system: return "Auto"
            case .en: return "English"
            case .ja: return "日本語"
            case .th: return "ไทย"
            }
        }
    }

    enum ResolvedTheme {
        case light
        case dark
    }

    /// Web Settings > Appearance > Artwork size (`playarr-artwork-size`): one size for all artwork. Small adds a column
    /// to every card grid and rail, large removes one.
    enum ArtworkSize: String, CaseIterable {
        case small, medium, large
        var columnStep: Int { self == .small ? 1 : self == .large ? -1 : 0 }
    }

    private static let artworkSizeKey = "com.playarr.playarr.tvos.artworkSize"

    var artworkSize: ArtworkSize {
        didSet { defaults.set(artworkSize.rawValue, forKey: Self.artworkSizeKey) }
    }

    /// Web `--card-w` at 1920x1080: the 1190.4-wide rail minus 156.96 of padding, split into 3 + step columns with
    /// 25.92 gaps (medium 327.2, small 238.9, large 503.8).
    var cardWidth: CGFloat {
        let columns = CGFloat(3 + artworkSize.columnStep)
        return (1033.44 - (columns - 1) * 25.92) / columns
    }

    var cardColumns: Int { 3 + artworkSize.columnStep }

    private static let themeKey = "com.playarr.playarr.tvos.theme"
    private static let languageKey = "com.playarr.playarr.tvos.language"

    private let defaults: UserDefaults

    var themePreference: ThemePreference {
        didSet { defaults.set(themePreference.rawValue, forKey: Self.themeKey) }
    }

    var languagePreference: LanguagePreference {
        didSet { defaults.set(languagePreference.rawValue, forKey: Self.languageKey) }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        artworkSize = defaults.string(forKey: Self.artworkSizeKey).flatMap(ArtworkSize.init(rawValue:)) ?? .medium
        if let raw = defaults.string(forKey: Self.themeKey),
           let value = ThemePreference(rawValue: raw) {
            themePreference = value
        } else {
            themePreference = .system
        }
        if let raw = defaults.string(forKey: Self.languageKey),
           let value = LanguagePreference(rawValue: raw) {
            languagePreference = value
        } else {
            languagePreference = .system
        }
    }

    var resolvedTheme: ResolvedTheme {
        switch themePreference {
        case .light: return .light
        case .dark: return .dark
        case .system:
            // tvOS has no reliable “system light” for living-room TVs; default
            // dark like the web TV surface when preference is System.
            return .dark
        }
    }

    var colorScheme: ColorScheme {
        resolvedTheme == .light ? .light : .dark
    }

    /// Trigger caption: shows preference name (System / Light / Dark), matching
    /// the web ThemeDropdown trigger.
    var themeTriggerLabel: String { themePreference.menuLabel }

    /// Trigger caption: Auto / English / 日本語 / ไทย.
    var languageTriggerLabel: String { languagePreference.menuLabel }
}

/// Web auth stage wash — measured from `.login-profile-page` / `.profiles-page`.
enum TVAuthBackgroundStyle {
    /// `.login-profile-page`: `circle 900px at 50% 50%` → transparent 100%.
    case login
    /// `.profiles-page`: `circle at 50% 48%` → transparent 34%.
    case profiles
}

/// Full-bleed auth backdrop matching web layered gradients 1:1 @ 1920×1080.
struct TVAuthStageBackground: View {
    let palette: TVAuthPalette
    var style: TVAuthBackgroundStyle = .login

    var body: some View {
        GeometryReader { geo in
            // Scale fixed CSS px radii with the design canvas height.
            let scale = geo.size.height / DesignTokens.Shell.canvasHeight
            // Farthest-corner radius for percentage-based CSS radials.
            let farthestCorner = hypot(geo.size.width / 2, geo.size.height / 2)

            ZStack {
                // CSS: linear-gradient(145deg, var(--surface), var(--bg) 72%)
                LinearGradient(
                    stops: [
                        .init(color: palette.surface, location: 0),
                        .init(color: palette.bg, location: 0.72),
                        .init(color: palette.bg, location: 1),
                    ],
                    // 145° clockwise from up ≈ down-right on screen.
                    startPoint: UnitPoint(x: 0.18, y: 0.0),
                    endPoint: UnitPoint(x: 0.82, y: 1.0)
                )

                // Rose glow — login uses a fixed 900 CSS-px radius; profiles
                // uses farthest-corner with a 34% transparency stop.
                switch style {
                case .login:
                    // `radial-gradient(circle 900px at 50% 50%, #cf3157 13%, transparent 100%)`
                    RadialGradient(
                        colors: [
                            palette.brandPink.opacity(0.13),
                            Color.clear,
                        ],
                        center: UnitPoint(x: 0.50, y: 0.50),
                        startRadius: 0,
                        endRadius: 900 * scale
                    )
                case .profiles:
                    // `radial-gradient(circle at 50% 48%, #cf3157 13%, transparent 34%)`
                    RadialGradient(
                        gradient: Gradient(stops: [
                            .init(color: palette.brandPink.opacity(0.13), location: 0),
                            .init(color: Color.clear, location: 0.34),
                            .init(color: Color.clear, location: 1),
                        ]),
                        center: UnitPoint(x: 0.50, y: 0.48),
                        startRadius: 0,
                        endRadius: farthestCorner
                    )
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}

/// Auth stage palette that flips with `TVDisplayPreferences.resolvedTheme`
/// (web `:root` light vs `[data-theme="dark"]`).
struct TVAuthPalette {
    let bg: Color
    let surface: Color
    let surfaceStrong: Color
    let ink: Color
    let inkSoft: Color
    let inkMuted: Color
    let lineStrong: Color
    /// Web `--accent`. Dark auth: #dfdcdd (near-white). Light: #675961.
    let accent: Color
    /// Web `--on-accent` (text on primary buttons). Dark: #211d21. Light: #fff.
    let onAccent: Color
    let brandPink: Color
    let danger: Color
    let isDark: Bool

    static func forTheme(_ theme: TVDisplayPreferences.ResolvedTheme) -> TVAuthPalette {
        switch theme {
        case .dark:
            return TVAuthPalette(
                bg: DesignTokens.Stage.bg,
                surface: DesignTokens.Stage.surface,
                surfaceStrong: DesignTokens.Stage.surfaceStrong,
                ink: DesignTokens.Stage.ink,
                inkSoft: DesignTokens.Stage.inkSoft,
                inkMuted: DesignTokens.Stage.inkMuted,
                lineStrong: Color(red: 0xdf / 255, green: 0xdc / 255, blue: 0xdd / 255).opacity(0.23),
                accent: Color(red: 0xdf / 255, green: 0xdc / 255, blue: 0xdd / 255),
                onAccent: Color(red: 0x21 / 255, green: 0x1d / 255, blue: 0x21 / 255),
                brandPink: DesignTokens.Stage.brandPink,
                danger: DesignTokens.Stage.danger,
                isDark: true
            )
        case .light:
            // Web light `:root` on /login/qr.
            return TVAuthPalette(
                bg: Color(red: 0xf5 / 255, green: 0xf3 / 255, blue: 0xf2 / 255),
                surface: Color(red: 0xfb / 255, green: 0xfa / 255, blue: 0xf9 / 255),
                surfaceStrong: Color.white,
                ink: Color(red: 0x38 / 255, green: 0x26 / 255, blue: 0x21 / 255),
                inkSoft: Color(red: 0x67 / 255, green: 0x59 / 255, blue: 0x61 / 255),
                inkMuted: Color(red: 0xa5 / 255, green: 0x96 / 255, blue: 0x9e / 255),
                lineStrong: Color(red: 0x38 / 255, green: 0x26 / 255, blue: 0x21 / 255).opacity(0.28),
                accent: Color(red: 0x67 / 255, green: 0x59 / 255, blue: 0x61 / 255),
                onAccent: Color.white,
                brandPink: DesignTokens.Stage.brandPink,
                danger: Color(red: 0xa8 / 255, green: 0x46 / 255, blue: 0x4c / 255),
                isDark: false
            )
        }
    }
}
