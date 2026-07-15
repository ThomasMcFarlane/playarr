package io.streamarr.shared.domain.usecase

import io.streamarr.shared.data.model.Work
import io.streamarr.shared.data.model.WorkKind
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.model.runCatchingStreamarr
import io.streamarr.shared.domain.repository.WorkRepository
import javax.inject.Inject

/** Lists the catalog, optionally narrowed to one [WorkKind] -- the query behind Home/Library grids. */
class BrowseLibraryUseCase @Inject constructor(
    private val workRepository: WorkRepository,
) {
    suspend operator fun invoke(kind: WorkKind? = null): StreamarrResult<List<Work>> = runCatchingStreamarr {
        workRepository.listWorks(kind)
    }
}
