package io.playarr.shared.domain.repository

import io.playarr.shared.data.model.VersionEnvelope
import io.playarr.shared.data.remote.PlayarrApi
import javax.inject.Inject

/** `GET /api/system/version` -- the server/client compatibility envelope the auto-update module checks on every app resume. */
interface VersionRepository {
    suspend fun getVersion(): VersionEnvelope
}

class DefaultVersionRepository @Inject constructor(
    private val api: PlayarrApi,
) : VersionRepository {
    override suspend fun getVersion(): VersionEnvelope = api.getVersion()
}
