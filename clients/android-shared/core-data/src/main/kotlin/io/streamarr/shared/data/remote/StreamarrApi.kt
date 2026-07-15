package io.streamarr.shared.data.remote

import io.streamarr.shared.data.model.Device
import io.streamarr.shared.data.model.Episode
import io.streamarr.shared.data.model.MediaFile
import io.streamarr.shared.data.model.PlaybackEvent
import io.streamarr.shared.data.model.PlaybackSession
import io.streamarr.shared.data.model.Policy
import io.streamarr.shared.data.model.Season
import io.streamarr.shared.data.model.UserProfile
import io.streamarr.shared.data.model.VersionEnvelope
import io.streamarr.shared.data.model.Work
import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * Hand-written placeholder for the Streamarr HTTP API surface.
 *
 * Per `docs/architecture/overview.md`, the source of truth for this
 * contract is `crates/streamarr-api/openapi.yaml`, and CI generates Kotlin
 * client stubs from it for every Playarr client. **This interface exists
 * so `core-data`, `core-domain`, and the app modules have something real
 * to compile and inject against before that codegen pipeline exists** — it
 * should be deleted and replaced wholesale by the generated client once
 * `streamarr-api` ships its first OpenAPI spec, not incrementally patched
 * to match it forever.
 *
 * Endpoint paths and shapes are inferred from `streamarr-model` and
 * `docs/architecture/auth-modes.md` (the only parts of the contract
 * documented so far); see `core-auth.DeviceAuthApi` for the RFC 8628
 * device-pairing endpoints, which live on this same host but are kept in
 * `core-auth` since they're usable before a session token exists.
 */
interface StreamarrApi {

    @GET("api/system/version")
    suspend fun getVersion(): VersionEnvelope

    @GET("api/me")
    suspend fun getCurrentUser(): UserProfile

    @GET("api/me/policy")
    suspend fun getCurrentPolicy(): Policy

    @GET("api/me/devices")
    suspend fun listDevices(): List<Device>

    @GET("api/works")
    suspend fun listWorks(
        @Query("kind") kind: String? = null,
        @Query("cursor") cursor: String? = null,
        @Query("limit") limit: Int? = null,
    ): WorkPage

    @GET("api/works/{workId}")
    suspend fun getWork(@Path("workId") workId: String): Work

    @GET("api/works/{workId}/seasons")
    suspend fun listSeasons(@Path("workId") workId: String): List<Season>

    @GET("api/seasons/{seasonId}/episodes")
    suspend fun listEpisodes(@Path("seasonId") seasonId: String): List<Episode>

    @GET("api/works/{workId}/media-files")
    suspend fun listMediaFiles(@Path("workId") workId: String): List<MediaFile>

    @POST("api/playback/sessions")
    suspend fun startPlaybackSession(@Body request: StartPlaybackSessionRequest): PlaybackSession

    @POST("api/playback/sessions/{sessionId}/events")
    suspend fun recordPlaybackEvent(
        @Path("sessionId") sessionId: String,
        @Body event: PlaybackEvent,
    )
}

/** Cursor-paginated envelope; every `GET` list endpoint follows this shape. */
@Serializable
data class WorkPage(
    val items: List<Work>,
    val nextCursor: String? = null,
)

/** Body for `POST /api/playback/sessions` — the server assigns `id`/`startedAt` and returns the full session. */
@Serializable
data class StartPlaybackSessionRequest(
    val mediaFileId: String,
    val clientPlatform: String,
    val clientVersion: String,
)
