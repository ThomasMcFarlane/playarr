import SwiftUI

enum TVTheme {
    static let canvasWidth = DesignTokens.Shell.canvasWidth
    static let canvasHeight = DesignTokens.Shell.canvasHeight
    static let workTileWidth = DesignTokens.Shell.homeCardWidth
    static let workTileHeight = DesignTokens.Shell.homeCardHeight
    static let posterCardWidth: CGFloat = 250
    static let posterCardHeight: CGFloat = 360
    static let pagePadding = DesignTokens.Spacing.xxxl
    static let sectionGap = DesignTokens.Spacing.xl
    static let tileGap = DesignTokens.Shell.homeCardGap

    /// Live SPA uses `"Avenir Next", Avenir, …` (`global.css --font`).
    /// Avenir Next ships on tvOS / macOS; fall back to system if missing.
    private static let family = "Avenir Next"

    static func font(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        let name: String
        switch weight {
        case .ultraLight, .thin, .light: name = "AvenirNext-UltraLight"
        case .medium: name = "AvenirNext-Medium"
        case .semibold: name = "AvenirNext-DemiBold"
        case .bold, .heavy: name = "AvenirNext-Bold"
        case .black: name = "AvenirNext-Heavy"
        default: name = "AvenirNext-Regular"
        }
        return .custom(name, size: size)
    }

    static func displayFont() -> Font {
        font(size: DesignTokens.TypeScale.displaySize, weight: DesignTokens.TypeScale.displayWeight)
    }

    static func heroTitleFont() -> Font {
        font(size: DesignTokens.TypeScale.heroTitleSize, weight: .semibold)
    }

    static func titleFont() -> Font {
        font(size: DesignTokens.TypeScale.titleSize, weight: DesignTokens.TypeScale.titleWeight)
    }

    static func subtitleFont() -> Font {
        font(size: DesignTokens.TypeScale.subtitleSize, weight: DesignTokens.TypeScale.subtitleWeight)
    }

    static func bodyFont(emphasis: Bool = false) -> Font {
        font(
            size: DesignTokens.TypeScale.bodySize,
            weight: emphasis ? DesignTokens.TypeScale.bodyEmphasisWeight : DesignTokens.TypeScale.bodyWeight
        )
    }

    static func captionFont() -> Font {
        font(size: DesignTokens.TypeScale.captionSize, weight: DesignTokens.TypeScale.captionWeight)
    }
}

/// Orbital Playarr mark from `playarr-icon.svg` (embedded raster).
struct PlayarrLogoMark: View {
    var size: CGFloat = DesignTokens.Shell.logoSize

    var body: some View {
        PlayarrLogoAsset.image
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .frame(width: size, height: size)
            .shadow(color: Color.black.opacity(0.28), radius: 8, y: 6)
    }
}

struct TVStageBackground: View {
    var body: some View {
        DesignTokens.Color.backgroundBase.ignoresSafeArea()
    }
}

struct TVPrimaryButton: View {
    let label: String
    var isFocused: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(TVTheme.bodyFont(emphasis: true))
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .padding(.horizontal, DesignTokens.Spacing.xl)
                .padding(.vertical, DesignTokens.Spacing.sm)
                .background(
                    Capsule().fill(DesignTokens.Color.brandPrimary)
                )
                .scaleEffect(isFocused ? DesignTokens.FocusMotion.focusScale : 1)
        }
        .buttonStyle(.plain)
    }
}

struct TVSecondaryButton: View {
    let label: String
    var isFocused: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(TVTheme.bodyFont(emphasis: true))
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .padding(.horizontal, DesignTokens.Spacing.xl)
                .padding(.vertical, DesignTokens.Spacing.sm)
                .background(
                    Capsule().fill(DesignTokens.Color.backgroundRaised)
                )
        }
        .buttonStyle(.plain)
    }
}

/// Floating left rail matching `.app-nav` on the web shell.
enum TVNavTab: String, CaseIterable, Identifiable {
    case search
    case home
    case series
    case movies
    case music
    case playlists
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .search: return "Search"
        case .home: return "Home"
        case .series: return "Series"
        case .movies: return "Movies"
        case .music: return "Music"
        case .playlists: return "Playlists"
        case .settings: return "Settings"
        }
    }

    var systemImage: String {
        // Prefer SF symbols that mirror the SPA phosphor/icon set silhouette.
        switch self {
        case .search: return "magnifyingglass"
        case .home: return "house"
        case .series: return "tv"
        case .movies: return "film"
        case .music: return "music.note"
        case .playlists: return "list.bullet"
        case .settings: return "gearshape"
        }
    }
}

struct TVFloatingNav: View {
    @Binding var selection: TVNavTab
    /// When true, suppress tvOS focus lift so parity captures match web chrome.
    var suppressFocusChrome: Bool = false

    private let primaryTabs: [TVNavTab] = [.search, .home, .series, .movies, .music, .playlists]

    var body: some View {
        // Whole nav is one centred column (web: top 50% + translateY(-50%)).
        // Settings sits just under the primary group, not pinned to the footer.
        VStack(spacing: 14) {
            navGroup(tabs: primaryTabs)
            navGroup(tabs: [.settings])
        }
        .frame(width: DesignTokens.Shell.navItemSize + DesignTokens.Shell.navGroupPadding * 2)
    }

