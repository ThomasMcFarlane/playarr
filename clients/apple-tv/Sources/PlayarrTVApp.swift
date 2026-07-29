import SwiftUI

@main
struct PlayarrTVApp: App {
    @State private var environment = TVAppEnvironment()

    var body: some Scene {
        WindowGroup {
            // Always production SwiftUI shell. Honest parity captures use
            // `-PlayarrParityScreen` only (handled inside TVRootView). Web-ref
            // paint is disabled (`webRefBaseURL` always nil).
            TVRootView()
                .environment(environment)
        }
    }
}
