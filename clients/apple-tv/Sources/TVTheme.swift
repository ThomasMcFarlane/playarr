import PlayarrKit
import SwiftUI
import UIKit

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

    /// CSS `font-weight` for a SwiftUI weight, as the web client uses them for text of that role.
    static func cssWeight(_ weight: Font.Weight) -> CGFloat {
        switch weight {
        case .ultraLight, .thin, .light: return 300
        case .medium: return 560
        case .semibold: return 620
        case .bold: return 700
        case .heavy: return 800
        case .black: return 900
        default: return 400
        }
    }

    /// The design font (Nunito Sans, variable) at a CSS weight such as 560 or 610.
    static func font(size: CGFloat, css weight: CGFloat) -> Font {
        Font(TVFontLoader.uiFont(mono: false, size: size, weight: weight))
    }

    /// JetBrains Mono (variable) at a CSS weight, for the version label and technical runs.
    static func mono(size: CGFloat, css weight: CGFloat) -> Font {
        Font(TVFontLoader.uiFont(mono: true, size: size, weight: weight))
    }

    static func font(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        font(size: size, css: cssWeight(weight))
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

/// tvOS-safe card/nav button style: keeps the focus engine happy (unlike
/// `.buttonStyle(.plain)`, which can leave controls unfocusable under some
/// SwiftUI/tvOS combinations) while avoiding the default glass chrome.
struct TVFocusableCardButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.92 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

// MARK: - Web-matched focus / hover (tvOS focus ≈ web :focus-visible / :hover)

/// Shared focus environment for ButtonStyles (tvOS paints focus here, not
/// via `configuration.isPressed`).
private struct TVButtonFocusBody<Content: View>: View {
    @Environment(\.isFocused) private var isFocused
    let isPressed: Bool
    @ViewBuilder var content: (_ focused: Bool, _ pressed: Bool) -> Content

    var body: some View {
        content(isFocused, isPressed)
            .animation(
                .easeOut(duration: DesignTokens.FocusMotion.transitionSeconds),
                value: isFocused
            )
    }
}

/// Web `.language-dropdown-trigger:hover/focus-visible`:
/// border → accent, bg → surface-strong, scale 1.02.
struct TVChromeMenuButtonStyle: ButtonStyle {
    let palette: TVAuthPalette

    func makeBody(configuration: Configuration) -> some View {
        TVButtonFocusBody(isPressed: configuration.isPressed) { focused, pressed in
            configuration.label
                .background(focused || pressed ? palette.surfaceStrong : palette.bg)
                .overlay(
                    Rectangle().stroke(
                        focused || pressed ? palette.accent : palette.lineStrong,
                        lineWidth: 1
                    )
                )
                .scaleEffect(
                    focused || pressed
                        ? DesignTokens.FocusMotion.chromeMenuFocusScale
                        : 1
                )
        }
    }
}

/// Web `.tv-page-back:hover/focus-visible`:
/// fill ink, colour bg, scale 1.1.
struct TVBackButtonStyle: ButtonStyle {
    let palette: TVAuthPalette

    func makeBody(configuration: Configuration) -> some View {
        TVButtonFocusBody(isPressed: configuration.isPressed) { focused, pressed in
            let active = focused || pressed
            configuration.label
                .foregroundStyle(active ? palette.bg : palette.inkSoft)
                .background(active ? palette.ink : palette.surfaceStrong.opacity(0.70))
                .overlay(
                    Circle().stroke(
                        active ? Color.clear : palette.lineStrong.opacity(0.66),
                        lineWidth: 1
                    )
                )
                .clipShape(Circle())
                .scaleEffect(active ? DesignTokens.FocusMotion.backFocusScale : 1)
        }
    }
}

/// Web `.btn.btn-secondary` + `.device-login-manual` (pill):
/// surface fill, line-strong border, ink-soft text, scale 1.055 on focus only.
/// Label should be plain text; this style owns fill/border/radius/height chrome.
struct TVSecondaryPillButtonStyle: ButtonStyle {
    let palette: TVAuthPalette
    /// CSS `min-height: clamp(44px, 3.6vw, 58px)` @ 1920 → 58.
    var minHeight: CGFloat = 58
    /// CSS `font-size: clamp(0.72rem, 0.82vw, 0.92rem)` @ 1920 → 14.72.
    var fontSize: CGFloat = 14.72

    func makeBody(configuration: Configuration) -> some View {
        TVButtonFocusBody(isPressed: configuration.isPressed) { focused, pressed in
            let active = focused || pressed
            configuration.label
                .font(.system(size: fontSize, weight: .bold))
                .foregroundStyle(palette.inkSoft)
                .frame(maxWidth: .infinity)
                .frame(minHeight: minHeight)
                .padding(.horizontal, fontSize * 1.35)
                .background(palette.surface)
                .overlay(
                    Capsule().stroke(palette.lineStrong, lineWidth: 1)
                )
                .clipShape(Capsule())
                .scaleEffect(active ? DesignTokens.FocusMotion.buttonFocusScale : 1)
        }
    }
}

/// Web `.btn.btn-primary` (+ pill when `.auth-submit` / `.device-login-manual`):
/// fill `--accent`, text `--on-accent`, scale 1.055 on focus.
/// Dark auth: near-white fill + dark text (not brand pink).
struct TVPrimaryPillButtonStyle: ButtonStyle {
    let palette: TVAuthPalette
    var minHeight: CGFloat = 58
    var fontSize: CGFloat = 14.72

    func makeBody(configuration: Configuration) -> some View {
        TVButtonFocusBody(isPressed: configuration.isPressed) { focused, pressed in
            let active = focused || pressed
            configuration.label
                .font(.system(size: fontSize, weight: .bold))
                .foregroundStyle(palette.onAccent)
                .frame(maxWidth: .infinity)
                .frame(minHeight: minHeight)
                .padding(.horizontal, fontSize * 1.35)
                .background(palette.accent)
                .clipShape(Capsule())
                .scaleEffect(active ? DesignTokens.FocusMotion.buttonFocusScale : 1)
                .brightness(active ? 0.04 : 0)
        }
    }
}

/// Web `.profile-avatar-button:hover/focus-visible`:
/// translateY(-8) scale(1.045) on the whole choice.
struct TVProfileCardButtonStyle: ButtonStyle {
    let palette: TVAuthPalette
    var isSelected: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        TVButtonFocusBody(isPressed: configuration.isPressed) { focused, pressed in
            let active = focused || pressed || isSelected
            configuration.label
                .scaleEffect(active ? DesignTokens.FocusMotion.profileFocusScale : 1)
                .offset(y: active ? -DesignTokens.FocusMotion.profileFocusLift : 0)
                .brightness(pressed ? -0.02 : 0)
                .animation(
                    .easeOut(duration: DesignTokens.FocusMotion.transitionSeconds),
                    value: active
                )
        }
    }
}

