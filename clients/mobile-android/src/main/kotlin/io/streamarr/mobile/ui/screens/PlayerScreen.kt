package io.streamarr.mobile.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import dagger.hilt.android.lifecycle.HiltViewModel
import io.streamarr.mobile.R
import io.streamarr.shared.data.model.PlaybackMode
import io.streamarr.shared.domain.model.StreamarrError
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.usecase.GetPlaybackInfoUseCase
import io.streamarr.shared.player.PlaybackState
import io.streamarr.shared.player.StreamFormat
import io.streamarr.shared.player.StreamarrPlayer
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Where [PlayerViewModel] is in resolving+configuring playback for a `mediaFileId`, independent of [PlaybackState] (ExoPlayer's own live state, only meaningful once [Ready] is reached). */
sealed interface PlayerLoadState {
    data object Idle : PlayerLoadState
    data object Loading : PlayerLoadState
    data object Ready : PlayerLoadState
    data class Error(val message: String) : PlayerLoadState
}

@HiltViewModel
class PlayerViewModel @Inject constructor(
    val player: StreamarrPlayer,
    private val getPlaybackInfoUseCase: GetPlaybackInfoUseCase,
) : ViewModel() {

    val state = player.state

    private val _loadState = MutableStateFlow<PlayerLoadState>(PlayerLoadState.Idle)
    val loadState: StateFlow<PlayerLoadState> = _loadState.asStateFlow()

    /**
     * Resolves direct-play vs. HLS via `GET /api/v1/playback/{media_file_id}`
     * *first*, then configures [StreamarrPlayer] with whichever of
     * `mode`/`url` the server decided on -- real decision branching, not a
     * guessed streaming path.
     */
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
    viewModel: PlayerViewModel = hiltViewModel(),
) {
    val playbackState by viewModel.state.collectAsState()
    val loadState by viewModel.loadState.collectAsState()

    LaunchedEffect(mediaFileId) {
        if (mediaFileId != null) {
            viewModel.playMediaFile(mediaFileId)
        }
    }

    Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        val currentLoadState = loadState
        when {
            mediaFileId == null -> Text(
                text = stringResource(R.string.player_no_media),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            currentLoadState is PlayerLoadState.Error -> Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.padding(24.dp),
            ) {
                Text(
                    text = currentLoadState.message,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.error,
                )
                Button(onClick = { viewModel.playMediaFile(mediaFileId) }) {
                    Text(stringResource(R.string.player_retry))
                }
            }

            currentLoadState is PlayerLoadState.Loading || currentLoadState is PlayerLoadState.Idle -> CircularProgressIndicator()

            else -> StreamarrPlayerSurface(player = viewModel.player, playbackState = playbackState)
        }
    }
}

@Composable
private fun StreamarrPlayerSurface(player: StreamarrPlayer, playbackState: PlaybackState) {
    Box(modifier = Modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { context ->
                PlayerView(context).apply {
                    this.player = player.rawPlayer
                    useController = true
                }
            },
        )
        if (playbackState.isBuffering) {
            CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
        }
    }
    DisposableEffect(Unit) {
        onDispose { /* Player lifetime is owned by PlayerViewModel.onCleared(), not this composable. */ }
    }
}
