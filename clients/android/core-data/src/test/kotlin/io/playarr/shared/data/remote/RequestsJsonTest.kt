package io.playarr.shared.data.remote

import io.playarr.shared.data.model.RequestResult
import io.playarr.shared.data.model.RequestView
import io.playarr.shared.data.model.ResolvedTitle
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RequestsJsonTest {
    private val json = PlayarrHttpClient.json

    @Test
    fun `decodes request views, tolerating absent requester and unknown fields`() {
        val rows = json.decodeFromString(
            ListSerializer(RequestView.serializer()),
            """
            [
              {"id": "a", "title": "Orbit", "kind": "movie", "year": 1995, "tmdb_id": 949, "seasons": [],
               "status": "pending", "origin": "playarr", "requested_by": "sam", "mine": true,
               "status_note": "Sent to Radarr", "systems": ["radarr"],
               "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-02T00:00:00Z", "future": 1},
              {"id": "b", "title": "Dark", "kind": "series", "seasons": [1, 2], "status": "approved",
               "origin": "ombi", "mine": false, "systems": [],
               "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z"}
            ]
            """.trimIndent(),
        )
        assertEquals(2, rows.size)
        assertEquals(1995, rows[0].year)
        assertEquals(949L, rows[0].tmdbId)
        assertEquals("sam", rows[0].requestedBy)
        assertTrue(rows[0].mine)
        assertEquals("Sent to Radarr", rows[0].statusNote)
        assertNull(rows[1].requestedBy)
        assertFalse(rows[1].mine)
        assertEquals(listOf(1, 2), rows[1].seasons)
    }

    @Test
    fun `request result and resolved title carry optional request fields`() {
        val result = json.decodeFromString(
            RequestResult.serializer(),
            """{"status": "requested", "provider_instance_id": "i1", "request_id": "r1", "request_status": "pending"}""",
        )
        assertEquals("r1", result.requestId)
        assertEquals("pending", result.requestStatus)
        val legacy = json.decodeFromString(
            RequestResult.serializer(),
            """{"status": "requested", "provider_instance_id": "i1"}""",
        )
        assertNull(legacy.requestId)
        val resolved = json.decodeFromString(
            ResolvedTitle.serializer(),
            """
            {"title": {"title_key": "tmdb:movie:1", "kind": "movie", "title": "X"}, "in_watchlist": false,
             "request": {"request_id": "r1", "status": "approved", "origin": "seerr", "requested_by": "kim", "mine": false}}
            """.trimIndent(),
        )
        assertEquals("approved", resolved.request?.status)
        assertEquals("kim", resolved.request?.requestedBy)
    }
}
