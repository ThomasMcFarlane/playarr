package io.playarr.shared.auth

import io.playarr.shared.auth.model.ClientPlatform
import io.playarr.shared.auth.model.HostedLinkClaim
import io.playarr.shared.auth.model.HostedLinkCodeRequest
import io.playarr.shared.auth.model.HostedLinkCodeResponse
import io.playarr.shared.auth.model.HostedLinkPollResult
import io.playarr.shared.auth.model.HostedLinkPollResponse
import io.playarr.shared.auth.remote.HostedDeviceLinkApi
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import retrofit2.Response

class HostedDeviceLinkClientTest {
    @Test
    fun `requests a hosted code for the selected Android platform`() = runBlocking {
        var requested: HostedLinkCodeRequest? = null
        val response = HostedLinkCodeResponse("secret", "ABCD-2345", "https://playarr.app/link", "https://playarr.app/link?user_code=ABCD-2345", 600, 0)
        val client = testClient(object : HostedDeviceLinkApi {
            override suspend fun requestCode(body: HostedLinkCodeRequest): HostedLinkCodeResponse {
                requested = body
                return response
            }

            override suspend fun poll(deviceCode: String): Response<HostedLinkPollResponse> = error("not used")
        })

        assertEquals(response, client.requestCode(ClientPlatform.AndroidTv))
        assertEquals(ClientPlatform.AndroidTv, requested?.clientPlatform)
    }

    @Test
    fun `polls pending hosted link until the server claim arrives`() = runBlocking {
        var polls = 0
        val claim = HostedLinkClaim("http://playarr.lan:8484", "server-secret", listOf("http://playarr.lan:8484"))
        val client = testClient(object : HostedDeviceLinkApi {
            override suspend fun requestCode(body: HostedLinkCodeRequest): HostedLinkCodeResponse = error("not used")

            override suspend fun poll(deviceCode: String): Response<HostedLinkPollResponse> {
                polls += 1
                return if (polls == 1) {
                    Response.success(202, HostedLinkPollResponse(error = "authorization_pending"))
                } else {
                    Response.success(HostedLinkPollResponse(claim.serverUrl, claim.serverDeviceCode, claim.serverUrls))
                }
            }
        })
        val code = HostedLinkCodeResponse("secret", "ABCD-2345", "", "", 600, 0)

        assertEquals(
            listOf(HostedLinkPollResult.AuthorizationPending, HostedLinkPollResult.Approved(claim)),
            client.pollUntilResolved(code).toList(),
        )
    }

    @Test
    fun `stops pending polling at five minutes without renewing the code`() = runBlocking {
        var nowMillis = 0L
        var polls = 0
        val client = HostedDeviceLinkClient(
            api = object : HostedDeviceLinkApi {
                override suspend fun requestCode(body: HostedLinkCodeRequest): HostedLinkCodeResponse = error("not used")

                override suspend fun poll(deviceCode: String): Response<HostedLinkPollResponse> {
                    polls += 1
                    return Response.success(202, HostedLinkPollResponse(error = "authorization_pending"))
                }
            },
            wait = { nowMillis += it },
            monotonicTimeMillis = { nowMillis },
        )
        val code = HostedLinkCodeResponse("secret", "ABCD-2345", "", "", 600, 2)

        val results = client.pollUntilResolved(code).toList()

        assertEquals(59, polls)
        assertEquals(HostedLinkPollResult.Expired, results.last())
    }

    private fun testClient(api: HostedDeviceLinkApi): HostedDeviceLinkClient =
        HostedDeviceLinkClient(
            api = api,
            wait = {},
            monotonicTimeMillis = { 0L },
        )
}
