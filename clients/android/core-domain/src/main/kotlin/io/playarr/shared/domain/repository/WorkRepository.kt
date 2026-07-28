package io.playarr.shared.domain.repository

import io.playarr.shared.data.model.CatalogPage
import io.playarr.shared.data.model.Work
import io.playarr.shared.data.model.WorkDetail
import io.playarr.shared.data.model.WorkKind
import io.playarr.shared.data.model.wireName
import io.playarr.shared.data.remote.PlayarrApi
import javax.inject.Inject

/**
 * Catalog access, independent of how it's transported.
 *
 * This is declared as an interface (rather than just calling
 * [PlayarrApi] straight from use cases) so screens and use cases can be
 * unit-tested against a fake, and so a future offline-cache-backed
 * implementation can be swapped in via DI without touching any call site.
 * [DefaultWorkRepository] is the only implementation today; it is a thin
 * pass-through to [PlayarrApi]'s `catalog`-tagged endpoints.
 */
interface WorkRepository {
    /** `GET /api/v1/catalog`. */
    suspend fun browseCatalog(
        kind: WorkKind? = null,
        availableOnly: Boolean? = null,
        genre: String? = null,
        tag: String? = null,
        sort: String? = null,
        limit: Long? = null,
        offset: Long? = null,
    ): CatalogPage

    suspend fun listCatalogKinds(): List<WorkKind>

    /** `GET /api/v1/catalog/search`. */
    suspend fun searchCatalog(query: String, limit: Long? = null): List<Work>

    /** `GET /api/v1/catalog/{id}` -- the work plus its full kind-specific child tree. */
    suspend fun getWork(workId: String): WorkDetail
}

class DefaultWorkRepository @Inject constructor(
    private val api: PlayarrApi,
) : WorkRepository {

    override suspend fun browseCatalog(
        kind: WorkKind?,
        availableOnly: Boolean?,
        genre: String?,
        tag: String?,
        sort: String?,
        limit: Long?,
        offset: Long?,
    ): CatalogPage = api.browseCatalog(
        kind = kind?.wireName(),
        availableOnly = availableOnly,
        genre = genre,
        tag = tag,
        sort = sort,
        limit = limit,
        offset = offset,
    )

    override suspend fun listCatalogKinds(): List<WorkKind> = api.listCatalogKinds()

    override suspend fun searchCatalog(query: String, limit: Long?): List<Work> =
        api.searchCatalog(query = query, limit = limit).items

    override suspend fun getWork(workId: String): WorkDetail =
        api.getWork(workId)
}
