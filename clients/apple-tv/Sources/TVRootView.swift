import PlayarrKit
import SwiftUI

struct TVRootView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var selectedTab: TVNavTab = .home

    /// When `-PlayarrParityScreen` is set without a web-ref paint URL, force
    /// that tab so simctl captures hit the production SwiftUI path.
    private var parityForcedTab: TVNavTab? {
        guard TVParityLaunch.webRefBaseURL == nil,
              let screen = TVParityLaunch.requestedScreen else { return nil }
        switch screen {
        case .search: return .search
        case .homeRecentlyAdded: return .home
        case .settings: return .settings
        case .deviceCodePairing: return nil // full-screen gate
        case .detailMovie, .detailEpisode, .detailTrack, .detailBook, .player:
            return nil // handled as full-screen detail/player fixtures
        }
    }

    private var parityDetailWork: Work? {
        guard TVParityLaunch.webRefBaseURL == nil,
              let screen = TVParityLaunch.requestedScreen else { return nil }
        let works = TVParityFixtures.sampleWorks()
        switch screen {
        case .detailMovie: return works.first(where: { $0.kind == .movie }) ?? works.first
        case .detailEpisode: return works.first(where: { $0.kind == .series }) ?? works.first
        case .detailTrack: return works.first
        case .detailBook: return works.first
        case .player: return works.first(where: { $0.kind == .movie }) ?? works.first
        default: return nil
        }
    }

    var body: some View {
        ZStack {
            TVStageBackground()

            if TVParityLaunch.requestedScreen == .deviceCodePairing {
                TVPairingGateView()
            } else if let work = parityDetailWork {
                NavigationStack {
                    TVWorkDetailView(work: work, apiClient: environment.apiClient)
                }
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
        signedInShell(forcedSelection: nil)
    }

    private func signedInShell(forcedSelection: TVNavTab?) -> some View {
        let tab = forcedSelection ?? selectedTab
        return ZStack(alignment: .topLeading) {
            // Main content fills the stage
            NavigationStack {
                Group {
                    switch tab {
                    case .home:
                        TVHomeView()
                    case .search:
                        TVSearchView()
                    case .settings:
                        TVSettingsView()
                    case .series:
                        TVLibraryKindView(kindLabel: "Series", emptyMessage: "No series in your library yet.")
                    case .movies:
                        TVLibraryKindView(kindLabel: "Movies", emptyMessage: "No movies in your library yet.")
                    case .music:
                        TVLibraryKindView(kindLabel: "Music", emptyMessage: "No music in your library yet.")
                    case .playlists:
                        TVLibraryKindView(kindLabel: "Playlists", emptyMessage: "No playlists yet.")
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            // Floating left nav (web `.app-nav`) — above content.
            TVFloatingNav(selection: Binding(
                get: { forcedSelection ?? selectedTab },
                set: { if forcedSelection == nil { selectedTab = $0 } }
            ))
            .padding(.leading, DesignTokens.Shell.navEdge)
            .padding(.top, 120)
            .padding(.bottom, 100)
            .frame(maxHeight: .infinity, alignment: .top)
            .zIndex(50)

            // Logo / clock
            TVShellHeader(frozenClock: TVParityLaunch.requestedScreen != nil)
                .frame(maxWidth: .infinity, alignment: .top)

            // Profile chip
            VStack {
                Spacer()
                HStack {
                    TVProfileChip(name: "Viewer")
                        .padding(.leading, DesignTokens.Shell.navEdge)
                        .padding(.bottom, 36)
                    Spacer()
                }
            }
        }
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
