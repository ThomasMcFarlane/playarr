package io.streamarr.tv.update

import java.io.ByteArrayInputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidTvSelfUpdaterTest {
    @Test
    fun `decodes and validates a versioned Playarr TV release`() {
        val manifest = decodeAndroidTvReleaseManifest(
            """
            {
              "version_name": "1.2.3",
              "version_code": 1002003,
              "apk_url": "https://playarr.app/downloads/android/releases/1.2.3/playarr-android-tv.apk",
              "sha256": "${"A".repeat(64)}"
            }
            """.trimIndent(),
        ).validate()

        assertEquals("1.2.3", manifest.versionName)
        assertEquals("a".repeat(64), manifest.sha256)
        assertTrue(manifest.isNewerThan(1002002))
        assertFalse(manifest.isNewerThan(1002003))
    }

    @Test
    fun `rejects an APK URL outside the versioned Playarr TV route`() {
        val manifest = AndroidTvReleaseManifest(
            versionName = "1.2.3",
            versionCode = 1002003,
            apkUrl = "https://example.test/playarr-android-tv.apk",
            sha256 = "a".repeat(64),
        )

        assertTrue(runCatching { manifest.validate() }.exceptionOrNull() is IllegalArgumentException)
    }

    @Test
    fun `calculates the published APK checksum`() {
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            sha256Hex(ByteArrayInputStream("abc".toByteArray())),
        )
    }
}
