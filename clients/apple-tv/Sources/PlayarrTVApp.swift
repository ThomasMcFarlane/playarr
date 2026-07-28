import SwiftUI

@main
struct PlayarrTVApp: App {
    @State private var environment = TVAppEnvironment()

    var body: some Scene {
        WindowGroup {
            // Always use production SwiftUI shell. Parity suite forces tabs via
            // `-PlayarrParityScreen` (handled inside TVRootView) — web-ref paint
            // is only used when `-PlayarrParityWebRefBaseURL` is set (AE0 tooling).
            if let parityScreen = TVParityLaunch.requestedScreen,
               TVParityLaunch.webRefBaseURL != nil {
                TVParityRootView(screen: parityScreen)
            } else {
                TVRootView()
                    .environment(environment)
            }
        }
    }
}
