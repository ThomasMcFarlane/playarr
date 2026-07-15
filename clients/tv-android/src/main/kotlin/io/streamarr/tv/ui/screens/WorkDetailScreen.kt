package io.streamarr.tv.ui.screens

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.tv.material3.Button
import androidx.tv.material3.ListItem
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import dagger.hilt.android.lifecycle.HiltViewModel
import io.streamarr.shared.data.model.Availability
import io.streamarr.shared.data.model.RequestTarget
import io.streamarr.shared.data.model.Work
import io.streamarr.shared.data.model.WorkChildren
import io.streamarr.shared.data.model.WorkDetail
import io.streamarr.shared.domain.model.StreamarrError
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.usecase.GetWorkDetailsUseCase
import io.streamarr.shared.domain.usecase.SubmitMediaRequestUseCase
import io.streamarr.tv.R
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface TvWorkDetailUiState {
    data object Loading : TvWorkDetailUiState
    data class Content(val detail: WorkDetail) : TvWorkDetailUiState
    data class Failure(val message: String) : TvWorkDetailUiState
}

/** Mirrors `mobile-android`'s `RequestActionState` -- local state for the "Request" action, independent of [TvWorkDetailUiState] (the detail load). */
sealed interface TvRequestActionState {
    data object Idle : TvRequestActionState
    data object Submitting : TvRequestActionState
    data object Submitted : TvRequestActionState
    data class Failed(val message: String) : TvRequestActionState
}

@HiltViewModel
class TvWorkDetailViewModel @Inject constructor(
    private val getWorkDetailsUseCase: GetWorkDetailsUseCase,
    private val submitMediaRequestUseCase: SubmitMediaRequestUseCase,
) : ViewModel() {

    private val _uiState = MutableStateFlow<TvWorkDetailUiState>(TvWorkDetailUiState.Loading)
    val uiState: StateFlow<TvWorkDetailUiState> = _uiState.asStateFlow()

    private val _requestState = MutableStateFlow<TvRequestActionState>(TvRequestActionState.Idle)
    val requestState: StateFlow<TvRequestActionState> = _requestState.asStateFlow()

    fun load(workId: String) {
        viewModelScope.launch {
            _uiState.value = TvWorkDetailUiState.Loading
            _requestState.value = TvRequestActionState.Idle
            _uiState.value = when (val result = getWorkDetailsUseCase(workId)) {
                is StreamarrResult.Success -> TvWorkDetailUiState.Content(result.value)
                is StreamarrResult.Failure -> TvWorkDetailUiState.Failure(result.error.toWorkDetailErrorMessage())
            }
        }
    }

    /**
     * No longer needs a locally-read user id: the submitting user is
     * derived server-side from the verified access token
     * `StreamarrHttpClient` attaches -- see [SubmitMediaRequestUseCase]'s
     * KDoc.
     */
    fun requestWork(work: Work) {
        viewModelScope.launch {
            _requestState.value = TvRequestActionState.Submitting
            _requestState.value = when (
                val result = submitMediaRequestUseCase(kind = work.kind, target = RequestTarget.ExistingWork(work.id))
            ) {
                is StreamarrResult.Success -> TvRequestActionState.Submitted
                is StreamarrResult.Failure -> TvRequestActionState.Failed(result.error.toWorkDetailErrorMessage())
            }
        }
    }
}

/** `internal` (rather than `private`) so this module's unit tests can exercise the 401/403 mapping directly. */
internal fun StreamarrError.toWorkDetailErrorMessage(): String = when (this) {
    is StreamarrError.Network -> "Can't reach the Streamarr server. Check the server address in Settings."
    is StreamarrError.Http -> when (code) {
        401 -> "Sign in again to submit a request."
        403 -> "You don't have permission to do that."
        404 -> "This title couldn't be found."
        else -> "Server error ($code)."
    }
    is StreamarrError.Unknown -> "Something went wrong loading this title."
}

