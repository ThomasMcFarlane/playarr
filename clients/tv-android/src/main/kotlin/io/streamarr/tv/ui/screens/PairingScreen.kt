package io.streamarr.tv.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.streamarr.tv.R
import io.streamarr.shared.auth.DeviceAuthClient
import io.streamarr.shared.auth.TokenStore
import io.streamarr.shared.auth.model.ClientPlatform
import io.streamarr.shared.auth.model.DeviceCodeResponse
import io.streamarr.shared.auth.model.DevicePollResult
import androidx.tv.material3.Button
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** UI-facing projection of the RFC 8628 pairing flow's progress; see [DeviceAuthClient]. */
sealed interface PairingUiState {
    data object Requesting : PairingUiState
    data class AwaitingApproval(val userCode: String, val verificationUri: String) : PairingUiState
    data object Approved : PairingUiState
    data class Failed(val message: String, val canRetry: Boolean) : PairingUiState
}

@HiltViewModel
class PairingViewModel @Inject constructor(
    private val deviceAuthClient: DeviceAuthClient,
    private val tokenStore: TokenStore,
) : ViewModel() {

    private val _state = MutableStateFlow<PairingUiState>(PairingUiState.Requesting)
    val state: StateFlow<PairingUiState> = _state.asStateFlow()

    init {
        startPairing()
    }

    fun startPairing() {
        _state.value = PairingUiState.Requesting
        viewModelScope.launch {
            val authorization: DeviceCodeResponse = try {
                deviceAuthClient.requestDeviceCode(clientPlatform = ClientPlatform.AndroidTv)
            } catch (e: Exception) {
                _state.value = PairingUiState.Failed(e.message ?: "Couldn't reach the server", canRetry = true)
                return@launch
            }

            _state.value = PairingUiState.AwaitingApproval(
                userCode = authorization.userCode,
                verificationUri = authorization.verificationUri,
            )

            deviceAuthClient.pollUntilResolved(
                deviceCode = authorization.deviceCode,
                initialIntervalSeconds = authorization.interval,
            ).collect { result ->
                when (result) {
                    is DevicePollResult.Approved -> {
                        tokenStore.save(result.token)
                        _state.value = PairingUiState.Approved
                    }
                    DevicePollResult.AuthorizationPending, DevicePollResult.SlowDown -> Unit // stay on AwaitingApproval
                    DevicePollResult.Expired -> _state.value =
                        PairingUiState.Failed("This code expired", canRetry = true)
                    DevicePollResult.Denied -> _state.value =
                        PairingUiState.Failed("Pairing was declined", canRetry = true)
                    is DevicePollResult.Failed -> _state.value =
                        PairingUiState.Failed(result.message, canRetry = true)
                }
            }
        }
    }
}

@Composable
fun PairingScreen(
    onPaired: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: PairingViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()

    LaunchedEffect(state) {
        if (state is PairingUiState.Approved) onPaired()
    }

    Column(
        modifier = modifier.fillMaxSize().padding(48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(text = stringResource(R.string.pairing_title), style = MaterialTheme.typography.headlineLarge)

        Spacer(modifier = Modifier.height(24.dp))

        when (val current = state) {
            is PairingUiState.Requesting -> CircularProgressIndicator()

            is PairingUiState.AwaitingApproval -> {
                Text(text = stringResource(R.string.pairing_instructions), style = MaterialTheme.typography.bodyLarge)
                Text(text = current.verificationUri, style = MaterialTheme.typography.titleLarge)
                Text(text = stringResource(R.string.pairing_enter_code), style = MaterialTheme.typography.bodyLarge)
                Text(text = current.userCode, style = MaterialTheme.typography.displayLarge)
                Text(text = stringResource(R.string.pairing_waiting), style = MaterialTheme.typography.bodyMedium)
            }

            is PairingUiState.Approved -> CircularProgressIndicator() // brief; onPaired() navigates away immediately

            is PairingUiState.Failed -> {
                Text(text = current.message, style = MaterialTheme.typography.bodyLarge)
                if (current.canRetry) {
                    Button(onClick = viewModel::startPairing) {
                        Text(stringResource(R.string.pairing_retry))
                    }
                }
            }
        }
    }
}
