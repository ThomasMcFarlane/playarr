import PlayarrKit
import SwiftUI

private struct PlayarrChromeHiddenKey: PreferenceKey {
    static let defaultValue = false
    static func reduce(value: inout Bool, nextValue: () -> Bool) { value = value || nextValue() }
}

extension View {
    func playarrChromeHidden(_ hidden: Bool = true) -> some View {
        preference(key: PlayarrChromeHiddenKey.self, value: hidden)
    }
}

struct RootView: View {
    let environment: AppEnvironment
    @State private var updateViewModel: UpdateViewModel
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("com.playarr.ios.appearance") private var appearance = "dark"

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
            #if DEBUG
            if ParityLaunch.isActive, let server = ParityLaunch.server, let user = ParityLaunch.user {
                try? await environment.signIn(
                    serverURL: server,
                    username: user,
                    password: ParityLaunch.password ?? ""
                )
                return
            }
            #endif
            await environment.restoreSessionState()
            await updateViewModel.checkForUpdate()
        }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active else { return }
            Task { await updateViewModel.checkForUpdate() }
            environment.downloadRepository.sweepExpiredDownloads()
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
        case downloads
        case search
        case home
        case library(WorkKind)
        case playlists
        case calendar
        case profiles
        case settings
        #if DEBUG
        case detail
        #endif

        var title: String {
            switch self {
            case .downloads: "Downloads"
            case .search: "Search"
            case .home: "Home"
            case .library(let kind): kind.displayName
            case .playlists: "Playlists"
            case .calendar: "Calendar"
            case .profiles: "Profiles"
            case .settings: "Profile"
            #if DEBUG
            case .detail: "Title"
            #endif
            }
        }

        var icon: String {
            switch self {
            case .downloads: "arrow.down.circle"
            case .search: "magnifyingglass"
            case .home: "house"
            case .library(let kind): kind.symbolName
            case .playlists: "music.note.list"
            case .calendar: "calendar"
            case .profiles: "person.2"
            case .settings: "person.crop.circle"
            #if DEBUG
            case .detail: "play.rectangle"
            #endif
            }
        }
    }

    let environment: AppEnvironment
    @State private var selected: Destination = .home
    @State private var availableKinds: Set<WorkKind> = []
    @State private var homeViewModel: HomeViewModel
    @State private var chromeHidden = false
    @State private var routeTransitionTitle: String?
    /// App-wide, so "Casting to <device>" stays visible while browsing
    /// anywhere in the app, not only inside `PlayerView` -- the same
    /// singleton `PlayerView` also reads for its own now-casting card.
    private let castCoordinator = CastSessionCoordinator.shared
    #if DEBUG
    @State private var demoDetailViewModel: WorkDetailViewModel
    #endif

    init(environment: AppEnvironment) {
        self.environment = environment
        _homeViewModel = State(initialValue: HomeViewModel(apiClient: environment.apiClient))
        #if DEBUG
        _demoDetailViewModel = State(initialValue: WorkDetailViewModel(
            apiClient: environment.apiClient,
            workID: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
        ))
        if let screen = ParityLaunch.screen {
            switch screen {
            case "movies": _selected = State(initialValue: .library(.movie))
            case "series": _selected = State(initialValue: .library(.series))
            case "search": _selected = State(initialValue: .search)
            case "settings": _selected = State(initialValue: .settings)
            case "profiles": _selected = State(initialValue: .profiles)
            case "detail-film", "detail-series": _selected = State(initialValue: .detail)
            default: break
            }
        } else if ProcessInfo.processInfo.arguments.contains("--playarr-demo-profiles") {
            _selected = State(initialValue: .profiles)
        } else if ProcessInfo.processInfo.arguments.contains("--playarr-demo-library") {
            _selected = State(initialValue: .library(.movie))
        } else if ProcessInfo.processInfo.arguments.contains("--playarr-demo-playlists") {
            _selected = State(initialValue: .playlists)
        } else if ProcessInfo.processInfo.arguments.contains("--playarr-demo-settings") {
            _selected = State(initialValue: .settings)
        } else if ProcessInfo.processInfo.arguments.contains("--playarr-demo-detail") {
            _selected = State(initialValue: .detail)
        }
        #endif
    }

    var body: some View {
        ZStack {
            selectedContent
            if !chromeHidden { chrome }
            if castCoordinator.isCasting { castMiniBar }
            if let routeTransitionTitle {
                PlayarrLoadingView(title: "Opening \(routeTransitionTitle.lowercased())…")
                    .transition(.opacity)
                    .zIndex(20)
            }
        }
        .background(PlayarrStyle.background.ignoresSafeArea())
        .task {
            #if DEBUG
            if let title = ParityLaunch.title {
                let kind: WorkKind = ParityLaunch.screen == "detail-series" ? .series : .movie
                let page = try? await environment.apiClient.browseCatalog(
                    kind: kind, genre: nil, tag: nil, sort: nil, limit: 100, offset: nil
                )
                if let match = page?.items.first(where: { $0.title == title }) {
                    demoDetailViewModel = WorkDetailViewModel(apiClient: environment.apiClient, workID: match.id)
                }
            }
            #endif
            availableKinds = Set((try? await environment.apiClient.listCatalogKinds()) ?? [])
        }
        .onPreferenceChange(PlayarrChromeHiddenKey.self) { chromeHidden = $0 }
    }

    @ViewBuilder
    private var selectedContent: some View {
        switch selected {
        case .downloads:
            NavigationStack {
                DownloadsView(repository: environment.downloadRepository, apiClient: environment.apiClient)
            }
        case .home:
            NavigationStack {
                HomeView(viewModel: homeViewModel, apiClient: environment.apiClient, downloadRepository: environment.downloadRepository)
            }
        case .search:
            NavigationStack {
                LibraryView(kind: nil, apiClient: environment.apiClient, downloadRepository: environment.downloadRepository, title: "Search", initialQuery: parityQuery)
            }
        case .library(let kind):
            NavigationStack {
                LibraryView(kind: kind, apiClient: environment.apiClient, downloadRepository: environment.downloadRepository)
            }
        case .playlists:
            NavigationStack {
                PlaylistsView(apiClient: environment.apiClient, downloadRepository: environment.downloadRepository)
            }
        case .calendar:
            NavigationStack {
                CalendarView(apiClient: environment.apiClient, downloadRepository: environment.downloadRepository)
            }
        case .profiles:
            NavigationStack {
                ProfilesView(
                    environment: environment,
                    onOpenSettings: { select(.settings) },
                    onHome: { select(.home) }
                )
            }
        case .settings:
            NavigationStack {
                SettingsView(environment: environment)
            }
        #if DEBUG
        case .detail:
            NavigationStack {
                WorkDetailView(
                    viewModel: demoDetailViewModel,
                    apiClient: environment.apiClient,
                    downloadRepository: environment.downloadRepository
                )
                .id(demoDetailViewModel.workID)
            }
        #endif
        }
    }

    private var parityQuery: String? {
        #if DEBUG
        ParityLaunch.query
        #else
        nil
        #endif
    }

    private var chrome: some View {
        GeometryReader { proxy in
            if selected == .profiles {
                EmptyView()
            } else if PlayarrLayout.isPhone(proxy.size) {
                phoneChrome(proxy: proxy)
            } else {
                stageChrome(proxy: proxy)
            }
        }
        .allowsHitTesting(true)
    }

    /// Persistent "Casting to <device>" pill, visible from anywhere in the
    /// app while a Cast session is active -- there is no shared SwiftUI
    /// toolbar in this app's chrome to hang a mini-controller off, so this
    /// sits as its own top overlay instead, alongside (not replacing)
    /// `chrome`'s own tab navigation. Offers only "Stop" here -- full
    /// transport controls live in `PlayerView`'s own now-casting card, the
    /// same way most Cast-enabled apps split a lightweight persistent
    /// affordance from the full player screen's controls.
    private var castMiniBar: some View {
        VStack {
            if case .connected(let deviceName) = castCoordinator.connectionState {
                HStack(spacing: 10) {
                    Image(systemName: "tv.badge.wifi")
                        .foregroundStyle(PlayarrStyle.pink)
                    Text("Casting to \(deviceName)")
                        .font(.custom("Avenir Next", fixedSize: 11).weight(.semibold))
                        .lineLimit(1)
                    Spacer()
                    Button("Stop") { castCoordinator.endSession(reason: .userStopped) }
                        .font(.custom("Avenir Next", fixedSize: 11).weight(.bold))
                }
                .foregroundStyle(PlayarrStyle.ink)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(PlayarrStyle.surfaceStrong.opacity(0.92), in: Capsule())
                .overlay { Capsule().stroke(PlayarrStyle.line.opacity(0.6), lineWidth: 1) }
                .shadow(color: PlayarrStyle.ink.opacity(0.12), radius: 14, y: 6)
                .padding(.horizontal, 14)
                .padding(.top, 8)
            }
            Spacer()
        }
        .zIndex(15)
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
                            Button { select(destination) } label: {
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
                Button { select(destination) } label: {
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
        Button { select(.profiles) } label: {
            ZStack {
                currentAvatar(size: avatarSize)
            }
            .frame(width: avatarSize, height: avatarSize)
            .frame(width: size, height: size)
            .background(PlayarrStyle.surfaceStrong.opacity(0.66), in: Circle())
            .overlay { Circle().stroke(PlayarrStyle.line.opacity(0.7), lineWidth: 1) }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open profile and settings")
    }

    @ViewBuilder
    private func currentAvatar(size: CGFloat) -> some View {
        PlayarrProfileAvatar(
            preference: environment.currentAvatar,
            userID: environment.currentUserID,
            userName: environment.currentUserName,
            size: size
        )
    }

    private func select(_ destination: Destination) {
        guard destination != selected else { return }
        routeTransitionTitle = destination.title
        selected = destination
        Task {
            await Task.yield()
            try? await Task.sleep(for: .milliseconds(180))
            withAnimation(.easeOut(duration: 0.14)) { routeTransitionTitle = nil }
        }
    }

    private var stageNavigationHeight: CGFloat {
        let first = min(2, destinations.count)
        let second = max(0, destinations.count - 2)
        let firstHeight = CGFloat(first) * 64 + CGFloat(max(0, first - 1)) * 10 + 14
        let secondHeight = second > 0 ? CGFloat(second) * 64 + CGFloat(max(0, second - 1)) * 10 + 14 : 0
        return firstHeight + secondHeight + (second > 0 ? 14 : 0)
    }

    private var destinations: [Destination] {
        var result: [Destination] = [.downloads, .search, .home]
        for kind in [WorkKind.series, .movie, .site, .artist] where availableKinds.contains(kind) {
            result.append(.library(kind))
        }
        result.append(.playlists)
        result.append(.calendar)
        return result
    }
}
