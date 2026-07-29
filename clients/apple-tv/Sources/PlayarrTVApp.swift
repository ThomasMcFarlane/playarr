import SwiftUI

@main
struct PlayarrTVApp: App {
    @State private var environment = TVAppEnvironment()
    @State private var displayPreferences = TVDisplayPreferences()

    var body: some Scene {
        WindowGroup {
            // Always production native SwiftUI. Apple platforms never use
            // WebView/WKWebView (or web-ref paint) for parity — simctl captures
            // of this shell vs Playwright SPA refs only (`-PlayarrParityScreen`).
            TVRootView()
                .environment(environment)
                .environment(displayPreferences)
                .preferredColorScheme(displayPreferences.colorScheme)
        }
    }
}
