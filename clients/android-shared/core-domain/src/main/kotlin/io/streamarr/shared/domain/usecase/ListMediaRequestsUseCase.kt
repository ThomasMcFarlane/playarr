package io.streamarr.shared.domain.usecase

import io.streamarr.shared.data.model.MediaRequest
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.model.runCatchingStreamarr
import io.streamarr.shared.domain.repository.RequestRepository
import javax.inject.Inject

/** `GET /api/v1/requests`. [userId] narrows to that user's own requests; omitted lists every request still `Pending` an admin decision. */
class ListMediaRequestsUseCase @Inject constructor(
    private val requestRepository: RequestRepository,
) {
    suspend operator fun invoke(userId: String? = null): StreamarrResult<List<MediaRequest>> = runCatchingStreamarr {
        requestRepository.listRequests(userId = userId)
    }
}
