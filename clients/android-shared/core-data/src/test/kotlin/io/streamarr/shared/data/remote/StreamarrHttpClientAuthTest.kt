package io.streamarr.shared.data.remote

import io.streamarr.shared.data.model.ClientPlatform
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Test

class StreamarrHttpClientAuthTest {
    @Test
    fun `401 refreshes once and retries request with replacement bearer token`() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"items":[],"total":0}"""),
        )
        server.start()
        try {
            var storedToken = "rejected-token"
            var refreshCalls = 0
            val api = StreamarrHttpClient.create(
                baseUrlProvider = { server.url("/").toString() },
                clientPlatform = ClientPlatform.AndroidMobile,
                clientVersion = "0.2.2",
                accessTokenProvider = { storedToken },
                refreshAccessToken = { rejectedToken ->
                    assertEquals("rejected-token", rejectedToken)
                    refreshCalls++
                    storedToken = "replacement-token"
                    storedToken
                },
            )

            assertEquals(0, api.browseCatalog().items.size)
            assertEquals(1, refreshCalls)
            assertEquals("Bearer rejected-token", server.takeRequest().headers["Authorization"])
            assertEquals("Bearer replacement-token", server.takeRequest().headers["Authorization"])
        } finally {
            server.close()
        }
    }
}
