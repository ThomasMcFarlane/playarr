package io.streamarr.tv.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.ui.PlayerView
import androidx.tv.material3.Button
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import dagger.hilt.android.lifecycle.HiltViewModel
import io.streamarr.shared.data.model.PlaybackMode
import io.streamarr.shared.domain.model.StreamarrError
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.usecase.GetPlaybackInfoUseCase
import io.streamarr.shared.player.StreamFormat
import io.streamarr.shared.player.StreamarrPlayer
import io.streamarr.tv.R
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Mirrors `mobile-android`'s `PlayerScreen.kt` -- see that file for the real load-state/error-mapping rationale. */
sealed interface PlayerLoadState {
    data object Idle : PlayerLoadState
    data object Loading : PlayerLoadState
    data object Ready : PlayerLoadState
    data class Error(val message: String) : PlayerLoadState
}

@HiltViewModel
class TvPlayerViewModel @Inject constructor(
    val player: StreamarrPlayer,
    private val getPlaybackInfoUseCase: GetPlaybackInfoUseCase,
) : ViewModel() {

    val state = player.state

    private val _loadState = MutableStateFlow<PlayerLoadState>(PlayerLoadState.Idle)
    val loadState: StateFlow<PlayerLoadState> = _loadState.asStateFlow()

    /** Calls `GET /api/v1/playback/{media_file_id}` first, then configures the player with whatever it decided. */
    fun playMediaFile(mediaFileId: String) {
        viewModelScope.launch {
            _loadState.value = PlayerLoadState.Loading
            when (val result = getPlaybackInfoUseCase(mediaFileId)) {
                is StreamarrResult.Success -> {
                    val info = result.value
                    val format = when (info.mode) {
                        PlaybackMode.Direct -> StreamFormat.Direct
                        PlaybackMode.Hls -> StreamFormat.Hls
                    }
                    player.prepare(mediaUrl = info.url, format = format)
                    player.play()
                    _loadState.value = PlayerLoadState.Ready
                }
                is StreamarrResult.Failure -> _loadState.value = PlayerLoadState.Error(result.error.toUserMessage())
            }
        }
    }

    override fun onCleared() {
        player.release()
    }
}

private fun StreamarrError.toUserMessage(): String = when (this) {
    is StreamarrError.Network -> "Can't reach the Streamarr server. Check the server address in Settings."
    is StreamarrError.Http -> when (code) {
        404 -> "This media file couldn't be found."
        503 -> "No transcode capacity is available on the server right now."
        else -> "Server error ($code)."
    }
    is StreamarrError.Unknown -> "Something went wrong loading this media."
}

@Composable
fun PlayerScreen(
    mediaFileId: String?,
    modifier: Modifier = Modifier,
    viewModel: TvPlayerViewModel = hiltViewModel(),
) {
    val playbackState by viewModel.state.collectAsState()
    val loadState by viewModel.loadState.collectAsState()

    LaunchedEffect(mediaFileId) {
        if (mediaFileId != null) viewModel.playMediaFile(mediaFileId)
    }

    Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        val currentLoadState = loadState
        when {
            mediaFileId == null -> Text(text = stringResource(R.string.player_no_media), style = MaterialTheme.typography.bodyLarge)

            currentLoadState is PlayerLoadState.Error -> Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.padding(24.dp),
            ) {
                Text(text = currentLoadState.message, style = MaterialTheme.typography.bodyLarge)
                Button(onClick = { viewModel.playMediaFile(mediaFileId) }) {
                    Text(stringResource(R.string.player_retry))
                }
            }

            currentLoadState is PlayerLoadState.Loading || currentLoadState is PlayerLoadState.Idle -> CircularProgressIndicator()

            else -> {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { context ->
                        PlayerView(context).apply {
                            this.player = viewModel.player.rawPlayer
                            useController = true
                        }
                    },
                )
                if (playbackState.isBuffering) {
                    CircularProgressIndicator()
                }
            }
        }
    }
}
