package io.streamarr.shared.auth

import io.streamarr.shared.auth.model.ClientPlatform
import io.streamarr.shared.auth.model.HostedLinkClaim
import io.streamarr.shared.auth.model.HostedLinkCodeRequest
import io.streamarr.shared.auth.model.HostedLinkCodeResponse
import io.streamarr.shared.auth.model.HostedLinkPollResult
import io.streamarr.shared.auth.model.HostedLinkPollResponse
import io.streamarr.shared.auth.remote.HostedDeviceLinkApi
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
        val client = HostedDeviceLinkClient(object : HostedDeviceLinkApi {
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
        val claim = HostedLinkClaim("http://streamarr.lan:8484", "server-secret", listOf("http://streamarr.lan:8484"))
        val client = HostedDeviceLinkClient(object : HostedDeviceLinkApi {
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
}
