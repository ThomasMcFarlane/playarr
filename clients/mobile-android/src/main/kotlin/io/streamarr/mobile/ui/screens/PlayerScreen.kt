package io.streamarr.mobile.ui.screens

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.media3.ui.PlayerView
import dagger.hilt.android.lifecycle.HiltViewModel
import io.streamarr.mobile.BuildConfig
import io.streamarr.mobile.R
import io.streamarr.shared.player.PlaybackState
import io.streamarr.shared.player.StreamarrPlayer
import javax.inject.Inject

@HiltViewModel
class PlayerViewModel @Inject constructor(
    val player: StreamarrPlayer,
) : ViewModel() {

    val state = player.state

    /**
     * Points the player at the direct-play stream for `mediaFileId`.
     * `/api/media-files/{id}/stream` is a placeholder path -- see the note
     * on `StreamarrApi`; once `streamarr-transcode`/`streamarr-api` ship
     * their real streaming endpoints this becomes a resolved
     * [io.streamarr.shared.data.model.Rendition] or direct-play URL
     * instead of a guessed path.
     */
    fun playMediaFile(mediaFileId: String) {
        player.prepare(mediaUrl = "${BuildConfig.STREAMARR_BASE_URL}api/media-files/$mediaFileId/stream")
        player.play()
    }

    override fun onCleared() {
        player.release()
    }
}

@Composable
fun PlayerScreen(
    mediaFileId: String?,
    modifier: Modifier = Modifier,
    viewModel: PlayerViewModel = hiltViewModel(),
) {
    val playbackState by viewModel.state.collectAsState()

    LaunchedEffect(mediaFileId) {
        if (mediaFileId != null) {
            viewModel.playMediaFile(mediaFileId)
        }
    }

    Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        if (mediaFileId == null) {
            Text(
                text = stringResource(R.string.player_no_media),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            StreamarrPlayerSurface(player = viewModel.player, playbackState = playbackState)
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
