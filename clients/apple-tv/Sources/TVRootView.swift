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
    /// Default QR. Pass `-PlayarrStartRoute profiles` to open Who’s watching first
    /// (dev/sim verification of the dashed add tile without re-install thrash).
    @State private var route: TVAuthRoute = {
        let args = ProcessInfo.processInfo.arguments
        if let idx = args.firstIndex(of: "-PlayarrStartRoute"),
           args.indices.contains(idx + 1),
           args[idx + 1].lowercased() == "profiles" {
            return .profiles
        }
        return .qr
    }()
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
            // Cap on-screen lifetime to 5 minutes like web MAX_DEVICE_CODE_LIFETIME.
            secondsRemaining = min(5 * 60, max(1, Int(pending.expiresIn)))
        }
        // Countdown only — expiry renew is owned by startPairing's silent loop
        // (and pollUntilClaim grace), matching web renewCode without an error flash.
        .task(id: approvalUserCode) {
            guard route == .qr else { return }
            while !Task.isCancelled {
                guard case .awaitingApproval = environment.pairingState else { return }
                if secondsRemaining <= 0 {
                    // Blank briefly then silent renew (web setDeviceCode(null) + renewCode).
                    beginPairing(hosted: true)
                    return
                }
                try? await Task.sleep(for: .seconds(1))
                if !Task.isCancelled, case .awaitingApproval = environment.pairingState {
                    secondsRemaining -= 1
                }
            }
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
            // Never park on expiry copy — web auto-renews instead.
            if Self.isExpiryMessage(message) {
                TVDeviceLoginChrome(
                    phase: .requesting,
                    onRetry: nil,
                    onManual: { route = .manual },
                    onBack: { route = .profiles }
                )
                .task { beginPairing(hosted: true) }
            } else {
                TVDeviceLoginChrome(
                    phase: .failed(message),
                    onRetry: { beginPairing(hosted: true) },
                    onManual: { route = .manual },
                    onBack: { route = .profiles }
                )
            }
        }
    }

    private func beginPairing(hosted: Bool) {
        pairingTask?.cancel()
        pairingTask = Task { await environment.startPairing(forceHosted: hosted) }
    }

    /// Web `isExpiredCodeError` — treat as silent renew, never error chrome.
    private static func isExpiryMessage(_ message: String) -> Bool {
        message.range(of: #"\bexpired\b"#, options: .regularExpression) != nil
    }

    /// On-screen "visit …" line is always the playarr.app app link, matching
    /// live `/login/qr`. Direct-server Host/relay URLs stay out of the UI.
    static func displayVerificationURI(_ uri: String) -> String {
        _ = uri
        return "https://playarr.app/link"
    }
}

// MARK: - Profiles (web `/profiles` Who's watching?)

/// Focus targets for the Who's watching row (web profiles track + `#profile-add`).
private enum TVProfilesFocus: Hashable {
    case profile(UUID)
    case add
}

/// Household profile picker matching live web `/profiles` 1:1 @ 1920×1080.
/// Always shows the dashed blank “+” add tile (`Sign in` / `ADD ANOTHER PROFILE`).
/// Back from `/login/qr` lands here so linked profiles stay reachable without re-scanning.
struct TVProfilesView: View {
    var onLinkTV: () -> Void
    /// Kept for pairing-gate call-site parity; manual entry lives on the QR chrome.
    var onManual: () -> Void

    @Environment(TVAppEnvironment.self) private var environment
    @Environment(TVDisplayPreferences.self) private var displayPreferences
    @State private var profiles: [AvailableProfile] = []
    @State private var loadError: String?
    /// Never start true: empty households must show the dashed + tile on first
    /// paint (web `#profile-add`), not a spinner-only void.
    @State private var isLoading = false
    @State private var switchingID: UUID?
    @State private var pinProfile: AvailableProfile?
    @State private var pin = ""
    @State private var pinError: String?
    /// Web `selectedId` — drives under-avatar actions (settings / sign out).
    @State private var selectedID: String = "add"
    @FocusState private var focusedTarget: TVProfilesFocus?
    /// Shared with `TVAuthStageChrome` so ArrowUp from the avatar row can
    /// reach theme/language (web ProfileAuthLayout focus bridge).
    @FocusState private var chromeFocus: TVAuthFocus?

