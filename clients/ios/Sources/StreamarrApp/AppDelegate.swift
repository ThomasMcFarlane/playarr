import StreamarrKit
import UIKit

/// Bridges the OS's background-`URLSession`-relaunch handshake into
/// `URLSessionDownloadEngine`. This is the one piece of the downloads
/// feature that has to live outside `StreamarrKit` (which deliberately
/// imports no UIKit — see `Package.swift`'s tvOS-reuse note):
/// `UIApplicationDelegate` is UIKit-only, so it lives here in the app
/// target instead and only reaches into `StreamarrKit` via
/// `URLSessionDownloadEngine.backgroundCompletionHandler`.
///
/// No `UIApplicationDelegateAdaptor`/`AppDelegate` existed anywhere in this
/// app before the downloads feature — `App.swift` wires this one in solely
/// for this handshake.
final class AppDelegate: NSObject, UIApplicationDelegate {
    /// Set by `StreamarrApp` right after `AppEnvironment` exists, so the
    /// completion handler below can be handed to the same
    /// `URLSessionDownloadEngine` instance `DownloadRepository` is driving.
    var downloadEngine: URLSessionDownloadEngine?

    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        guard identifier == URLSessionDownloadEngine.backgroundSessionIdentifier else {
            completionHandler()
            return
        }
        downloadEngine?.backgroundCompletionHandler = completionHandler
    }
}
