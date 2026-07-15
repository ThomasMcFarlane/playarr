package io.streamarr.shared.domain.usecase

import io.streamarr.shared.data.model.VersionEnvelope
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.model.runCatchingStreamarr
import io.streamarr.shared.domain.repository.VersionRepository
import javax.inject.Inject

/** `GET /api/system/version` -- feeds `core-update`'s `UpdateAvailabilityEvaluator`. */
class GetServerVersionUseCase @Inject constructor(
    private val versionRepository: VersionRepository,
) {
    suspend operator fun invoke(): StreamarrResult<VersionEnvelope> = runCatchingStreamarr {
        versionRepository.getVersion()
    }
}
