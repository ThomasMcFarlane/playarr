package io.streamarr.shared.domain.repository

import io.streamarr.shared.data.model.CatalogPage
import io.streamarr.shared.data.model.Work
import io.streamarr.shared.data.model.WorkDetail
import io.streamarr.shared.data.model.WorkKind
import io.streamarr.shared.data.model.wireName
import io.streamarr.shared.data.remote.StreamarrApi
import javax.inject.Inject

/**
 * Catalog access, independent of how it's transported.
 *
 * This is declared as an interface (rather than just calling
 * [StreamarrApi] straight from use cases) so screens and use cases can be
 * unit-tested against a fake, and so a future offline-cache-backed
 * implementation can be swapped in via DI without touching any call site.
 * [DefaultWorkRepository] is the only implementation today; it is a thin
 * pass-through to [StreamarrApi]'s `catalog`-tagged endpoints.
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
    private val api: StreamarrApi,
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
        api.searchCatalog(query = query, limit = limit)

    override suspend fun getWork(workId: String): WorkDetail =
        api.getWork(workId)
}
