package io.streamarr.shared.domain.usecase

import io.streamarr.shared.data.model.DecideRequestBody
import io.streamarr.shared.data.model.MediaRequest
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.model.runCatchingStreamarr
import io.streamarr.shared.domain.repository.RequestRepository
import javax.inject.Inject

/** `POST /api/v1/requests/{id}/approve` -- an admin decision on a `Pending` request. See [RequestRepository]'s KDoc for the admin-gating caveat. */
class ApproveMediaRequestUseCase @Inject constructor(
    private val requestRepository: RequestRepository,
) {
    suspend operator fun invoke(
        requestId: String,
        decidedBy: String,
        reason: String? = null,
    ): StreamarrResult<MediaRequest> = runCatchingStreamarr {
        requestRepository.approveRequest(requestId, DecideRequestBody(decidedBy = decidedBy, reason = reason))
    }
}

/** `POST /api/v1/requests/{id}/reject` -- an admin decision on a `Pending` request. See [RequestRepository]'s KDoc for the admin-gating caveat. */
class RejectMediaRequestUseCase @Inject constructor(
    private val requestRepository: RequestRepository,
) {
    suspend operator fun invoke(
        requestId: String,
        decidedBy: String,
        reason: String? = null,
    ): StreamarrResult<MediaRequest> = runCatchingStreamarr {
        requestRepository.rejectRequest(requestId, DecideRequestBody(decidedBy = decidedBy, reason = reason))
    }
}
