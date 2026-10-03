package io.playarr.shared.data.remote

import io.playarr.shared.data.model.AckRemoteEventRequest
import io.playarr.shared.data.model.AckRemoteHandoffRequest
import io.playarr.shared.data.model.ApproveRemotePairingRequest
import io.playarr.shared.data.model.CreateRemoteHandoffRequest
import io.playarr.shared.data.model.CreateRemotePairingRequest
import io.playarr.shared.data.model.RegisterRemoteTargetRequest
import io.playarr.shared.data.model.RemoteCommandAccepted
import io.playarr.shared.data.model.RemoteCommandRequest
import io.playarr.shared.data.model.RemoteCommandStatus
import io.playarr.shared.data.model.RemoteHandoff
import io.playarr.shared.data.model.RemoteInbox
import io.playarr.shared.data.model.RemotePairing
import io.playarr.shared.data.model.RemoteTarget
import io.playarr.shared.data.model.ReportRemoteStateRequest
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * Retrofit surface for the phone remote and playback handoff endpoints
 * (`docs/architecture/remote-control.md`). Kept apart from [PlayarrApi] because
 * it only ever talks to the signed-in primary server.
 */
interface PlayarrRemoteApi {
    @PUT("api/v1/remote/target")
    suspend fun registerTarget(@Body request: RegisterRemoteTargetRequest): RemoteTarget

    @DELETE("api/v1/remote/target")
    suspend fun unregisterTarget(): Response<ResponseBody>

    @GET("api/v1/remote/targets")
    suspend fun listTargets(): List<RemoteTarget>

    @PUT("api/v1/remote/target/state")
    suspend fun reportState(@Body request: ReportRemoteStateRequest): Response<ResponseBody>

    @POST("api/v1/remote/pairings")
    suspend fun createPairing(@Body request: CreateRemotePairingRequest): RemotePairing

    @GET("api/v1/remote/pairings")
    suspend fun listPairings(): List<RemotePairing>

    @GET("api/v1/remote/pairings/{id}")
    suspend fun getPairing(@Path("id") id: String): RemotePairing

    @POST("api/v1/remote/pairings/{id}/approve")
    suspend fun approvePairing(
        @Path("id") id: String,
        @Body request: ApproveRemotePairingRequest = ApproveRemotePairingRequest(),
    ): RemotePairing

    @POST("api/v1/remote/pairings/{id}/deny")
    suspend fun denyPairing(@Path("id") id: String): RemotePairing

    @DELETE("api/v1/remote/pairings/{id}")
    suspend fun revokePairing(@Path("id") id: String): Response<ResponseBody>

    @POST("api/v1/remote/pairings/{id}/commands")
    suspend fun sendCommand(
        @Path("id") pairingId: String,
        @Body request: RemoteCommandRequest,
    ): RemoteCommandAccepted

    @GET("api/v1/remote/commands/{id}")
    suspend fun commandStatus(@Path("id") commandId: String): RemoteCommandStatus

    /** Long poll; the server caps [wait] at 25 seconds. */
    @GET("api/v1/remote/inbox")
    suspend fun inbox(@Query("after") after: Long, @Query("wait") wait: Int): RemoteInbox

    @POST("api/v1/remote/events/{id}/ack")
    suspend fun ackEvent(
        @Path("id") eventId: String,
        @Body request: AckRemoteEventRequest,
    ): Response<ResponseBody>

    @POST("api/v1/remote/handoffs")
    suspend fun createHandoff(@Body request: CreateRemoteHandoffRequest): RemoteHandoff

    @GET("api/v1/remote/handoffs/{id}")
    suspend fun getHandoff(@Path("id") id: String): RemoteHandoff

    @POST("api/v1/remote/handoffs/{id}/ack")
    suspend fun ackHandoff(
        @Path("id") id: String,
        @Body request: AckRemoteHandoffRequest,
    ): RemoteHandoff

    @POST("api/v1/remote/handoffs/{id}/cancel")
    suspend fun cancelHandoff(@Path("id") id: String): RemoteHandoff
}
