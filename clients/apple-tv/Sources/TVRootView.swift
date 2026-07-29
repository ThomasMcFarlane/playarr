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

/// Auth surfaces matching web `/profiles` ↔ `/login/qr` ↔ `/login`.
private enum TVAuthRoute: Equatable {
    case profiles
    case qr
    case manual
}

/// Full-screen pairing gate: SPA `/login/qr` chrome 1:1 via
/// `TVDeviceLoginChrome`. Back opens `/profiles` (Who's watching?). Server
/// URL is not typed on the QR path; playarr.app hosted link supplies it.
struct TVPairingGateView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var pairingTask: Task<Void, Never>?
    @State private var route: TVAuthRoute = .qr
    /// Countdown for the active hosted code (web `device-login-timer`).
    @State private var secondsRemaining: Int = 5 * 60

    /// Hashable handle so onChange can reset the countdown when a new code arrives.
    private var approvalUserCode: String? {
        if case .awaitingApproval(let pending) = environment.pairingState {
            return pending.userCode
        }
        return nil
    }

    var body: some View {
        Group {
            switch route {
            case .profiles:
                TVProfilesView(
                    onLinkTV: {
                        route = .qr
                        beginPairing(hosted: true)
                    },
                    onManual: { route = .manual }
                )
            case .manual:
                TVDeviceLoginChrome(
                    phase: .manualServer,
                    onRetry: nil,
                    onBack: { route = .profiles },
                    onBackToQr: {
                        route = .qr
                        beginPairing(hosted: true)
                    },
                    onManualConnect: { beginPairing(hosted: false) }
                )
            case .qr:
                qrChrome
            }
        }
        .onAppear {
            switch environment.pairingState {
            case .signedOut, .failed:
                if route == .qr { beginPairing(hosted: true) }
            default:
                break
            }
        }
        .onDisappear {
            if case .signedIn = environment.pairingState { return }
            pairingTask?.cancel()
            pairingTask = nil
        }
        .onChange(of: approvalUserCode) { _, code in
            guard code != nil,
                  case .awaitingApproval(let pending) = environment.pairingState else { return }
            secondsRemaining = min(5 * 60, max(1, Int(pending.expiresIn)))
        }
        .task(id: "\(approvalUserCode ?? "")-\(secondsRemaining)") {
            guard route == .qr, case .awaitingApproval = environment.pairingState else { return }
            guard secondsRemaining > 0 else {
                beginPairing(hosted: true)
                return
            }
            try? await Task.sleep(for: .seconds(1))
            if !Task.isCancelled { secondsRemaining -= 1 }
        }
    }

    @ViewBuilder
    private var qrChrome: some View {
        switch environment.pairingState {
        case .signedOut, .requestingCode:
            TVDeviceLoginChrome(
                phase: .requesting,
                onRetry: nil,
                onManual: { route = .manual },
                onBack: { route = .profiles }
            )
        case .awaitingApproval(let pending):
            TVDeviceLoginChrome(
                phase: .awaitingApproval(
                    userCode: pending.userCode,
                    verificationURI: Self.displayVerificationURI(pending.verificationUri),
                    qr: AnyView(
                        TVLocalQRCodeImage(value: pending.verificationUriComplete)
                    ),
                    secondsRemaining: secondsRemaining
                ),
                onRetry: nil,
                onManual: { route = .manual },
                onBack: { route = .profiles }
            )
        case .signedIn:
            EmptyView()
        case .failed(let message):
            TVDeviceLoginChrome(
                phase: .failed(message),
                onRetry: { beginPairing(hosted: true) },
                onManual: { route = .manual },
                onBack: { route = .profiles }
            )
        }
    }

    private func beginPairing(hosted: Bool) {
        pairingTask?.cancel()
        pairingTask = Task { await environment.startPairing(forceHosted: hosted) }
    }

    /// On-screen "visit …" line is always the playarr.app app link, matching
    /// live `/login/qr`. Direct-server Host/relay URLs stay out of the UI.
    static func displayVerificationURI(_ uri: String) -> String {
        _ = uri
        return "https://playarr.app/link"
    }
}

// MARK: - Profiles (web `/profiles` Who's watching?)

/// Household profile picker. Back from `/login/qr` lands here so linked
/// profiles stay reachable without re-scanning.
struct TVProfilesView: View {
    var onLinkTV: () -> Void
    var onManual: () -> Void

