package io.streamarr.shared.domain.usecase

import io.streamarr.shared.data.model.DecideRequestBody
import io.streamarr.shared.data.model.MediaRequest
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.model.runCatchingStreamarr
import io.streamarr.shared.domain.repository.RequestRepository
import javax.inject.Inject

/**
 * `POST /api/v1/requests/{id}/approve` -- an admin decision on a `Pending`
 * request. Requires a verified `Authorization: Bearer` access token: 401
 * without one, 403 if the verified caller isn't an admin (see
 * [RequestRepository]'s KDoc). The deciding user is derived server-side
 * from that token's `sub` claim, never from anything this use case sends
 * (the real spec's `DecideRequestBody` carries no `decided_by` field).
 */
class ApproveMediaRequestUseCase @Inject constructor(
    private val requestRepository: RequestRepository,
) {
    suspend operator fun invoke(
        requestId: String,
        reason: String? = null,
    ): StreamarrResult<MediaRequest> = runCatchingStreamarr {
        requestRepository.approveRequest(requestId, DecideRequestBody(reason = reason))
    }
}

/** `POST /api/v1/requests/{id}/reject` -- see [ApproveMediaRequestUseCase]'s KDoc for the auth requirements, which are identical. */
class RejectMediaRequestUseCase @Inject constructor(
    private val requestRepository: RequestRepository,
) {
    suspend operator fun invoke(
        requestId: String,
        reason: String? = null,
    ): StreamarrResult<MediaRequest> = runCatchingStreamarr {
        requestRepository.rejectRequest(requestId, DecideRequestBody(reason = reason))
    }
}
