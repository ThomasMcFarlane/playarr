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
    fun `invalid server address is rejected`() {
        assertThrows(IllegalArgumentException::class.java) { normaliseServerUrl("not a server") }
    }
}
