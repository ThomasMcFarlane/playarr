package io.streamarr.shared.data.remote

import io.streamarr.shared.data.model.CatalogPage
import io.streamarr.shared.data.model.DecideRequestBody
import io.streamarr.shared.data.model.MediaRequest
import io.streamarr.shared.data.model.PlaybackInfoResponse
import io.streamarr.shared.data.model.SubmitRequestBody
import io.streamarr.shared.data.model.VersionEnvelope
import io.streamarr.shared.data.model.Work
import io.streamarr.shared.data.model.WorkDetail
import kotlinx.serialization.json.JsonElement
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * Real, typed Retrofit client for every path in `backend/openapi/streamarr.yaml`
 * *except* the RFC 8628 device-authorization endpoints, which stay on
 * `core-auth`'s `DeviceAuthApi` (see that interface's KDoc for why -- a
 * device legitimately needs those two calls before it has any access
 * token, hence before it has any business constructing an authenticated
 * [StreamarrApi]).
 *
 * Hand-written rather than run through `openapi-generator-cli`: this
 * project's hand-rolled `KSerializer`s for the spec's externally/internally
 * tagged `oneOf` schemas (`ExternalProvider`, `WorkChildren`,
 * `RequestTarget`) already reproduce serde's exact wire shapes, and
 * every method below is checked field-for-field against the spec, so a
 * generated client would either need heavy post-generation patching for
 * those types or a custom template -- not worth the codegen dependency for
 * 13 paths. This is the **replacement** for the Wave-1 placeholder that
 * used to live at this same file path (`/api/works`, `/api/me`, `/api/playback/sessions`,
 * ... paths that were never real).
 *
 * This is deliberately one flat interface (not split per-tag) to mirror
 * how `StreamarrHttpClient.create` hands out exactly one Retrofit-backed
 * implementation per app process.
 */
interface StreamarrApi {

    // ---- system ------------------------------------------------------------

    /**
     * `GET /api/system/health` -- 200 iff the process is alive; no response
     * body either way, so this returns the raw, unconverted
     * [ResponseBody] rather than running an empty body through the JSON
     * converter (which would fail trying to decode zero bytes).
     */
    @GET("api/system/health")
    suspend fun health(): Response<ResponseBody>

    /** `GET /api/system/ready` -- 200 ready / 503 not ready; see [health] for why the return type is raw. */
    @GET("api/system/ready")
    suspend fun ready(): Response<ResponseBody>

    @GET("api/system/version")
    suspend fun getVersion(): VersionEnvelope

    // ---- catalog -------------------------------------------------------------

    /**
     * `GET /api/v1/catalog`. [kind] is the lowercase wire value of
     * [io.streamarr.shared.data.model.WorkKind] (e.g. `"movie"`, see
     * [io.streamarr.shared.data.model.WorkKind.wireName]); [sort] is
     * `"title"` (server default when omitted) or `"recent"`.
     */
    @GET("api/v1/catalog")
    suspend fun browseCatalog(
        @Query("kind") kind: String? = null,
        @Query("genre") genre: String? = null,
        @Query("tag") tag: String? = null,
        @Query("sort") sort: String? = null,
        @Query("limit") limit: Long? = null,
        @Query("offset") offset: Long? = null,
    ): CatalogPage

    @GET("api/v1/catalog/search")
    suspend fun searchCatalog(
        @Query("q") query: String,
        @Query("limit") limit: Long? = null,
    ): List<Work>

    /** `GET /api/v1/catalog/{id}` -- a work and its full kind-specific child tree. */
    @GET("api/v1/catalog/{id}")
    suspend fun getWork(@Path("id") id: String): WorkDetail

    // ---- requests ------------------------------------------------------------

    /** [userId] narrows to that user's own requests (any status); omitted lists every request still `Pending`. Unauthenticated, per the real spec. */
    @GET("api/v1/requests")
    suspend fun listRequests(@Query("user_id") userId: String? = null): List<MediaRequest>

    /**
     * Requires a verified `Authorization: Bearer` access token -- see
     * [StreamarrHttpClient.create]'s `accessTokenProvider` -- and 401s
     * without one. `requested_by` on the returned [MediaRequest] is derived
     * server-side from the token's `sub` claim, not from anything sent here.
     */
    @POST("api/v1/requests")
    suspend fun submitRequest(@Body body: SubmitRequestBody): MediaRequest

    /** Requires a verified `Authorization: Bearer` access token: 401 without one, 403 if the verified caller isn't an admin. */
    @POST("api/v1/requests/{id}/approve")
    suspend fun approveRequest(@Path("id") id: String, @Body body: DecideRequestBody): MediaRequest

    /** Requires a verified `Authorization: Bearer` access token: 401 without one, 403 if the verified caller isn't an admin. */
    @POST("api/v1/requests/{id}/reject")
    suspend fun rejectRequest(@Path("id") id: String, @Body body: DecideRequestBody): MediaRequest

    // ---- playback --------------------------------------------------------------

    /**
     * `GET /api/v1/playback/{media_file_id}` -- the direct-play-vs-transcode
     * negotiation this whole endpoint exists for. [containers]/[videoCodecs]/[audioCodecs]
     * are comma-separated capability lists the calling device can play
     * (e.g. `"mp4"`, `"h264"`); [profile] names a transcode target profile
     * (server defaults to `"h264-720p-4mbps"` when omitted/unrecognized).
     * Non-2xx (404 unknown id, 503 no transcode capacity) surfaces as an
     * [retrofit2.HttpException] from this suspend call, same as every
     * other non-`Response`-wrapped method here.
     */
    @GET("api/v1/playback/{media_file_id}")
    suspend fun getPlaybackInfo(
        @Path("media_file_id") mediaFileId: String,
        @Query("containers") containers: String? = null,
        @Query("video_codecs") videoCodecs: String? = null,
        @Query("audio_codecs") audioCodecs: String? = null,
        @Query("max_bitrate_bps") maxBitrateBps: Long? = null,
        @Query("profile") profile: String? = null,
    ): PlaybackInfoResponse

    // ---- webhooks --------------------------------------------------------------

    /**
     * `POST /webhooks/{instance_id}` -- receives *arr webhook payloads.
     * This is a server-to-server endpoint in normal operation (Sonarr/Radarr/etc.
     * call it, not a Streamarr client app); it's included here only so
     * this SDK's coverage of the spec is complete and real -- no screen in
     * this app calls it. [payload]'s schema is `{}` (arbitrary JSON) in
     * the spec, hence [JsonElement] rather than a concrete DTO.
     */
    @POST("webhooks/{instance_id}")
    suspend fun sendWebhook(
        @Path("instance_id") instanceId: String,
        @Body payload: JsonElement,
    ): Response<ResponseBody>
}
