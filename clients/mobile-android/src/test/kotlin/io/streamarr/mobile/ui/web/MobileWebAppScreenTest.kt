package io.streamarr.mobile.ui.web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MobileWebAppScreenTest {
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

    @Test
    fun `builds a versioned app URL without changing its origin`() {
        assertEquals(
            "https://media.example.test/playarr/?androidBuild=42",
            androidAppUrl("https://media.example.test/playarr/", 42),
        )
    }

    @Test
    fun `recognises stable and versioned public Android APK downloads`() {
        assertTrue(
            isPlayarrAndroidApkUrl(
                "https://playarr.app/downloads/android/playarr-android.apk",
            ),
        )
        assertTrue(
            isPlayarrAndroidApkUrl(
                "https://playarr.app/downloads/android/releases/0.1.5/playarr-android.apk",
            ),
        )
    }

    @Test
    fun `does not intercept ordinary Playarr navigation`() {
        assertTrue(!isPlayarrAndroidApkUrl("https://playarr.app/clients"))
    }
}
