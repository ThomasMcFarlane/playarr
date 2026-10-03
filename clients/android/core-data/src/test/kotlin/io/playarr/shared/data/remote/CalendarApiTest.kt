package io.playarr.shared.data.remote

import io.playarr.shared.data.model.CalendarFeedCreated
import io.playarr.shared.data.model.CalendarMediaKind
import io.playarr.shared.data.model.CalendarResponse
import io.playarr.shared.data.model.ClientPlatform
import java.time.Instant
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CalendarApiTest {
    private val json = PlayarrHttpClient.json

    private val calendarBody = """
        {
          "start": "2026-10-04",
          "end": "2026-11-03",
          "entries": [
            {
              "id": "episode:tvdb:81189:s1e2:2026-10-05:air",
              "media_kind": "episode",
              "release_type": "air",
              "title": "Example Show",
              "subtitle": "Second Episode",
              "season_number": 1,
              "episode_number": 2,
              "date": "2026-10-05",
              "release_at": "2026-10-05T01:00:00Z",
              "monitored": true,
              "has_file": false,
              "poster_url": "https://images.example.com/poster.jpg",
              "work_id": "11111111-1111-1111-1111-111111111111",
              "average_lag_seconds": 7200,
              "sources": [
                {"source_instance_id": "22222222-2222-2222-2222-222222222222", "source_name": "Sonarr HD", "source_kind": "sonarr", "arr_id": 42}
              ]
            },
            {
              "id": "movie:tmdb:603:cinema:2026-10-09",
              "media_kind": "movie",
              "release_type": "cinema",
              "title": "Example Movie",
              "date": "2026-10-09",
              "monitored": false,
              "has_file": false,
              "sources": []
            },
            {
              "id": "future:1",
              "media_kind": "podcast",
              "release_type": "surprise",
              "title": "From a newer server",
              "date": "2026-10-10",
              "monitored": false,
              "has_file": true,
              "unknown_field": 1
            }
          ],
          "sources": [
            {"source_instance_id": "22222222-2222-2222-2222-222222222222", "name": "Sonarr HD", "kind": "sonarr", "status": "ok", "entry_count": 2},
            {"source_instance_id": "33333333-3333-3333-3333-333333333333", "name": "Radarr 4K", "kind": "radarr", "status": "unreachable", "error": "connection refused", "entry_count": 0}
          ]
        }
    """.trimIndent()

    @Test
    fun `decodes the calendar response including all-day entries and unknown enum values`() {
        val response = json.decodeFromString(CalendarResponse.serializer(), calendarBody)

        assertEquals(LocalDate.parse("2026-10-04"), response.start)
        assertEquals(3, response.entries.size)
        val episode = response.entries[0]
        assertEquals(Instant.parse("2026-10-05T01:00:00Z"), episode.releaseAt)
        assertEquals(LocalDate.parse("2026-10-05"), episode.date)
        assertEquals(1L, episode.seasonNumber)
        assertEquals(7200L, episode.averageLagSeconds)
        assertEquals("Sonarr HD", episode.sources.single().sourceName)
        assertEquals(CalendarMediaKind.Episode, CalendarMediaKind.fromWire(episode.mediaKind))

        val movie = response.entries[1]
        assertNull(movie.releaseAt)
        assertNull(movie.workId)
        assertNull(movie.posterUrl)

        assertNull(CalendarMediaKind.fromWire(response.entries[2].mediaKind))

        assertTrue(response.sources[0].isOk)
        val failed = response.sources[1]
        assertFalse(failed.isOk)
        assertEquals("connection refused", failed.error)
    }

    @Test
    fun `calendar feed and lag routes use the documented paths and parse their bodies`() = runBlocking {
        val server = MockWebServer()
        server.enqueue(jsonResponse(calendarBody))
        server.enqueue(jsonResponse("""{"active":true,"created_at":"2026-10-01T10:00:00Z","last_used_at":null}"""))
        server.enqueue(
            jsonResponse(
                """{"url":"https://playarr.example/api/v1/calendar/feed/secret.ics","token":"secret","created_at":"2026-10-04T08:00:00Z"}""",
            ).setResponseCode(201),
        )
        server.enqueue(MockResponse().setResponseCode(204))
        server.enqueue(
            jsonResponse(
                """
                {"average_seconds":null,"sample_count":0,"backfill_count":2,"unknown_count":1,
                 "backfill_threshold_days":30,"average_grab_seconds":null,"samples":[]}
                """.trimIndent(),
            ),
        )
        server.start()
        try {
            val api = PlayarrHttpClient.create(
                baseUrlProvider = { server.url("/").toString() },
                clientPlatform = ClientPlatform.AndroidMobile,
                clientVersion = "0.0.0",
                accessTokenProvider = { "token" },
            )

            assertEquals(3, api.getCalendar(start = "2026-10-04", end = "2026-11-03").entries.size)
            val feed = api.getCalendarFeed()
            assertTrue(feed.active)
            assertNull(feed.lastUsedAt)
            val created = api.createCalendarFeed()
            assertEquals("secret", created.token)
            assertTrue(api.revokeCalendarFeed().isSuccessful)
            val lag = api.getAvailabilityLag("work-1")
            assertNull(lag.averageSeconds)
            assertEquals(2, lag.backfillCount)

            val calendarRequest = server.takeRequest()
            assertEquals("GET", calendarRequest.method)
            assertEquals("/api/v1/calendar?start=2026-10-04&end=2026-11-03", calendarRequest.path)
            assertEquals("Bearer token", calendarRequest.headers["Authorization"])
            assertEquals("/api/v1/calendar/feed", server.takeRequest().path)
            val create = server.takeRequest()
            assertEquals("POST", create.method)
            assertEquals("/api/v1/calendar/feed", create.path)
            val revoke = server.takeRequest()
            assertEquals("DELETE", revoke.method)
            assertEquals("/api/v1/calendar/feed", revoke.path)
            assertEquals("/api/v1/catalog/work-1/availability-lag", server.takeRequest().path)
        } finally {
            server.close()
        }
    }

    @Test
    fun `the secret subscription url never appears in toString`() {
        val created = CalendarFeedCreated(
            url = "https://playarr.example/api/v1/calendar/feed/secret-token.ics",
            token = "secret-token",
            createdAt = Instant.parse("2026-10-04T08:00:00Z"),
        )
        assertFalse(created.toString().contains("secret-token"))
    }

    private fun jsonResponse(body: String) = MockResponse()
        .setResponseCode(200)
        .setHeader("Content-Type", "application/json")
        .setBody(body)
}
