import CoreImage
import CoreImage.CIFilterBuiltins
import PlayarrKit
import SwiftUI
import UIKit

struct TVRootView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var selectedTab: TVNavTab = .home
    /// Shared focus so the shell can move between nav and stage with arrows.
    @FocusState private var shellFocus: TVShellFocus?

    /// When `-PlayarrParityScreen` is set, force that tab so simctl captures
    /// hit production SwiftUI (never WebView / web-ref paint).
    ///
    /// Suite `webPath` maps:
    ///   detail-episode → /series (library)
    ///   detail-track → /music (library)
    ///   detail-book → /library → /series (library)
    ///   detail-movie → SPA capture shows work-detail chrome (chapters/cast)
    private var parityForcedTab: TVNavTab? {
        guard let screen = TVParityLaunch.requestedScreen else { return nil }
        switch screen {
        case .search: return .search
        case .homeRecentlyAdded: return .home
        case .settings: return .settings
        case .detailEpisode, .detailBook: return .series
        case .detailTrack: return .music
        case .detailMovie: return .movies // shell chrome; detail overlay below
        case .deviceCodePairing: return nil
        case .player: return nil
        }
    }

    /// Work-detail fixture for screens whose SPA reference is a title page
    /// (detail-movie / player), not a library directory.
    private var parityWorkDetail: Work? {
        guard let screen = TVParityLaunch.requestedScreen else { return nil }
        switch screen {
        case .detailMovie:
            return TVParityFixtures.libraryWorks(kind: .movie).first
        case .player:
            return TVParityFixtures.libraryWorks(kind: .movie).first
                ?? TVParityFixtures.sampleWorks().first
        default:
            return nil
        }
    }

    var body: some View {
        ZStack {
            TVStageBackground()

            if TVParityLaunch.requestedScreen == .deviceCodePairing {
                // Fixture device-code chrome (do not hit live ATS / network).
                TVParityPairingFixtureView()
            } else if TVParityLaunch.requestedScreen == .player {
                // Fixture player chrome (SPA suite maps /login when media is unavailable).
                TVParityPlayerFixtureView()
            } else if TVParityLaunch.requestedScreen == .detailMovie, let work = parityWorkDetail {
                // SPA movie ref is work-detail with shell (nav/logo/profile).
                signedInShell(forcedSelection: .movies, detailWork: work)
            } else {
                switch environment.pairingState {
                case .signedIn:
                    signedInShell
                default:
                    if let forced = parityForcedTab {
                        signedInShell(forcedSelection: forced)
                    } else if TVParityLaunch.requestedScreen == nil {
                        TVPairingGateView()
                    } else {
                        signedInShell
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
        .tint(DesignTokens.Color.brandPrimary)
        .onAppear {
            if let forced = parityForcedTab {
                selectedTab = forced
            }
        }
    }

    private var signedInShell: some View {
        signedInShell(forcedSelection: nil, detailWork: nil)
    }

    private func signedInShell(forcedSelection: TVNavTab?, detailWork: Work? = nil) -> some View {
        let tab = forcedSelection ?? selectedTab
        let parity = TVParityLaunch.requestedScreen != nil
        let navBinding = Binding(
            get: { forcedSelection ?? selectedTab },
            set: { if forcedSelection == nil { selectedTab = $0 } }
        )

        // Parity freezes keep the floating ZStack chrome for AE geometry.
        // Production uses a real HStack so the focus engine has adjacent
        // layout peers (overlay ZStacks do not move focus with arrows).
        if parity {
            return AnyView(parityShell(tab: tab, detailWork: detailWork, nav: navBinding))
        }
        return AnyView(productionShell(tab: tab, detailWork: detailWork, nav: navBinding))
    }

    /// Interactive shell: nav column + stage side-by-side (focus-safe).
    private func productionShell(
        tab: TVNavTab,
        detailWork: Work?,
        nav: Binding<TVNavTab>
    ) -> some View {
        TVProductionShell(
            tab: tab,
            detailWork: detailWork,
            nav: nav,
            shellFocus: $shellFocus,
            stageContent: { stageContent(tab: tab, detailWork: detailWork) }
        )
    }

    /// Parity-only floating chrome (absolute SPA geometry).
    private func parityShell(
        tab: TVNavTab,
        detailWork: Work?,
        nav: Binding<TVNavTab>
    ) -> some View {
        ZStack(alignment: .topLeading) {
            NavigationStack {
                stageContent(tab: tab, detailWork: detailWork)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .toolbar(.hidden, for: .navigationBar)
                    .navigationBarBackButtonHidden(true)
            }

            TVFloatingNav(
                selection: nav,
                suppressFocusChrome: true,
                showSettings: false,
                externalFocus: $shellFocus
            )
            .padding(.leading, DesignTokens.Shell.navEdge)
            .frame(maxHeight: .infinity, alignment: .center)
            .zIndex(50)

            TVShellHeader(frozenClock: true)
                .frame(maxWidth: .infinity, alignment: .top)
                .allowsHitTesting(false)
                .zIndex(80)

            VStack {
                Spacer()
                HStack {
                    TVProfileChip(name: "Test User A", version: "v0.1.0")
                        .padding(.leading, DesignTokens.Shell.navEdge - 4)
                        .padding(.bottom, 36)
                    Spacer()
                }
            }
            .allowsHitTesting(false)
            .zIndex(50)
        }
        .ignoresSafeArea()
    }

    @ViewBuilder
    private func stageContent(tab: TVNavTab, detailWork: Work?) -> some View {
        if let detailWork {
            TVWorkDetailView(work: detailWork, apiClient: environment.apiClient)
        } else {
            switch tab {
            case .home:
                TVHomeView()
            case .search:
                TVSearchView()
            case .settings:
                TVSettingsView()
            case .series:
                TVLibraryKindView(
                    kindLabel: "Series",
                    emptyMessage: "No series in your library yet.",
                    workKind: .series,
                    collectionNoun: "TITLES"
                )
            case .movies:
                TVLibraryKindView(
                    kindLabel: "Movies",
                    emptyMessage: "No movies in your library yet.",
                    workKind: .movie,
                    collectionNoun: "TITLES"
                )
            case .music:
                TVLibraryKindView(
                    kindLabel: "Music",
                    emptyMessage: "No music in your library yet.",
                    workKind: .artist,
                    collectionNoun: "ARTISTS"
                )
            case .playlists:
                TVLibraryKindView(
                    kindLabel: "Playlists",
                    emptyMessage: "No playlists yet.",
                    workKind: nil,
                    collectionNoun: "PLAYLISTS"
                )
            }
        }
    }
}

/// Production signed-in chrome with a single focus scope so Left from rails
/// can land on the dock (and Right can return to the stage).
private struct TVProductionShell<Stage: View>: View {
    let tab: TVNavTab
    let detailWork: Work?
    @Binding var nav: TVNavTab
    var shellFocus: FocusState<TVShellFocus?>.Binding
    @ViewBuilder var stageContent: () -> Stage

    @Namespace private var shellFocusNamespace
    @State private var preferNavDefault = false
    @Environment(\.resetFocus) private var resetFocus

    private var navColumn: CGFloat {
        DesignTokens.Shell.navItemSize
            + DesignTokens.Shell.navGroupPadding * 2
            + DesignTokens.Shell.navEdge * 2
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            HStack(alignment: .center, spacing: 0) {
                TVFloatingNav(
                    selection: $nav,
                    suppressFocusChrome: false,
                    showSettings: true,
                    externalFocus: shellFocus,
                    focusNamespace: shellFocusNamespace,
                    preferDefaultFocus: preferNavDefault
                )
                .frame(width: navColumn)
                .focusSection()

                NavigationStack {
                    stageContent()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .toolbar(.hidden, for: .navigationBar)
                        .navigationBarBackButtonHidden(true)
                        .focusSection()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .focusSection()
                .focused(shellFocus, equals: .stage)
            }
            // One scope for dock + stage so resetFocus / prefersDefaultFocus
            // can pull the remote out of ScrollView rails into the dock.
            .focusScope(shellFocusNamespace)
            .environment(\.requestNavFocus) {
                preferNavDefault = true
                let target = TVShellFocus.nav(tab)
                Task { @MainActor in
                    shellFocus.wrappedValue = target
                    resetFocus(in: shellFocusNamespace)
                    // Prefer-nav is a one-shot entry hint; clear so Right can
                    // re-enter the stage on the next move.
                    try? await Task.sleep(for: .milliseconds(80))
                    preferNavDefault = false
                }
            }
            .onChange(of: shellFocus.wrappedValue) { _, newValue in
                if case .nav = newValue {
                    preferNavDefault = false
                }
            }

            TVShellHeader(frozenClock: false)
                .frame(maxWidth: .infinity, alignment: .top)
                .allowsHitTesting(false)
                .zIndex(80)

            VStack {
                Spacer()
                HStack {
                    TVProfileChip(name: "Viewer", version: nil)
                        .padding(.leading, DesignTokens.Shell.navEdge - 4)
                        .padding(.bottom, 36)
                    Spacer()
                }
            }
            .allowsHitTesting(false)
            .zIndex(50)
        }
        .ignoresSafeArea()
    }
}

/// Full-screen pairing gate: SPA DeviceLogin chrome 1:1 via
/// `TVDeviceLoginChrome`. Server URL is not typed here; playarr.app hosted
/// link supplies it from the phone claim.
struct TVPairingGateView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var pairingTask: Task<Void, Never>?

    var body: some View {
        chrome
            .onAppear {
                // Recover from cold launch and from URLSession "cancelled"
                // failures without needing a remote click on Try again.
                switch environment.pairingState {
                case .signedOut, .failed:
                    beginPairing()
                default:
                    break
                }
            }
            .onDisappear {
                if case .signedIn = environment.pairingState { return }
                pairingTask?.cancel()
                pairingTask = nil
            }
    }

    @ViewBuilder
    private var chrome: some View {
        switch environment.pairingState {
        case .signedOut, .requestingCode:
            TVDeviceLoginChrome(phase: .requesting, onRetry: nil)
        case .awaitingApproval(let pending):
            TVDeviceLoginChrome(
                phase: .awaitingApproval(
                    userCode: pending.userCode,
                    // Always show the app link, never a server/relay Host.
                    verificationURI: Self.displayVerificationURI(pending.verificationUri),
                    qr: AnyView(
                        TVLocalQRCodeImage(value: pending.verificationUriComplete)
                    )
                ),
                onRetry: nil
            )
        case .signedIn:
            EmptyView()
        case .failed(let message):
            TVDeviceLoginChrome(
                phase: .failed(message),
                onRetry: { beginPairing() }
            )
        }
    }

    private func beginPairing() {
        pairingTask?.cancel()
        pairingTask = Task { await environment.startPairing() }
    }

    /// On-screen "visit …" line is always the playarr.app app link, matching
    /// live `/login/qr`. Direct-server Host/relay URLs stay out of the UI.
    static func displayVerificationURI(_ uri: String) -> String {
        if uri.hasPrefix("https://playarr.app/link") || uri.hasPrefix("http://playarr.app/link") {
            return "https://playarr.app/link"
        }
        return "https://playarr.app/link"
    }
}

// MARK: - Device login chrome (live /login/qr)

/// Production pairing chrome matches live web `/login/qr`
/// (`ProfileAuthLayout` + `TvStageChrome` + embedded `DeviceLogin`): stage
/// chrome (logo + theme + language), centred column, Welcome home / Sign in
/// to Playarr, QR tile above code. Parity freezes still use measured
/// left-rail geometry via `TVParityPairingFixtureView`.
struct TVDeviceLoginChrome: View {
    enum Phase {
        case requesting
        case awaitingApproval(userCode: String, verificationURI: String, qr: AnyView)
        case failed(String)
    }

    let phase: Phase
    var onRetry: (() -> Void)?

    @Environment(TVDisplayPreferences.self) private var displayPreferences

    private var palette: TVAuthPalette {
        TVAuthPalette.forTheme(displayPreferences.resolvedTheme)
    }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                palette.bg
                // Soft rose halo (web profiles-page wash).
                RadialGradient(
                    colors: [
                        palette.brandPink.opacity(palette.isDark ? 0.16 : 0.12),
                        palette.brandPink.opacity(0.05),
                        .clear,
                    ],
                    center: UnitPoint(x: 0.50, y: 0.42),
                    startRadius: 20,
                    endRadius: min(geo.size.width, geo.size.height) * 0.42
                )

                VStack(spacing: 0) {
                    playarrWordmark
                        .padding(.bottom, 28)

                    Text("WELCOME HOME")
                        .font(.system(size: 12, weight: .heavy))
                        .tracking(2.4)
                        .foregroundStyle(palette.inkMuted)

                    Text("Sign in to Playarr")
                        .font(.system(size: 64, weight: .medium))
                        .tracking(-4.0)
                        .foregroundStyle(palette.ink)
                        .multilineTextAlignment(.center)
                        .padding(.top, 8)

                    Text("Scan the QR code with your phone or another browser to sign in on this device.")
                        .font(.system(size: 17, weight: .regular))
                        .foregroundStyle(palette.inkMuted)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 440)
                        .padding(.top, 16)
                        .padding(.bottom, 28)

                    phaseBody
                }
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                .padding(.horizontal, 48)

                // Web `TvStageChrome`: logo left, theme + language top-right.
                TVAuthStageChrome(palette: palette)
            }
        }
        .ignoresSafeArea()
        .preferredColorScheme(displayPreferences.colorScheme)
    }

    private var playarrWordmark: some View {
        HStack(spacing: 8) {
            ZStack {
                Circle()
                    .fill(palette.brandPink)
                    .frame(width: 34, height: 34)
                Image(systemName: "play.fill")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white)
                    .offset(x: 1)
            }
            HStack(spacing: 0) {
                Text("Play")
                    .foregroundStyle(palette.brandPink)
                Text("arr")
                    .foregroundStyle(palette.ink)
            }
            .font(.system(size: 18, weight: .semibold))
        }
    }

    @ViewBuilder
    private var phaseBody: some View {
        switch phase {
        case .requesting:
            Text("Creating a secure sign-in code…")
                .font(.system(size: 15, weight: .regular))
                .foregroundStyle(palette.inkMuted)
        case .awaitingApproval(let userCode, let verificationURI, let qr):
            // Live `/login/qr` embedded DeviceLogin: column, centred, QR above copy.
            VStack(alignment: .center, spacing: 22) {
                // `.device-login-qr`: border-box 240, 12pt white edge, r=18,
                // content 216, soft plate shadow (0 24 72 / 30% black).
                ZStack {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(Color.white)
                    qr
                        .frame(width: 216, height: 216)
                }
                .frame(width: 240, height: 240)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .shadow(
                    color: Color.black.opacity(palette.isDark ? 0.30 : 0.12),
                    radius: 36,
                    x: 0,
                    y: 24
                )

                VStack(alignment: .center, spacing: 10) {
                    Text("Scan the QR code, or visit")
                        .font(.system(size: 15, weight: .regular))
                        .foregroundStyle(palette.inkMuted)
                    Text(verificationURI)
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(palette.ink)
                    Text("and enter the code")
                        .font(.system(size: 15, weight: .regular))
                        .foregroundStyle(palette.inkMuted)
                    Text(userCode)
                        .font(.system(size: 52, weight: .bold, design: .monospaced))
                        .tracking(5)
                        .foregroundStyle(palette.ink)
                    Text("Waiting for approval…")
                        .font(.system(size: 13, weight: .regular))
                        .foregroundStyle(palette.inkMuted)
                        .padding(.top, 2)
                }
                .multilineTextAlignment(.center)
            }
        case .failed(let message):
            VStack(alignment: .center, spacing: 16) {
                Text(message)
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(palette.danger)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                if let onRetry {
                    Button("Try again", action: onRetry)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(palette.brandPink)
                        .buttonStyle(TVFocusableCardButtonStyle())
                }
            }
        }
    }
}

