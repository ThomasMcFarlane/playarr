package io.streamarr.tv.ui.screens

import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text as Material3Text
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.tv.material3.Button
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import dagger.hilt.android.lifecycle.HiltViewModel
import io.streamarr.shared.auth.TokenStore
import io.streamarr.shared.data.config.ServerConfigStore
import io.streamarr.tv.BuildConfig
import io.streamarr.tv.R
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

@HiltViewModel
class TvSettingsViewModel @Inject constructor(
    private val tokenStore: TokenStore,
    private val serverConfigStore: ServerConfigStore,
) : ViewModel() {

    val baseUrl = serverConfigStore.baseUrl
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ServerConfigStore.DEFAULT_BASE_URL)

    /** Clears the stored session; the TV NavHost observes `TokenStore` and routes back to Pairing. */
    fun signOut() {
        viewModelScope.launch { tokenStore.clear() }
    }

    fun saveBaseUrl(url: String) {
        viewModelScope.launch { serverConfigStore.setBaseUrl(url) }
    }
}

@Composable
fun SettingsScreen(
    modifier: Modifier = Modifier,
    viewModel: TvSettingsViewModel = hiltViewModel(),
) {
    val savedBaseUrl by viewModel.baseUrl.collectAsState()
    var baseUrlInput by remember(savedBaseUrl) { mutableStateOf(savedBaseUrl) }

    Column(modifier = modifier.fillMaxSize().padding(48.dp)) {
        Text(text = stringResource(R.string.settings_server), style = MaterialTheme.typography.titleLarge)

        // androidx.tv.material3 ships no text-input widget (TV apps
        // normally drive text entry via a system keyboard overlay, not an
        // inline Material field) -- same "borrow the one missing plain
        // Material 3 widget" pattern as CircularProgressIndicator
        // elsewhere in this app; not themed via
        // androidx.tv.material3.MaterialTheme.
        OutlinedTextField(
            value = baseUrlInput,
            onValueChange = { baseUrlInput = it },
            label = { Material3Text(stringResource(R.string.settings_server_url)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        )
        // 10.0.2.2 is the Android emulator's own host-loopback alias -- it
        // only resolves from inside the emulator. A physical Google
        // TV/Android TV device needs the host machine's real LAN IP here
        // instead (e.g. 192.168.1.23).
        Text(
            text = stringResource(R.string.settings_server_url_hint),
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(top = 4.dp).width(480.dp),
        )
        Button(
            onClick = { viewModel.saveBaseUrl(baseUrlInput.trim()) },
            modifier = Modifier.padding(top = 16.dp),
        ) {
            Text(stringResource(R.string.settings_save))
        }

        Button(
            onClick = viewModel::signOut,
            modifier = Modifier.padding(top = 24.dp),
        ) {
            Text(stringResource(R.string.settings_sign_out))
        }

        Text(
            text = stringResource(R.string.settings_version, BuildConfig.VERSION_NAME),
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(top = 24.dp),
        )
    }
}
