package io.streamarr.shared.domain.usecase

import io.streamarr.shared.data.model.WorkKind
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.model.runCatchingStreamarr
import io.streamarr.shared.domain.repository.WorkRepository
import javax.inject.Inject

/** Access-gated media kinds used to keep Playarr navigation free of dead destinations. */
class ListCatalogKindsUseCase @Inject constructor(
    private val workRepository: WorkRepository,
) {
    suspend operator fun invoke(): StreamarrResult<List<WorkKind>> = runCatchingStreamarr {
        workRepository.listCatalogKinds()
    }
}
