package io.streamarr.tv.ui.screens

import io.streamarr.shared.domain.model.StreamarrError
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

/**
 * Mirrors `mobile-android`'s `WorkDetailScreenTest` -- see that file's
 * KDoc. [TvWorkDetailViewModel.requestWork] surfaces a 401/403 as real,
 * distinct [TvRequestActionState.Failed] messages via
 * [StreamarrError.toUserMessage].
 */
class WorkDetailScreenTest {

    private fun httpError(code: Int): StreamarrError.Http {
        val response: Response<Any> = Response.error(code, "".toResponseBody("application/json".toMediaType()))
        return StreamarrError.Http(code, HttpException(response))
    }

    @Test
    fun `401 surfaces as a distinct sign-in-required message, not a generic server error`() {
        assertEquals("Sign in again to submit a request.", httpError(401).toWorkDetailErrorMessage())
    }

    @Test
    fun `403 surfaces as a distinct permission message, not a generic server error`() {
        assertEquals("You don't have permission to do that.", httpError(403).toWorkDetailErrorMessage())
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
