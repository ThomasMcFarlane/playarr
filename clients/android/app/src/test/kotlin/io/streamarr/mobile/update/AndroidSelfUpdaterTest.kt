package io.streamarr.mobile.update

import java.io.ByteArrayInputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidSelfUpdaterTest {
    @Test
    fun `accepts the signed universal Android release route`() {
        val manifest = decodeAndroidReleaseManifest(
            """{"version_name":"1.2.3","version_code":1002003,"apk_url":"https://playarr.app/downloads/android/releases/1.2.3/playarr-android.apk","sha256":"${"ab".repeat(32)}"}""",
        ).validate()

        assertEquals("1.2.3", manifest.versionName)
        assertTrue(manifest.isNewerThan(1002002))
        assertFalse(manifest.isNewerThan(1002003))
    }

    @Test
    fun `rejects an APK URL outside the universal release route`() {
        val error = runCatching {
            AndroidReleaseManifest(
                versionName = "1.2.3",
                versionCode = 1002003,
                apkUrl = "https://example.test/playarr-android.apk",
                sha256 = "ab".repeat(32),
            ).validate()
        }.exceptionOrNull()

        assertTrue(error is IllegalArgumentException)
    }

    @Test
    fun `calculates the published APK checksum`() {
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            sha256Hex(ByteArrayInputStream("abc".encodeToByteArray())),
        )
    }
}