/** Mirrors `mobile-android`'s `WorkDetailScreen.kt` -- see that file's KDoc for when the play affordance and Request action show. */
@Composable
fun WorkDetailScreen(
    workId: String,
    onPlayMediaFile: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: TvWorkDetailViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val requestState by viewModel.requestState.collectAsState()

    LaunchedEffect(workId) { viewModel.load(workId) }

    Box(modifier = modifier.fillMaxSize()) {
        when (val current = uiState) {
            is TvWorkDetailUiState.Loading -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            is TvWorkDetailUiState.Failure -> Box(modifier = Modifier.fillMaxSize().padding(48.dp), contentAlignment = Alignment.Center) {
                Text(text = current.message, style = MaterialTheme.typography.bodyLarge)
            }
            is TvWorkDetailUiState.Content -> TvWorkDetailContent(
                detail = current.detail,
                requestState = requestState,
                onPlayMediaFile = onPlayMediaFile,
                onRequestWork = { viewModel.requestWork(current.detail.work) },
            )
        }
    }
}

@Composable
private fun TvWorkDetailContent(
    detail: WorkDetail,
    requestState: TvRequestActionState,
    onPlayMediaFile: (String) -> Unit,
    onRequestWork: () -> Unit,
) {
    val work = detail.work

    LazyColumn(modifier = Modifier.fillMaxSize()) {
        item {
            Column(modifier = Modifier.padding(48.dp, 32.dp, 48.dp, 16.dp)) {
                Text(text = work.title, style = MaterialTheme.typography.headlineMedium)
                work.overview?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }
        }

        if (work.availability != Availability.Available) {
            item {
                TvRequestActionRow(requestState = requestState, onRequestWork = onRequestWork, modifier = Modifier.padding(horizontal = 48.dp, vertical = 8.dp))
            }
        }

        when (val children = detail.children) {
            WorkChildren.Movie -> {
                val mediaFileId = detail.mediaFileId
                if (mediaFileId != null) {
                    item {
                        Button(onClick = { onPlayMediaFile(mediaFileId) }, modifier = Modifier.padding(horizontal = 48.dp)) {
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
                        modifier = Modifier.padding(horizontal = 48.dp, vertical = 8.dp),
                    )
                }
                items(seasonDetail.episodes, key = { it.episode.id }) { episodeDetail ->
                    val mediaFileId = episodeDetail.mediaFileId
                    val episode = episodeDetail.episode
                    ListItem(
                        selected = false,
                        onClick = { if (mediaFileId != null) onPlayMediaFile(mediaFileId) },
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
                        modifier = Modifier.padding(horizontal = 48.dp),
                    )
                }
            }

            is WorkChildren.Artist -> children.albums.forEach { albumDetail ->
                item {
                    Text(
                        text = albumDetail.album.title,
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(horizontal = 48.dp, vertical = 8.dp),
                    )
                }
                items(albumDetail.tracks, key = { it.track.id }) { trackDetail ->
                    val mediaFileId = trackDetail.mediaFileId
                    val track = trackDetail.track
                    ListItem(
                        selected = false,
                        onClick = { if (mediaFileId != null) onPlayMediaFile(mediaFileId) },
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
                        modifier = Modifier.padding(horizontal = 48.dp),
                    )
                }
            }

            is WorkChildren.Author -> items(children.books, key = { it.book.id }) { bookDetail ->
                val mediaFileId = bookDetail.mediaFileId
                ListItem(
                    selected = false,
                    onClick = { if (mediaFileId != null) onPlayMediaFile(mediaFileId) },
                    headlineContent = { Text(bookDetail.book.title) },
                    supportingContent = if (mediaFileId == null) {
                        { Text(stringResource(R.string.work_detail_not_available)) }
                    } else {
                        null
                    },
                    modifier = Modifier.padding(horizontal = 48.dp),
                )
            }
        }
    }
}

@Composable
private fun TvRequestActionRow(requestState: TvRequestActionState, onRequestWork: () -> Unit, modifier: Modifier = Modifier) {
    Column(modifier = modifier) {
        when (requestState) {
            is TvRequestActionState.Idle -> Button(onClick = onRequestWork) { Text(stringResource(R.string.work_detail_request)) }
            is TvRequestActionState.Submitting -> Button(onClick = {}, enabled = false) { Text(stringResource(R.string.work_detail_requesting)) }
            is TvRequestActionState.Submitted -> Text(
                text = stringResource(R.string.work_detail_request_submitted),
                style = MaterialTheme.typography.bodyMedium,
            )
            is TvRequestActionState.Failed -> Column {
                Text(text = requestState.message, style = MaterialTheme.typography.bodySmall)
                Button(onClick = onRequestWork, modifier = Modifier.padding(top = 4.dp)) { Text(stringResource(R.string.work_detail_request)) }
            }
        }
    }
}
