package io.streamarr.shared.data.remote

import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure, no-network unit tests for [requiresBearerAuth]'s path/method
 * matching -- the allow-list [StreamarrHttpClientAuthTest] relies on to
 * scope `Authorization` attachment to only the three `requests` write
 * calls the real spec documents as needing one.
 */
class RequiresBearerAuthTest {

    private val emptyJsonBody = "{}".toRequestBody()

    private fun get(path: String): Request = Request.Builder().url("http://streamarr.invalid$path").get().build()
    private fun post(path: String): Request = Request.Builder().url("http://streamarr.invalid$path").post(emptyJsonBody).build()

    @Test
    fun `POST api v1 requests requires bearer auth`() {
        assertTrue(post("/api/v1/requests").requiresBearerAuth())
    }

    @Test
    fun `POST api v1 requests id approve requires bearer auth`() {
        assertTrue(post("/api/v1/requests/11111111-1111-1111-1111-111111111111/approve").requiresBearerAuth())
    }

    @Test
    fun `POST api v1 requests id reject requires bearer auth`() {
        assertTrue(post("/api/v1/requests/11111111-1111-1111-1111-111111111111/reject").requiresBearerAuth())
    }

    @Test
    fun `GET api v1 requests -- listing -- does not require bearer auth`() {
        assertFalse(get("/api/v1/requests").requiresBearerAuth())
    }

    @Test
    fun `GET api v1 catalog does not require bearer auth`() {
        assertFalse(get("/api/v1/catalog").requiresBearerAuth())
    }

    @Test
    fun `GET api v1 playback does not require bearer auth`() {
        assertFalse(get("/api/v1/playback/11111111-1111-1111-1111-111111111111").requiresBearerAuth())
    }

    @Test
    fun `POST webhooks does not require bearer auth`() {
        assertFalse(post("/webhooks/11111111-1111-1111-1111-111111111111").requiresBearerAuth())
    }

    @Test
    fun `an unrelated 5-segment POST path is not mistaken for an approve or reject decision`() {
        assertFalse(post("/api/v1/requests/some-id/not-a-real-action").requiresBearerAuth())
    }
}
