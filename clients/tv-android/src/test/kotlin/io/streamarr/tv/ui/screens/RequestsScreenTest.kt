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
 * Mirrors `mobile-android`'s `RequestsScreenTest` -- see that file's KDoc.
 * [TvRequestsViewModel.approve]/[TvRequestsViewModel.reject] surface a
 * 401/403 as real, distinct `actionError` messages via
 * [StreamarrError.toUserMessage].
 */
class RequestsScreenTest {

    private fun httpError(code: Int): StreamarrError.Http {
        val response: Response<Any> = Response.error(code, "".toResponseBody("application/json".toMediaType()))
        return StreamarrError.Http(code, HttpException(response))
    }

    @Test
    fun `401 surfaces as a distinct sign-in-required message, not a generic server error`() {
        assertEquals("Sign in again to continue.", httpError(401).toRequestsErrorMessage())
    }

    @Test
    fun `403 surfaces as a distinct not-an-admin message, not a generic server error`() {
        assertEquals("You don't have permission to approve or reject requests.", httpError(403).toRequestsErrorMessage())
    }

    @Test
    fun `401, 403, and 409 all map to different messages from each other`() {
        val unauthorized = httpError(401).toRequestsErrorMessage()
        val forbidden = httpError(403).toRequestsErrorMessage()
        val alreadyDecided = httpError(409).toRequestsErrorMessage()

        assertNotEquals(unauthorized, forbidden)
        assertNotEquals(unauthorized, alreadyDecided)
        assertNotEquals(forbidden, alreadyDecided)
        assertEquals("This request was already decided.", alreadyDecided)
    }

    @Test
    fun `an unrelated 500 still falls through to the generic server error message`() {
        assertEquals("Server error (500).", httpError(500).toRequestsErrorMessage())
    }
}
