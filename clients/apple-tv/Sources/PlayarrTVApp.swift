import SwiftUI

@main
struct PlayarrTVApp: App {
    @State private var environment = TVAppEnvironment()

    var body: some Scene {
        WindowGroup {
            // Always production SwiftUI shell. Honest parity captures use
            // `-PlayarrParityScreen` only (handled inside TVRootView). Full-bleed
            // web-ref paint (`-PlayarrParityWebRefBaseURL` / TVParityRootView) is
            // intentionally not wired — it cannot satisfy native-vs-SPA AE.
            TVRootView()
                .environment(environment)
        }
    }
}
