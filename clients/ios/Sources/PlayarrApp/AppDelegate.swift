import GoogleCast
import PlayarrKit
import UIKit

/// Bridges the OS's background-`URLSession`-relaunch handshake into
/// `URLSessionDownloadEngine`. This is the one piece of the downloads
/// feature that has to live outside `PlayarrKit` (which deliberately
/// imports no UIKit — see `Package.swift`'s tvOS-reuse note):
/// `UIApplicationDelegate` is UIKit-only, so it lives here in the app
/// target instead and only reaches into `PlayarrKit` via
/// `URLSessionDownloadEngine.backgroundCompletionHandler`.
///
/// No `UIApplicationDelegateAdaptor`/`AppDelegate` existed anywhere in this
/// app before the downloads feature — `App.swift` wires this one in solely
/// for this handshake. The Cast SDK bootstrap below is the second reason
/// this type exists: `GCKCastContext` must be initialized here, in
/// `application(_:didFinishLaunchingWithOptions:)`, not in a SwiftUI
/// `init`/`onAppear`. Doing it any later breaks the SDK's automatic
/// session-resumption-on-relaunch behavior.
final class AppDelegate: NSObject, UIApplicationDelegate {
    /// Set by `PlayarrApp` right after `AppEnvironment` exists, so the
    /// completion handler below can be handed to the same
    /// `URLSessionDownloadEngine` instance `DownloadRepository` is driving.
    var downloadEngine: URLSessionDownloadEngine?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // A placeholder empty string (the checked-in default -- see
        // `Info.plist`'s `PlayarrCastReceiverAppID`) means casting is
        // inert, not crashing: `GCKCastContext` is simply never configured
        // until a human fills in a real receiver Application ID from the
        // Google Cast SDK Developer Console. `CastSessionCoordinator
        // .isConfigured` reflects this for callers that construct a raw
        // `GCKUICastButton`, which itself expects a configured context.
        let receiverAppID = (Bundle.main.object(forInfoDictionaryKey: "PlayarrCastReceiverAppID") as? String) ?? ""
        if !receiverAppID.isEmpty {
            let criteria = GCKDiscoveryCriteria(applicationID: receiverAppID)
            let options = GCKCastOptions(discoveryCriteria: criteria)
            GCKCastContext.setSharedInstanceWith(options)
            CastSessionCoordinator.shared.startObservingSessions()
        }
        return true
    }

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
