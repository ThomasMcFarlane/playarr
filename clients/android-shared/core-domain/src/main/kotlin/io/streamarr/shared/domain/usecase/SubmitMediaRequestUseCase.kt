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
 * Requires a verified `Authorization: Bearer` access token -- see
 * `io.streamarr.shared.data.remote.StreamarrHttpClient` -- and 401s
 * without one; the submitting user is derived server-side from that
 * token's `sub` claim, never from anything this use case sends (the real
 * spec's `SubmitRequestBody` carries no `requested_by` field at all).
 */
class SubmitMediaRequestUseCase @Inject constructor(
    private val requestRepository: RequestRepository,
) {
    suspend operator fun invoke(
        kind: WorkKind,
        target: RequestTarget,
        note: String? = null,
    ): StreamarrResult<MediaRequest> = runCatchingStreamarr {
        requestRepository.submitRequest(SubmitRequestBody(kind = kind, target = target, note = note))
    }
}
