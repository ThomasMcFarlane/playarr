import PlayarrKit
import SwiftUI

struct TVRootView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var selectedTab: TVNavTab = .home

    /// When `-PlayarrParityScreen` is set without a web-ref paint URL, force
    /// that tab so simctl captures hit the production SwiftUI path.
    ///
    /// Suite `webPath` maps:
    ///   detail-episode → /series (library)
    ///   detail-track → /music (library)
    ///   detail-book → /library → /series (library)
    ///   detail-movie → SPA capture shows work-detail chrome (chapters/cast)
    private var parityForcedTab: TVNavTab? {
        guard TVParityLaunch.webRefBaseURL == nil,
              let screen = TVParityLaunch.requestedScreen else { return nil }
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
        guard TVParityLaunch.webRefBaseURL == nil,
              let screen = TVParityLaunch.requestedScreen else { return nil }
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
        return ZStack(alignment: .topLeading) {
            // Main content fills the stage
            NavigationStack {
                Group {
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
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .toolbar(.hidden, for: .navigationBar)
            }

            // Floating left nav (web `.app-nav`) — vertically centred at nav edge.
            TVFloatingNav(
                selection: Binding(
                    get: { forcedSelection ?? selectedTab },
                    set: { if forcedSelection == nil { selectedTab = $0 } }
                ),
                suppressFocusChrome: TVParityLaunch.requestedScreen != nil,
                // SPA never shows the settings gear in the floating nav on
                // library/home/search/settings frames (settings is reached
                // via other chrome). Keep gear only for live non-parity.
                showSettings: TVParityLaunch.requestedScreen == nil
            )
            .padding(.leading, DesignTokens.Shell.navEdge)
            .frame(maxHeight: .infinity, alignment: .center)
            .zIndex(50)

            // Logo / clock
            TVShellHeader(frozenClock: TVParityLaunch.requestedScreen != nil)
                .frame(maxWidth: .infinity, alignment: .top)
                .zIndex(80)

            // Profile chip (live SPA shows signed-in user under the nav).
            VStack {
                Spacer()
                HStack {
                    TVProfileChip(
                        name: TVParityLaunch.requestedScreen != nil ? "Test User A" : "Viewer",
                        version: TVParityLaunch.requestedScreen != nil ? "v0.1.0" : nil
                    )
                    .padding(.leading, DesignTokens.Shell.navEdge - 4)
                    .padding(.bottom, 36)
                    Spacer()
                }
            }
            .zIndex(50)
        }
        // Shell chrome is authored for the full 1920×1080 stage, matching web
        // CSS viewport units. Safe-area inset would shift logo/nav/header.
        .ignoresSafeArea()
    }
}

/// Full-screen pairing gate aligned with ui-tv / device-code display.
struct TVPairingGateView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var pairingTask: Task<Void, Never>?
    @State private var serverError: String?

    var body: some View {
        ZStack {
            TVStageBackground()
            VStack(spacing: DesignTokens.Spacing.lg) {
                Text("Playarr Server")
                    .font(TVTheme.heroTitleFont())
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                pairingBody
                serverAddressEditor
            }
            .padding(DesignTokens.Spacing.xxxl)
            .frame(maxWidth: 1200)
        }
        .onAppear {
            if case .signedOut = environment.pairingState {
                beginPairing()
            }
        }
        .onDisappear {
            pairingTask?.cancel()
            pairingTask = nil
        }
    }

    @ViewBuilder
    private var pairingBody: some View {
        switch environment.pairingState {
        case .signedOut, .requestingCode:
            Text("Requesting a pairing code...")
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
            ProgressView().tint(DesignTokens.Color.brandPrimary)
        case .awaitingApproval(let pending):
            VStack(spacing: DesignTokens.Spacing.md) {
                Text("Scan the QR code, or visit")
                    .font(TVTheme.subtitleFont())
                    .foregroundStyle(DesignTokens.Color.textSecondary)
                Text(pending.verificationUri)
                    .font(TVTheme.titleFont())
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .multilineTextAlignment(.center)
                Text("and enter the code")
                    .font(TVTheme.subtitleFont())
                    .foregroundStyle(DesignTokens.Color.textSecondary)
                Text(pending.userCode)
                    .font(.system(size: 64, weight: .bold, design: .monospaced))
                    .tracking(8)
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .padding(.horizontal, DesignTokens.Spacing.xl)
                    .padding(.vertical, DesignTokens.Spacing.md)
                    .background(
                        RoundedRectangle(cornerRadius: DesignTokens.Radius.lg, style: .continuous)
                            .fill(DesignTokens.Color.backgroundRaised)
                    )
                ProgressView("Waiting for approval…")
                    .tint(DesignTokens.Color.brandPrimary)
                    .foregroundStyle(DesignTokens.Color.textSecondary)
                Button("Cancel pairing", role: .cancel) {
                    pairingTask?.cancel()
                    pairingTask = nil
                    environment.signOut()
                }
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
            }
        case .signedIn:
            EmptyView()
        case .failed(let message):
            Text(message)
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.stateError)
                .multilineTextAlignment(.center)
            TVPrimaryButton(label: "Try again") { beginPairing() }
        }
    }

    private var serverAddressEditor: some View {
        VStack(spacing: DesignTokens.Spacing.sm) {
            Text("Server address")
                .font(TVTheme.captionFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
            TextField(
                "https://playarr.example",
                text: Bindable(environment).serverAddress
            )
            .font(TVTheme.bodyFont())
            .foregroundStyle(DesignTokens.Color.textPrimary)
            .padding(DesignTokens.Spacing.md)
            .frame(maxWidth: 720)
            .background(
                RoundedRectangle(cornerRadius: DesignTokens.Radius.md, style: .continuous)
                    .fill(DesignTokens.Color.backgroundRaised)
            )
            .textContentType(.URL)
            .autocorrectionDisabled()
            Button("Save server") {
                serverError = environment.saveServerAddress()
                    ? nil
                    : "Enter a valid HTTP or HTTPS server address."
                if serverError == nil { beginPairing() }
            }
            .font(TVTheme.bodyFont(emphasis: true))
            .foregroundStyle(DesignTokens.Color.brandPrimary)
            if let serverError {
                Text(serverError)
                    .font(TVTheme.captionFont())
                    .foregroundStyle(DesignTokens.Color.stateError)
            }
        }
        .padding(.top, DesignTokens.Spacing.xl)
    }

    private func beginPairing() {
        pairingTask?.cancel()
        pairingTask = Task { await environment.startPairing() }
    }
}
