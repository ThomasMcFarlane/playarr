package io.streamarr.shared.domain.usecase

import io.streamarr.shared.data.model.Work
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.model.runCatchingStreamarr
import io.streamarr.shared.domain.repository.WorkRepository
import javax.inject.Inject

/** `GET /api/v1/catalog/search` -- free-text catalog search. */
class SearchCatalogUseCase @Inject constructor(
    private val workRepository: WorkRepository,
) {
    suspend operator fun invoke(query: String, limit: Long? = null): StreamarrResult<List<Work>> = runCatchingStreamarr {
        workRepository.searchCatalog(query = query, limit = limit)
    }
}
