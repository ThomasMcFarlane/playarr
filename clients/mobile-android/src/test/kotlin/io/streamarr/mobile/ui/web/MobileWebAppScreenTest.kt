package io.streamarr.mobile.ui.web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MobileWebAppScreenTest {
    @Test
    fun `Android shell always loads hosted Playarr`() {
        assertEquals(
            "https://playarr.app/?androidBuild=42",
            androidAppUrl(42),
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
                "https://playarr.app/downloads/android/releases/0.1.7/playarr-android.apk",
            ),
        )
    }

    @Test
    fun `does not intercept ordinary Playarr navigation`() {
        assertTrue(!isPlayarrAndroidApkUrl("https://playarr.app/clients"))
    }
}
