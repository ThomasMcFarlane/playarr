package io.playarr.shared.update

import com.google.android.play.core.install.model.AppUpdateType

/**
 * A narrowed read of Play Core's `AppUpdateInfo` (see
 * `AppUpdateCoordinator.toSnapshot`), carrying only what
 * [resolveUpdateAction] needs to decide whether/how to start an update
 * flow. Kept as this project's own small DTO -- like `core-player`'s
 * `PlaybackState` narrowing Media3's `Player` -- rather than passing the
 * real `AppUpdateInfo` into decision logic directly, so that logic is
 * plain-Kotlin unit-testable: `AppUpdateInfo` itself has no public
 * constructor (Play Core only ever hands one out via a real
 * `AppUpdateManager`, or `FakeAppUpdateManager`, which needs a real/mocked
 * Android `Context`).
 */
data class AppUpdateSnapshot(
    val updateAvailable: Boolean,
    val availableVersionCode: Int,
    val isFlexibleUpdateAllowed: Boolean,
    val isImmediateUpdateAllowed: Boolean,
)

/** What [resolveUpdateAction] decided to do about an [UpdateSeverity], given the store-side [AppUpdateSnapshot]. */
sealed interface AppUpdateAction {
    data object None : AppUpdateAction

    /** [appUpdateType] is one of [AppUpdateType.FLEXIBLE]/[AppUpdateType.IMMEDIATE]. */
    data class Start(val appUpdateType: Int) : AppUpdateAction
}

/**
 * Combines the server's opinion ([severity], from [UpdateAvailabilityEvaluator])
 * with Play's opinion ([snapshot], from the real Play Store listing) into a
 * single decision: the server can want an update the device has no way to
 * actually fetch yet (no matching Play listing in this sandboxed
 * environment, a store rollout that hasn't reached this device, ...), and
 * Play can report an update this server's version envelope doesn't care
 * about (a cosmetic release that didn't bump `latestVersion`/
 * `minSupportedVersion` for this platform) -- an update flow is only
 * started when both agree.
 */
fun resolveUpdateAction(severity: UpdateSeverity, snapshot: AppUpdateSnapshot): AppUpdateAction {
    if (severity == UpdateSeverity.None) return AppUpdateAction.None
    if (!snapshot.updateAvailable) return AppUpdateAction.None

    val appUpdateType = when (severity) {
        is UpdateSeverity.Required -> AppUpdateType.IMMEDIATE
        is UpdateSeverity.Recommended -> AppUpdateType.FLEXIBLE
        UpdateSeverity.None -> return AppUpdateAction.None
    }
    val allowed = when (appUpdateType) {
        AppUpdateType.IMMEDIATE -> snapshot.isImmediateUpdateAllowed
        else -> snapshot.isFlexibleUpdateAllowed
    }
    return if (allowed) AppUpdateAction.Start(appUpdateType) else AppUpdateAction.None
}
