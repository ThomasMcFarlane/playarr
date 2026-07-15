package io.streamarr.tv.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import dagger.hilt.android.lifecycle.HiltViewModel
import io.streamarr.shared.data.model.Work
import io.streamarr.shared.domain.model.StreamarrError
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.usecase.BrowseLibraryUseCase
import io.streamarr.tv.R
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** See `HomeScreen.kt`'s `TvHomeUiState` for why this isn't a bare `isLoading: Boolean` + list. */
sealed interface TvLibraryUiState {
    data object Loading : TvLibraryUiState
    data class Content(val works: List<Work>) : TvLibraryUiState
    data class Failure(val message: String) : TvLibraryUiState
}

@HiltViewModel
class TvLibraryViewModel @Inject constructor(
    private val browseLibraryUseCase: BrowseLibraryUseCase,
) : ViewModel() {

    private val _uiState = MutableStateFlow<TvLibraryUiState>(TvLibraryUiState.Loading)
    val uiState: StateFlow<TvLibraryUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            _uiState.value = when (val result = browseLibraryUseCase()) {
                is StreamarrResult.Success -> TvLibraryUiState.Content(result.value)
                is StreamarrResult.Failure -> TvLibraryUiState.Failure(result.error.toUserMessage())
            }
        }
    }
}

private fun StreamarrError.toUserMessage(): String = when (this) {
    is StreamarrError.Network -> "Can't reach the Streamarr server. Check the server address in Settings."
    is StreamarrError.Http -> "Server error ($code)."
    is StreamarrError.Unknown -> "Something went wrong loading your library."
}

/** Full-catalog grid of d-pad-focusable [TvPosterCard]s. */
@Composable
fun LibraryScreen(
    onWorkClick: (Work) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: TvLibraryViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    when (val current = uiState) {
        is TvLibraryUiState.Loading -> Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        is TvLibraryUiState.Failure -> Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(text = current.message, style = MaterialTheme.typography.bodyLarge)
        }
        is TvLibraryUiState.Content -> if (current.works.isEmpty()) {
            Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(text = stringResource(R.string.home_empty_state), style = MaterialTheme.typography.bodyLarge)
            }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 160.dp),
                contentPadding = PaddingValues(48.dp),
                horizontalArrangement = Arrangement.spacedBy(20.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
                modifier = modifier.fillMaxSize(),
            ) {
                items(current.works, key = { it.id }) { work ->
                    TvPosterCard(work = work, onClick = { onWorkClick(work) })
                }
            }
        }
    }
}
