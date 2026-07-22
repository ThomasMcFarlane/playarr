package io.streamarr.shared.data.remote

import io.streamarr.shared.data.model.CatalogPage
import io.streamarr.shared.data.model.AddPlaylistItemRequest
import io.streamarr.shared.data.model.AvailableProfile
import io.streamarr.shared.data.model.CreatePlaylistRequest
import io.streamarr.shared.data.model.CreateDownloadTicketRequest
import io.streamarr.shared.data.model.CreateUserInviteRequest
import io.streamarr.shared.data.model.DownloadOptionsResponse
import io.streamarr.shared.data.model.DownloadQualityOption
import io.streamarr.shared.data.model.DownloadStatus
import io.streamarr.shared.data.model.DownloadTicketResponse
import io.streamarr.shared.data.model.PlayerPreferences
import io.streamarr.shared.data.model.OptionalUserInviteRequest
import io.streamarr.shared.data.model.Playlist
import io.streamarr.shared.data.model.PlaylistItem
import io.streamarr.shared.data.model.PlaybackInfoResponse
import io.streamarr.shared.data.model.PlaybackEventRequest
import io.streamarr.shared.data.model.ProfileAvatarSetting
import io.streamarr.shared.data.model.ProfilePinSetting
import io.streamarr.shared.data.model.ReorderPlaylistItemsRequest
import io.streamarr.shared.data.model.SelfCapabilitiesResponse
import io.streamarr.shared.data.model.UpdatePlayerPreferencesRequest
import io.streamarr.shared.data.model.UpdatePlaylistRequest
import io.streamarr.shared.data.model.UpdateProfileAvatarRequest
import io.streamarr.shared.data.model.UpdateProfilePinRequest
import io.streamarr.shared.data.model.UpdateWatchProgressRequest
import io.streamarr.shared.data.model.UserInvite
import io.streamarr.shared.data.model.UserInviteRequest
import io.streamarr.shared.data.model.VerifyProfilePinRequest
import io.streamarr.shared.data.model.VerifyProfilePinResponse
import io.streamarr.shared.data.model.WatchProgress
import io.streamarr.shared.data.model.VersionEnvelope
import io.streamarr.shared.data.model.Work
import io.streamarr.shared.data.model.WorkDetail
import io.streamarr.shared.data.model.WorkKind
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.Serializable
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.PUT
import retrofit2.http.Query

/**
 * Real, typed Retrofit client for every catalog/playback/system/webhooks
 * path in `backend/openapi/streamarr.yaml`, *except* the RFC 8628
 * device-authorization endpoints (which stay on `core-auth`'s
 * `DeviceAuthApi` -- see that interface's KDoc for why: a device
 * legitimately needs those two calls before it has any access token,
 * hence before it has any business constructing an authenticated
 * [StreamarrApi]) and the `requests` list/create/approve/reject paths,
 * which no longer exist here at all: Streamarr's request-management
 * feature (an Overseerr/Jellyseerr-style submit/approve/reject flow) was
 * removed entirely -- it duplicated an already-existing tool and was out
 * of Streamarr's actual scope.
 *
 * Hand-written rather than run through `openapi-generator-cli`: this
 * project's hand-rolled `KSerializer`s for the spec's externally/internally
 * tagged `oneOf` schemas (`ExternalProvider`, `WorkChildren`) already
 * reproduce serde's exact wire shapes, and every method below is checked
 * field-for-field against the spec, so a generated client would either
 * need heavy post-generation patching for those types or a custom template
 * -- not worth the codegen dependency for 8 paths. This is the
 * **replacement** for the Wave-1 placeholder that used to live at this
 * same file path (`/api/works`, `/api/me`, `/api/playback/sessions`, ...
 * paths that were never real).
 *
 * This is deliberately one flat interface (not split per-tag) to mirror
 * how `StreamarrHttpClient.create` hands out exactly one Retrofit-backed
 * implementation per app process.
 */
interface StreamarrApi {