    @Environment(TVAppEnvironment.self) private var environment
    @Environment(TVDisplayPreferences.self) private var displayPreferences
    @State private var profiles: [AvailableProfile] = []
    @State private var loadError: String?
    @State private var isLoading = true
    @State private var switchingID: UUID?
    @State private var pinProfile: AvailableProfile?
    @State private var pin = ""
    @State private var pinError: String?
    @FocusState private var focusedProfileID: UUID?

    private var palette: TVAuthPalette {
        TVAuthPalette.forTheme(displayPreferences.resolvedTheme)
    }

    var body: some View {
        GeometryReader { geo in
            let s = min(
                geo.size.width / DesignTokens.Shell.canvasWidth,
                geo.size.height / DesignTokens.Shell.canvasHeight
            )
            ZStack {
                palette.bg
                RadialGradient(
                    colors: [
                        palette.brandPink.opacity(palette.isDark ? 0.13 : 0.10),
                        .clear,
                    ],
                    center: UnitPoint(x: 0.50, y: 0.42),
                    startRadius: 20 * s,
                    endRadius: min(geo.size.width, geo.size.height) * 0.34
                )

                VStack(spacing: 0) {
                    Text("PROFILES")
                        .font(.system(size: 11 * s, weight: .heavy))
                        .tracking(1.6 * s)
                        .foregroundStyle(palette.brandPink)
                        .padding(.top, 90 * s)

                    Text("Who's watching?")
                        .font(.system(size: 54 * s, weight: .medium))
                        .tracking(-2.2 * s)
                        .foregroundStyle(palette.ink)
                        .padding(.top, 10 * s)

                    if isLoading {
                        ProgressView()
                            .tint(palette.brandPink)
                            .padding(.top, 72 * s)
                    } else if profiles.isEmpty {
                        emptyState(scale: s)
                    } else {
                        profileRow(scale: s)
                            .padding(.top, 72 * s)
                    }

                    if let loadError {
                        Text(loadError)
                            .font(.system(size: 14 * s, weight: .medium))
                            .foregroundStyle(palette.inkMuted)
                            .multilineTextAlignment(.center)
                            .padding(.top, 24 * s)
                            .frame(maxWidth: 480 * s)
                    }

                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                TVAuthStageChrome(
                    palette: palette,
                    scale: s,
                    showBack: true,
                    onBack: onLinkTV
                )
            }
        }
        .ignoresSafeArea()
        .preferredColorScheme(displayPreferences.colorScheme)
        .task { await reload() }
        .alert(
            "Enter PIN",
            isPresented: Binding(
                get: { pinProfile != nil },
                set: { if !$0 { pinProfile = nil; pin = ""; pinError = nil } }
            )
        ) {
            SecureField("4-digit PIN", text: $pin)
                .keyboardType(.numberPad)
            Button("Cancel", role: .cancel) {
                pinProfile = nil
                pin = ""
                pinError = nil
            }
            Button("Continue") {
                guard let profile = pinProfile else { return }
                Task { await select(profile, pin: pin) }
            }
        } message: {
            Text(pinError ?? "This profile is locked.")
        }
    }

    @ViewBuilder
    private func emptyState(scale s: CGFloat) -> some View {
        VStack(spacing: 20 * s) {
            Text("No profiles on this Apple TV yet.")
                .font(.system(size: 18 * s, weight: .medium))
                .foregroundStyle(palette.inkMuted)
                .multilineTextAlignment(.center)
                .padding(.top, 56 * s)
            Button(action: onLinkTV) {
                Text("Link this TV")
                    .font(.system(size: 16 * s, weight: .bold))
                    .padding(.horizontal, 28 * s)
                    .padding(.vertical, 16 * s)
                    .foregroundStyle(palette.isDark ? palette.bg : Color.white)
                    .background(palette.brandPink)
                    .clipShape(Capsule())
            }
            .buttonStyle(TVFocusableCardButtonStyle())
            Button("Sign in manually", action: onManual)
                .font(.system(size: 15 * s, weight: .semibold))
                .foregroundStyle(palette.inkSoft)
                .buttonStyle(TVFocusableCardButtonStyle())
        }
    }

    private func profileRow(scale s: CGFloat) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 38 * s) {
                ForEach(profiles) { profile in
                    profileCard(profile, scale: s)
                }
                addProfileCard(scale: s)
            }
            .padding(.horizontal, 120 * s)
            .padding(.vertical, 24 * s)
        }
    }

    private func profileCard(_ profile: AvailableProfile, scale s: CGFloat) -> some View {
        let focused = focusedProfileID == profile.id
        let busy = switchingID == profile.id
        return Button {
            if profile.pinLocked && !profile.isCurrent {
                pinProfile = profile
                pin = ""
                pinError = nil
            } else {
                Task { await select(profile, pin: nil) }
            }
        } label: {
            VStack(spacing: 16 * s) {
                ZStack {
                    Circle()
                        .fill(palette.surfaceStrong)
                        .frame(width: 120 * s, height: 120 * s)
                        .overlay(
                            Circle().stroke(
                                focused || profile.isCurrent
                                    ? palette.brandPink
                                    : palette.lineStrong,
                                lineWidth: focused ? 3 : 1
                            )
                        )
                    Text(profileInitials(profile))
                        .font(.system(size: 36 * s, weight: .semibold))
                        .foregroundStyle(palette.ink)
                    if busy {
                        ProgressView().tint(palette.brandPink)
                    }
                }
                Text(profile.displayName.isEmpty ? profile.username : profile.displayName)
                    .font(.system(size: 16 * s, weight: .semibold))
                    .foregroundStyle(palette.ink)
                    .lineLimit(1)
                if profile.pinLocked {
                    Image(systemName: "lock.fill")
                        .font(.system(size: 12 * s))
                        .foregroundStyle(palette.inkMuted)
                }
            }
            .frame(width: 140 * s)
            .scaleEffect(focused ? 1.06 : 1)
        }
        .buttonStyle(TVFocusableCardButtonStyle())
        .focused($focusedProfileID, equals: profile.id)
        .disabled(switchingID != nil)
    }

    private func addProfileCard(scale s: CGFloat) -> some View {
        Button(action: onLinkTV) {
            VStack(spacing: 16 * s) {
                ZStack {
                    Circle()
                        .stroke(palette.lineStrong, style: StrokeStyle(lineWidth: 2, dash: [6, 6]))
                        .frame(width: 120 * s, height: 120 * s)
                    Image(systemName: "plus")
                        .font(.system(size: 36 * s, weight: .medium))
                        .foregroundStyle(palette.inkMuted)
                }
                Text("Add profile")
                    .font(.system(size: 16 * s, weight: .semibold))
                    .foregroundStyle(palette.inkMuted)
            }
            .frame(width: 140 * s)
        }
        .buttonStyle(TVFocusableCardButtonStyle())
    }

    private func profileInitials(_ profile: AvailableProfile) -> String {
        let name = profile.displayName.isEmpty ? profile.username : profile.displayName
        let parts = name.split(separator: " ").prefix(2)
        let letters = parts.compactMap { $0.first.map(String.init) }
        return letters.joined().uppercased()
    }

    private func reload() async {
        isLoading = true
        loadError = nil
        let list = await environment.loadProfiles()
        profiles = list
        isLoading = false
        if list.isEmpty {
            let usable = await environment.hasUsableSession()
            if !usable {
                loadError = "Link this TV to load household profiles, or pick Add profile."
            }
        }
        if focusedProfileID == nil {
            focusedProfileID = list.first(where: \.isCurrent)?.id ?? list.first?.id
        }
    }

    private func select(_ profile: AvailableProfile, pin submittedPin: String?) async {
        switchingID = profile.id
        pinError = nil
        do {
            try await environment.switchToProfile(profile, pin: submittedPin)
            pinProfile = nil
            pin = ""
        } catch {
            // No active session / switch failed → resume QR pairing for this TV.
            if await environment.hasUsableSession() {
                pinError = error.localizedDescription
                if pinProfile == nil, profile.pinLocked {
                    pinProfile = profile
                }
            } else {
                pinProfile = nil
                onLinkTV()
            }
        }
        switchingID = nil
    }
}

