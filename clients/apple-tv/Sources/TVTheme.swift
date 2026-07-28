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

    static func displayFont() -> Font {
        .system(size: DesignTokens.TypeScale.displaySize, weight: DesignTokens.TypeScale.displayWeight)
    }

    static func heroTitleFont() -> Font {
        .system(size: DesignTokens.TypeScale.heroTitleSize, weight: .semibold)
    }

    static func titleFont() -> Font {
        .system(size: DesignTokens.TypeScale.titleSize, weight: DesignTokens.TypeScale.titleWeight)
    }

    static func subtitleFont() -> Font {
        .system(size: DesignTokens.TypeScale.subtitleSize, weight: DesignTokens.TypeScale.subtitleWeight)
    }

    static func bodyFont(emphasis: Bool = false) -> Font {
        .system(
            size: DesignTokens.TypeScale.bodySize,
            weight: emphasis ? DesignTokens.TypeScale.bodyEmphasisWeight : DesignTokens.TypeScale.bodyWeight
        )
    }

    static func captionFont() -> Font {
        .system(size: DesignTokens.TypeScale.captionSize, weight: DesignTokens.TypeScale.captionWeight)
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
        switch self {
        case .search: return "magnifyingglass"
        case .home: return "house"
        case .series: return "rectangle.stack"
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
                    .font(.system(size: 20, weight: .semibold))
                Text(tab.title)
                    .font(.system(size: 9, weight: .semibold))
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
                Text(frozenClock ? "12:00" : Self.liveTimeString())
                    .font(.system(size: 17, weight: .bold))
                    .tracking(-0.5)
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                Text(frozenClock ? "WED 29 JULY" : Self.liveDateString())
                    .font(.system(size: 11, weight: .semibold))
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
                Circle()
                    .fill(DesignTokens.Color.brandPrimary)
                    .frame(width: DesignTokens.Shell.logoSize, height: DesignTokens.Shell.logoSize)
                    .overlay(
                        Image(systemName: "play.fill")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(.white)
                            .offset(x: 1)
                    )
                    .shadow(color: DesignTokens.Color.brandPrimary.opacity(0.28), radius: 14, y: 8)
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

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(DesignTokens.Color.backgroundRaised)
                .frame(width: DesignTokens.Shell.userAvatarSize, height: DesignTokens.Shell.userAvatarSize)
                .overlay(
                    Image(systemName: "person.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                )
            Text(name)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(DesignTokens.Color.textPrimary)
        }
        .padding(.leading, 6)
        .padding(.trailing, 14)
        .padding(.vertical, 6)
        .background(
            Capsule().fill(DesignTokens.Color.backgroundElevated.opacity(0.9))
        )
    }
}