/// Web `TvStageChrome` on auth pages: mark top-left, theme + language menus
/// top-right (order matches live `/login/qr`: theme then language).
struct TVAuthStageChrome: View {
    let palette: TVAuthPalette
    @Environment(TVDisplayPreferences.self) private var displayPreferences

    var body: some View {
        VStack {
            HStack(alignment: .center, spacing: 0) {
                PlayarrLogoMark(size: 36)
                    .accessibilityHidden(true)

                Spacer(minLength: 16)

                HStack(spacing: 14) {
                    themeMenu
                    languageMenu
                }
            }
            .padding(.horizontal, 36)
            .padding(.top, 40)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .allowsHitTesting(true)
    }

    private var themeMenu: some View {
        Menu {
            ForEach(TVDisplayPreferences.ThemePreference.allCases) { option in
                Button {
                    displayPreferences.themePreference = option
                } label: {
                    if displayPreferences.themePreference == option {
                        Label(option.menuLabel, systemImage: "checkmark")
                    } else {
                        Text(option.menuLabel)
                    }
                }
            }
        } label: {
            chromeTrigger(
                icon: "circle.lefthalf.filled",
                label: displayPreferences.themeTriggerLabel,
                accessibility: "Theme: \(displayPreferences.themeTriggerLabel)"
            )
        }
        .buttonStyle(TVFocusableCardButtonStyle())
    }

    private var languageMenu: some View {
        Menu {
            ForEach(TVDisplayPreferences.LanguagePreference.allCases) { option in
                Button {
                    displayPreferences.languagePreference = option
                } label: {
                    if displayPreferences.languagePreference == option {
                        Label(option.menuLabel, systemImage: "checkmark")
                    } else {
                        Text(option.menuLabel)
                    }
                }
            }
        } label: {
            chromeTrigger(
                icon: "globe",
                label: displayPreferences.languageTriggerLabel,
                accessibility: "Language: \(displayPreferences.languageTriggerLabel)"
            )
        }
        .buttonStyle(TVFocusableCardButtonStyle())
    }

    private func chromeTrigger(icon: String, label: String, accessibility: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(palette.inkMuted)
            Text(label)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(palette.ink)
                .lineLimit(1)
            Image(systemName: "chevron.down")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(palette.inkMuted)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(palette.surfaceStrong.opacity(palette.isDark ? 0.92 : 0.96))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(palette.lineStrong, lineWidth: 1)
        )
        .accessibilityLabel(accessibility)
    }
}

