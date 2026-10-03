package io.playarr.shared.data.remote

import io.playarr.shared.data.model.DiscoverResponse
import io.playarr.shared.data.model.DiscoveryWire
import io.playarr.shared.data.model.ExternalProvider
import io.playarr.shared.data.model.ExternalRef
import io.playarr.shared.data.model.TitleSnapshot
import io.playarr.shared.data.model.WatchlistResponse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Decodes literal JSON shaped like `backend/openapi/playarr.yaml`'s discovery schemas. */
class DiscoveryJsonTest {
    private val json = PlayarrHttpClient.json

    @Test
    fun `decodes a flattened discover title with sources and provider status`() {
        val response = json.decodeFromString(
            DiscoverResponse.serializer(),
            """
            {
              "titles": [{
                "title_key": "tmdb:movie:949", "kind": "movie", "title": "Orbit", "year": 1995,
                "external_refs": [{"provider": "tmdb", "external_id": "949"}],
                "editions": ["Theatrical"], "in_watchlist": true,
                "sources": [
                  {"source": "library", "label": "Library", "availability": "available", "work_id": "w1"},
                  {"source": "request", "label": "Radarr", "availability": "requestable", "provider_instance_id": "i1"}
                ]
              }],
              "providers": [{"provider": "game", "state": "unavailable", "reason": "Games catalogue is not available yet (task 22)"}],
              "unknown_future_field": 1
            }
            """.trimIndent(),
        )
        val title = response.titles.single()
        assertEquals("tmdb:movie:949", title.titleKey)
        assertTrue(title.inWatchlist)
        assertEquals(ExternalProvider.Tmdb, title.externalRefs.single().provider)
        assertEquals("w1", title.sources.first { it.source == DiscoveryWire.SOURCE_LIBRARY }.workId)
        assertEquals("unavailable", response.providers.single().state)
    }

    @Test
    fun `decodes a watchlist entry with its actions and unknown action kinds`() {
        val list = json.decodeFromString(
            WatchlistResponse.serializer(),
            """
            {"items": [{
              "title": {"title_key": "k", "kind": "movie", "title": "Orbit", "external_refs": [], "editions": [], "sources": []},
              "in_watchlist": true, "added_at": "2026-10-03T00:00:00Z",
              "actions": [
                {"action": "resume", "enabled": true, "media_file_id": "f1", "position_ms": 61000},
                {"action": "record", "enabled": false, "reason": "Recording is not available yet"},
                {"action": "something_new", "enabled": false}
              ]
            }]}
            """.trimIndent(),
        )
        val actions = list.items.single().actions
        assertEquals(61000L, actions[0].positionMs)
        assertEquals("f1", actions[0].mediaFileId)
        assertFalse(actions[1].enabled)
        assertNull(actions[2].reason)
    }

    @Test
    fun `encodes a snapshot with snake_case keys and omits null fields`() {
        val encoded = json.encodeToString(
            TitleSnapshot.serializer(),
            TitleSnapshot(
                kind = "movie",
                title = "Orbit",
                externalRefs = listOf(ExternalRef(ExternalProvider.Tmdb, "949")),
            ),
        )
        assertTrue(encoded, encoded.contains("\"external_refs\":[{\"provider\":\"tmdb\",\"external_id\":\"949\"}]"))
        assertFalse(encoded, encoded.contains("work_id"))
    }
}
