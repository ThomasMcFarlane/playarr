import PlayarrKit
import SwiftUI

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
                    verificationURI: pending.verificationUri,
                    qr: AnyView(
                        TVHostedLinkQRImage(
                            verificationURIComplete: pending.verificationUriComplete
                        )
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
}

// MARK: - Device login chrome (live /login/qr)

/// Production pairing chrome matches live web `/login/qr`
/// (`ProfileAuthLayout` + embedded `DeviceLogin`): centred column, Welcome
/// home / Sign in to Playarr, QR tile (240 / 12 / r=18 + soft shadow) above
/// instructions and code. Parity freezes still use measured left-rail geometry
/// via `TVParityPairingFixtureView`.
struct TVDeviceLoginChrome: View {
    enum Phase {
        case requesting
        case awaitingApproval(userCode: String, verificationURI: String, qr: AnyView)
        case failed(String)
    }

    let phase: Phase
    var onRetry: (() -> Void)?

    var body: some View {
        GeometryReader { geo in
            ZStack {
                DesignTokens.Color.backgroundBase
                // Soft rose halo behind the plate (web profiles-page wash).
                RadialGradient(
                    colors: [
                        DesignTokens.Color.brandPrimary.opacity(0.14),
                        DesignTokens.Color.brandPrimary.opacity(0.05),
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
                        .foregroundStyle(DesignTokens.Color.textDisabled)

                    Text("Sign in to Playarr")
                        .font(.system(size: 64, weight: .medium))
                        .tracking(-4.0)
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                        .multilineTextAlignment(.center)
                        .padding(.top, 8)

                    Text("Scan the QR code with your phone or another browser to sign in on this device.")
                        .font(.system(size: 17, weight: .regular))
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 440)
                        .padding(.top, 16)
                        .padding(.bottom, 28)

                    phaseBody
                }
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                .padding(.horizontal, 48)
            }
        }
        .ignoresSafeArea()
    }

    private var playarrWordmark: some View {
        HStack(spacing: 8) {
            ZStack {
                Circle()
                    .fill(DesignTokens.Color.brandPrimary)
                    .frame(width: 34, height: 34)
                Image(systemName: "play.fill")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white)
                    .offset(x: 1)
            }
            HStack(spacing: 0) {
                Text("Play")
                    .foregroundStyle(DesignTokens.Color.brandPrimary)
                Text("arr")
                    .foregroundStyle(DesignTokens.Color.textPrimary)
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
                .foregroundStyle(DesignTokens.Color.textSecondary)
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
                .shadow(color: Color.black.opacity(0.30), radius: 36, x: 0, y: 24)

                VStack(alignment: .center, spacing: 10) {
                    Text("Scan the QR code, or visit")
                        .font(.system(size: 15, weight: .regular))
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                    Text(verificationURI)
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                    Text("and enter the code")
                        .font(.system(size: 15, weight: .regular))
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                    Text(userCode)
                        .font(.system(size: 52, weight: .bold, design: .monospaced))
                        .tracking(5)
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                    Text("Waiting for approval…")
                        .font(.system(size: 13, weight: .regular))
                        .foregroundStyle(DesignTokens.Color.textDisabled)
                        .padding(.top, 2)
                }
                .multilineTextAlignment(.center)
            }
        case .failed(let message):
            VStack(alignment: .leading, spacing: 16) {
                Text(message)
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(DesignTokens.Color.stateError)
                    .fixedSize(horizontal: false, vertical: true)
                if let onRetry {
                    Button("Try again", action: onRetry)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(DesignTokens.Color.brandPrimary)
                        .buttonStyle(TVFocusableCardButtonStyle())
                }
            }
        }
    }
}

/// Live hosted-link QR image (playarr.app `/api/link/qr`).
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
                    Color.black.opacity(0.08)
                case .empty:
                    ProgressView()
                        .tint(.black.opacity(0.4))
                @unknown default:
                    Color.black.opacity(0.08)
                }
            }
        } else {
            Color.black.opacity(0.08)
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
