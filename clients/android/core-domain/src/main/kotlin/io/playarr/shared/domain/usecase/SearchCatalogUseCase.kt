package io.playarr.shared.domain.usecase

import io.playarr.shared.data.model.Work
import io.playarr.shared.domain.model.PlayarrResult
import io.playarr.shared.domain.model.runCatchingPlayarr
import io.playarr.shared.domain.repository.WorkRepository
import javax.inject.Inject

/** `GET /api/v1/catalog/search` -- free-text catalog search. */
class SearchCatalogUseCase @Inject constructor(
    private val workRepository: WorkRepository,
) {
    suspend operator fun invoke(query: String, limit: Long? = null): PlayarrResult<List<Work>> = runCatchingPlayarr {
        workRepository.searchCatalog(query = query, limit = limit)
    }
}
