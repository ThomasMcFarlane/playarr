package io.streamarr.tv.ui.screens

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
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
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import dagger.hilt.android.lifecycle.HiltViewModel
import io.streamarr.shared.player.StreamarrPlayer
import io.streamarr.tv.BuildConfig
import io.streamarr.tv.R
import javax.inject.Inject

/** Mirrors `mobile-android`'s `PlayerViewModel` -- see that file for the direct-play-URL caveat. */
@HiltViewModel
class TvPlayerViewModel @Inject constructor(
    val player: StreamarrPlayer,
) : ViewModel() {

    val state = player.state

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
    viewModel: TvPlayerViewModel = hiltViewModel(),
) {
    val playbackState by viewModel.state.collectAsState()

    LaunchedEffect(mediaFileId) {
        if (mediaFileId != null) viewModel.playMediaFile(mediaFileId)
    }

    Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        if (mediaFileId == null) {
            Text(text = stringResource(R.string.player_no_media), style = MaterialTheme.typography.bodyLarge)
        } else {
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
