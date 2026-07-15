package io.streamarr.mobile.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import io.streamarr.mobile.R
import io.streamarr.shared.data.model.WorkChildren
import io.streamarr.shared.data.model.WorkDetail
import io.streamarr.shared.domain.model.StreamarrError
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.usecase.GetWorkDetailsUseCase
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface WorkDetailUiState {
    data object Loading : WorkDetailUiState
    data class Content(val detail: WorkDetail) : WorkDetailUiState
    data class Failure(val message: String) : WorkDetailUiState
}

@HiltViewModel
class WorkDetailViewModel @Inject constructor(
    private val getWorkDetailsUseCase: GetWorkDetailsUseCase,
) : ViewModel() {

    private val _uiState = MutableStateFlow<WorkDetailUiState>(WorkDetailUiState.Loading)
    val uiState: StateFlow<WorkDetailUiState> = _uiState.asStateFlow()

    fun load(workId: String) {
        viewModelScope.launch {
            _uiState.value = WorkDetailUiState.Loading
            _uiState.value = when (val result = getWorkDetailsUseCase(workId)) {
                is StreamarrResult.Success -> WorkDetailUiState.Content(result.value)
                is StreamarrResult.Failure -> WorkDetailUiState.Failure(result.error.toWorkDetailErrorMessage())
            }
        }
    }
}

/** `internal` (rather than `private`) so this module's unit tests can exercise the 401/403 mapping directly. */
internal fun StreamarrError.toWorkDetailErrorMessage(): String = when (this) {
    is StreamarrError.Network -> "Can't reach the Streamarr server. Check the server address in Settings."
    is StreamarrError.Http -> when (code) {
        401 -> "Sign in again to continue."
        403 -> "You don't have permission to do that."
        404 -> "This title couldn't be found."
        else -> "Server error ($code)."
    }
    is StreamarrError.Unknown -> "Something went wrong loading this title."
}

/** `GET /api/v1/catalog/{id}` -- a work plus its full kind-specific child tree. */
@Composable
fun WorkDetailScreen(
    workId: String,
    onPlayMediaFile: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: WorkDetailViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(workId) { viewModel.load(workId) }

    Box(modifier = modifier.fillMaxSize()) {
        when (val current = uiState) {
            is WorkDetailUiState.Loading -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            is WorkDetailUiState.Failure -> Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                Text(
                    text = current.message,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            is WorkDetailUiState.Content -> WorkDetailContent(
                detail = current.detail,
                onPlayMediaFile = onPlayMediaFile,
            )
        }
    }
}

/**
 * [onPlayMediaFile] is called with the real, server-resolved `media_file_id`
 * for whichever leaf was tapped (`WorkDetailSchema.media_file_id` for a
 * movie; the sibling `media_file_id` on `EpisodeDetailSchema`/
 * `TrackDetailSchema`/`BookDetailSchema` for series/artist/author children).
 * A leaf with no resolved file yet (`media_file_id == null` -- nothing has
 * synced for it) renders without a play affordance rather than navigating
 * to the Player screen with nothing to play.
 */
@Composable
private fun WorkDetailContent(
    detail: WorkDetail,
    onPlayMediaFile: (String) -> Unit,
) {
    val work = detail.work

    LazyColumn(modifier = Modifier.fillMaxSize()) {
        item {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(text = work.title, style = MaterialTheme.typography.headlineSmall)
                work.overview?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }
        }

        when (val children = detail.children) {
            WorkChildren.Movie -> {
                val mediaFileId = detail.mediaFileId
                if (mediaFileId != null) {
                    item {
                        Button(
                            onClick = { onPlayMediaFile(mediaFileId) },
                            modifier = Modifier.padding(horizontal = 16.dp),
                        ) {
                            Text(stringResource(R.string.work_detail_play))
                        }
                    }
                }
            }

            is WorkChildren.Series -> children.seasons.forEach { seasonDetail ->
                item {
                    Text(
                        text = stringResource(R.string.work_detail_season, seasonDetail.season.seasonNumber),
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                }
                items(seasonDetail.episodes, key = { it.episode.id }) { episodeDetail ->
                    val mediaFileId = episodeDetail.mediaFileId
                    val episode = episodeDetail.episode
                    ListItem(
                        headlineContent = { Text(episode.title ?: stringResource(R.string.work_detail_untitled)) },
                        supportingContent = {
                            Text(
                                if (mediaFileId != null) {
                                    stringResource(R.string.work_detail_episode_number, episode.episodeNumber)
                                } else {
                                    stringResource(R.string.work_detail_not_available)
                                },
                            )
                        },
                        modifier = if (mediaFileId != null) Modifier.clickable { onPlayMediaFile(mediaFileId) } else Modifier,
                    )
                }
            }

            is WorkChildren.Artist -> children.albums.forEach { albumDetail ->
                item {
                    Text(
                        text = albumDetail.album.title,
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                }
                items(albumDetail.tracks, key = { it.track.id }) { trackDetail ->
                    val mediaFileId = trackDetail.mediaFileId
                    val track = trackDetail.track
                    ListItem(
                        headlineContent = { Text(track.title) },
                        supportingContent = {
                            Text(
                                if (mediaFileId != null) {
                                    stringResource(R.string.work_detail_track_number, track.trackNumber)
                                } else {
                                    stringResource(R.string.work_detail_not_available)
                                },
                            )
                        },
                        modifier = if (mediaFileId != null) Modifier.clickable { onPlayMediaFile(mediaFileId) } else Modifier,
                    )
                }
            }

            is WorkChildren.Author -> items(children.books, key = { it.book.id }) { bookDetail ->
                val mediaFileId = bookDetail.mediaFileId
                ListItem(
                    headlineContent = { Text(bookDetail.book.title) },
                    supportingContent = if (mediaFileId == null) {
                        { Text(stringResource(R.string.work_detail_not_available)) }
                    } else {
                        null
                    },
                    modifier = if (mediaFileId != null) Modifier.clickable { onPlayMediaFile(mediaFileId) } else Modifier,
                )
            }
        }
    }
}
