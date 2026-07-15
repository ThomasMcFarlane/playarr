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
                is StreamarrResult.Failure -> WorkDetailUiState.Failure(result.error.toUserMessage())
            }
        }
    }
}

private fun StreamarrError.toUserMessage(): String = when (this) {
    is StreamarrError.Network -> "Can't reach the Streamarr server. Check the server address in Settings."
    is StreamarrError.Http -> if (code == 404) "This title couldn't be found." else "Server error ($code)."
    is StreamarrError.Unknown -> "Something went wrong loading this title."
}

/**
 * `GET /api/v1/catalog/{id}` -- a work plus its full kind-specific child
 * tree. [onPlayMediaFile] is called with what the tapped leaf's own `id`
 * is, standing in for a `media_file_id` (movies use the work's own `id`).
 * The real spec has no endpoint that maps a work/episode/track/book to the
 * `MediaFile` id `GET /api/v1/playback/{media_file_id}` actually expects,
 * so this is a best-effort assumption -- documented rather than silently
 * guessed -- until the catalog schema exposes real media-file identifiers.
 */
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
            is WorkDetailUiState.Content -> WorkDetailContent(detail = current.detail, onPlayMediaFile = onPlayMediaFile)
        }
    }
}

@Composable
private fun WorkDetailContent(detail: WorkDetail, onPlayMediaFile: (String) -> Unit) {
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
            WorkChildren.Movie -> item {
                Button(
                    onClick = { onPlayMediaFile(work.id) },
                    modifier = Modifier.padding(horizontal = 16.dp),
                ) {
                    Text(stringResource(R.string.work_detail_play))
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
                items(seasonDetail.episodes, key = { it.id }) { episode ->
                    ListItem(
                        headlineContent = { Text(episode.title ?: stringResource(R.string.work_detail_untitled)) },
                        supportingContent = { Text(stringResource(R.string.work_detail_episode_number, episode.episodeNumber)) },
                        modifier = Modifier.clickable { onPlayMediaFile(episode.id) },
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
                items(albumDetail.tracks, key = { it.id }) { track ->
                    ListItem(
                        headlineContent = { Text(track.title) },
                        supportingContent = { Text(stringResource(R.string.work_detail_track_number, track.trackNumber)) },
                        modifier = Modifier.clickable { onPlayMediaFile(track.id) },
                    )
                }
            }

            is WorkChildren.Author -> items(children.books, key = { it.id }) { book ->
                ListItem(
                    headlineContent = { Text(book.title) },
                    modifier = Modifier.clickable { onPlayMediaFile(book.id) },
                )
            }
        }
    }
}
