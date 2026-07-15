package io.streamarr.mobile.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import io.streamarr.shared.data.model.WorkKind
import io.streamarr.shared.designsystem.component.PosterCard
import io.streamarr.shared.domain.model.StreamarrError
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.usecase.BrowseLibraryUseCase
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** See `HomeScreen.kt`'s `HomeUiState` for why this isn't a bare `isLoading: Boolean` + list. */
sealed interface LibraryUiState {
    data object Loading : LibraryUiState
    data class Content(val works: List<Work>) : LibraryUiState
    data class Failure(val message: String) : LibraryUiState
}

@HiltViewModel
class LibraryViewModel @Inject constructor(
    private val browseLibraryUseCase: BrowseLibraryUseCase,
) : ViewModel() {

    private val _uiState = MutableStateFlow<LibraryUiState>(LibraryUiState.Loading)
    val uiState: StateFlow<LibraryUiState> = _uiState.asStateFlow()

    fun load(kind: WorkKind?) {
        viewModelScope.launch {
            _uiState.value = LibraryUiState.Loading
            _uiState.value = when (val result = browseLibraryUseCase(kind = kind)) {
                is StreamarrResult.Success -> LibraryUiState.Content(result.value)
                is StreamarrResult.Failure -> LibraryUiState.Failure(result.error.toUserMessage())
            }
        }
    }

    init {
        load(kind = null)
    }
}

private fun StreamarrError.toUserMessage(): String = when (this) {
    is StreamarrError.Network -> "Can't reach the Streamarr server. Check the server address in Settings."
    is StreamarrError.Http -> "Server error ($code)."
    is StreamarrError.Unknown -> "Something went wrong loading your library."
}

@Composable
fun LibraryScreen(
    onWorkClick: (Work) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: LibraryViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    var selectedKind by remember { mutableStateOf<WorkKind?>(null) }
    val filters: List<WorkKind?> = remember { listOf(null) + WorkKind.entries }

    Column(modifier = modifier.fillMaxSize()) {
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(filters) { kind ->
                FilterChip(
                    selected = selectedKind == kind,
                    onClick = {
                        selectedKind = kind
                        viewModel.load(kind)
                    },
                    label = { Text(kind?.name ?: stringResource(R.string.library_all_works)) },
                )
            }
        }

        when (val current = uiState) {
            is LibraryUiState.Loading -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            is LibraryUiState.Failure -> Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                Text(
                    text = current.message,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            is LibraryUiState.Content -> if (current.works.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                    Text(
                        text = stringResource(R.string.home_empty_state),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(minSize = 110.dp),
                    contentPadding = PaddingValues(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(current.works, key = { it.id }) { work ->
                        PosterCard(
                            title = work.title,
                            imageUrl = work.images.firstOrNull { it.kind == ImageKind.Poster }?.url,
                            onClick = { onWorkClick(work) },
                        )
                    }
                }
            }
        }
    }
}
