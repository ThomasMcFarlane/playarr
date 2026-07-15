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
 * [submitRequest]/[approveRequest]/[rejectRequest] all require a verified
 * `Authorization: Bearer` access token now -- see
 * `io.streamarr.shared.data.remote.StreamarrHttpClient` for where that
 * header is attached -- and 401 without one. There is still no
 * server-exposed way for this client to know *in advance* whether the
 * signed-in user is an admin (`Policy.is_admin` is server-internal only --
 * see `streamarr_model::policy::Policy` -- and the access-token JWT carries
 * no role claim -- see `streamarr_auth::jwt::AccessTokenClaims`), so
 * [approveRequest]/[rejectRequest] are always attempted rather than hidden
 * behind a client-side guess at permission; a caller lacking real admin
 * rights now gets a real 403 back from the server (enforced there since
 * the security fix that removed `requested_by`/`decided_by` from the
 * request bodies), which surfaces the same way any other
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
