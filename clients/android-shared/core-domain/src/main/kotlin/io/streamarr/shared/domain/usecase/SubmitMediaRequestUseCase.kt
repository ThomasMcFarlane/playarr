package io.streamarr.shared.domain.usecase

import io.streamarr.shared.data.model.MediaRequest
import io.streamarr.shared.data.model.RequestTarget
import io.streamarr.shared.data.model.SubmitRequestBody
import io.streamarr.shared.data.model.WorkKind
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.model.runCatchingStreamarr
import io.streamarr.shared.domain.repository.RequestRepository
import javax.inject.Inject

/**
 * `POST /api/v1/requests` -- the "Request" action on `WorkDetailScreen` for
 * a [io.streamarr.shared.data.model.Work] that isn't fully available yet.
 * [requestedBy] must be the signed-in user's own id (see
 * `io.streamarr.shared.auth.TokenStore.userId`) -- the real spec takes this
 * in the request body rather than deriving it from the bearer token today
 * (see `SubmitRequestBody.requestedBy`'s `TODO(auth)` note in
 * `backend/openapi/streamarr.yaml`).
 */
class SubmitMediaRequestUseCase @Inject constructor(
    private val requestRepository: RequestRepository,
) {
    suspend operator fun invoke(
        requestedBy: String,
        kind: WorkKind,
        target: RequestTarget,
        note: String? = null,
    ): StreamarrResult<MediaRequest> = runCatchingStreamarr {
        requestRepository.submitRequest(
            SubmitRequestBody(requestedBy = requestedBy, kind = kind, target = target, note = note),
        )
    }
}
