package io.playarr.mobile.remote

import io.playarr.shared.data.model.CreateRemoteHandoffRequest
import io.playarr.shared.data.model.CreateRemotePairingRequest
import io.playarr.shared.data.model.RemoteHandoff
import io.playarr.shared.data.model.RemotePairing
import io.playarr.shared.data.model.RemotePlaybackSnapshot
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class RemoteHandoffFlowTest {
    private fun handoff(status: String, reason: String? = null) = RemoteHandoff(
        id = "h1", status = status, sourceDeviceId = "s", destinationDeviceId = "d",
        mediaFileId = "m", workId = "w", snapshot = RemotePlaybackSnapshot(5_000L),
        failureReason = reason,
    )

    private fun pairing(status: String) = RemotePairing(
        id = "p1", status = status, controllerDeviceId = "s", controllerName = "Phone",
        targetDeviceId = "d", scopes = listOf("handoff"), verificationCode = "123456",
        createdMs = 0, expiresMs = 0,
    )

    private fun httpError(code: Int, error: String) = HttpException(
        Response.error<Any>(
            code,
            """{"error":"$error","message":"$error"}""".toResponseBody("application/json".toMediaType()),
        ),
    )

    private class FakeApi(
        val create: MutableList<() -> RemoteHandoff>,
        val gets: MutableList<RemoteHandoff> = mutableListOf(),
        val pairingCreate: () -> RemotePairing = { error("unexpected pairing") },
        val pairingGets: MutableList<RemotePairing> = mutableListOf(),
    ) : RemoteHandoffApi {
        val createRequests = mutableListOf<CreateRemoteHandoffRequest>()
        var pairingRequests = 0
        override suspend fun createHandoff(request: CreateRemoteHandoffRequest): RemoteHandoff {
            createRequests += request
            return create.removeAt(0)()
        }
        override suspend fun getHandoff(id: String) = gets.removeAt(0)
        override suspend fun createPairing(request: CreateRemotePairingRequest): RemotePairing {
            pairingRequests += 1
            assertEquals(listOf("handoff"), request.scopes)
            return pairingCreate()
        }
        override suspend fun getPairing(id: String) = pairingGets.removeAt(0)
    }

    private suspend fun run(api: RemoteHandoffApi, onProgress: (HandoffProgress) -> Unit = {}, now: () -> Long = { 0L }) =
        handOffPlayback(
            api = api, sourceDeviceId = "s", destinationDeviceId = "d", mediaFileId = "m",
            snapshot = RemotePlaybackSnapshot(5_000L), controllerName = "Phone", requestKey = "key-1",
            onProgress = onProgress, pollMs = 1L, clock = now,
        )

    @Test
    fun `returns once the destination commits and sends one idempotency key`() = runBlocking {
        val api = FakeApi(mutableListOf({ handoff("pending") }), mutableListOf(handoff("pending"), handoff("committed")))
        assertEquals("committed", run(api).status)
        assertEquals("key-1", api.createRequests.single().requestKey)
        assertEquals(0, api.pairingRequests)
    }

    @Test
    fun `pairs with the handoff scope when no pairing exists then retries`() = runBlocking {
        val api = FakeApi(
            create = mutableListOf({ throw httpError(403, "pairing_required") }, { handoff("committed") }),
            pairingCreate = { pairing("pending") },
            pairingGets = mutableListOf(pairing("active")),
        )
        val stages = mutableListOf<HandoffProgress>()
        run(api, stages::add)
        assertEquals(1, api.pairingRequests)
        assertEquals(2, api.createRequests.size)
        assertTrue(stages.any { it is HandoffProgress.Pairing })
    }

    @Test
    fun `a denied pairing fails clearly`() = runBlocking {
        val api = FakeApi(
            create = mutableListOf({ throw httpError(403, "pairing_required") }),
            pairingCreate = { pairing("pending") },
            pairingGets = mutableListOf(pairing("denied")),
        )
        try {
            run(api)
            fail("expected failure")
        } catch (failure: HandoffFailure) {
            assertEquals(HandoffFailure.Reason.Denied, failure.reason)
        }
    }

    @Test
    fun `a destination failure surfaces so the source keeps playing`() = runBlocking {
        val api = FakeApi(mutableListOf({ handoff("pending") }), mutableListOf(handoff("failed", "codec unsupported")))
        try {
            run(api)
            fail("expected failure")
        } catch (failure: HandoffFailure) {
            assertEquals(HandoffFailure.Reason.Failed, failure.reason)
            assertEquals("codec unsupported", failure.message)
        }
    }

    @Test
    fun `an unresponsive destination expires`() = runBlocking {
        var time = 0L
        val api = FakeApi(mutableListOf({ handoff("pending") }), MutableList(5) { handoff("pending") })
        try {
            run(api, now = { time.also { time += 40_000L } })
            fail("expected failure")
        } catch (failure: HandoffFailure) {
            assertEquals(HandoffFailure.Reason.Expired, failure.reason)
        }
    }

    @Test
    fun `unrelated rejections do not trigger pairing`() = runBlocking {
        val api = FakeApi(mutableListOf({ throw httpError(409, "target_offline") }))
        try {
            run(api)
            fail("expected failure")
        } catch (failure: HandoffFailure) {
            assertEquals(HandoffFailure.Reason.Rejected, failure.reason)
        }
        assertEquals(0, api.pairingRequests)
    }
}
