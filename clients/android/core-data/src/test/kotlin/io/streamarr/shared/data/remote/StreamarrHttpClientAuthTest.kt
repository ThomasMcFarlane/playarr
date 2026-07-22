package io.streamarr.shared.data.remote

import io.streamarr.shared.data.model.ClientPlatform
import io.streamarr.shared.data.model.AddPlaylistItemRequest
import io.streamarr.shared.data.model.CreatePlaylistRequest
import io.streamarr.shared.data.model.PlaylistMediaType
import io.streamarr.shared.data.model.PlaybackEventRequest
import io.streamarr.shared.data.model.PlaybackStopReason
import io.streamarr.shared.data.model.UpdateWatchProgressRequest
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Test

class StreamarrHttpClientAuthTest {
    @Test
    fun `401 refreshes once and retries request with replacement bearer token`() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"items":[],"total":0}"""),
        )
        server.start()
        try {
            var storedToken = "rejected-token"
            var refreshCalls = 0
            val api = StreamarrHttpClient.create(
                baseUrlProvider = { server.url("/").toString() },
                clientPlatform = ClientPlatform.AndroidMobile,
                clientVersion = "0.2.2",
                accessTokenProvider = { storedToken },
                refreshAccessToken = { rejectedToken ->
                    assertEquals("rejected-token", rejectedToken)
                    refreshCalls++
                    storedToken = "replacement-token"
                    storedToken
                },
            )

            assertEquals(0, api.browseCatalog().items.size)
            assertEquals(1, refreshCalls)
            assertEquals("Bearer rejected-token", server.takeRequest().headers["Authorization"])
            assertEquals("Bearer replacement-token", server.takeRequest().headers["Authorization"])
        } finally {
            server.close()
        }
    }

    @Test
    fun `native experience calls the documented progress playlist and profile routes`() = runBlocking {
        val server = MockWebServer()
        server.enqueue(jsonResponse("[]"))
        server.enqueue(jsonResponse("""{"media_file_id":"mf-1","work_id":"w1","position_ms":10,"duration_ms":100,"state":"part_watched"}"""))
        server.enqueue(jsonResponse("""{"id":"p1","name":"Friday","is_system":false,"media_type":"video","created_at":"now","updated_at":"now"}"""))
        server.enqueue(jsonResponse("""{"id":"i1","playlist_id":"p1","work_id":"w1","position":0,"added_at":"now"}"""))
        server.enqueue(jsonResponse("[]"))
        server.enqueue(jsonResponse("""{"can_download":true}"""))
        server.enqueue(jsonResponse("null"))
        server.start()
        try {
            val api = StreamarrHttpClient.create(
                baseUrlProvider = { server.url("/").toString() },
                clientPlatform = ClientPlatform.AndroidTv,
                clientVersion = "0.2.7",
                accessTokenProvider = { "token" },
            )

            api.listWatchProgress()
            api.updateWatchProgress("mf-1", UpdateWatchProgressRequest(10, 100))
            api.createPlaylist(CreatePlaylistRequest("Friday", PlaylistMediaType.Video))
            api.addPlaylistItem("p1", AddPlaylistItemRequest("w1"))
            api.listAvailableProfiles()
            assertEquals(true, api.getSelfCapabilities().canDownload)
            assertEquals(null, api.getMyUserInviteRequest().value)

            assertEquals("/api/v1/playback/progress", server.takeRequest().path)
            val progress = server.takeRequest()
            assertEquals("/api/v1/playback/mf-1/progress", progress.path)
            assertEquals("PUT", progress.method)
            val create = server.takeRequest()
            assertEquals("/api/v1/playlists", create.path)
            assertEquals("POST", create.method)
            val add = server.takeRequest()
            assertEquals("/api/v1/playlists/p1/items", add.path)
            assertEquals("POST", add.method)
            assertEquals("/api/v1/users/profiles", server.takeRequest().path)
            assertEquals("/api/v1/users/me/capabilities", server.takeRequest().path)
            assertEquals("/api/v1/users/me/user-invite-request", server.takeRequest().path)
        } finally {
            server.close()
        }
    }

    @Test
    fun `native search calls the public view list and resolve routes`() = runBlocking {
        val server = MockWebServer()
        server.enqueue(
            jsonResponse(
                """[{"id":"view-1","name":"Recently Added","is_default":true,"default_order":0}]""",
            ),
        )
        server.enqueue(jsonResponse("""{"items":[],"total":0}"""))
        server.start()
        try {
            val api = StreamarrHttpClient.create(
                baseUrlProvider = { server.url("/").toString() },
                clientPlatform = ClientPlatform.AndroidMobile,
                clientVersion = "0.2.7",
                accessTokenProvider = { "token" },
            )

            val view = api.listViews().single()
            assertEquals("Recently Added", view.name)
            assertEquals(true, view.isDefault)
            assertEquals(0, view.defaultOrder)
            assertEquals(0, api.resolveView("view-1", limit = 500).items.size)

            assertEquals("/api/v1/views", server.takeRequest().path)
            assertEquals("/api/v1/views/view-1/resolve?limit=500", server.takeRequest().path)
        } finally {
            server.close()
        }
    }

    @Test
    fun `playback quality defaults use the documented force transcode query`() = runBlocking {
        val server = MockWebServer()
        server.enqueue(jsonResponse("""{"mode":"hls","url":"/api/v1/media/sessions/s1/playlist.m3u8"}"""))
        server.start()
        try {
            val api = StreamarrHttpClient.create(
                baseUrlProvider = { server.url("/").toString() },
                clientPlatform = ClientPlatform.AndroidMobile,
                clientVersion = "0.2.7",
                accessTokenProvider = { "token" },
            )

            api.getPlaybackInfo(
                mediaFileId = "mf-1",
                profile = "h264-1080p-8mbps",
                forceTranscode = true,
                startPositionMs = 12_345,
                audioStreamIndex = 2,
                ignoreSavedPreferences = true,
            )

            assertEquals(
                "/api/v1/playback/mf-1?profile=h264-1080p-8mbps&force_transcode=true&start_position_ms=12345&audio_stream_index=2&ignore_saved_preferences=true",
                server.takeRequest().path,
            )
        } finally {
            server.close()
        }
    }

    @Test
    fun `playback lifecycle events use the session route and exact tagged bodies`() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(204))
        server.enqueue(MockResponse().setResponseCode(204))
        server.start()
        try {
            val api = StreamarrHttpClient.create(
                baseUrlProvider = { server.url("/").toString() },
                clientPlatform = ClientPlatform.AndroidMobile,
                clientVersion = "0.2.7",
                accessTokenProvider = { "token" },
            )

            api.recordPlaybackEvent("session-1", PlaybackEventRequest.heartbeat(125_000L))
            api.recordPlaybackEvent(
                "session-1",
                PlaybackEventRequest.stop(PlaybackStopReason.UserStopped, 130_000L),
            )

            val heartbeat = server.takeRequest()
            assertEquals("/api/v1/playback/sessions/session-1/events", heartbeat.path)
            assertEquals("POST", heartbeat.method)
            assertEquals("Bearer token", heartbeat.headers["Authorization"])
            assertEquals(
                "{\"kind\":\"heartbeat\",\"position_ms\":125000,\"bytes_streamed_total\":0}",
                heartbeat.body.readUtf8(),
            )
            val stop = server.takeRequest()
            assertEquals(
                "{\"kind\":\"stop\",\"position_ms\":130000,\"reason\":\"user_stopped\"}",
                stop.body.readUtf8(),
            )
        } finally {
            server.close()
        }
    }

    private fun jsonResponse(body: String) = MockResponse()
        .setResponseCode(200)
        .setHeader("Content-Type", "application/json")
        .setBody(body)
}
