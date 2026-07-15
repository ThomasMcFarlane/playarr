import StreamarrKit
import SwiftUI

/// Tab container wiring the four placeholder screens to their view
/// models. View models are created once, in `init`, and held in `@State`
/// (not re-created on every `body` evaluation) — the standard SwiftUI +
/// `@Observable` ownership pattern this app uses throughout.
///
/// "Now Playing" is included here as a tab purely so this scaffold shows
/// all four required screens wired up; in the real app `PlayerView` is far
/// more likely to be presented full-screen from `HomeView`/`LibraryView`
/// when the user taps something playable, not live as a persistent tab.
struct RootView: View {
    @State private var homeViewModel: HomeViewModel
    @State private var libraryViewModel: LibraryViewModel
    @State private var playerViewModel: PlayerViewModel
    @State private var settingsViewModel: SettingsViewModel

    init(environment: AppEnvironment) {
        _homeViewModel = State(initialValue: HomeViewModel(apiClient: environment.apiClient))
        _libraryViewModel = State(initialValue: LibraryViewModel(apiClient: environment.apiClient))
        _playerViewModel = State(
            initialValue: PlayerViewModel(engine: AVPlayerEngine(), apiClient: environment.apiClient)
        )
        _settingsViewModel = State(initialValue: SettingsViewModel(environment: environment))
    }

    var body: some View {
        TabView {
            HomeView(viewModel: homeViewModel)
                .tabItem { Label("Home", systemImage: "house") }

            LibraryView(viewModel: libraryViewModel)
                .tabItem { Label("Library", systemImage: "film.stack") }

            PlayerView(viewModel: playerViewModel)
                .tabItem { Label("Now Playing", systemImage: "play.circle") }

            SettingsView(viewModel: settingsViewModel)
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}