/// Web `#profile-add` plate + labels.
/// Rest: dashed line-strong border, surface→rose fill, light “+”.
/// Active (focus): 4px pink ring, soft drop shadow, avatar scale 1.035, ink title.
struct TVProfileAddLabel: View {
    let palette: TVAuthPalette
    let scale: CGFloat
    let avatarSize: CGFloat
    /// When true, force the active nav chrome (FocusState lag / selected peer).
    var forceActive: Bool = false

    @Environment(\.isFocused) private var isFocused

    private var active: Bool { isFocused || forceActive }

    /// Web `.profile-add` start: `color-mix(surface-strong 84%, #cf3157)`.
    private var fillStart: Color {
        Color.tvMix(palette.surfaceStrong, palette.brandPink, amount: 0.16)
    }

    /// Muted end of the plate (surface-heavy, slight rose) — not a solid pink disc.
    private var fillEnd: Color {
        // Web `.profile-avatar` default end colour.
        Color(red: 0xa8 / 255, green: 0x26 / 255, blue: 0x55 / 255)
    }

    var body: some View {
        VStack(spacing: 9 * scale) {
            ZStack {
                // Soft plate (web linear 145deg + highlight radial).
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [fillStart, fillEnd],
                            startPoint: UnitPoint(x: 0.1006, y: -0.0705),
                            endPoint: UnitPoint(x: 0.8994, y: 1.0705)
                        )
                    )
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [.white.opacity(0.28), .white.opacity(0)],
                            center: UnitPoint(x: 0.34, y: 0.26),
                            startRadius: 0,
                            endRadius: avatarSize * 0.267
                        )
                    )
                // Dashed plate edge — web `.profile-add .profile-avatar { border-style: dashed }`.
                // Keep dash visible under the solid focus ring (ring sits outside).
                Circle()
                    .strokeBorder(
                        palette.lineStrong.opacity(active ? 0.85 : 0.66),
                        style: StrokeStyle(
                            lineWidth: max(1.5, 1.75 * scale),
                            dash: [10 * scale, 8 * scale]
                        )
                    )
                Text("+")
                    // Web clamp(2.4rem, 4vw, 5.4rem) weight 300 → ~0.35× avatar.
                    .font(.system(size: avatarSize * 0.36, weight: .light))
                    .foregroundStyle(active ? palette.ink : palette.inkSoft)
            }
            .frame(width: avatarSize, height: avatarSize)
            // Web focus avatar: scale 1.035 + 4px pink ring (box-shadow) + soft lift.
            .scaleEffect(active ? 1.035 : 1)
            .background {
                // Outer pink focus ring sits *outside* the dashed edge (web
                // `0 0 0 4px color-mix(#cf3157 42%)`).
                if active {
                    Circle()
                        .stroke(palette.brandPink.opacity(0.42), lineWidth: 4 * scale)
                        .frame(
                            width: avatarSize + 8 * scale,
                            height: avatarSize + 8 * scale
                        )
                }
            }
            .shadow(
                color: active
                    ? Color(red: 0x1f / 255, green: 0x0e / 255, blue: 0x14 / 255).opacity(0.22)
                    : Color.clear,
                radius: active ? 26 * scale : 0,
                y: active ? 14 * scale : 0
            )
            .animation(
                .easeOut(duration: DesignTokens.FocusMotion.transitionSeconds),
                value: active
            )

            Text("Sign in")
                .font(.system(size: 16 * scale, weight: .semibold))
                .foregroundStyle(active ? palette.ink : palette.inkSoft)
                .lineLimit(1)

            Text("Add another profile")
                .font(.system(size: 9 * scale, weight: .bold))
                .tracking(0.6 * scale)
                .textCase(.uppercase)
                .foregroundStyle(palette.inkMuted)
                .frame(minHeight: 12 * scale)
        }
        .frame(width: avatarSize)
    }
}

