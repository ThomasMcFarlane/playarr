import SwiftUI

@main
struct PlayarrTVApp: App {
    @State private var environment = TVAppEnvironment()

    var body: some Scene {
        WindowGroup {
            TVRootView()
                .environment(environment)
        }
    }
}
