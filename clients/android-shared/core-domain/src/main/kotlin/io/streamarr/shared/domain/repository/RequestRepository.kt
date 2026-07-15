package io.streamarr.shared.domain.repository

import io.streamarr.shared.data.model.DecideRequestBody
import io.streamarr.shared.data.model.MediaRequest
import io.streamarr.shared.data.model.SubmitRequestBody
import io.streamarr.shared.data.remote.StreamarrApi
import javax.inject.Inject

/**
 * Media request lifecycle, independent of transport: `GET/POST /api/v1/requests`,
 * `POST /api/v1/requests/{id}/approve`, `POST /api/v1/requests/{id}/reject`.
 * Mirrors [WorkRepository]'s "thin pass-through to [StreamarrApi]" shape.
 *
 * There is no server-exposed way for this client to know whether the
 * signed-in user is an admin (`Policy.is_admin` is server-internal only --
 * see `streamarr_model::policy::Policy` -- and the access-token JWT carries
 * no role claim -- see `streamarr_auth::jwt::AccessTokenClaims`). [approve]/
 * [reject] are therefore always attempted rather than hidden behind a
 * client-side guess at permission; a caller lacking real admin rights is
 * expected to get an authorization failure back from the server once such
 * enforcement exists there (today the server doesn't check this either --
 * see `SubmitRequestBody.requestedBy`'s own `TODO(auth)` note in
 * `backend/openapi/streamarr.yaml`), which surfaces the same way any other
 * [StreamarrError.Http] does.
 */
interface RequestRepository {
    /** [userId] narrows to that user's own requests (any status); omitted lists every request still `Pending` an admin decision. */
    suspend fun listRequests(userId: String? = null): List<MediaRequest>

    suspend fun submitRequest(body: SubmitRequestBody): MediaRequest

    suspend fun approveRequest(id: String, body: DecideRequestBody): MediaRequest

    suspend fun rejectRequest(id: String, body: DecideRequestBody): MediaRequest
}

class DefaultRequestRepository @Inject constructor(
    private val api: StreamarrApi,
) : RequestRepository {

    override suspend fun listRequests(userId: String?): List<MediaRequest> =
        api.listRequests(userId = userId)

    override suspend fun submitRequest(body: SubmitRequestBody): MediaRequest =
        api.submitRequest(body)

    override suspend fun approveRequest(id: String, body: DecideRequestBody): MediaRequest =
        api.approveRequest(id, body)

    override suspend fun rejectRequest(id: String, body: DecideRequestBody): MediaRequest =
        api.rejectRequest(id, body)
}