extension Color {
    /// Approximate CSS `color-mix(in srgb, a (1-amount), b amount)`.
    static func tvMix(_ a: Color, _ b: Color, amount: Double) -> Color {
        let t = max(0, min(1, amount))
        var r1: CGFloat = 0, g1: CGFloat = 0, b1: CGFloat = 0, a1: CGFloat = 0
        var r2: CGFloat = 0, g2: CGFloat = 0, b2: CGFloat = 0, a2: CGFloat = 0
        UIColor(a).getRed(&r1, green: &g1, blue: &b1, alpha: &a1)
        UIColor(b).getRed(&r2, green: &g2, blue: &b2, alpha: &a2)
        return Color(
            red: Double(r1 * (1 - t) + r2 * t),
            green: Double(g1 * (1 - t) + g2 * t),
            blue: Double(b1 * (1 - t) + b2 * t),
            opacity: Double(a1 * (1 - t) + a2 * t)
        )
    }
}

/// Web `.profile-action-button:hover/focus-visible` → scale 1.07.
struct TVProfileActionButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        TVButtonFocusBody(isPressed: configuration.isPressed) { focused, pressed in
            configuration.label
                .scaleEffect(focused || pressed ? 1.07 : 1)
        }
    }
}

/// Web profile-actions chrome (settings gear circle / Sign out pill).
struct TVProfileActionLabel: View {
    enum Kind { case settings, signOut }

