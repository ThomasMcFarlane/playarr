package io.playarr.mobile.ui

import io.playarr.shared.data.model.DiscoveryTitle
import io.playarr.shared.data.model.DiscoveryWire
import io.playarr.shared.data.model.TitleAction
import io.playarr.shared.data.model.TitleSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrDiscoveryTest {
    private fun action(kind: String, enabled: Boolean = true, reason: String? = null, file: String? = null) =
        TitleAction(action = kind, enabled = enabled, reason = reason, mediaFileId = file)

    private fun source(kind: String, availability: String = "available", workId: String? = null) =
        TitleSource(source = kind, label = kind, availability = availability, workId = workId)

    private fun title(kind: String = "movie", vararg sources: TitleSource) = DiscoveryTitle(
        titleKey = "tmdb:$kind:1",
        kind = kind,
        title = "Orbit",
        sources = sources.toList(),
    )

    @Test
    fun `resume outranks play and disabled actions are skipped`() {
        val actions = listOf(
            action(DiscoveryWire.ACTION_PLAY, file = "f1"),
            action(DiscoveryWire.ACTION_RESUME, file = "f1"),
            action(DiscoveryWire.ACTION_RECORD, enabled = false, reason = "later"),
        )
        assertEquals(DiscoveryWire.ACTION_RESUME, primaryDiscoveryAction(actions)?.action)
    }

    @Test
    fun `falls back to request and returns null when nothing is enabled`() {
        assertEquals(
            DiscoveryWire.ACTION_REQUEST,
            primaryDiscoveryAction(
                listOf(action(DiscoveryWire.ACTION_PLAY, enabled = false, reason = "x"), action(DiscoveryWire.ACTION_REQUEST)),
            )?.action,
        )
        assertNull(primaryDiscoveryAction(listOf(action(DiscoveryWire.ACTION_PLAY, enabled = false, reason = "x"))))
    }

    @Test
    fun `explains only disabled actions that carry a reason`() {
        val explained = explainedDisabledActions(
            listOf(
                action(DiscoveryWire.ACTION_PLAY),
                action(DiscoveryWire.ACTION_RECORD, enabled = false, reason = "Recording is not available yet"),
                action(DiscoveryWire.ACTION_REQUEST, enabled = false),
            ),
        )
        assertEquals(listOf(DiscoveryWire.ACTION_RECORD), explained.map { it.action })
    }

    @Test
    fun `snapshot keeps the library work id and extras keep non library and game titles`() {
        val library = title("movie", source(DiscoveryWire.SOURCE_LIBRARY, workId = "w1"))
        val peer = title("movie", source(DiscoveryWire.SOURCE_PEER))
        val game = title("game")
        assertEquals("w1", library.toSnapshot().workId)
        assertEquals(listOf(peer, game), extraDiscoveryTitles(listOf(library, peer, game)))
    }

    @Test
    fun `only requestable request sources are requestable`() {
        assertTrue(
            title("movie", source(DiscoveryWire.SOURCE_REQUEST, DiscoveryWire.AVAILABILITY_REQUESTABLE)).isRequestable(),
        )
        assertFalse(title("movie", source(DiscoveryWire.SOURCE_REQUEST, "upcoming")).isRequestable())
        assertFalse(title("movie", source(DiscoveryWire.SOURCE_LIBRARY)).isRequestable())
    }

    @Test
    fun `games search type is its own filter that never matches library works`() {
        assertTrue(PlayarrSearchMediaType.entries.any { it == PlayarrSearchMediaType.Game })
        assertEquals(
            emptyList<Any>(),
            filterPlayarrSearchWorks(emptyList(), emptySet(), PlayarrSearchMediaType.Game),
        )
    }

    @Test
    fun `an older server that answers with html is reported as unsupported`() {
        assertTrue(discoveryUnsupportedByServer(kotlinx.serialization.SerializationException("Expected start of the object")))
        assertFalse(discoveryUnsupportedByServer(java.io.IOException("timeout")))
    }
}
