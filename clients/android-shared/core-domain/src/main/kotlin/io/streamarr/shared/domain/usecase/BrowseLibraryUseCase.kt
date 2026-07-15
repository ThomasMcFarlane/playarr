package io.streamarr.shared.domain.usecase

import io.streamarr.shared.data.model.Work
import io.streamarr.shared.data.model.WorkKind
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.model.runCatchingStreamarr
import io.streamarr.shared.domain.repository.WorkRepository
import javax.inject.Inject

/** `GET /api/v1/catalog` -- the query behind Home/Library grids, optionally narrowed/sorted. */
class BrowseLibraryUseCase @Inject constructor(
    private val workRepository: WorkRepository,
) {
    suspend operator fun invoke(
        kind: WorkKind? = null,
        genre: String? = null,
        tag: String? = null,
        sort: String? = null,
        limit: Long? = null,
        offset: Long? = null,
    ): StreamarrResult<List<Work>> = runCatchingStreamarr {
        workRepository.browseCatalog(kind = kind, genre = genre, tag = tag, sort = sort, limit = limit, offset = offset).items
    }
}