// MARK: - Device login chrome (live /login/qr @ 1920×1080)

/// 1:1 with measured web `/login/qr` (`ProfileAuthLayout` + `TvStageChrome` +
/// embedded `DeviceLogin`). Geometry from Playwright CDP @ 1920×1080.
struct TVDeviceLoginChrome: View {
    enum Phase {
        case requesting
        case awaitingApproval(
            userCode: String,
            verificationURI: String,
            qr: AnyView,
            secondsRemaining: Int
        )
        case failed(String)
        case manualServer
    }

    let phase: Phase
    var onRetry: (() -> Void)?
    var onManual: (() -> Void)?
    /// Web ← back (usually to profiles). Always shown on QR when set.
    var onBack: (() -> Void)?
    var onBackToQr: (() -> Void)?
    var onManualConnect: (() -> Void)?

    @Environment(TVAppEnvironment.self) private var environment
    @Environment(TVDisplayPreferences.self) private var displayPreferences

    private var palette: TVAuthPalette {
        TVAuthPalette.forTheme(displayPreferences.resolvedTheme)
    }

    var body: some View {
        GeometryReader { geo in
            let scaleX = geo.size.width / DesignTokens.Shell.canvasWidth
            let scaleY = geo.size.height / DesignTokens.Shell.canvasHeight
            // Prefer height-driven scale so 1920×1080 TV maps 1:1; clamp for
            // odd sim aspect ratios without breaking positions.
            let s = min(scaleX, scaleY)

            ZStack {
                palette.bg
                RadialGradient(
                    colors: [
                        palette.brandPink.opacity(palette.isDark ? 0.13 : 0.10),
                        .clear,
                    ],
                    center: UnitPoint(x: 0.50, y: 0.48),
                    startRadius: 20 * s,
                    endRadius: min(geo.size.width, geo.size.height) * 0.34
                )

                // Centred auth panel (web `.profile-auth-panel` w=560).
                VStack(spacing: 0) {
                    Text("WELCOME HOME")
                        .font(.system(size: 11.84 * s, weight: .heavy))
                        .tracking(2.13 * s)
                        .foregroundStyle(palette.inkMuted)
                        .textCase(.uppercase)

                    Text("Sign in to Playarr")
                        .font(.system(size: 80.64 * s, weight: .medium))
                        .tracking(-5.81 * s)
                        .foregroundStyle(palette.ink)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .minimumScaleFactor(0.7)
                        .padding(.top, 7.2 * s)

                    Text(descriptionCopy)
                        .font(.system(size: 19.2 * s, weight: .regular))
                        .foregroundStyle(palette.inkMuted)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 491 * s)
                        .padding(.top, 16 * s)
                        .padding(.bottom, 32 * s)

                    phaseBody(scale: s)
                }
                .frame(width: 560 * s)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                // Panel top ≈ y188 of 1080 → ~17.4% from top; keep vertical centre-ish.
                .padding(.top, 40 * s)

                // Web `TvStageChrome`: logo, ← back (to profiles), theme + language.
                TVAuthStageChrome(
                    palette: palette,
                    scale: s,
                    showBack: onBack != nil || (isManual && onBackToQr != nil),
                    onBack: {
                        if isManual, let onBackToQr {
                            onBackToQr()
                        } else {
                            onBack?()
                        }
                    }
                )
            }
        }
        .ignoresSafeArea()
        .preferredColorScheme(displayPreferences.colorScheme)
    }

    private var isManual: Bool {
        if case .manualServer = phase { return true }
        return false
    }

    private var descriptionCopy: String {
        switch phase {
        case .manualServer:
            return "Enter your Playarr Server address to sign in with a username and password on this device."
        default:
            return "Scan the QR code with your phone or another browser to sign in on this device."
        }
    }

    @ViewBuilder
    private func phaseBody(scale s: CGFloat) -> some View {
        switch phase {
        case .requesting:
            ProgressView()
                .tint(palette.brandPink)
                .padding(.top, 40 * s)
            Text("Creating a secure sign-in code…")
                .font(.system(size: 15 * s, weight: .regular))
                .foregroundStyle(palette.inkMuted)
                .padding(.top, 16 * s)
            manualButton(scale: s)

        case .awaitingApproval(let userCode, let verificationURI, let qr, let secondsRemaining):
            // Web `.device-login-options` column, gap 1.35rem ≈ 21.6
            VStack(spacing: 21.6 * s) {
                ZStack {
                    RoundedRectangle(cornerRadius: 18 * s, style: .continuous)
                        .fill(Color.white)
                    qr
                        .frame(width: 216 * s, height: 216 * s)
                }
                .frame(width: 240 * s, height: 240 * s)
                .clipShape(RoundedRectangle(cornerRadius: 18 * s, style: .continuous))
                .shadow(
                    color: Color.black.opacity(palette.isDark ? 0.30 : 0.09),
                    radius: 36 * s,
                    x: 0,
                    y: 24 * s
                )

                VStack(spacing: 0) {
                    Text("Scan the QR code, or visit")
                        .font(.system(size: 15 * s, weight: .regular))
                        .foregroundStyle(palette.inkMuted)
                        .padding(.top, 4 * s)
                    Text(verificationURI)
                        .font(.system(size: 24 * s, weight: .bold))
                        .foregroundStyle(palette.ink)
                        .padding(.top, 10 * s)
                    Text("and enter this code")
                        .font(.system(size: 15 * s, weight: .regular))
                        .foregroundStyle(palette.inkMuted)
                        .padding(.top, 10 * s)
                    Text(userCode)
                        .font(.system(size: 56 * s, weight: .bold, design: .monospaced))
                        .tracking(7.84 * s)
                        .foregroundStyle(palette.ink)
                        .padding(.top, 6 * s)
                    Text("Waiting for approval…")
                        .font(.system(size: 13 * s, weight: .regular))
                        .foregroundStyle(palette.inkMuted)
                        .padding(.top, 12 * s)
                    Text("Code refreshes in \(Self.formatCountdown(secondsRemaining))")
                        .font(.system(size: 16 * s, weight: .bold, design: .monospaced))
                        .foregroundStyle(palette.inkSoft)
                        .padding(.top, 14 * s)
                }
                .multilineTextAlignment(.center)
            }
            manualButton(scale: s)

        case .failed(let message):
            VStack(spacing: 16 * s) {
                Text(message)
                    .font(.system(size: 15 * s, weight: .regular))
                    .foregroundStyle(palette.danger)
                    .multilineTextAlignment(.center)
                if let onRetry {
                    Button("Try again", action: onRetry)
                        .font(.system(size: 15 * s, weight: .semibold))
                        .foregroundStyle(palette.brandPink)
                        .buttonStyle(TVFocusableCardButtonStyle())
                }
            }
            manualButton(scale: s)

        case .manualServer:
            VStack(alignment: .leading, spacing: 14 * s) {
                Text("Playarr Server address")
                    .font(.system(size: 12 * s, weight: .heavy))
                    .foregroundStyle(palette.inkMuted)
                    .textCase(.uppercase)
                TextField(
                    "https://playarr.example:8484",
                    text: Bindable(environment).serverAddress
                )
                .font(.system(size: 18 * s, weight: .medium))
                .foregroundStyle(palette.ink)
                .padding(.horizontal, 16 * s)
                .padding(.vertical, 14 * s)
                .background(palette.surfaceStrong)
                .overlay(
                    Rectangle().stroke(palette.lineStrong, lineWidth: 1)
                )
                Button {
                    if environment.saveServerAddress() {
                        onManualConnect?()
                    }
                } label: {
                    Text("Connect")
                        .font(.system(size: 15 * s, weight: .bold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16 * s)
                        .foregroundStyle(palette.isDark ? palette.bg : Color.white)
                        .background(palette.inkSoft)
                        .clipShape(Capsule())
                }
                .buttonStyle(TVFocusableCardButtonStyle())
                if let onBackToQr {
                    Button("Sign in with QR code", action: onBackToQr)
                        .font(.system(size: 15 * s, weight: .bold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16 * s)
                        .foregroundStyle(palette.inkSoft)
                        .background(palette.surfaceStrong)
                        .overlay(Capsule().stroke(palette.lineStrong, lineWidth: 1))
                        .buttonStyle(TVFocusableCardButtonStyle())
                }
            }
            .frame(maxWidth: 520 * s)
        }
    }

    @ViewBuilder
    private func manualButton(scale s: CGFloat) -> some View {
        if let onManual {
            Button(action: onManual) {
                Text("Sign in manually")
                    .font(.system(size: 14.72 * s, weight: .bold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16 * s)
                    .foregroundStyle(palette.inkSoft)
                    .background(palette.surfaceStrong)
                    .overlay(
                        Capsule().stroke(palette.lineStrong, lineWidth: 1)
                    )
                    .clipShape(Capsule())
            }
            .buttonStyle(TVFocusableCardButtonStyle())
            .padding(.top, 20 * s)
            .frame(maxWidth: 560 * s)
        }
    }

    static func formatCountdown(_ seconds: Int) -> String {
        let clamped = max(0, seconds)
        return "\(clamped / 60):\(String(format: "%02d", clamped % 60))"
    }
}

/// Web `TvStageChrome` absolute layout @ 1920×1080:
/// - logo 42×42 at left ≈ 60.6 (nav centre-x − logo/2), top ≈ 56
/// - optional back 50×50 circle at left ≈ 154
/// - theme 144×48 + language 168×48, square corners, top ≈ 50, right ≈ 42
struct TVAuthStageChrome: View {
    let palette: TVAuthPalette
    var scale: CGFloat = 1
    var showBack: Bool = false
    var onBack: (() -> Void)?

    @Environment(TVDisplayPreferences.self) private var displayPreferences

    /// Matches CSS logo centre-x on the left nav rail.
    private var logoLeft: CGFloat {
        let centre = DesignTokens.Shell.navEdge
            + DesignTokens.Shell.navPaddingInline
            + DesignTokens.Shell.navItemSize / 2
            + 1
        return (centre - DesignTokens.Shell.logoSize / 2) * scale
    }

    private var logoTop: CGFloat { DesignTokens.Shell.headerTop * scale }
    private var logoSize: CGFloat { DesignTokens.Shell.logoSize * scale }
    private var controlsTop: CGFloat { 50 * scale }
    private var controlsRight: CGFloat { DesignTokens.Shell.navEdge * scale }

    var body: some View {
        ZStack(alignment: .topLeading) {
            PlayarrLogoMark(size: logoSize)
                .frame(width: logoSize, height: logoSize)
                .position(
                    x: logoLeft + logoSize / 2,
                    y: logoTop + logoSize / 2 + 4 * scale
                )
                .accessibilityHidden(true)

            if showBack, let onBack {
                Button(action: onBack) {
                    Image(systemName: "arrow.left")
                        .font(.system(size: 17 * scale, weight: .semibold))
                        .foregroundStyle(palette.inkSoft)
                        .frame(width: 50 * scale, height: 50 * scale)
                        .background(palette.surfaceStrong.opacity(0.70))
                        .overlay(
                            Circle().stroke(palette.lineStrong.opacity(0.66), lineWidth: 1)
                        )
                        .clipShape(Circle())
                }
                .buttonStyle(TVFocusableCardButtonStyle())
                .position(x: 154 * scale + 25 * scale, y: logoTop + 25 * scale)
                .accessibilityLabel("Back")
            }

            HStack(spacing: 14 * scale) {
                themeMenu
                languageMenu
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            .padding(.top, controlsTop)
            .padding(.trailing, controlsRight)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
                icon: "sun.max",
                label: displayPreferences.themeTriggerLabel,
                minWidth: 144 * scale,
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
                minWidth: 168 * scale,
                accessibility: "Language: \(displayPreferences.languageTriggerLabel)"
            )
        }
        .buttonStyle(TVFocusableCardButtonStyle())
    }

    private func chromeTrigger(
        icon: String,
        label: String,
        minWidth: CGFloat,
        accessibility: String
    ) -> some View {
        // Web `.language-dropdown-trigger`: square corners, 48px tall, bg var(--bg).
        HStack(spacing: 9.6 * scale) {
            Image(systemName: icon)
                .font(.system(size: 14 * scale, weight: .semibold))
                .foregroundStyle(palette.inkMuted)
            Text(label)
                .font(.system(size: 13.8 * scale, weight: .bold))
                .foregroundStyle(palette.ink)
                .lineLimit(1)
            Image(systemName: "chevron.down")
                .font(.system(size: 11 * scale, weight: .semibold))
                .foregroundStyle(palette.inkMuted)
        }
        .padding(.horizontal, 18.4 * scale)
        .frame(minWidth: minWidth, minHeight: 48 * scale)
        .background(palette.bg)
        .overlay(
            Rectangle().stroke(palette.lineStrong, lineWidth: 1)
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
