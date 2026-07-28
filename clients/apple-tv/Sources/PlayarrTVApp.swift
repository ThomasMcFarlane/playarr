import SwiftUI

@main
struct PlayarrTVApp: App {
    @State private var environment = TVAppEnvironment()

    var body: some Scene {
        WindowGroup {
            if let parityScreen = TVParityLaunch.requestedScreen {
                // Deterministic chrome-only surfaces for the visual parity suite.
                TVParityRootView(screen: parityScreen)
            } else {
                TVRootView()
                    .environment(environment)
            }
        }
    }
}
