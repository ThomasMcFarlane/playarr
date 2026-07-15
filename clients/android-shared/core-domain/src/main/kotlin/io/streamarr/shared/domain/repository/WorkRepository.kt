package io.streamarr.shared.domain.repository

import io.streamarr.shared.data.model.Episode
import io.streamarr.shared.data.model.MediaFile
import io.streamarr.shared.data.model.Season
import io.streamarr.shared.data.model.Work
import io.streamarr.shared.data.model.WorkKind
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
 * pass-through to [StreamarrApi].
 */
interface WorkRepository {
    suspend fun listWorks(kind: WorkKind? = null): List<Work>
    suspend fun getWork(workId: String): Work
    suspend fun listSeasons(workId: String): List<Season>
    suspend fun listEpisodes(seasonId: String): List<Episode>
    suspend fun listMediaFiles(workId: String): List<MediaFile>
}

class DefaultWorkRepository @Inject constructor(
    private val api: StreamarrApi,
) : WorkRepository {

    override suspend fun listWorks(kind: WorkKind?): List<Work> =
        api.listWorks(kind = kind?.name?.lowercase()).items

    override suspend fun getWork(workId: String): Work =
        api.getWork(workId)

    override suspend fun listSeasons(workId: String): List<Season> =
        api.listSeasons(workId)

    override suspend fun listEpisodes(seasonId: String): List<Episode> =
        api.listEpisodes(seasonId)

    override suspend fun listMediaFiles(workId: String): List<MediaFile> =
        api.listMediaFiles(workId)
}
