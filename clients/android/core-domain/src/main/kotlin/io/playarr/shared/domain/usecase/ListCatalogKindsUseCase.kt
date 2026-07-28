package io.playarr.shared.domain.usecase

import io.playarr.shared.data.model.WorkKind
import io.playarr.shared.domain.model.PlayarrResult
import io.playarr.shared.domain.model.runCatchingPlayarr
import io.playarr.shared.domain.repository.WorkRepository
import javax.inject.Inject

/** Access-gated media kinds used to keep Playarr navigation free of dead destinations. */
class ListCatalogKindsUseCase @Inject constructor(
    private val workRepository: WorkRepository,
) {
    suspend operator fun invoke(): PlayarrResult<List<WorkKind>> = runCatchingPlayarr {
        workRepository.listCatalogKinds()
    }
}
