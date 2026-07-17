package io.streamarr.tv.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WebAppScreenTest {
    @Test
    fun `adds an http scheme to a home network address`() {
        assertEquals(
            "http://192.168.1.23:8484",
            normaliseServerUrl("192.168.1.23:8484/"),
        )
    }

    @Test
    fun `preserves https reverse proxy paths`() {
        assertEquals(
            "https://media.example.test/streamarr",
            normaliseServerUrl(" https://media.example.test/streamarr/ "),
        )
    }

    @Test
    fun `rejects unsupported schemes`() {
        val error = runCatching { normaliseServerUrl("file:///tmp/playarr") }.exceptionOrNull()
        assertTrue(error is IllegalArgumentException)
    }
}
