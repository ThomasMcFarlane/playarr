package io.streamarr.mobile.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
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
import dagger.hilt.android.lifecycle.HiltViewModel
import io.streamarr.mobile.BuildConfig
import io.streamarr.mobile.R
import io.streamarr.shared.auth.TokenStore
import io.streamarr.shared.data.config.ServerConfigStore
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val tokenStore: TokenStore,
    private val serverConfigStore: ServerConfigStore,
) : ViewModel() {

    val isSignedIn = tokenStore.accessToken
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val baseUrl = serverConfigStore.baseUrl
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ServerConfigStore.DEFAULT_BASE_URL)

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
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val accessToken by viewModel.isSignedIn.collectAsState()
    val savedBaseUrl by viewModel.baseUrl.collectAsState()
    var baseUrlInput by remember(savedBaseUrl) { mutableStateOf(savedBaseUrl) }

    Column(modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        ListItem(headlineContent = { Text(stringResource(R.string.settings_server)) })

        OutlinedTextField(
            value = baseUrlInput,
            onValueChange = { baseUrlInput = it },
            label = { Text(stringResource(R.string.settings_server_url)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        // 10.0.2.2 is the Android emulator's own host-loopback alias -- it
        // only resolves from inside the emulator. A physical device needs
        // the host machine's real LAN IP here instead (e.g. 192.168.1.23).
        Text(
            text = stringResource(R.string.settings_server_url_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp),
        )
        Button(
            onClick = { viewModel.saveBaseUrl(baseUrlInput.trim()) },
            modifier = Modifier.padding(16.dp),
        ) {
            Text(stringResource(R.string.settings_save))
        }

        ListItem(
            headlineContent = { Text(stringResource(R.string.settings_account)) },
            supportingContent = { Text(if (accessToken != null) "Signed in" else "Not signed in") },
        )
        if (accessToken != null) {
            Button(onClick = viewModel::signOut, modifier = Modifier.padding(16.dp)) {
                Text(stringResource(R.string.settings_sign_out))
            }
        }
        ListItem(
            headlineContent = { Text(stringResource(R.string.settings_about)) },
            supportingContent = { Text(stringResource(R.string.settings_version, BuildConfig.VERSION_NAME)) },
        )
    }
}
