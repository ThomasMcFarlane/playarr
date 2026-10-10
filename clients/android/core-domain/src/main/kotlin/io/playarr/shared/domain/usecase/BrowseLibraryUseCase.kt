package io.playarr.shared.domain.usecase

import io.playarr.shared.data.model.Work
import io.playarr.shared.data.model.WorkKind
import io.playarr.shared.domain.model.PlayarrResult
import io.playarr.shared.domain.model.runCatchingPlayarr
import io.playarr.shared.domain.repository.WorkRepository
import javax.inject.Inject

/** `GET /api/v1/catalog` -- the query behind Home/Library grids, optionally narrowed/sorted. */
class BrowseLibraryUseCase @Inject constructor(
    private val workRepository: WorkRepository,
) {
    suspend operator fun invoke(
        kind: WorkKind? = null,
        availableOnly: Boolean? = null,
        genre: String? = null,
        tag: String? = null,
        sort: String? = null,
        limit: Long? = null,
        offset: Long? = null,
    ): PlayarrResult<List<Work>> = runCatchingPlayarr {
        workRepository.browseCatalog(
            kind = kind,
            availableOnly = availableOnly,
            genre = genre,
            tag = tag,
            sort = sort,
            limit = limit,
            offset = offset,
        ).items
    }
}
