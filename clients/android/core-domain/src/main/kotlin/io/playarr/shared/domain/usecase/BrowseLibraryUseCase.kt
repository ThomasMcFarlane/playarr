package io.playarr.shared.domain.usecase

import io.playarr.shared.data.model.CatalogPage
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
        browse(kind, availableOnly, genre, tag, sort, limit, offset).items
    }

    /** The same query, keeping the server's `total` (the library header shows it before every page has loaded). */
    suspend fun page(
        kind: WorkKind? = null,
        availableOnly: Boolean? = null,
        sort: String? = null,
        limit: Long? = null,
        offset: Long? = null,
    ): PlayarrResult<CatalogPage> = runCatchingPlayarr {
        browse(kind, availableOnly, null, null, sort, limit, offset)
    }

    private suspend fun browse(
        kind: WorkKind?,
        availableOnly: Boolean?,
        genre: String?,
        tag: String?,
        sort: String?,
        limit: Long?,
        offset: Long?,
    ): CatalogPage =
        workRepository.browseCatalog(
            kind = kind,
            availableOnly = availableOnly,
            genre = genre,
            tag = tag,
            sort = sort,
            limit = limit,
            offset = offset,
        )
}
