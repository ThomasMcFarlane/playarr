package io.streamarr.mobile.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ListItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
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
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val tokenStore: TokenStore,
) : ViewModel() {

    val isSignedIn = tokenStore.accessToken
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    fun signOut() {
        viewModelScope.launch { tokenStore.clear() }
    }
}

@Composable
fun SettingsScreen(
    modifier: Modifier = Modifier,
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val accessToken by viewModel.isSignedIn.collectAsState()

    Column(modifier = modifier.fillMaxSize()) {
        ListItem(
            headlineContent = { Text(stringResource(R.string.settings_server)) },
            supportingContent = { Text(BuildConfig.STREAMARR_BASE_URL) },
        )
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
