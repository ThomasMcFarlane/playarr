import Foundation

/// Where the auto-update module (`UpdateViewModel`) gets "what version am
/// I" and "where's my App Store listing" from. The installed version and
/// bundle identifier come from the real app bundle; only the App Store id
/// remains a placeholder until App Store Connect allocates one.
// `public`/`public static` throughout (rather than the `internal` default):
// `UpdateViewModel.init` (in `PlayarrApp`, same module) is `public` and
// defaults its `installedVersion`/`bundleID`/`appStoreID` parameters from
// this type, and Swift requires a public API's default-argument
// expressions to be at least as visible as the API itself, regardless of
// whether anything outside this module actually ever calls it (this
// executable target has no external consumers today, but the access-control
// check doesn't know that).
public enum InstalledAppVersion {
    /// Matches `APIClientConfiguration`'s own default `clientVersion`
    /// ("0.1.0") for consistency between the `X-Playarr-Client-Version`
    /// header and what the auto-update module compares. Note this reads as
    /// `.blocked` against `backend/config/client-compatibility.toml`'s
    /// current `[ios] minSupported = "0.8.0"` — that's expected for an
    /// un-updated fresh scaffold checkout (see
    /// `AppUpdateEvaluatorTests.testRealSampleConfigFromClientCompatibilityToml`
    /// in `PlayarrKitTests`), not a bug in this constant; bump it
    /// alongside real release tags once this client actually ships builds.
    public static let fallback = "0.1.0"

    /// Reads `CFBundleShortVersionString` from the Xcode-built app bundle,
    /// with a fallback for direct package tooling and previews.
    public static var current: String {
        (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? fallback
    }

    /// Reads the configured product bundle identifier.
    public static var bundleIdentifier: String {
        Bundle.main.bundleIdentifier ?? "com.playarr.ios"
    }

    /// Numeric App Store id of the Playarr record (iOS and tvOS share it).
    /// `itms-apps://itunes.apple.com/app/id<this>` resolves to the public
    /// listing once the app is released; during TestFlight it is the
    /// record's Apple ID. An App Store id is public, not a secret.
    public static let appStoreID = "6818958016"
}
