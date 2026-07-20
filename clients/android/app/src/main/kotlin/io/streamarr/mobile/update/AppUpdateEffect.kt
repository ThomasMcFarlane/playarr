package io.streamarr.mobile.update

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
import io.streamarr.mobile.BuildConfig
import io.streamarr.shared.data.model.ClientPlatform
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.usecase.GetServerVersionUseCase
import io.streamarr.shared.update.AppUpdateAction
import io.streamarr.shared.update.AppUpdateCheck
import io.streamarr.shared.update.AppUpdateCoordinator
import io.streamarr.shared.update.UpdateAvailabilityEvaluator
import io.streamarr.shared.update.resolveUpdateAction
import javax.inject.Inject
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
            val envelope = (versionResult as? StreamarrResult.Success)?.value ?: return@launch
            val severity = UpdateAvailabilityEvaluator.evaluate(
                currentVersion = BuildConfig.VERSION_NAME,
                platform = ClientPlatform.AndroidMobile,
                envelope = envelope,
            )
            val check = appUpdateCoordinator.checkForUpdate()
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
        appUpdateCoordinator.startUpdateFlow(pending.check.info, pending.appUpdateType, launcher)
    }
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
