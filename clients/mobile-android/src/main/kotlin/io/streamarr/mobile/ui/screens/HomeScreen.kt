package io.streamarr.mobile.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import dagger.hilt.android.lifecycle.HiltViewModel
import io.streamarr.mobile.R
import io.streamarr.shared.data.model.ImageKind
import io.streamarr.shared.data.model.Work
import io.streamarr.shared.designsystem.component.PosterCard
import io.streamarr.shared.designsystem.component.SectionHeader
import io.streamarr.shared.domain.model.StreamarrError
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.usecase.BrowseLibraryUseCase
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * `GET /api/v1/catalog` result, distinguishing "still loading" / "loaded
 * (possibly empty)" / "call failed". Unlike the Wave-1 placeholder's bare
 * `isLoading: Boolean` + list, a [Failure] no longer silently collapses
 * into the same "empty shelf" UI as a genuinely empty catalog.
 */
sealed interface HomeUiState {
    data object Loading : HomeUiState
    data class Content(val works: List<Work>) : HomeUiState
    data class Failure(val message: String) : HomeUiState
}

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val browseLibraryUseCase: BrowseLibraryUseCase,
) : ViewModel() {

    private val _uiState = MutableStateFlow<HomeUiState>(HomeUiState.Loading)
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = HomeUiState.Loading
            // sort=recent: this shelf is "Recently Added", not the server's default title sort.
            _uiState.value = when (val result = browseLibraryUseCase(sort = "recent")) {
                is StreamarrResult.Success -> HomeUiState.Content(result.value)
                is StreamarrResult.Failure -> HomeUiState.Failure(result.error.toUserMessage())
            }
        }
    }
}

private fun StreamarrError.toUserMessage(): String = when (this) {
    is StreamarrError.Network -> "Can't reach the Streamarr server. Check the server address in Settings."
    is StreamarrError.Http -> "Server error ($code)."
    is StreamarrError.Unknown -> "Something went wrong loading your library."
}

@Composable
fun HomeScreen(
    onWorkClick: (Work) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    Column(modifier = modifier.fillMaxSize()) {
        SectionHeader(title = stringResource(R.string.home_recently_added))

        when (val current = uiState) {
            is HomeUiState.Loading -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            is HomeUiState.Failure -> Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                Text(
                    text = current.message,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            is HomeUiState.Content -> if (current.works.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                    Text(
                        text = stringResource(R.string.home_empty_state),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(current.works, key = { it.id }) { work ->
                        PosterCard(
                            title = work.title,
                            imageUrl = work.images.firstOrNull { it.kind == ImageKind.Poster }?.url,
                            onClick = { onWorkClick(work) },
                            modifier = Modifier.width(120.dp),
                        )
                    }
                }
            }
        }
    }
}
