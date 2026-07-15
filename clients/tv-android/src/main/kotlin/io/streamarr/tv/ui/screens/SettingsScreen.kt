package io.streamarr.tv.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
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
import io.streamarr.tv.BuildConfig
import io.streamarr.tv.R
import javax.inject.Inject
import kotlinx.coroutines.launch

@HiltViewModel
class TvSettingsViewModel @Inject constructor(
    private val tokenStore: TokenStore,
) : ViewModel() {
    /** Clears the stored session; the TV NavHost observes `TokenStore` and routes back to Pairing. */
    fun signOut() {
        viewModelScope.launch { tokenStore.clear() }
    }
}

@Composable
fun SettingsScreen(
    modifier: Modifier = Modifier,
    viewModel: TvSettingsViewModel = hiltViewModel(),
) {
    Column(modifier = modifier.fillMaxSize().padding(48.dp)) {
        Text(text = stringResource(R.string.settings_server), style = MaterialTheme.typography.titleLarge)
        Text(text = BuildConfig.STREAMARR_BASE_URL, style = MaterialTheme.typography.bodyMedium)

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