    @POST("api/v1/users/me/push-registrations")
    suspend fun registerPush(@Body request: PushRegistrationRequest): Response<ResponseBody>

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
        @Query("available_only") availableOnly: Boolean? = null,
        @Query("genre") genre: String? = null,
        @Query("tag") tag: String? = null,
        @Query("sort") sort: String? = null,
        @Query("limit") limit: Long? = null,
        @Query("offset") offset: Long? = null,
    ): CatalogPage

    @GET("api/v1/catalog/kinds")
    suspend fun listCatalogKinds(): List<WorkKind>

    @GET("api/v1/catalog/search")
    suspend fun searchCatalog(
        @Query("q") query: String,
        @Query("limit") limit: Long? = null,
    ): List<Work>

    /** `GET /api/v1/catalog/{id}` -- a work and its full kind-specific child tree. */
    @GET("api/v1/catalog/{id}")
    suspend fun getWork(@Path("id") id: String): WorkDetail

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
        @Query("force_transcode") forceTranscode: Boolean? = null,
        @Query("start_position_ms") startPositionMs: Long? = null,
    ): PlaybackInfoResponse

    @POST("api/v1/playback/sessions/{session_id}/events")
    suspend fun recordPlaybackEvent(
        @Path("session_id") sessionId: String,
        @Body request: PlaybackEventRequest,
    )

    @GET("api/v1/playback/progress")
    suspend fun listWatchProgress(): List<WatchProgress>

    @GET("api/v1/playback/{media_file_id}/progress")
    suspend fun getWatchProgress(@Path("media_file_id") mediaFileId: String): WatchProgress

    @PUT("api/v1/playback/{media_file_id}/progress")
    suspend fun updateWatchProgress(
        @Path("media_file_id") mediaFileId: String,
        @Body request: UpdateWatchProgressRequest,
    ): WatchProgress

    // ---- downloads -----------------------------------------------------------

    /**
     * `GET /api/v1/media/{media_file_id}/download-options` -- the download
     * qualities this server can produce for this media file (`"original"`
     * plus every supported transcode profile). See [DownloadQualityOption]'s
     * KDoc for the size-estimate semantics.
     */
    @GET("api/v1/media/{media_file_id}/download-options")
    suspend fun getDownloadOptions(@Path("media_file_id") mediaFileId: String): DownloadOptionsResponse

    /**
     * `POST /api/v1/downloads` -- stages a new download ticket, or returns
     * an existing queued/processing/ready ticket for the same
     * `(media_file_id, quality_id)` pair (200) instead of creating a
     * duplicate (201). `"original"` resolves `Ready` immediately;
     * see [DownloadStatus]'s KDoc for why a named profile currently never
     * leaves `Queued`.
     */
    @POST("api/v1/downloads")
    suspend fun createDownloadTicket(@Body request: CreateDownloadTicketRequest): DownloadTicketResponse

    @GET("api/v1/downloads")
    suspend fun listDownloadTickets(): List<DownloadTicketResponse>

    /** `GET /api/v1/downloads/{id}` -- poll a ticket's current state. */
    @GET("api/v1/downloads/{id}")
    suspend fun getDownloadTicket(@Path("id") id: String): DownloadTicketResponse

    /**
     * `DELETE /api/v1/downloads/{id}` -- soft-cancels the ticket (marked
     * `Canceled`, not deleted). Note: the actual byte-serving
     * `GET /api/v1/downloads/{id}/file` endpoint is deliberately *not*
     * modeled here -- Media3's `DownloadManager`/offline `DownloadService`
     * fetches those bytes directly via its own authenticated
     * `OkHttpDataSource` (see `core-download`'s `DefaultDownloadRepository`
     * and the app module's `DownloadModule`), not through this Retrofit
     * client.
     */
    @DELETE("api/v1/downloads/{id}")
    suspend fun cancelDownloadTicket(@Path("id") id: String): Response<ResponseBody>

    // ---- Playarr profiles and preferences ---------------------------------

    @GET("api/v1/users/profiles")
    suspend fun listAvailableProfiles(): List<AvailableProfile>

    @GET("api/v1/users/me/capabilities")
    suspend fun getSelfCapabilities(): SelfCapabilitiesResponse

    @POST("api/v1/users/profiles/{id}/verify-pin")
    suspend fun verifyProfilePin(
        @Path("id") id: String,
        @Body request: VerifyProfilePinRequest,
    ): VerifyProfilePinResponse

    @GET("api/v1/users/me/profile-pin")
    suspend fun getProfilePinSetting(): ProfilePinSetting

    @PATCH("api/v1/users/me/profile-pin")
    suspend fun updateProfilePinSetting(@Body request: UpdateProfilePinRequest): ProfilePinSetting

    @GET("api/v1/users/me/player-preferences")
    suspend fun getPlayerPreferences(): PlayerPreferences

    @PATCH("api/v1/users/me/player-preferences")
    suspend fun updatePlayerPreferences(@Body request: UpdatePlayerPreferencesRequest): PlayerPreferences

    @GET("api/v1/users/me/profile-avatar")
    suspend fun getProfileAvatar(): ProfileAvatarSetting

    @PUT("api/v1/users/me/profile-avatar")
    suspend fun updateProfileAvatar(@Body request: UpdateProfileAvatarRequest): ProfileAvatarSetting

    @GET("api/v1/users/me/user-invite-request")
    suspend fun getMyUserInviteRequest(): OptionalUserInviteRequest

    @POST("api/v1/users/me/user-invite-request")
    suspend fun createUserInviteRequest(@Body request: CreateUserInviteRequest): UserInviteRequest

    @POST("api/v1/users/me/user-invite-request/generate")
    suspend fun generateApprovedUserInvite(): UserInvite

    // ---- playlists --------------------------------------------------------

    @GET("api/v1/playlists")
    suspend fun listPlaylists(): List<Playlist>

    @POST("api/v1/playlists")
    suspend fun createPlaylist(@Body request: CreatePlaylistRequest): Playlist

    @GET("api/v1/playlists/{id}")
    suspend fun getPlaylist(@Path("id") id: String): Playlist

    @PUT("api/v1/playlists/{id}")
    suspend fun updatePlaylist(@Path("id") id: String, @Body request: UpdatePlaylistRequest): Playlist

    @DELETE("api/v1/playlists/{id}")
    suspend fun deletePlaylist(@Path("id") id: String): Response<ResponseBody>

    @GET("api/v1/playlists/{id}/items")
    suspend fun listPlaylistItems(@Path("id") id: String): List<PlaylistItem>

    @POST("api/v1/playlists/{id}/items")
    suspend fun addPlaylistItem(
        @Path("id") id: String,
        @Body request: AddPlaylistItemRequest,
    ): PlaylistItem

    @DELETE("api/v1/playlists/{id}/items/{item_id}")
    suspend fun removePlaylistItem(
        @Path("id") id: String,
        @Path("item_id") itemId: String,
    ): Response<ResponseBody>

    @PUT("api/v1/playlists/{id}/items/order")
    suspend fun reorderPlaylistItems(
        @Path("id") id: String,
        @Body request: ReorderPlaylistItemsRequest,
    ): List<PlaylistItem>

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

@Serializable
data class PushRegistrationRequest(
    val token: String,
    val platform: io.streamarr.shared.data.model.ClientPlatform,
)
