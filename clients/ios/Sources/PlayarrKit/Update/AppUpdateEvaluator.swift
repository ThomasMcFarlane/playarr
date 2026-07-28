import Foundation

// MARK: - Client auto-update module (evaluation half)
//
// See `docs/versioning-policy.md` and `docs/architecture/clients/ios.md`
// for the architecture plan this implements. Those documents also describe
// a more elaborate `apiVersion`/`apiVersionFloor` integer scheme (a `426
// Upgrade Required` gate, an `X-Playarr-Api-Version` request header) that
// the *real, current* backend does not implement — `GET
// /api/system/version` (`playarr-model::VersionEnvelope`, see
// `backend/crates/playarr-model/src/platform.rs` and
// `backend/config/client-compatibility.toml`) only exposes a flat
// `compatibility: [CompatibilityEntry]` table keyed by `ClientPlatform`,
// each entry carrying plain per-platform SemVer-shaped strings
// (`latest_version` / `min_supported_version`). This file is written
// against that real shape, per this pass's explicit instructions — not
// against the docs' aspirational integer scheme.
//
// **Enforcement ceiling, stated explicitly per the architecture plan:**
// Apple's App Store guidelines prohibit an iOS app from downloading and
// executing new code outside what App Review approved — there is no such
// thing as an OTA code update on this platform, full stop. Nothing in this
// file (or `PlayarrApp`'s `UpdateViewModel`/`UpdateGateModifier`, which
// render the status this file computes) can make an out-of-date client
// stop working at the network/API layer; it can only decide which
// UX — none, a dismissible nudge, or a blocking-but-inert interstitial —
// to show. Real enforcement, if Playarr Server ever needs it, has to happen
// server-side (rejecting the request outright), independent of whether
// this client-side nudge exists at all.

/// What the client should show given the installed app version vs. the
/// `ios` `CompatibilityEntry` in `GET /api/system/version`'s
/// `VersionEnvelope.compatibility`. See `AppUpdateEvaluator.evaluate`.
public enum AppUpdateStatus: Equatable, Sendable {
    /// Installed version is at or above `latest_version` — nothing to show.
    case upToDate
    /// Installed version is at or above `min_supported_version` but below
    /// `latest_version` — a dismissible nudge. Associated value is
    /// `latest_version`, for display.
    case softNudge(latestVersion: String)
    /// Installed version is below `min_supported_version` — a blocking
    /// (but, per the ceiling above, not actually enforcing) interstitial.
    /// Associated value is `min_supported_version`, for display.
    case blocked(minSupportedVersion: String)
}

/// Pure version-comparison logic — no networking, no UIKit/SwiftUI, so it's
/// trivially unit-testable and (per `Package.swift`'s stated platform
/// strategy) reusable unchanged from a future tvOS app target.
public enum AppUpdateEvaluator {
    /// Compares `installedVersion` against `entry`'s two floors for its
    /// platform and returns which UX state applies. `entry` should already
    /// be the caller's own platform's row (see `ClientPlatform.ios`) — this
    /// function doesn't filter by platform itself, it only compares.
    public static func evaluate(installedVersion: String, entry: CompatibilityEntry) -> AppUpdateStatus {
        if compareVersions(installedVersion, entry.minSupportedVersion) == .orderedAscending {
            return .blocked(minSupportedVersion: entry.minSupportedVersion)
        }
        if compareVersions(installedVersion, entry.latestVersion) == .orderedAscending {
            return .softNudge(latestVersion: entry.latestVersion)
        }
        return .upToDate
    }

    /// Compares two `"major.minor.patch[...]"`-shaped version strings
    /// numerically, component by component — missing trailing components
    /// are treated as `0` (`"1.2"` == `"1.2.0"`), and a non-numeric
    /// component sorts below any numeric one rather than crashing, since
    /// this only ever runs against server-supplied config strings
    /// (`backend/config/client-compatibility.toml`), not something this
    /// client controls the shape of and can assume is well-formed.
    public static func compareVersions(_ lhs: String, _ rhs: String) -> ComparisonResult {
        let lhsParts = lhs.split(separator: ".").map(numericValue)
        let rhsParts = rhs.split(separator: ".").map(numericValue)
        let count = max(lhsParts.count, rhsParts.count)
        for index in 0..<count {
            let lhsValue = index < lhsParts.count ? lhsParts[index] : 0
            let rhsValue = index < rhsParts.count ? rhsParts[index] : 0
            if lhsValue != rhsValue {
                return lhsValue < rhsValue ? .orderedAscending : .orderedDescending
            }
        }
        return .orderedSame
    }

    private static func numericValue(_ component: Substring) -> Int {
        Int(component) ?? -1
    }
}