/// Local QR (Core Image) so the tile never depends on `/api/link/qr` network
/// or its playarr.app-only allow-list. Matches PLAYARR_QR_STYLE: pure black
/// modules on white, ECC M.
struct TVLocalQRCodeImage: View {
    let value: String

    var body: some View {
        if let image = Self.makeUIImage(value: value, pixelSize: 432) {
            Image(uiImage: image)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
        } else {
            // Fallback: still show structure rather than a blank white hole.
            Color.black.opacity(0.12)
        }
    }

    static func makeUIImage(value: String, pixelSize: CGFloat) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(value.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }

        // Scale modules to a crisp integer grid (nearest-neighbour).
        let extent = output.extent.integral
        guard extent.width > 0, extent.height > 0 else { return nil }
        let scale = pixelSize / extent.width
        let scaled = output.transformed(by: CGAffineTransform(scaleX: scale, y: scale))

        // Core Image QR is black modules on transparent; force white plate.
        let colored = scaled.applyingFilter(
            "CIFalseColor",
            parameters: [
                "inputColor0": CIColor.black,
                "inputColor1": CIColor.white,
            ]
        )

        let context = CIContext(options: [.useSoftwareRenderer: false])
        guard let cgImage = context.createCGImage(colored, from: colored.extent) else {
            return nil
        }
        return UIImage(cgImage: cgImage)
    }
}

