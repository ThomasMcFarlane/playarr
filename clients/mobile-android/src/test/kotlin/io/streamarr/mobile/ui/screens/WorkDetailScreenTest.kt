package io.streamarr.mobile.ui.screens

import io.streamarr.shared.domain.model.StreamarrError
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

/**
 * [WorkDetailViewModel.requestWork] (`POST /api/v1/requests`) surfaces a
 * 401 (missing/invalid bearer token, per Round E's security fix) and a 403
 * as real, distinct [RequestActionState.Failed] messages via
 * [StreamarrError.toUserMessage] -- not a silent failure, and not lumped
 * into the generic "Server error (n)" branch every other status shares.
 */
class WorkDetailScreenTest {

    private fun httpError(code: Int): StreamarrError.Http {
        val response: Response<Any> = Response.error(code, "".toResponseBody("application/json".toMediaType()))
        return StreamarrError.Http(code, HttpException(response))
    }

    @Test
    fun `401 surfaces as a distinct sign-in-required message, not a generic server error`() {
        val message = httpError(401).toWorkDetailErrorMessage()
        assertEquals("Sign in again to submit a request.", message)
    }

    @Test
    fun `403 surfaces as a distinct permission message, not a generic server error`() {
        val message = httpError(403).toWorkDetailErrorMessage()
        assertEquals("You don't have permission to do that.", message)
    }

    @Test
    fun `401 and 403 map to different messages from each other and from a plain 500`() {
        val unauthorized = httpError(401).toWorkDetailErrorMessage()
        val forbidden = httpError(403).toWorkDetailErrorMessage()
        val serverError = httpError(500).toWorkDetailErrorMessage()

        assertNotEquals(unauthorized, forbidden)
        assertNotEquals(unauthorized, serverError)
        assertNotEquals(forbidden, serverError)
        assertEquals("Server error (500).", serverError)
    }

    @Test
    fun `404 keeps its existing not-found message`() {
        assertEquals("This title couldn't be found.", httpError(404).toWorkDetailErrorMessage())
    }
}
