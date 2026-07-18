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
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--playarr-demo-profiles") {
            _selected = State(initialValue: .profiles)
        }
        #endif
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
        GeometryReader { proxy in
            if selected == .profiles {
                EmptyView()
            } else if proxy.size.width <= 760 {
                phoneChrome(proxy: proxy)
            } else {
                stageChrome(proxy: proxy)
            }
        }
        .allowsHitTesting(true)
    }

    private func phoneChrome(proxy: GeometryProxy) -> some View {
        ZStack(alignment: .topTrailing) {
            profileButton(size: 42, avatarSize: 32)
                .padding(4)
                .offset(x: -16, y: 4)

            VStack {
                Spacer()
                ScrollView(.horizontal) {
                    HStack(spacing: 2) {
                        ForEach(destinations, id: \.self) { destination in
                            Button { selected = destination } label: {
                                Image(systemName: destination.icon)
                                    .font(.system(size: 21, weight: .medium))
                                    .foregroundStyle(
                                        selected == destination ? PlayarrStyle.background : PlayarrStyle.muted
                                    )
                                    .frame(width: 44, height: 46)
                                    .background(
                                        selected == destination ? PlayarrStyle.ink : .clear,
                                        in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    )
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(destination.title)
                        }
                    }
                    .padding(5)
                }
                .scrollIndicators(.hidden)
                .frame(height: 58)
                .background(
                    PlayarrStyle.surfaceStrong.opacity(0.88),
                    in: RoundedRectangle(cornerRadius: 20, style: .continuous)
                )
                .shadow(color: Color(red: 31 / 255, green: 14 / 255, blue: 20 / 255).opacity(0.2), radius: 20, y: 14)
                .padding(.horizontal, 10)
                .padding(.bottom, max(8, proxy.safeAreaInsets.bottom))
            }
        }
    }

    private func stageChrome(proxy: GeometryProxy) -> some View {
        let navEdge = min(44, max(18, proxy.size.width * 0.022))
        let chromeTop = min(66, max(34, proxy.size.height * 0.052))

        return ZStack(alignment: .topLeading) {
            TimelineView(.periodic(from: .now, by: 60)) { context in
                HStack(alignment: .firstTextBaseline, spacing: 11) {
                    Text(context.date.formatted(date: .omitted, time: .shortened))
                        .font(.custom("Avenir Next", fixedSize: 14).weight(.heavy))
                    Text(context.date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)))
                        .font(.custom("Avenir Next", fixedSize: 9).weight(.semibold))
                        .foregroundStyle(PlayarrStyle.muted)
                }
                .foregroundStyle(PlayarrStyle.ink)
                .offset(x: 150, y: chromeTop + 10)
            }

            PlayarrLogo(size: 30)
                .offset(x: navEdge + 24.4, y: chromeTop)

            VStack(spacing: 14) {
                navGroup(Array(destinations.prefix(2)))
                if destinations.count > 2 {
                    navGroup(Array(destinations.dropFirst(2)))
                }
            }
            .offset(x: navEdge, y: max(100, (proxy.size.height - stageNavigationHeight) / 2))

            profileButton(size: 46, avatarSize: 34)
                .offset(x: navEdge + 16, y: proxy.size.height - max(46, proxy.safeAreaInsets.bottom + 46))
        }
    }

    private func navGroup(_ group: [Destination]) -> some View {
        VStack(spacing: 10) {
            ForEach(group, id: \.self) { destination in
                Button { selected = destination } label: {
                    VStack(spacing: 5) {
                        Image(systemName: destination.icon)
                            .font(.system(size: 20, weight: .medium))
                        Text(destination.title)
                            .font(.custom("Avenir Next", fixedSize: 8).weight(.semibold))
                            .lineLimit(1)
                    }
                    .foregroundStyle(selected == destination ? PlayarrStyle.ink : PlayarrStyle.muted)
                    .frame(width: 64, height: 64)
                    .background(
                        selected == destination ? PlayarrStyle.ink.opacity(0.09) : .clear,
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                    )
                    .scaleEffect(selected == destination ? 1.05 : 1)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(destination.title)
            }
        }
        .padding(.vertical, 7)
        .padding(.horizontal, 6)
        .background(
            PlayarrStyle.surfaceStrong.opacity(0.56),
            in: RoundedRectangle(cornerRadius: 22, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(PlayarrStyle.line.opacity(0.48), lineWidth: 1)
        }
        .shadow(color: PlayarrStyle.ink.opacity(0.1), radius: 21, y: 14)
    }

    private func profileButton(size: CGFloat, avatarSize: CGFloat) -> some View {
        Button { selected = .profiles } label: {
            ZStack {
                Circle().fill(
                    LinearGradient(
                        colors: [Color(red: 0.847, green: 0.31, blue: 0.439), Color(red: 0.659, green: 0.149, blue: 0.333)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                Text(String((environment.currentUserName ?? "P").prefix(1)).uppercased())
                    .font(.custom("Avenir Next", fixedSize: avatarSize * 0.42).weight(.bold))
                    .foregroundStyle(.white)
            }
            .frame(width: avatarSize, height: avatarSize)
            .frame(width: size, height: size)
            .background(PlayarrStyle.surfaceStrong.opacity(0.66), in: Circle())
            .overlay { Circle().stroke(PlayarrStyle.line.opacity(0.7), lineWidth: 1) }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open profile and settings")
    }

    private var stageNavigationHeight: CGFloat {
        let first = min(2, destinations.count)
        let second = max(0, destinations.count - 2)
        let firstHeight = CGFloat(first) * 64 + CGFloat(max(0, first - 1)) * 10 + 14
        let secondHeight = second > 0 ? CGFloat(second) * 64 + CGFloat(max(0, second - 1)) * 10 + 14 : 0
        return firstHeight + secondHeight + (second > 0 ? 14 : 0)
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
