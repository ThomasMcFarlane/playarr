package io.playarr.mobile.update

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.playarr.mobile.BuildConfig
import io.playarr.shared.data.model.ClientPlatform
import io.playarr.shared.domain.model.PlayarrResult
import io.playarr.shared.domain.usecase.GetServerVersionUseCase
import io.playarr.shared.update.AppUpdateAction
import io.playarr.shared.update.AppUpdateCheck
import io.playarr.shared.update.AppUpdateCoordinator
import io.playarr.shared.update.UpdateAvailabilityEvaluator
import io.playarr.shared.update.UpdateSeverity
import io.playarr.shared.update.resolveUpdateAction
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** A resolved-but-not-yet-launched update flow, from [AppUpdateViewModel.checkForUpdate]. */
data class PendingUpdateStart(val check: AppUpdateCheck, val appUpdateType: Int)

/**
 * Drives the client auto-update module (see `core-update`'s
 * `UpdateAvailabilityEvaluator`/`AppUpdateCoordinator`) for `android-mobile`:
 * on every check, compares [BuildConfig.VERSION_NAME] against
 * `GET /api/system/version`'s row for [ClientPlatform.AndroidMobile], then
 * (if the server wants an update) checks Play's own [AppUpdateCoordinator]
 * before deciding whether/how to actually start a flow -- see
 * `resolveUpdateAction`. A failed version check, or a check with nothing to
 * do, is silently a no-op -- there is no "update check failed" UI, mirroring
 * how a failed background refresh is already treated elsewhere in this app.
 */
@HiltViewModel
class AppUpdateViewModel @Inject constructor(
    private val getServerVersionUseCase: GetServerVersionUseCase,
    private val appUpdateCoordinator: AppUpdateCoordinator,
) : ViewModel() {

    private val _pendingStart = MutableStateFlow<PendingUpdateStart?>(null)
    val pendingStart: StateFlow<PendingUpdateStart?> = _pendingStart.asStateFlow()

    fun checkForUpdate() {
        viewModelScope.launch {
            val versionResult = getServerVersionUseCase()
            val envelope = (versionResult as? PlayarrResult.Success)?.value ?: return@launch
            val severity = UpdateAvailabilityEvaluator.evaluate(
                currentVersion = BuildConfig.VERSION_NAME,
                platform = ClientPlatform.AndroidMobile,
                envelope = envelope,
            )
            // Do not bind Play Core unless the server actually reports a
            // newer Android build. Sideloads and devices without Play can
            // legitimately have no update service at all.
            if (severity == UpdateSeverity.None) return@launch
            val check = bestEffortUpdateCheck { appUpdateCoordinator.checkForUpdate() } ?: return@launch
            when (val action = resolveUpdateAction(severity, check.snapshot)) {
                is AppUpdateAction.Start -> _pendingStart.value = PendingUpdateStart(check, action.appUpdateType)
                AppUpdateAction.None -> Unit
            }
        }
    }

    /** Launches whatever [checkForUpdate] most recently resolved, then clears it -- a pending start is one-shot. */
    fun startPendingUpdate(launcher: ActivityResultLauncher<IntentSenderRequest>) {
        val pending = _pendingStart.value ?: return
        _pendingStart.value = null
        bestEffortUpdateStart {
            appUpdateCoordinator.startUpdateFlow(pending.check.info, pending.appUpdateType, launcher)
        }
    }
}

/** Play Core is optional at runtime: sideloads and non-Play devices must remain usable. */
internal suspend fun bestEffortUpdateCheck(block: suspend () -> AppUpdateCheck): AppUpdateCheck? =
    try {
        block()
    } catch (cancellation: CancellationException) {
        throw cancellation
    } catch (_: Exception) {
        null
    }

/** Starting the Play-owned UI is likewise best-effort once a check has succeeded. */
internal fun bestEffortUpdateStart(block: () -> Boolean): Boolean =
    try {
        block()
    } catch (_: Exception) {
        false
    }

/**
 * Renders nothing; mount once near the root of the Compose tree (see
 * `MainActivity`). Checks for an update on every [Lifecycle.Event.ON_RESUME]
 * (cold start included) and launches Play's Flexible/Immediate In-App
 * Update flow through an [ActivityResultLauncher] registered here, per
 * `docs/versioning-policy.md`'s per-platform table.
 */
@Composable
fun AppUpdateEffect(viewModel: AppUpdateViewModel = hiltViewModel()) {
    val pendingStart by viewModel.pendingStart.collectAsState()

    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) {
        // Play Core owns this flow's UI end to end (including the
        // Immediate flow's blocking full-screen prompt and the Flexible
        // flow's background download); there is no result-specific
        // handling this app needs beyond letting the launcher exist so
        // AppUpdateManager.startUpdateFlowForResult has somewhere to send
        // the user's decision.
    }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        viewModel.checkForUpdate()
    }

    LaunchedEffect(pendingStart) {
        if (pendingStart != null) {
            viewModel.startPendingUpdate(launcher)
        }
    }
}
