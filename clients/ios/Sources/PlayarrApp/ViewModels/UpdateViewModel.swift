import Foundation
import Observation
import PlayarrKit
#if canImport(UIKit)
import UIKit
#endif

/// Drives the client auto-update-nudge module described in
/// `docs/versioning-policy.md` / `docs/architecture/clients/ios.md`, wired
/// against the *real* `GET /api/system/version` shape
/// (`VersionEnvelope.compatibility: [CompatibilityEntry]`, keyed by
/// `ClientPlatform`) rather than those docs' more elaborate
/// `apiVersion`/`apiVersionFloor` integer scheme, which the current backend
/// doesn't implement — see `AppUpdateEvaluator`'s header comment in
/// `PlayarrKit` for the full note. All the actual comparison logic lives
/// there (pure, unit-tested); this type is just the `@MainActor` glue that
/// calls it on foreground, holds the resulting `AppUpdateStatus` as
/// `@Observable` state, and knows how to open the App Store.
///
/// **Enforcement ceiling:** this is a UX-level nudge/block only — see
/// `AppUpdateEvaluator.swift`'s header and `UpdateGateModifier`'s doc
/// comment for the explicit statement of why (Apple disallows OTA code
/// updates on iOS) and what that does and doesn't mean in practice.
@MainActor
@Observable
public final class UpdateViewModel {
    public private(set) var status: AppUpdateStatus = .upToDate
    public private(set) var softNudgeDismissed = false
    /// Display-only "latest version" from the secondary, throttled iTunes
    /// Lookup poll — **never** used for the blocked/soft-nudge decision
    /// above, only surfaced so a diagnostics screen can show it if useful.
    /// `nil` until the first successful (non-throttled) lookup.
    public private(set) var storeListingVersion: String?

    private let apiClient: PlayarrAPIClient
    private let installedVersion: String
    private let bundleID: String
    private let appStoreID: String
    private let storeLookupClient: AppStoreLookupClient
    private let userDefaults: UserDefaults

    private static let lastStoreLookupDefaultsKey = "com.playarr.ios.lastStoreLookupAt"
    /// "~daily" per the architecture plan — the iTunes Lookup API is a
    /// public, third-party, unauthenticated endpoint outside Playarr Server's
    /// own infrastructure, so this is deliberately not tied to every
    /// foreground the way the real `/api/system/version` check is.
    static let storeLookupThrottleInterval: TimeInterval = 60 * 60 * 24

    public init(
        apiClient: PlayarrAPIClient,
        installedVersion: String = InstalledAppVersion.current,
        bundleID: String = InstalledAppVersion.bundleIdentifier,
        appStoreID: String = InstalledAppVersion.appStoreID,
        storeLookupClient: AppStoreLookupClient = AppStoreLookupClient(),
        userDefaults: UserDefaults = .standard
    ) {
        self.apiClient = apiClient
        self.installedVersion = installedVersion
        self.bundleID = bundleID
        self.appStoreID = appStoreID
        self.storeLookupClient = storeLookupClient
        self.userDefaults = userDefaults
    }

    /// Call on launch and on every foreground (see `RootView`). Talks to
    /// the real, authoritative `GET /api/system/version` first; also
    /// opportunistically (and throttled) polls the secondary iTunes Lookup
    /// source, but that result never feeds the gating decision below.
    public func checkForUpdate() async {
        do {
            let envelope = try await apiClient.fetchVersion()
            if let entry = envelope.compatibility.first(where: { $0.platform == .ios }) {
                let newStatus = AppUpdateEvaluator.evaluate(installedVersion: installedVersion, entry: entry)
                if newStatus != status {
                    softNudgeDismissed = false
                }
                status = newStatus
            }
            // No `ios` entry in the table at all: leave `status` as-is
            // rather than assuming either extreme — an operator running a
            // server build that hasn't been configured with this
            // platform's row yet shouldn't be able to lock iOS users out
            // (or silently stop nudging them) as a side effect of that gap.
        } catch {
            // A failed version check must never itself become (or clear) a
            // hard block — an operator's server being briefly unreachable
            // shouldn't lock users out of an app that was working fine a
            // moment ago. Leave `status` as whatever it last was.
        }

        await pollStoreListingIfDue()
    }

    public func dismissSoftNudge() {
        softNudgeDismissed = true
    }

    /// Deep-links to this app's App Store listing via `itms-apps://` — the
    /// only place an update can actually be obtained (see the ceiling note
    /// on this type and on `AppUpdateEvaluator`).
    public func openAppStore() {
        guard let url = URL(string: "itms-apps://itunes.apple.com/app/id\(appStoreID)") else { return }
        #if canImport(UIKit)
        UIApplication.shared.open(url)
        #endif
    }

    // MARK: - Secondary iTunes Lookup source (display-only, throttled)

    private func pollStoreListingIfDue() async {
        let now = Date()
        if let last = userDefaults.object(forKey: Self.lastStoreLookupDefaultsKey) as? Date,
           now.timeIntervalSince(last) < Self.storeLookupThrottleInterval {
            return
        }
        do {
            storeListingVersion = try await storeLookupClient.lookupLatestVersion(bundleID: bundleID)
            userDefaults.set(now, forKey: Self.lastStoreLookupDefaultsKey)
        } catch {
            // Display-only and best-effort: never surfaced as a user-facing
            // error, never affects `status`. A stale/missing App Store
            // listing (e.g. pre-launch, or this bundle id placeholder not
            // published yet) is expected during development.
        }
    }
}