    let palette: TVAuthPalette
    let scale: CGFloat
    let kind: Kind
    @Environment(\.isFocused) private var isFocused

    var body: some View {
        let active = isFocused
        Group {
            switch kind {
            case .settings:
                Image(systemName: "gearshape")
                    .font(.system(size: 16 * scale, weight: .regular))
                    .foregroundStyle(active ? palette.bg : palette.brandPink)
                    .frame(width: 44 * scale, height: 44 * scale)
                    .background(
                        Circle().fill(
                            active
                                ? palette.ink.opacity(0.88)
                                : palette.surfaceStrong.opacity(0.64)
                        )
                    )
                    .overlay(
                        Circle().stroke(
                            active ? Color.clear : palette.lineStrong.opacity(0.7),
                            lineWidth: 1
                        )
                    )
            case .signOut:
                HStack(spacing: 7 * scale) {
                    Image(systemName: "rectangle.portrait.and.arrow.right")
                        .font(.system(size: 14 * scale, weight: .regular))
                    Text("Sign out")
                        .font(.system(size: 11 * scale, weight: .bold))
                }
                .foregroundStyle(active ? Color.white : palette.inkSoft)
                .padding(.horizontal, 16 * scale)
                .frame(height: 44 * scale)
                .background(
                    Capsule().fill(
                        active ? palette.danger : palette.surfaceStrong.opacity(0.64)
                    )
                )
                .overlay(
                    Capsule().stroke(
                        active ? Color.clear : palette.lineStrong.opacity(0.7),
                        lineWidth: 1
                    )
                )
            }
        }
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
        .buttonStyle(TVFocusableCardButtonStyle())
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
        .buttonStyle(TVFocusableCardButtonStyle())
    }
}

/// Floating left rail matching `.app-nav` on the web shell.
enum TVNavTab: String, CaseIterable, Identifiable {
    case downloads
    case search
    case home
    case series
    case movies
    case music
    case playlists
    case watchlist
    case requests
    case calendar
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .downloads: return "Downloads"
        case .watchlist: return "Watchlist"
        case .requests: return "Requests"
        case .calendar: return "Calendar"
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
        case .downloads: return "arrow.down.to.line"
        case .watchlist: return "bookmark"
        case .requests: return "text.badge.plus"
        case .calendar: return "calendar"
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

/// Focus identity shared between floating nav and main stage.
enum TVShellFocus: Hashable {
    case nav(TVNavTab)
    case stage
}

/// Called when the stage wants the remote to land on the left nav (Left on a
/// leading card). The shell owns the FocusState and performs the move.
private struct RequestNavFocusKey: EnvironmentKey {
    static let defaultValue: () -> Void = {}
}

extension EnvironmentValues {
    var requestNavFocus: () -> Void {
        get { self[RequestNavFocusKey.self] }
        set { self[RequestNavFocusKey.self] = newValue }
    }
}

struct TVFloatingNav: View {
    @Binding var selection: TVNavTab
    /// When true, suppress tvOS focus lift so parity captures match web chrome.
    var suppressFocusChrome: Bool = false
    /// SPA library/home frames omit the settings group from the left rail.
    var showSettings: Bool = true
    /// Parent-owned focus (required for moving between nav and stage).
    var externalFocus: FocusState<TVShellFocus?>.Binding
    /// Shared shell namespace for prefersDefaultFocus / resetFocus hand-off.
    var focusNamespace: Namespace.ID? = nil
    /// When true, the active tab is the preferred default focus target.
    var preferDefaultFocus: Bool = false

