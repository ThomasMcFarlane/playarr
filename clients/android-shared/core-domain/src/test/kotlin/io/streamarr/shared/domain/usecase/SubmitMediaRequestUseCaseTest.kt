package io.streamarr.shared.domain.usecase

import io.streamarr.shared.data.model.DecideRequestBody
import io.streamarr.shared.data.model.MediaRequest
import io.streamarr.shared.data.model.RequestStatus
import io.streamarr.shared.data.model.RequestTarget
import io.streamarr.shared.data.model.SubmitRequestBody
import io.streamarr.shared.data.model.WorkKind
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.repository.RequestRepository
import java.time.Instant
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

private fun fakeMediaRequest(id: String = "r1") = MediaRequest(
    id = id,
    requestedBy = "server-derived-user",
    kind = WorkKind.Movie,
    target = RequestTarget.ExistingWork("w1"),
    status = RequestStatus.Pending,
    createdAt = Instant.EPOCH,
    updatedAt = Instant.EPOCH,
)

/**
 * [SubmitMediaRequestUseCase]/[ApproveMediaRequestUseCase]/[RejectMediaRequestUseCase]
 * no longer take a `requestedBy`/`decidedBy` parameter (Round E's security
 * fix: the real spec derives the acting user server-side from the verified
 * access token instead) -- these tests pin the bodies each use case builds
 * so a regression that resurrects those parameters, or that stops sending
 * `note`/`reason` through, fails here rather than only against a live
 * server.
 */
class SubmitMediaRequestUseCaseTest {

    private class RecordingRequestRepository : RequestRepository {
        var capturedSubmitBody: SubmitRequestBody? = null

        override suspend fun listRequests(userId: String?): List<MediaRequest> = emptyList()

        override suspend fun submitRequest(body: SubmitRequestBody): MediaRequest {
            capturedSubmitBody = body
            return fakeMediaRequest()
        }

        override suspend fun approveRequest(id: String, body: DecideRequestBody): MediaRequest = fakeMediaRequest(id)
        override suspend fun rejectRequest(id: String, body: DecideRequestBody): MediaRequest = fakeMediaRequest(id)
    }

    @Test
    fun `submit builds a SubmitRequestBody with no requested_by, carrying only kind, target, and note`() = runBlocking {
        val repository = RecordingRequestRepository()
        val useCase = SubmitMediaRequestUseCase(repository)

        val result = useCase(kind = WorkKind.Movie, target = RequestTarget.ExistingWork("w1"), note = "please")

        assertEquals(SubmitRequestBody(kind = WorkKind.Movie, target = RequestTarget.ExistingWork("w1"), note = "please"), repository.capturedSubmitBody)
        assertEquals(true, result is StreamarrResult.Success)
    }

    @Test
    fun `submit with no note defaults it to null, not an empty string`() = runBlocking {
        val repository = RecordingRequestRepository()
        val useCase = SubmitMediaRequestUseCase(repository)

        useCase(kind = WorkKind.Series, target = RequestTarget.ExistingWork("w2"))

        assertNull(repository.capturedSubmitBody?.note)
    }
}
