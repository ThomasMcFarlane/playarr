package io.streamarr.shared.update

import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import com.google.android.play.core.appupdate.AppUpdateInfo
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.UpdateAvailability
import com.google.android.play.core.ktx.requestAppUpdateInfo
import com.google.android.play.core.ktx.requestCompleteUpdate
import javax.inject.Inject

/** Result of [AppUpdateCoordinator.checkForUpdate]: the real Play Core [info] (needed to start a flow) plus its narrowed, testable [snapshot]. */
data class AppUpdateCheck(val info: AppUpdateInfo, val snapshot: AppUpdateSnapshot)

/**
 * Thin coordinator around Play Core's [AppUpdateManager] -- the
 * Android/Play-Core-facing half of this module, deliberately kept free of
 * decision logic (see [UpdateAvailabilityEvaluator]/[resolveUpdateAction]
 * for that, both plain Kotlin and unit-tested against fixtures). Mirrors
 * `core-player`'s `ExoPlayerStreamarrPlayer`: a real, not-directly-unit-tested
 * wrapper around a third-party SDK that needs a live Play Store
 * listing/device to meaningfully exercise, kept thin and behind a small
 * DTO seam ([AppUpdateSnapshot]) precisely so the logic that *decides* what
 * to do can be tested without either -- see this module's `AppUpdateManagerFactory.create(context)`
 * call site in each app module's `di/UpdateModule.kt` for how a real
 * instance is constructed.
 */
class AppUpdateCoordinator @Inject constructor(
    private val appUpdateManager: AppUpdateManager,
) {

    /** `AppUpdateManager.getAppUpdateInfo()`, awaited via the Play Core KTX suspend extension. */
    suspend fun checkForUpdate(): AppUpdateCheck {
        val info = appUpdateManager.requestAppUpdateInfo()
        return AppUpdateCheck(info = info, snapshot = info.toSnapshot())
    }

    /**
     * Launches the flow [appUpdateType] ([AppUpdateType.FLEXIBLE] or
     * [AppUpdateType.IMMEDIATE]) for [info] (from a just-completed
     * [checkForUpdate]) via [launcher] -- register one with
     * `androidx.activity.compose.rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult())`
     * in the calling screen. Returns whether the flow actually started.
     */
    fun startUpdateFlow(
        info: AppUpdateInfo,
        appUpdateType: Int,
        launcher: ActivityResultLauncher<IntentSenderRequest>,
    ): Boolean = appUpdateManager.startUpdateFlowForResult(info, launcher, AppUpdateOptions.defaultOptions(appUpdateType))

    /** Confirms a completed Flexible download so Play installs it -- call once a registered [InstallStateUpdatedListener] reports `InstallStatus.DOWNLOADED`. */
    suspend fun completeFlexibleUpdate() {
        appUpdateManager.requestCompleteUpdate()
    }

    fun registerListener(listener: InstallStateUpdatedListener) = appUpdateManager.registerListener(listener)

    fun unregisterListener(listener: InstallStateUpdatedListener) = appUpdateManager.unregisterListener(listener)
}

private fun AppUpdateInfo.toSnapshot(): AppUpdateSnapshot = AppUpdateSnapshot(
    updateAvailable = updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE,
    availableVersionCode = availableVersionCode(),
    isFlexibleUpdateAllowed = isUpdateTypeAllowed(AppUpdateType.FLEXIBLE),
    isImmediateUpdateAllowed = isUpdateTypeAllowed(AppUpdateType.IMMEDIATE),
)
