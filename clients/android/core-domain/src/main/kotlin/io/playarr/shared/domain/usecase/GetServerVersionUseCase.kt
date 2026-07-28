package io.playarr.shared.domain.usecase

import io.playarr.shared.data.model.VersionEnvelope
import io.playarr.shared.domain.model.PlayarrResult
import io.playarr.shared.domain.model.runCatchingPlayarr
import io.playarr.shared.domain.repository.VersionRepository
import javax.inject.Inject

/** `GET /api/system/version` -- feeds `core-update`'s `UpdateAvailabilityEvaluator`. */
class GetServerVersionUseCase @Inject constructor(
    private val versionRepository: VersionRepository,
) {
    suspend operator fun invoke(): PlayarrResult<VersionEnvelope> = runCatchingPlayarr {
        versionRepository.getVersion()
    }
}
