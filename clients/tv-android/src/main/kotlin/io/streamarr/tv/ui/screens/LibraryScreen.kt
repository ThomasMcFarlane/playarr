package io.streamarr.tv.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.streamarr.shared.data.model.Work
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.usecase.BrowseLibraryUseCase
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

@HiltViewModel
class TvLibraryViewModel @Inject constructor(
    private val browseLibraryUseCase: BrowseLibraryUseCase,
) : ViewModel() {

    private val _works = MutableStateFlow<List<Work>>(emptyList())
    val works: StateFlow<List<Work>> = _works.asStateFlow()

    init {
        viewModelScope.launch {
            when (val result = browseLibraryUseCase()) {
                is StreamarrResult.Success -> _works.value = result.value
                is StreamarrResult.Failure -> _works.value = emptyList()
            }
        }
    }
}

/** Full-catalog grid of d-pad-focusable [TvPosterCard]s. */
@Composable
fun LibraryScreen(
    onWorkClick: (Work) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: TvLibraryViewModel = hiltViewModel(),
) {
    val works by viewModel.works.collectAsState()

    LazyVerticalGrid(
        columns = GridCells.Adaptive(minSize = 160.dp),
        contentPadding = PaddingValues(48.dp),
        horizontalArrangement = Arrangement.spacedBy(20.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
        modifier = modifier.fillMaxSize(),
    ) {
        items(works, key = { it.id }) { work ->
            TvPosterCard(work = work, onClick = { onWorkClick(work) })
        }
    }
}