/// Optional network QR (hosted PNG). Prefer `TVLocalQRCodeImage` for the gate.
struct TVHostedLinkQRImage: View {
    let verificationURIComplete: String

    var body: some View {
        if let url = HostedDeviceLinkClient.qrImageURL(for: verificationURIComplete) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .interpolation(.none)
                        .scaledToFit()
                case .failure:
                    TVLocalQRCodeImage(value: verificationURIComplete)
                case .empty:
                    ProgressView()
                        .tint(.black.opacity(0.4))
                @unknown default:
                    TVLocalQRCodeImage(value: verificationURIComplete)
                }
            }
        } else {
            TVLocalQRCodeImage(value: verificationURIComplete)
        }
    }
}

/// Deterministic monochrome QR stand-in for parity freezes (no network).
struct TVParityQRModules: View {
    var body: some View {
        let n = 11
        return Canvas { context, size in
            let cell = size.width / CGFloat(n)
            for (fx, fy) in [(0, 0), (n - 3, 0), (0, n - 3)] {
                let r = CGRect(
                    x: CGFloat(fx) * cell,
                    y: CGFloat(fy) * cell,
                    width: cell * 3,
                    height: cell * 3
                )
                context.stroke(
                    Path(roundedRect: r.insetBy(dx: cell * 0.15, dy: cell * 0.15), cornerRadius: 1),
                    with: .color(.black),
                    lineWidth: cell * 0.35
                )
                context.fill(
                    Path(
                        roundedRect: CGRect(
                            x: r.midX - cell * 0.45,
                            y: r.midY - cell * 0.45,
                            width: cell * 0.9,
                            height: cell * 0.9
                        ),
                        cornerRadius: 0.5
                    ),
                    with: .color(.black)
                )
            }
            var seed: UInt64 = 0xA5C3_2345
            for y in 0..<n {
                for x in 0..<n {
                    if (x < 3 && y < 3) || (x >= n - 3 && y < 3) || (x < 3 && y >= n - 3) {
                        continue
                    }
                    seed = seed &* 1_103_515_245 &+ 12_345
                    if seed % 3 == 0 {
                        let r = CGRect(
                            x: CGFloat(x) * cell + cell * 0.12,
                            y: CGFloat(y) * cell + cell * 0.12,
                            width: cell * 0.76,
                            height: cell * 0.76
                        )
                        context.fill(Path(r), with: .color(.black))
                    }
                }
            }
        }
    }
}