    /// Same three groups as the web shell (`.app-nav`). Music joins the browse group only when
    /// the library has music (`showMusic`).
    private var navGroups: [[TVNavTab]] {
        [
            [.downloads, .search],
            [.home]
                + ((browseKinds?.contains(.series) ?? true) ? [.series] : [])
                + ((browseKinds?.contains(.movie) ?? true) ? [.movies] : [])
                + ((browseKinds?.contains(.artist) ?? showMusic) ? [.music] : []),
            [.playlists, .watchlist, .requests, .calendar],
        ]
    }
    var showMusic: Bool = false
    /// Kinds the profile can browse (`nil` while unknown shows Series and Movies).
    var browseKinds: Set<WorkKind>? = nil

    var body: some View {
        // Whole nav is one centred column (web: top 50% + translateY(-50%)).
        // Settings sits just under the primary group, not pinned to the footer.
        VStack(spacing: 14) {
            ForEach(navGroups, id: \.self) { navGroup(tabs: $0) }
            if showSettings {
                navGroup(tabs: [.settings])
            }
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

    @ViewBuilder
    private func navButton(_ tab: TVNavTab) -> some View {
        let isActive = selection == tab
        let isFocused = externalFocus.wrappedValue == .nav(tab)
        let button = Button {
            selection = tab
            externalFocus.wrappedValue = .nav(tab)
        } label: {
            VStack(spacing: 5) {
                Image(systemName: tab.systemImage)
                    .font(.system(size: 20, weight: .medium))
                Text(tab.title)
                    .font(TVTheme.font(size: 9, weight: .semibold))
                    .tracking(0.3)
                    .lineLimit(1)
            }
            .foregroundStyle(
                isActive || isFocused
                    ? DesignTokens.Color.textPrimary
                    : DesignTokens.Color.textDisabled
            )
            .frame(
                width: DesignTokens.Shell.navItemSize,
                height: DesignTokens.Shell.navItemSize
            )
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(
                        isActive || isFocused
                            ? DesignTokens.Color.textPrimary.opacity(0.09)
                            : Color.clear
                    )
            )
            // Web TV nav: focus looks like the active tab (filled tile, ink text); no ring, no scale.
        }
        // Card-like style stays focusable; .plain can drop remote hand-off.
        .buttonStyle(TVFocusableCardButtonStyle())
        .accessibilityLabel(tab.title)
        .focused(externalFocus, equals: .nav(tab))
        .disabled(suppressFocusChrome) // not .focusable: on a Button it adds a second, inert focus target
        .focusEffectDisabled(suppressFocusChrome)
        .onMoveCommand { direction in
            // Right from any dock item jumps into the stage (first rail card).
            if direction == .right {
                externalFocus.wrappedValue = .stage
            }
        }

        if let focusNamespace, preferDefaultFocus, isActive {
            button.prefersDefaultFocus(true, in: focusNamespace)
        } else {
            button
        }
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
    /// Web `.app-clock`: x 476.1 on every TV page (live web, 2026-10-11).
    var clockLeading: CGFloat = 476.1

    var body: some View {
        ZStack(alignment: .topLeading) {
            PlayarrLogoMark(size: DesignTokens.Shell.logoSize)
                .placed(x: 60.6, y: 60.2)
            TimelineView(.everyMinute) { _ in
            HStack(spacing: 11.3) {
                Text(Self.timeString(frozen: frozenClock))
                    .font(TVTheme.font(size: 17.28, css: 760))
                    .tracking(-0.52)
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                Text(Self.dateString(frozen: frozenClock))
                    .font(TVTheme.font(size: 11.136, css: 640))
                    .tracking(0.45)
                    .foregroundStyle(DesignTokens.Color.textPrimary)
            }
            }
            .placed(x: clockLeading, y: 68.2, h: 25.9)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .allowsHitTesting(false)
    }

    /// The frozen clock is the instant the web references froze, shown in UTC like the web capture.
    private static func timeString(frozen: Bool) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.dateFormat = "HH:mm"
        if frozen { f.timeZone = TimeZone(identifier: "UTC") }
        return f.string(from: frozen ? TVParityLaunch.frozenNow : Date())
    }

    private static func dateString(frozen: Bool) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.dateFormat = "EEE d MMMM"
        if frozen { f.timeZone = TimeZone(identifier: "UTC") }
        return f.string(from: frozen ? TVParityLaunch.frozenNow : Date()).uppercased()
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

/// Loads the bundled variable design fonts (`UIAppFonts`) and sets the weight axis. Nunito Sans
/// keeps width 100, optical size 12 and `YTLC` 500 as on the web; its file defaults to weight 200,
/// so the weight is always set. Falls back to the system font if the files are missing.
enum TVFontLoader {
    private static var cache: [String: UIFont] = [:]

    /// Builds the face with the shared `DesignFont` helper (the file `clients/ios/Sources/PlayarrApp/DesignFont.swift`
    /// is compiled into this target as well). `NunitoSans-wght-web.ttf` has the web's width, optical size and
    /// YTLC baked in, so only the weight is set. The system font is used only if a face is not registered.
    static func uiFont(mono: Bool, size: CGFloat, weight: CGFloat) -> UIFont {
        let key = "\(mono)-\(size)-\(weight)"
        if let cached = cache[key] { return cached }
        let css = Int(weight.rounded())
        let face = mono
            ? DesignFont.uiFont(family: "JetBrains Mono", size: size, weight: css, fixedAxes: [:])
            : DesignFont.uiFont(
                family: "Nunito Sans",
                postScriptName: DesignFont.nunitoPostScriptName,
                size: size,
                weight: css,
                fixedAxes: DesignFont.nunitoAxes
            )
        let font = face ?? UIFont.systemFont(ofSize: size, weight: mono ? .regular : UIFont.Weight(rawValue: (weight - 400) / 500))
        cache[key] = font
        return font
    }
}

/// The one header action tile (Filters, Calendar link, ...): web `.page-filters-button`, the 30 September
/// `.tv-filter-launcher` look. A 14 pt-radius tile at least 62 x 72 pt with the glyph above an 8.26 pt bold label.
/// Focus draws the ring (white in dark, ink in light) and never fills the tile; the open state keeps the ink fill.
/// Every page header uses this view so the calendar buttons and the library Filters button cannot drift apart
/// (the web `headerButtonParity` test pins both call sites to it).
struct TVHeaderPill: View {
    let label: String
    let symbol: String
    let width: CGFloat

    static let height: CGFloat = 72

    var body: some View {
        VStack(spacing: 5.6) {
            Image(systemName: symbol)
                .font(.system(size: 18, weight: .regular))
            Text(label)
                .font(TVTheme.font(size: 8.256, css: 700))
                .tracking(0.165)
                .lineLimit(1)
        }
        .foregroundStyle(DesignTokens.Stage.inkMuted)
        .frame(width: width, height: Self.height)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(DesignTokens.Color.backgroundInputDisabled.opacity(0.78))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(DesignTokens.Color.borderDefault.opacity(0.68), lineWidth: 1)
                )
        )
    }
}

/// The web's shell action column (page-layout spec, rule 2.3): one column owned by the shell where every page's
/// side-panel buttons stack, at the 30 September launcher position. At 1920x1080: 62 wide, right edge 12.48 px,
/// top 151.2 px (`clamp(116px, 14 * viewport-unit, 164px)`), 13 px between stacked tiles.
enum TVShellActionColumn {
    static let width: CGFloat = 62
    static let edge: CGFloat = 12.48
    static let top: CGFloat = 151.2
    static let gap: CGFloat = 13
    static var x: CGFloat { 1920 - edge - width }
    static func y(slot: Int) -> CGFloat { top + CGFloat(slot) * (TVHeaderPill.height + gap) }
}
