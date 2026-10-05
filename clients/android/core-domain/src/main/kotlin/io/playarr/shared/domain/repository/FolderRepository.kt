package io.playarr.shared.domain.repository

import io.playarr.shared.data.model.FolderBrowseResponse
import io.playarr.shared.data.model.FolderRoot
import io.playarr.shared.data.remote.PlayarrApi
import javax.inject.Inject

/** Unsorted folders: the roots an administrator enabled and one directory level of each. */
interface FolderRepository {
    suspend fun roots(kind: String? = null): List<FolderRoot>

    suspend fun browse(
        rootId: String,
        path: String,
        query: String,
        sort: String,
        order: String,
        type: String,
        limit: Int,
        offset: Int,
    ): FolderBrowseResponse
}

class DefaultFolderRepository @Inject constructor(
    private val api: PlayarrApi,
) : FolderRepository {
    override suspend fun roots(kind: String?): List<FolderRoot> = api.listFolderRoots(kind).roots

    override suspend fun browse(
        rootId: String,
        path: String,
        query: String,
        sort: String,
        order: String,
        type: String,
        limit: Int,
        offset: Int,
    ): FolderBrowseResponse = api.browseFolder(
        rootId = rootId,
        path = path.ifEmpty { null },
        q = query.ifEmpty { null },
        sort = sort,
        order = order,
        type = type,
        limit = limit,
        offset = offset.takeIf { it > 0 },
    )
}
