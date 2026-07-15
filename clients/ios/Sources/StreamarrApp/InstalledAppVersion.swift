import Foundation

/// Where the auto-update module (`UpdateViewModel`) gets "what version am
/// I" and "where's my App Store listing" from. Both are placeholders until
/// this package gets a real Xcode project layer with a populated
/// `Info.plist` and a real App Store Connect listing — see
/// `clients/ios/README.md`'s "Why `StreamarrApp` isn't a real `.app` yet".
// `public`/`public static` throughout (rather than the `internal` default):
// `UpdateViewModel.init` (in `StreamarrApp`, same module) is `public` and
// defaults its `installedVersion`/`bundleID`/`appStoreID` parameters from
// this type, and Swift requires a public API's default-argument
// expressions to be at least as visible as the API itself, regardless of
// whether anything outside this module actually ever calls it (this
// executable target has no external consumers today, but the access-control
// check doesn't know that).
public enum InstalledAppVersion {
    /// Matches `APIClientConfiguration`'s own default `clientVersion`
    /// ("0.1.0") for consistency between the `X-Streamarr-Client-Version`
    /// header and what the auto-update module compares. Note this reads as
    /// `.blocked` against `backend/config/client-compatibility.toml`'s
    /// current `[ios] minSupported = "0.8.0"` — that's expected for an
    /// un-updated fresh scaffold checkout (see
    /// `AppUpdateEvaluatorTests.testRealSampleConfigFromClientCompatibilityToml`
    /// in `StreamarrKitTests`), not a bug in this constant; bump it
    /// alongside real release tags once this client actually ships builds.
    public static let fallback = "0.1.0"

    /// `CFBundleShortVersionString` once a real `Info.plist` exists (true
    /// after this is wrapped in an Xcode project); falls back to
    /// `fallback` today, since this pre-Xcode-project SPM executable has no
    /// populated bundle info dictionary.
    public static var current: String {
        (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? fallback
    }

    /// `TODO`: replace with the app's real bundle identifier once one is
    /// registered in App Store Connect.
    public static var bundleIdentifier: String {
        Bundle.main.bundleIdentifier ?? "com.streamarr.ios"
    }

    /// `TODO`: replace with the app's real numeric App Store id once
    /// published — `itms-apps://itunes.apple.com/app/id<this>` only
    /// resolves to a real listing after that. Left as an obviously-fake
    /// placeholder (rather than a real-looking number) so it fails loudly
    /// — the App Store shows "can't find app" — instead of silently
    /// deep-linking to an unrelated app if this ever ships un-replaced.
    public static let appStoreID = "0000000000"
}
