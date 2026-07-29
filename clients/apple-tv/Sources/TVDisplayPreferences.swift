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

/// Auth stage palette that flips with `TVDisplayPreferences.resolvedTheme`
/// (web `:root` light vs `[data-theme="dark"]`).
struct TVAuthPalette {
    let bg: Color
    let surfaceStrong: Color
    let ink: Color
    let inkSoft: Color
    let inkMuted: Color
    let lineStrong: Color
    let brandPink: Color
    let danger: Color
    let isDark: Bool

    static func forTheme(_ theme: TVDisplayPreferences.ResolvedTheme) -> TVAuthPalette {
        switch theme {
        case .dark:
            return TVAuthPalette(
                bg: DesignTokens.Stage.bg,
                surfaceStrong: DesignTokens.Stage.surfaceStrong,
                ink: DesignTokens.Stage.ink,
                inkSoft: DesignTokens.Stage.inkSoft,
                inkMuted: DesignTokens.Stage.inkMuted,
                lineStrong: DesignTokens.Stage.inkMuted.opacity(0.45),
                brandPink: DesignTokens.Stage.brandPink,
                danger: DesignTokens.Stage.danger,
                isDark: true
            )
        case .light:
            // Web light `:root` on /login/qr.
            return TVAuthPalette(
                bg: Color(red: 0xf5 / 255, green: 0xf3 / 255, blue: 0xf2 / 255),
                surfaceStrong: Color.white,
                ink: Color(red: 0x38 / 255, green: 0x26 / 255, blue: 0x21 / 255),
                inkSoft: Color(red: 0x67 / 255, green: 0x59 / 255, blue: 0x61 / 255),
                inkMuted: Color(red: 0xa5 / 255, green: 0x96 / 255, blue: 0x9e / 255),
                lineStrong: Color(red: 0x38 / 255, green: 0x26 / 255, blue: 0x21 / 255).opacity(0.28),
                brandPink: DesignTokens.Stage.brandPink,
                danger: Color(red: 0xa8 / 255, green: 0x46 / 255, blue: 0x4c / 255),
                isDark: false
            )
        }
    }
}
