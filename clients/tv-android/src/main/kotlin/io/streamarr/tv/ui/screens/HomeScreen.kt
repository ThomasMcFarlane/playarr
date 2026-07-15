package io.streamarr.tv.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
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
import androidx.tv.material3.Card
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

/** See `mobile-android`'s `HomeScreen.kt` `HomeUiState` for why this isn't a bare `isLoading: Boolean` + list. */
sealed interface TvHomeUiState {
    data object Loading : TvHomeUiState
    data class Content(val works: List<Work>) : TvHomeUiState
    data class Failure(val message: String) : TvHomeUiState
}

@HiltViewModel
class TvHomeViewModel @Inject constructor(
    private val browseLibraryUseCase: BrowseLibraryUseCase,
) : ViewModel() {

    private val _uiState = MutableStateFlow<TvHomeUiState>(TvHomeUiState.Loading)
    val uiState: StateFlow<TvHomeUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            _uiState.value = when (val result = browseLibraryUseCase(sort = "recent")) {
                is StreamarrResult.Success -> TvHomeUiState.Content(result.value)
                is StreamarrResult.Failure -> TvHomeUiState.Failure(result.error.toUserMessage())
            }
        }
    }
}

private fun StreamarrError.toUserMessage(): String = when (this) {
    is StreamarrError.Network -> "Can't reach the Streamarr server. Check the server address in Settings."
    is StreamarrError.Http -> "Server error ($code)."
    is StreamarrError.Unknown -> "Something went wrong loading your library."
}

/** Home row of d-pad-focusable [Card]s -- the TV equivalent of mobile's `HomeScreen` poster shelf. */
@Composable
fun HomeScreen(
    onWorkClick: (Work) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: TvHomeViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    Column(modifier = modifier.fillMaxSize().padding(top = 32.dp)) {
        Text(
            text = stringResource(R.string.home_recently_added),
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.padding(horizontal = 48.dp, vertical = 16.dp),
        )

        when (val current = uiState) {
            is TvHomeUiState.Loading -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            is TvHomeUiState.Failure -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(text = current.message, style = MaterialTheme.typography.bodyLarge)
            }
            is TvHomeUiState.Content -> if (current.works.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(text = stringResource(R.string.home_empty_state), style = MaterialTheme.typography.bodyLarge)
                }
            } else {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 48.dp),
                    horizontalArrangement = Arrangement.spacedBy(20.dp),
                ) {
                    items(current.works, key = { it.id }) { work ->
                        TvPosterCard(work = work, onClick = { onWorkClick(work) })
                    }
                }
            }
        }
    }
}

@Composable
fun TvPosterCard(work: Work, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Card(
        onClick = onClick,
        modifier = modifier.width(160.dp),
    ) {
        Box(modifier = Modifier.aspectRatio(2f / 3f).fillMaxSize()) {
            Text(
                text = work.title,
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.align(Alignment.BottomStart).padding(8.dp),
            )
        }
    }
}
