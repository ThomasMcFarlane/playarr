package io.streamarr.shared.domain.usecase

import io.streamarr.shared.data.model.DecideRequestBody
import io.streamarr.shared.data.model.MediaRequest
import io.streamarr.shared.data.model.RequestStatus
import io.streamarr.shared.data.model.RequestTarget
import io.streamarr.shared.data.model.SubmitRequestBody
import io.streamarr.shared.data.model.WorkKind
import io.streamarr.shared.domain.repository.RequestRepository
import java.time.Instant
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

private fun fakeMediaRequest(id: String) = MediaRequest(
    id = id,
    requestedBy = "server-derived-user",
    kind = WorkKind.Movie,
    target = RequestTarget.ExistingWork("w1"),
    status = RequestStatus.Approved,
    createdAt = Instant.EPOCH,
    updatedAt = Instant.EPOCH,
)

/** See [SubmitMediaRequestUseCaseTest]'s KDoc for why these bodies are pinned. */
class DecideMediaRequestUseCaseTest {

    private class RecordingRequestRepository : RequestRepository {
        var capturedApproveId: String? = null
        var capturedApproveBody: DecideRequestBody? = null
        var capturedRejectId: String? = null
        var capturedRejectBody: DecideRequestBody? = null

        override suspend fun listRequests(userId: String?): List<MediaRequest> = emptyList()
        override suspend fun submitRequest(body: SubmitRequestBody): MediaRequest = error("not exercised")

        override suspend fun approveRequest(id: String, body: DecideRequestBody): MediaRequest {
            capturedApproveId = id
            capturedApproveBody = body
            return fakeMediaRequest(id)
        }

        override suspend fun rejectRequest(id: String, body: DecideRequestBody): MediaRequest {
            capturedRejectId = id
            capturedRejectBody = body
            return fakeMediaRequest(id)
        }
    }

    @Test
    fun `approve builds a DecideRequestBody with no decided_by, carrying only reason`() = runBlocking {
        val repository = RecordingRequestRepository()
        val useCase = ApproveMediaRequestUseCase(repository)

        useCase(requestId = "r1", reason = "looks good")

        assertEquals("r1", repository.capturedApproveId)
        assertEquals(DecideRequestBody(reason = "looks good"), repository.capturedApproveBody)
    }

    @Test
    fun `reject builds a DecideRequestBody with no decided_by, carrying only reason`() = runBlocking {
        val repository = RecordingRequestRepository()
        val useCase = RejectMediaRequestUseCase(repository)

        useCase(requestId = "r2", reason = "duplicate")

        assertEquals("r2", repository.capturedRejectId)
        assertEquals(DecideRequestBody(reason = "duplicate"), repository.capturedRejectBody)
    }

    @Test
    fun `reason defaults to null when omitted`() = runBlocking {
        val repository = RecordingRequestRepository()
        val useCase = ApproveMediaRequestUseCase(repository)

        useCase(requestId = "r3")

        assertEquals(DecideRequestBody(reason = null), repository.capturedApproveBody)
    }
}
