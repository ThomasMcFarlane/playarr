import StreamarrKit
import SwiftUI

struct RootView: View {
    let environment: AppEnvironment
    @State private var updateViewModel: UpdateViewModel
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("com.streamarr.ios.appearance") private var appearance = "system"

    init(environment: AppEnvironment) {
        self.environment = environment
        _updateViewModel = State(initialValue: UpdateViewModel(apiClient: environment.apiClient))
    }

    var body: some View {
        Group {
            switch environment.sessionState {
            case .restoring:
                PlayarrLoadingView(title: "Opening Playarr…")
            case .signedOut:
                LoginView(environment: environment)
            case .signedIn:
                AuthenticatedPlayarrShell(environment: environment)
                    .id("\(environment.serverBaseURL.absoluteString)-\(environment.currentUserName ?? "viewer")")
            }
        }
        .preferredColorScheme(preferredColourScheme)
        .updateGate(updateViewModel)
        .task {
            await environment.restoreSessionState()
            await updateViewModel.checkForUpdate()
        }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active else { return }
            Task { await updateViewModel.checkForUpdate() }
        }
        .onChange(of: environment.serverBaseURL) { _, _ in
            updateViewModel = UpdateViewModel(apiClient: environment.apiClient)
        }
    }

    private var preferredColourScheme: ColorScheme? {
        switch appearance {
        case "light": .light
        case "dark": .dark
        default: nil
        }
    }
}

private struct AuthenticatedPlayarrShell: View {
    enum Destination: Hashable {
        case search
        case home
        case library(WorkKind)
        case playlists
        case profiles
        case settings

        var title: String {
            switch self {
            case .search: "Search"
            case .home: "Home"
            case .library(let kind): kind.displayName
            case .playlists: "Playlists"
            case .profiles: "Profiles"
            case .settings: "Profile"
            }
        }

        var icon: String {
            switch self {
            case .search: "magnifyingglass"
            case .home: "house"
            case .library(let kind): kind.symbolName
            case .playlists: "music.note.list"
            case .profiles: "person.2"
            case .settings: "person.crop.circle"
            }
        }
    }

    let environment: AppEnvironment
    @State private var selected: Destination = .home
    @State private var availableKinds: Set<WorkKind> = []
    @State private var homeViewModel: HomeViewModel

    init(environment: AppEnvironment) {
        self.environment = environment
        _homeViewModel = State(initialValue: HomeViewModel(apiClient: environment.apiClient))
    }

    var body: some View {
        ZStack {
            selectedContent
            chrome
        }
        .background(PlayarrStyle.background.ignoresSafeArea())
        .task {
            availableKinds = Set((try? await environment.apiClient.listCatalogKinds()) ?? [])
        }
    }

    @ViewBuilder
    private var selectedContent: some View {
        switch selected {
        case .home:
            NavigationStack {
                HomeView(viewModel: homeViewModel, apiClient: environment.apiClient)
            }
        case .search:
            NavigationStack {
                LibraryView(kind: nil, apiClient: environment.apiClient, title: "Search")
            }
        case .library(let kind):
            NavigationStack {
                LibraryView(kind: kind, apiClient: environment.apiClient)
            }
        case .playlists:
            NavigationStack {
                PlaylistsView(apiClient: environment.apiClient)
            }
        case .profiles:
            NavigationStack {
                ProfilesView(
                    environment: environment,
                    onOpenSettings: { selected = .settings },
                    onHome: { selected = .home }
                )
            }
        case .settings:
            NavigationStack {
                SettingsView(environment: environment)
            }
        }
    }

    private var chrome: some View {
        VStack {
            HStack {
                Button { selected = .home } label: { PlayarrLogo(size: 38) }
                    .buttonStyle(.plain)
                Spacer()
                Button { selected = .profiles } label: {
                    ZStack {
                        Circle().fill(PlayarrStyle.pink.gradient)
                        Text(String((environment.currentUserName ?? "P").prefix(1)).uppercased())
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(.white)
                    }
                    .frame(width: 38, height: 38)
                    .overlay {
                        Circle().stroke(.white.opacity(0.8), lineWidth: 2)
                    }
                    .shadow(color: PlayarrStyle.ink.opacity(0.14), radius: 12, y: 6)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open profile and settings")
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)

            Spacer()

            ScrollView(.horizontal) {
                HStack(spacing: 3) {
                    ForEach(destinations, id: \.self) { destination in
                        Button { selected = destination } label: {
                            HStack(spacing: selected == destination ? 7 : 0) {
                                Image(systemName: destination.icon)
                                    .font(.system(size: 17, weight: .semibold))
                                if selected == destination {
                                    Text(destination.title)
                                        .font(.caption2.weight(.bold))
                                        .lineLimit(1)
                                        .transition(.opacity.combined(with: .scale))
                                }
                            }
                            .foregroundStyle(selected == destination ? PlayarrStyle.background : PlayarrStyle.muted)
                            .frame(minWidth: 44, minHeight: 46)
                            .padding(.horizontal, selected == destination ? 10 : 0)
                            .background(selected == destination ? PlayarrStyle.ink : .clear, in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(destination.title)
                    }
                }
                .animation(.snappy(duration: 0.28), value: selected)
                .padding(5)
            }
            .scrollIndicators(.hidden)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: 620)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(.white.opacity(0.72), lineWidth: 1)
            }
            .shadow(color: PlayarrStyle.ink.opacity(0.18), radius: 22, y: 10)
            .padding(.horizontal, 10)
            .padding(.bottom, 8)
        }
        .allowsHitTesting(true)
    }

    private var destinations: [Destination] {
        var result: [Destination] = [.search, .home]
        for kind in [WorkKind.series, .movie, .site, .artist, .author] where availableKinds.contains(kind) {
            result.append(.library(kind))
        }
        result.append(.playlists)
        return result
    }
}
