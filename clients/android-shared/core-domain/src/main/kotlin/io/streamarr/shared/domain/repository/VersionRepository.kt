package io.streamarr.shared.domain.repository

import io.streamarr.shared.data.model.VersionEnvelope
import io.streamarr.shared.data.remote.StreamarrApi
import javax.inject.Inject

/** `GET /api/system/version` -- the server/client compatibility envelope the auto-update module checks on every app resume. */
interface VersionRepository {
    suspend fun getVersion(): VersionEnvelope
}

class DefaultVersionRepository @Inject constructor(
    private val api: StreamarrApi,
) : VersionRepository {
    override suspend fun getVersion(): VersionEnvelope = api.getVersion()
}
