import PlayarrKit
import SwiftUI

@main
struct PlayarrApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var environment = AppEnvironment()

    var body: some Scene {
        WindowGroup {
            RootView(environment: environment)
                .environment(environment)
                .task { appDelegate.downloadEngine = environment.downloadRepository.engine }
        }
    }
}
