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

    var body: some View {
        VStack(spacing: 14) {
            ForEach([TVNavTab.search, .home, .series, .movies, .music, .playlists], id: \.self) { tab in
                navButton(tab)
            }
            Spacer()
            navButton(.settings)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, DesignTokens.Shell.navPaddingInline)
        .frame(width: DesignTokens.Shell.navItemSize + DesignTokens.Shell.navPaddingInline * 2)
    }

    private func navButton(_ tab: TVNavTab) -> some View {
        Button {
            selection = tab
        } label: {
            Image(systemName: tab.systemImage)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(
                    selection == tab ? DesignTokens.Color.textPrimary : DesignTokens.Color.textSecondary
                )
                .frame(
                    width: DesignTokens.Shell.navItemSize,
                    height: DesignTokens.Shell.navItemSize
                )
                .background(
                    RoundedRectangle(cornerRadius: DesignTokens.Radius.navItem, style: .continuous)
                        .fill(
                            selection == tab
                                ? DesignTokens.Color.backgroundRaised.opacity(0.95)
                                : DesignTokens.Color.backgroundElevated.opacity(0.72)
                        )
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tab.title)
    }
}

struct TVShellHeader: View {
    /// Frozen clock for parity suite (matches Android mask strategy).
    var frozenClock: Bool = false

    var body: some View {
        ZStack {
            // Clock is centred on the live SPA header.
            if frozenClock {
                HStack(spacing: 10) {
                    Text("12:00")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                    Text("WED 29 JULY")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(DesignTokens.Color.textDisabled)
                }
            }
            HStack {
                // Logo sits on the nav centre-x on web.
                Circle()
                    .fill(DesignTokens.Color.brandPrimary)
                    .frame(width: DesignTokens.Shell.logoSize, height: DesignTokens.Shell.logoSize)
                    .overlay(
                        Image(systemName: "play.fill")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                            .offset(x: 1)
                    )
                    .padding(.leading, DesignTokens.Shell.navEdge + 14)
                Spacer()
            }
        }
        .padding(.top, DesignTokens.Shell.headerTop)
        .frame(maxWidth: .infinity)
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
