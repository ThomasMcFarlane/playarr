package io.playarr.shared.domain.usecase

import io.playarr.shared.data.model.WorkDetail
import io.playarr.shared.domain.model.PlayarrResult
import io.playarr.shared.domain.model.runCatchingPlayarr
import io.playarr.shared.domain.repository.WorkRepository
import javax.inject.Inject

/**
 * `GET /api/v1/catalog/{id}` -- the work plus its full kind-specific child
 * tree ([io.playarr.shared.data.model.WorkChildren]) in one call. Unlike
 * the Wave-1 placeholder this replaced, there is no separate
 * seasons/media-files fan-out to do: the real `WorkDetailSchema` already
 * nests everything a detail screen needs.
 */
class GetWorkDetailsUseCase @Inject constructor(
    private val workRepository: WorkRepository,
) {
    suspend operator fun invoke(workId: String): PlayarrResult<WorkDetail> = runCatchingPlayarr {
        workRepository.getWork(workId)
    }
}
