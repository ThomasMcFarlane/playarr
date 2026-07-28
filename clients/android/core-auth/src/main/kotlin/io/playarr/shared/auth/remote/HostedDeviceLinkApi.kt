package io.playarr.shared.auth.remote

import io.playarr.shared.auth.model.HostedLinkCodeRequest
import io.playarr.shared.auth.model.HostedLinkCodeResponse
import io.playarr.shared.auth.model.HostedLinkPollResponse
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface HostedDeviceLinkApi {
    @POST("api/link/code")
    suspend fun requestCode(@Body body: HostedLinkCodeRequest): HostedLinkCodeResponse

    @GET("api/link/code/{deviceCode}")
    suspend fun poll(@Path("deviceCode") deviceCode: String): Response<HostedLinkPollResponse>
}
