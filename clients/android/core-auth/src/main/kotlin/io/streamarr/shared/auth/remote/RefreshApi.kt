package io.streamarr.shared.auth.remote

import io.streamarr.shared.auth.model.RefreshRequest
import io.streamarr.shared.auth.model.RefreshResponse
import retrofit2.http.Body
import retrofit2.http.POST

/** Rotates a persisted refresh token without requiring the account password again. */
interface RefreshApi {
    @POST("api/v1/auth/refresh")
    suspend fun refresh(@Body body: RefreshRequest): RefreshResponse
}
