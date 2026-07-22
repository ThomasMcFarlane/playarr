package io.streamarr.mobile.di

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Test

class DownloadModuleTest {
    @Test
    fun `request origin retains non-default ports and IPv6 brackets`() {
        assertEquals(
            "https://secondary.example:9443",
            streamarrRequestOrigin("https://secondary.example:9443/media/file".toHttpUrl()),
        )
        assertEquals(
            "http://[2001:db8::1]:8484",
            streamarrRequestOrigin("http://[2001:db8::1]:8484/media/file".toHttpUrl()),
        )
    }

    @Test
    fun `request origin omits default ports`() {
        assertEquals("https://secondary.example", streamarrRequestOrigin("https://secondary.example/x".toHttpUrl()))
        assertEquals("http://secondary.example", streamarrRequestOrigin("http://secondary.example/x".toHttpUrl()))
    }
}