    private var palette: TVAuthPalette {
        TVAuthPalette.forTheme(displayPreferences.resolvedTheme)
    }

    /// Leave the profile track and land on top chrome (language is the usual
    /// right-side entry; theme is one Left away).
    private func moveFocusToChrome() {
        focusedTarget = nil
        chromeFocus = .language
    }

    /// Leave chrome and land on the profile track (current → first → add).
    private func moveFocusToProfiles() {
        chromeFocus = nil
        if let current = profiles.first(where: \.isCurrent) {
            focusedTarget = .profile(current.id)
        } else if let first = profiles.first {
            focusedTarget = .profile(first.id)
        } else {
            focusedTarget = .add
        }
    }

    /// Web `.profile-choice` max: `clamp(160px, 13vw, 244px)` @ 1920 → 244.
    private func avatarSize(scale s: CGFloat) -> CGFloat { 244 * s }

    /// Web `.profiles-track` gap: `clamp(22px, 2.2vw, 44px)` @ 1920 → ~42.
    private func trackGap(scale s: CGFloat) -> CGFloat { 42 * s }

    var body: some View {
        GeometryReader { geo in
            let s = min(
                geo.size.width / DesignTokens.Shell.canvasWidth,
                geo.size.height / DesignTokens.Shell.canvasHeight
            )
            let size = avatarSize(scale: s)

            ZStack {
                TVAuthStageBackground(palette: palette, style: .profiles)

                VStack(spacing: 0) {
                    // Web `.profiles-heading` top: clamp(104px, 15vh, 164px) @ 1080 → 162.
                    Color.clear.frame(height: 162 * s)

                    Text("PROFILES")
                        .font(.system(size: 11 * s, weight: .heavy))
                        .tracking(1.6 * s)
                        .foregroundStyle(palette.brandPink)

                    Text("Who's watching?")
                        .font(.system(size: 54 * s, weight: .medium))
                        .tracking(-2.2 * s)
                        .foregroundStyle(palette.ink)
                        .padding(.top, 8 * s)

                    // Always paint the track (including the dashed + add tile).
                    // Never gate the empty household on isLoading — web shows
                    // `#profile-add` immediately; a spinner-only empty state
                    // is what looked like “no circle to add an account”.
                    profileRow(scale: s, avatarSize: size)
                        .padding(.top, 88 * s)
                        .overlay(alignment: .top) {
                            if isLoading && profiles.isEmpty {
                                ProgressView()
                                    .tint(palette.brandPink)
                                    .padding(.top, 40 * s)
                            }
                        }

                    if let loadError {
                        Text(loadError)
                            .font(.system(size: 14 * s, weight: .medium))
                            .foregroundStyle(palette.inkMuted)
                            .multilineTextAlignment(.center)
                            .padding(.top, 20 * s)
                            .frame(maxWidth: 520 * s)
                    }

                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                // Web `/profiles` uses bare `<TvStageChrome />` — logo + theme/language
                // only. No back control (unlike `/login/qr` with onBack).
                TVAuthStageChrome(
                    palette: palette,
                    scale: s,
                    showBack: false,
                    authFocus: $chromeFocus,
                    onMoveDownFromChrome: { moveFocusToProfiles() },
                    onBack: nil
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

    private func profileRow(scale s: CGFloat, avatarSize size: CGFloat) -> some View {
        // Fixed height so a horizontal ScrollView cannot collapse to 0 in a
        // VStack (classic SwiftUI layout trap that hid the add circle entirely).
        let rowHeight = size + 160 * s
        return Group {
            if profiles.count <= 4 {
                // Centre the track when few faces (web `justify-content: center`).
                HStack(alignment: .top, spacing: trackGap(scale: s)) {
                    ForEach(Array(profiles.enumerated()), id: \.element.id) { index, profile in
                        profileCard(profile, index: index, scale: s, avatarSize: size)
                    }
                    addProfileCard(scale: s, avatarSize: size)
                }
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.horizontal, 72 * s)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: trackGap(scale: s)) {
                        ForEach(Array(profiles.enumerated()), id: \.element.id) { index, profile in
                            profileCard(profile, index: index, scale: s, avatarSize: size)
                        }
                        // Always present — web `#profile-add` blank dashed avatar.
                        addProfileCard(scale: s, avatarSize: size)
                    }
                    // Web `.profiles-track` padding-inline: clamp(72px, 10vw, 190px).
                    .padding(.horizontal, 190 * s)
                    .padding(.vertical, 20 * s)
                }
            }
        }
        .frame(height: rowHeight, alignment: .top)
    }

    private func profileCard(
        _ profile: AvailableProfile,
        index: Int,
        scale s: CGFloat,
        avatarSize size: CGFloat
    ) -> some View {
        let focused = focusedTarget == .profile(profile.id)
        let selected = selectedID == profile.id.uuidString
        let busy = switchingID == profile.id
        let active = focused || selected
        let colours = Self.avatarGradient(index: index)

        return VStack(spacing: 0) {
            Button {
                selectedID = profile.id.uuidString
                if profile.pinLocked && !profile.isCurrent {
                    pinProfile = profile
                    pin = ""
                    pinError = nil
                } else {
                    Task { await select(profile, pin: nil) }
                }
            } label: {
                VStack(spacing: 9 * s) {
                    ZStack {
                        Circle()
                            .fill(
                                LinearGradient(
                                    colors: colours,
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                        // Soft highlight: CSS radial at 34% 26%.
                        Circle()
                            .fill(
                                RadialGradient(
                                    colors: [.white.opacity(0.28), .clear],
                                    center: UnitPoint(x: 0.34, y: 0.26),
                                    startRadius: 0,
                                    endRadius: size * 0.42
                                )
                            )
                        Text(profileInitials(profile))
                            .font(.system(size: size * 0.28, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.95))
                        if busy {
                            ProgressView().tint(.white)
                        }
                        if profile.pinLocked && !profile.isCurrent {
                            Image(systemName: "lock.fill")
                                .font(.system(size: 12 * s, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(width: 30 * s, height: 30 * s)
                                .background(Color.black.opacity(0.55), in: Circle())
                                .offset(x: size * 0.32, y: size * 0.32)
                        }
                    }
                    .frame(width: size, height: size)
                    .overlay(
                        Circle().stroke(
                            palette.lineStrong.opacity(0.66),
                            lineWidth: 1
                        )
                    )
                    .overlay {
                        if active {
                            Circle()
                                .stroke(palette.brandPink.opacity(0.42), lineWidth: 4 * s)
                                .padding(-2 * s)
                        }
                    }
                    .shadow(
                        color: active
                            ? Color.black.opacity(0.18)
                            : Color.clear,
                        radius: active ? 22 * s : 0,
                        y: active ? 12 * s : 0
                    )

                    Text(profile.displayName.isEmpty ? profile.username : profile.displayName)
                        .font(.system(size: 16 * s, weight: .semibold))
                        .foregroundStyle(active ? palette.ink : palette.inkSoft)
                        .lineLimit(1)

                    Text(statusLabel(for: profile, busy: busy))
                        .font(.system(size: 9 * s, weight: .bold))
                        .tracking(0.6 * s)
                        .textCase(.uppercase)
                        .foregroundStyle(palette.inkMuted)
                        .frame(minHeight: 12 * s)
                }
                .frame(width: size)
            }
            .buttonStyle(TVProfileCardButtonStyle(palette: palette, isSelected: selected))
            .focusEffectDisabled(true)
            .focused($focusedTarget, equals: .profile(profile.id))
            .onChange(of: focusedTarget) { _, newValue in
                if case .profile(let id) = newValue, id == profile.id {
                    selectedID = profile.id.uuidString
                }
            }
            .onMoveCommand { direction in
                // Web ArrowUp from profiles track → stage chrome language/theme.
                if direction == .up {
                    moveFocusToChrome()
                }
            }
            .disabled(switchingID != nil)
            .accessibilityLabel(profile.displayName.isEmpty ? profile.username : profile.displayName)

            if selected {
                profileActions(for: profile, scale: s)
                    .padding(.top, 20 * s)
            }
        }
        .frame(width: size)
    }

    /// Web `.profile-actions` under the selected avatar only (never under add).
    private func profileActions(for profile: AvailableProfile, scale s: CGFloat) -> some View {
        HStack(spacing: 9 * s) {
            // Web `.profile-settings-button` — 44×44 glass circle, pink gear.
            Button {
                // Settings is owned by the signed-in shell; visual parity only here.
            } label: {
                TVProfileActionLabel(
                    palette: palette,
                    scale: s,
                    kind: .settings
                )
            }
            .buttonStyle(TVProfileActionButtonStyle())
            .focusEffectDisabled(true)
            .accessibilityLabel("Settings for \(profile.displayName)")

            // Web `.profile-sign-out-button` — glass pill, danger on focus.
            Button {
                environment.signOut()
                onLinkTV()
            } label: {
                TVProfileActionLabel(
                    palette: palette,
                    scale: s,
                    kind: .signOut
                )
            }
            .buttonStyle(TVProfileActionButtonStyle())
            .focusEffectDisabled(true)
            .accessibilityLabel("Sign out \(profile.displayName)")
        }
    }

    /// Web `#profile-add`: dashed circle, large light “+”, Sign in / ADD ANOTHER PROFILE.
    private func addProfileCard(scale s: CGFloat, avatarSize size: CGFloat) -> some View {
        let focused = focusedTarget == .add
        let selected = selectedID == "add" || (profiles.isEmpty && selectedID.isEmpty)
        let active = focused || selected

        return Button {
            selectedID = "add"
            onLinkTV()
        } label: {
            VStack(spacing: 9 * s) {
                ZStack {
                    // Dashed blank avatar — web `.profile-add .profile-avatar`.
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [
                                    palette.surfaceStrong.opacity(0.92),
                                    palette.surfaceStrong.mixed(with: palette.brandPink, amount: 0.16),
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                    Circle()
                        .strokeBorder(
                            palette.lineStrong.opacity(0.75),
                            style: StrokeStyle(
                                lineWidth: 2 * s,
                                dash: [7 * s, 6 * s]
                            )
                        )
                    Text("+")
                        .font(.system(size: size * 0.42, weight: .ultraLight))
                        .foregroundStyle(palette.inkSoft)
                }
                .frame(width: size, height: size)
                .overlay {
                    if active {
                        Circle()
                            .stroke(palette.brandPink.opacity(0.42), lineWidth: 4 * s)
                            .padding(-2 * s)
                    }
                }
                .shadow(
                    color: active ? Color.black.opacity(0.18) : Color.clear,
                    radius: active ? 22 * s : 0,
                    y: active ? 12 * s : 0
                )

                Text("Sign in")
                    .font(.system(size: 16 * s, weight: .semibold))
                    .foregroundStyle(active ? palette.ink : palette.inkSoft)
                    .lineLimit(1)

                Text("Add another profile")
                    .font(.system(size: 9 * s, weight: .bold))
                    .tracking(0.6 * s)
                    .textCase(.uppercase)
                    .foregroundStyle(palette.inkMuted)
                    .frame(minHeight: 12 * s)
            }
            .frame(width: size)
        }
        .buttonStyle(TVProfileCardButtonStyle(palette: palette, isSelected: selected))
        .focusEffectDisabled(true)
        .focused($focusedTarget, equals: .add)
        .onChange(of: focusedTarget) { _, newValue in
            if newValue == .add {
                selectedID = "add"
            }
        }
        .onMoveCommand { direction in
            if direction == .up {
                moveFocusToChrome()
            }
        }
        .accessibilityLabel("Sign in, add another profile")
    }

    private func statusLabel(for profile: AvailableProfile, busy: Bool) -> String {
        if busy { return "Switching…" }
        if profile.isCurrent { return "Watching now" }
        if profile.pinLocked { return "PIN required" }
        return "Ready"
    }

    private func profileInitials(_ profile: AvailableProfile) -> String {
        let name = profile.displayName.isEmpty ? profile.username : profile.displayName
        let parts = name.split(separator: " ").prefix(2)
        let letters = parts.compactMap { $0.first.map(String.init) }
        let joined = letters.joined().uppercased()
        return joined.isEmpty ? "P" : joined
    }

    /// Pink→rose gradient stops matching web default profile avatars.
    private static func avatarGradient(index: Int) -> [Color] {
        let choices: [[Color]] = [
            [
                Color(red: 0xe9 / 255, green: 0x75 / 255, blue: 0x91 / 255),
                Color(red: 0xa8 / 255, green: 0x26 / 255, blue: 0x55 / 255),
            ],
            [
                Color(red: 0x6e / 255, green: 0xb0 / 255, blue: 0xc0 / 255),
                Color(red: 0x2e / 255, green: 0x57 / 255, blue: 0x8a / 255),
            ],
            [
                Color(red: 0xc2 / 255, green: 0xa3 / 255, blue: 0x66 / 255),
                Color(red: 0x6e / 255, green: 0x45 / 255, blue: 0x2e / 255),
            ],
            [
                Color(red: 0x85 / 255, green: 0xb8 / 255, blue: 0x8c / 255),
                Color(red: 0x2e / 255, green: 0x6e / 255, blue: 0x4d / 255),
            ],
        ]
        return choices[index % choices.count]
    }

    private func reload() async {
        loadError = nil
        // Prefer cache first so faces (or empty + tile) appear without waiting
        // on a slow/hung profiles HTTP call.
        isLoading = true
        focusedTarget = focusedTarget ?? .add
        let list = await environment.loadProfiles()
        profiles = list
        isLoading = false
        if list.isEmpty {
            selectedID = "add"
            focusedTarget = .add
        } else if case .add = focusedTarget {
            if let current = list.first(where: \.isCurrent) {
                selectedID = current.id.uuidString
                focusedTarget = .profile(current.id)
            } else if let first = list.first {
                selectedID = first.id.uuidString
                focusedTarget = .profile(first.id)
            }
        } else if focusedTarget == nil {
            if let current = list.first(where: \.isCurrent) {
                selectedID = current.id.uuidString
                focusedTarget = .profile(current.id)
            } else if let first = list.first {
                selectedID = first.id.uuidString
                focusedTarget = .profile(first.id)
            }
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

// MARK: - Colour mix helper (web color-mix approximation)

private extension Color {
    /// Approximate CSS `color-mix(in srgb, self (1-amount), other amount)`.
    func mixed(with other: Color, amount: Double) -> Color {
        let t = max(0, min(1, amount))
        var r1: CGFloat = 0, g1: CGFloat = 0, b1: CGFloat = 0, a1: CGFloat = 0
        var r2: CGFloat = 0, g2: CGFloat = 0, b2: CGFloat = 0, a2: CGFloat = 0
        UIColor(self).getRed(&r1, green: &g1, blue: &b1, alpha: &a1)
        UIColor(other).getRed(&r2, green: &g2, blue: &b2, alpha: &a2)
        return Color(
            red: Double(r1 * (1 - t) + r2 * t),
            green: Double(g1 * (1 - t) + g2 * t),
            blue: Double(b1 * (1 - t) + b2 * t),
            opacity: Double(a1 * (1 - t) + a2 * t)
        )
    }
}

// MARK: - Device login chrome (live /login/qr @ 1920×1080)

/// Focus graph for auth chrome ↔ form (web ArrowUp/Down bridge on
/// ProfileAuthLayout). Full-screen chrome overlays trap tvOS focus unless we
/// own the hand-off explicitly.
enum TVAuthFocus: Hashable {
    case back
    case theme
    case language
    case formPrimary
    case formSecondary
}

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
    @FocusState private var authFocus: TVAuthFocus?

    private var palette: TVAuthPalette {
        TVAuthPalette.forTheme(displayPreferences.resolvedTheme)
    }

    private var showsBack: Bool {
        onBack != nil || (isManual && onBackToQr != nil)
    }

    var body: some View {
        GeometryReader { geo in
            let scaleX = geo.size.width / DesignTokens.Shell.canvasWidth
            let scaleY = geo.size.height / DesignTokens.Shell.canvasHeight
            // Prefer height-driven scale so 1920×1080 TV maps 1:1; clamp for
            // odd sim aspect ratios without breaking positions.
            let s = min(scaleX, scaleY)
            // Top chrome strip height (logo/back/menus) — keep focusable chrome
            // out of a full-screen ZStack so Down can reach the form.
            let chromeHeight = 120 * s

            ZStack {
                // Web `.login-profile-page`: 900px rose radial + 145° surface→bg.
                TVAuthStageBackground(palette: palette, style: .login)

                // Form column first in the focus graph (below chrome strip).
                VStack(spacing: 0) {
                    Color.clear
                        .frame(height: chromeHeight)
                        .accessibilityHidden(true)

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
                    .frame(maxWidth: .infinity, alignment: .center)

                    Spacer(minLength: 0)
                }

                // Absolute visual chrome; focus moves via shared authFocus +
                // onMoveCommand (not geometric search through a full overlay).
                TVAuthStageChrome(
                    palette: palette,
                    scale: s,
                    showBack: showsBack,
                    authFocus: $authFocus,
                    onMoveDownFromChrome: { authFocus = .formPrimary },
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
        .onAppear {
            // Land on the form (Sign in manually / Connect), not the top menus.
            if authFocus == nil {
                authFocus = .formPrimary
            }
        }
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
                    retryButton(scale: s, action: onRetry)
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
                    // Style owns fill/type — web `.btn.btn-primary.auth-submit`.
                    Text("Connect")
                }
                .buttonStyle(TVPrimaryPillButtonStyle(
                    palette: palette,
                    minHeight: 58 * s,
                    fontSize: 14.72 * s
                ))
                .focused($authFocus, equals: .formPrimary)
                .focusEffectDisabled(true)
                .onMoveCommand { direction in
                    if direction == .up {
                        authFocus = showsBack ? .back : .language
                    } else if direction == .down {
                        authFocus = .formSecondary
                    }
                }
                if let onBackToQr {
                    Button(action: onBackToQr) {
                        Text("Sign in with QR code")
                    }
                    .buttonStyle(TVSecondaryPillButtonStyle(
                        palette: palette,
                        minHeight: 58 * s,
                        fontSize: 14.72 * s
                    ))
                    .focused($authFocus, equals: .formSecondary)
                    .focusEffectDisabled(true)
                    .onMoveCommand { direction in
                        if direction == .up { authFocus = .formPrimary }
                    }
                }
            }
            .frame(maxWidth: 520 * s)
        }
    }

    @ViewBuilder
    private func manualButton(scale s: CGFloat) -> some View {
        if let onManual {
            Button(action: onManual) {
                // Web `.btn.btn-secondary.device-login-manual` full-width pill.
                Text("Sign in manually")
            }
            .buttonStyle(TVSecondaryPillButtonStyle(
                palette: palette,
                minHeight: 58 * s,
                fontSize: 14.72 * s
            ))
            .focused($authFocus, equals: .formPrimary)
            .focusEffectDisabled(true)
            .onMoveCommand { direction in
                // Up from the form lands on the top chrome (web focus bridge).
                if direction == .up {
                    authFocus = showsBack ? .back : .language
                }
            }
            // Web `.device-login-manual { margin-top: 1.25rem; width: 100% }` on 560 panel.
            .padding(.top, 20 * s)
            .frame(maxWidth: 560 * s)
        }
    }

    @ViewBuilder
    private func retryButton(scale s: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            // Web error path uses `.btn.btn-primary`, not secondary/pink text.
            Text("Try again")
        }
        .buttonStyle(TVPrimaryPillButtonStyle(
            palette: palette,
            minHeight: 58 * s,
            fontSize: 14.72 * s
        ))
        .focused($authFocus, equals: .formPrimary)
        .focusEffectDisabled(true)
        .onMoveCommand { direction in
            if direction == .up {
                authFocus = showsBack ? .back : .language
            }
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
///
/// Focus: only a top strip is focusable; Down is handed to the form via
/// `onMoveDownFromChrome` (full-screen chrome frames trap the focus engine).
struct TVAuthStageChrome: View {
    let palette: TVAuthPalette
    var scale: CGFloat = 1
    var showBack: Bool = false
    var authFocus: FocusState<TVAuthFocus?>.Binding?
    var onMoveDownFromChrome: (() -> Void)?
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
    private var chromeStripHeight: CGFloat { 120 * scale }

    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .topLeading) {
                PlayarrLogoMark(size: logoSize)
                    .frame(width: logoSize, height: logoSize)
                    .position(
                        x: logoLeft + logoSize / 2,
                        y: logoTop + logoSize / 2 + 4 * scale
                    )
                    .accessibilityHidden(true)
                    .allowsHitTesting(false)

                if showBack, let onBack {
                    Button(action: onBack) {
                        Image(systemName: "arrow.left")
                            .font(.system(size: 17 * scale, weight: .semibold))
                            .frame(width: 50 * scale, height: 50 * scale)
                    }
                    // Web `.tv-page-back:hover/focus` → ink fill, scale 1.1.
                    .buttonStyle(TVBackButtonStyle(palette: palette))
                    .focusEffectDisabled(true)
                    .modifier(TVAuthChromeFocusModifier(
                        binding: authFocus,
                        value: .back,
                        onDown: onMoveDownFromChrome
                    ))
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
            .frame(height: chromeStripHeight)
            .frame(maxWidth: .infinity)

            // Non-interactive remainder so chrome is not a full-screen focus island.
            Spacer(minLength: 0)
                .allowsHitTesting(false)
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
        // Web `.language-dropdown-trigger:hover/focus` → accent border, scale 1.02.
        .buttonStyle(TVChromeMenuButtonStyle(palette: palette))
        .focusEffectDisabled(true)
        .modifier(TVAuthChromeFocusModifier(
            binding: authFocus,
            value: .theme,
            onDown: onMoveDownFromChrome,
            onLeft: showBack ? { authFocus?.wrappedValue = .back } : nil,
            onRight: { authFocus?.wrappedValue = .language }
        ))
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
        .buttonStyle(TVChromeMenuButtonStyle(palette: palette))
        .focusEffectDisabled(true)
        .modifier(TVAuthChromeFocusModifier(
            binding: authFocus,
            value: .language,
            onDown: onMoveDownFromChrome,
            onLeft: { authFocus?.wrappedValue = .theme }
        ))
    }

    private func chromeTrigger(
        icon: String,
        label: String,
        minWidth: CGFloat,
        accessibility: String
    ) -> some View {
        // Content only — focus fill/border/scale come from TVChromeMenuButtonStyle.
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
        .contentShape(Rectangle())
        .accessibilityLabel(accessibility)
    }
}

/// Optional FocusState wiring + directional hand-off for stage-chrome controls.
private struct TVAuthChromeFocusModifier: ViewModifier {
    var binding: FocusState<TVAuthFocus?>.Binding?
    let value: TVAuthFocus
    var onDown: (() -> Void)?
    var onLeft: (() -> Void)?
    var onRight: (() -> Void)?

    @ViewBuilder
    func body(content: Content) -> some View {
        if let binding {
            content
                .focused(binding, equals: value)
                .onMoveCommand { direction in
                    switch direction {
                    case .down: onDown?()
                    case .left: onLeft?()
                    case .right: onRight?()
                    default: break
                    }
                }
        } else {
            content
                .onMoveCommand { direction in
                    if direction == .down { onDown?() }
                }
        }
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
