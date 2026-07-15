import StreamarrKit
import SwiftUI

@main
struct StreamarrApp: App {
    @State private var environment = AppEnvironment()

    var body: some Scene {
        WindowGroup {
            RootView(environment: environment)
                .environment(environment)
        }
    }
}