    private func navGroup(tabs: [TVNavTab]) -> some View {
        VStack(spacing: DesignTokens.Shell.navGroupGap) {
            ForEach(tabs, id: \.self) { tab in
                navButton(tab)
            }
        }
        .padding(.vertical, DesignTokens.Shell.navGroupPadding)
        .padding(.horizontal, DesignTokens.Shell.navGroupPadding)
        .background(
            RoundedRectangle(cornerRadius: DesignTokens.Shell.navGroupRadius, style: .continuous)
                .fill(DesignTokens.Color.backgroundElevated.opacity(0.56))
                .overlay(
                    RoundedRectangle(cornerRadius: DesignTokens.Shell.navGroupRadius, style: .continuous)
                        .stroke(DesignTokens.Color.borderDefault.opacity(0.35), lineWidth: 1)
                )
        )
    }

    private func navButton(_ tab: TVNavTab) -> some View {
        let isActive = selection == tab
        return Button {
            selection = tab
        } label: {
            VStack(spacing: 5) {
                Image(systemName: tab.systemImage)
                    .font(.system(size: 20, weight: .medium))
                Text(tab.title)
                    .font(TVTheme.font(size: 9, weight: .semibold))
                    .tracking(0.3)
                    .lineLimit(1)
            }
            .foregroundStyle(isActive ? DesignTokens.Color.textPrimary : DesignTokens.Color.textDisabled)
            .frame(
                width: DesignTokens.Shell.navItemSize,
                height: DesignTokens.Shell.navItemSize
            )
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(
                        isActive
                            ? DesignTokens.Color.textPrimary.opacity(0.09)
                            : Color.clear
                    )
            )
            .scaleEffect(isActive && !suppressFocusChrome ? 1.05 : 1)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tab.title)
        // Parity captures: disable focusability entirely so the system white
        // focus pill cannot appear (focusEffectDisabled alone still leaves a
        // large lift on tvOS). Production keeps full focus chrome.
        .focusable(!suppressFocusChrome)
        .focusEffectDisabled(suppressFocusChrome)
    }
}

/// Disables the system focus glow during parity captures (E4 residual otherwise
/// dominates AE). Production navigation keeps default tvOS focus chrome.
struct TVParityFocusChrome: ViewModifier {
    let suppressed: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if suppressed {
            content.focusEffectDisabled(true)
        } else {
            content
        }
    }
}

struct TVShellHeader: View {
    /// Frozen clock for parity suite (matches Android mask strategy).
    var frozenClock: Bool = false

    var body: some View {
        ZStack {
            // Clock is centred on the live SPA header.
            HStack(spacing: 11) {
                // Frozen time matches the Playwright reference frames used by
                // the honest suite (`run-4` / `run-honest-*` capture 05:59).
                Text(frozenClock ? "05:59" : Self.liveTimeString())
                    .font(TVTheme.font(size: 17, weight: .bold))
                    .tracking(-0.5)
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                Text(frozenClock ? "WED 29 JULY" : Self.liveDateString())
                    .font(TVTheme.font(size: 11, weight: .semibold))
                    .tracking(0.4)
                    .foregroundStyle(DesignTokens.Color.textDisabled)
            }
            HStack {
                // Logo sits on the nav centre-x on web
                // (`--tv-nav-centre-x` − logo/2).
                let navCentreX = DesignTokens.Shell.navEdge
                    + DesignTokens.Shell.navPaddingInline
                    + DesignTokens.Shell.navItemSize / 2
                    + 1
                PlayarrLogoMark(size: DesignTokens.Shell.logoSize)
                    .padding(.leading, max(0, navCentreX - DesignTokens.Shell.logoSize / 2))
                Spacer()
            }
        }
        .padding(.top, DesignTokens.Shell.headerTop)
        .frame(maxWidth: .infinity)
        .allowsHitTesting(false)
    }

    private static func liveTimeString() -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: Date())
    }

    private static func liveDateString() -> String {
        let f = DateFormatter()
        f.dateFormat = "EEE d MMMM"
        return f.string(from: Date()).uppercased()
    }
}

struct TVProfileChip: View {
    var name: String = "Viewer"
    /// Matches the live SPA version chip under the identity cluster.
    var version: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 10) {
                PlayarrAvatarAsset.image
                    .resizable()
                    .scaledToFill()
                    .frame(
                        width: DesignTokens.Shell.userAvatarSize,
                        height: DesignTokens.Shell.userAvatarSize
                    )
                    .clipShape(Circle())
                Text(name)
                    .font(TVTheme.font(size: 13, weight: .semibold))
                    .foregroundStyle(DesignTokens.Color.textPrimary)
            }
            .padding(.leading, 6)
            .padding(.trailing, 14)
            .padding(.vertical, 6)
            .background(
                Capsule().fill(DesignTokens.Color.backgroundElevated.opacity(0.9))
            )

            if let version {
                Text(version)
                    .font(TVTheme.font(size: 10, weight: .medium))
                    .foregroundStyle(DesignTokens.Color.textDisabled)
                    .padding(.leading, 44)
            }
        }
    }
}
