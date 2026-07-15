package io.streamarr.tv.update

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
import io.streamarr.shared.data.model.ClientPlatform
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.usecase.GetServerVersionUseCase
import io.streamarr.shared.update.AppUpdateAction
import io.streamarr.shared.update.AppUpdateCheck
import io.streamarr.shared.update.AppUpdateCoordinator
import io.streamarr.shared.update.UpdateAvailabilityEvaluator
import io.streamarr.shared.update.resolveUpdateAction
import io.streamarr.tv.BuildConfig
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** A resolved-but-not-yet-launched update flow, from [AppUpdateViewModel.checkForUpdate]. */
data class PendingUpdateStart(val check: AppUpdateCheck, val appUpdateType: Int)

/** Mirrors `mobile-android`'s `AppUpdateViewModel` for `android-tv` -- see that file's KDoc. */
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
                platform = ClientPlatform.AndroidTv,
                envelope = envelope,
            )
            val check = appUpdateCoordinator.checkForUpdate()
            when (val action = resolveUpdateAction(severity, check.snapshot)) {
                is AppUpdateAction.Start -> _pendingStart.value = PendingUpdateStart(check, action.appUpdateType)
                AppUpdateAction.None -> Unit
            }
        }
    }

    fun startPendingUpdate(launcher: ActivityResultLauncher<IntentSenderRequest>) {
        val pending = _pendingStart.value ?: return
        _pendingStart.value = null
        appUpdateCoordinator.startUpdateFlow(pending.check.info, pending.appUpdateType, launcher)
    }
}

/** Mirrors `mobile-android`'s `AppUpdateEffect` -- mount once near the root of the Compose tree (see `MainActivity`). */
@Composable
fun AppUpdateEffect(viewModel: AppUpdateViewModel = hiltViewModel()) {
    val pendingStart by viewModel.pendingStart.collectAsState()

    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) {
        // Play Core owns this flow's UI; no result-specific handling needed here.
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
