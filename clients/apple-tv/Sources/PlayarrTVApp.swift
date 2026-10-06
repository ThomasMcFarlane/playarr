import PlayarrKit
import SwiftUI

@main
struct PlayarrTVApp: App {
    @State private var environment = TVAppEnvironment()
    @State private var displayPreferences = TVDisplayPreferences()
    @State private var liveEvents = LiveEventsHub()

    var body: some Scene {
        WindowGroup {
            // Always production native SwiftUI. Apple platforms never use
            // WebView/WKWebView (or web-ref paint) for parity — simctl captures
            // of this shell vs Playwright SPA refs only (`-PlayarrParityScreen`).
            TVRootView()
                .environment(environment)
                .environment(displayPreferences)
                .environment(\.liveEvents, liveEvents)
                .preferredColorScheme(displayPreferences.colorScheme)
        }
    }
}
