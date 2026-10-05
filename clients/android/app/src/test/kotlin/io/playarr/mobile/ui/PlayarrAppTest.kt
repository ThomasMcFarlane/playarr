package io.playarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class PlayarrAppTest {
    @Test
    fun `server address without a scheme uses local-network http`() {
        assertEquals("http://192.168.1.20:8484", normaliseServerUrl("192.168.1.20:8484/"))
    }

    @Test
    fun `https server address remains https`() {
        assertEquals("https://playarr.example.com", normaliseServerUrl(" https://playarr.example.com/ "))
    }

    @Test
    fun `public ipv4 address uses its secure direct relay hostname`() {
        assertEquals(
            "https://v4-11-22-33-44.relay.playarr.app:8484",
            normaliseServerUrl("http://11.22.33.44:8484/"),
        )
    }

    @Test
    fun `public ipv4 address defaults to HTTPS port 443`() {
        assertEquals(
            "https://v4-11-22-33-44.relay.playarr.app",
            normaliseServerUrl("11.22.33.44"),
        )
    }

    @Test
    fun `existing relay hostname is normalised before authenticated requests`() {
        assertEquals(
            "https://v4-11-22-33-44.relay.playarr.app",
            normaliseServerUrl("http://v4-11-22-33-44.relay.playarr.app"),
        )
    }

    @Test
    fun `public relay preserves path query and fragment`() {
        assertEquals(
            "https://v4-11-22-33-44.relay.playarr.app/api?q=one#result",
            normaliseServerUrl("https://11.22.33.44:9443/api?q=one#result"),
        )
    }

    @Test
    fun `invalid server address is rejected`() {
        assertThrows(IllegalArgumentException::class.java) { normaliseServerUrl("not a server") }
    }

    @Test
    fun `connected server fallback label uses the origin host`() {
        assertEquals(
            "secondary.example.com",
            playarrServerFallbackLabel("https://secondary.example.com:9443"),
        )
    }

    @Test
    fun `connected server fallback label preserves an unparseable value`() {
        assertEquals("not a URL", playarrServerFallbackLabel("not a URL"))
    }

    @Test
    fun `relative artwork URL resolves against the selected account server`() {
        assertEquals(
            "https://playarr.example.com/api/v1/artwork/work-1/backdrop",
            resolveArtworkUrl("https://playarr.example.com", "/api/v1/artwork/work-1/backdrop"),
        )
    }

    @Test
    fun `absolute artwork URL remains on its owning server`() {
        assertEquals(
            "https://media.example.com/backdrop.jpg",
            resolveArtworkUrl("https://playarr.example.com", "https://media.example.com/backdrop.jpg"),
        )
    }
}
