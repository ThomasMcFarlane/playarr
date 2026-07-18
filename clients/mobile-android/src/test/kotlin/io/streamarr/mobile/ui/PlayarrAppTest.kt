package io.streamarr.mobile.ui

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
        assertEquals("https://streamarr.example.com", normaliseServerUrl(" https://streamarr.example.com/ "))
    }

    @Test
    fun `public ipv4 address uses its secure direct relay hostname`() {
        assertEquals(
            "https://v4-11-22-33-44.relay.playarr.app:8484",
            normaliseServerUrl("http://11.22.33.44:8484/"),
        )
    }

    @Test
    fun `existing relay hostname is normalised before authenticated requests`() {
        assertEquals(
            "https://v4-203-0-113-10.relay.playarr.app:8484",
            normaliseServerUrl("http://v4-203-0-113-10.relay.playarr.app"),
        )
    }

    @Test
    fun `public relay preserves path query and fragment`() {
        assertEquals(
            "https://v4-11-22-33-44.relay.playarr.app:8484/api?q=one#result",
            normaliseServerUrl("https://11.22.33.44:9443/api?q=one#result"),
        )
    }

    @Test
    fun `invalid server address is rejected`() {
        assertThrows(IllegalArgumentException::class.java) { normaliseServerUrl("not a server") }
    }

    @Test
    fun `relative artwork URL resolves against the selected account server`() {
        assertEquals(
            "https://streamarr.example.com/api/v1/artwork/work-1/backdrop",
            resolveArtworkUrl("https://streamarr.example.com", "/api/v1/artwork/work-1/backdrop"),
        )
    }

    @Test
    fun `absolute artwork URL remains on its owning server`() {
        assertEquals(
            "https://media.example.com/backdrop.jpg",
            resolveArtworkUrl("https://streamarr.example.com", "https://media.example.com/backdrop.jpg"),
        )
    }
}
