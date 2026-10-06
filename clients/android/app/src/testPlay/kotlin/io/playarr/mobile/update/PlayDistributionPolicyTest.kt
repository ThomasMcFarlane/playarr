package io.playarr.mobile.update

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayDistributionPolicyTest {
    @Test
    fun `Play runtime does not contain the sideload APK installer`() {
        assertThrows(ClassNotFoundException::class.java) {
            Class.forName("io.playarr.mobile.update.AndroidSelfUpdater")
        }
    }

    @Test
    fun `Play manifest removes installer access and allows cleartext to user-entered servers`() {
        val appDirectory = androidAppDirectory()
        val commonManifest = File(appDirectory, "src/main/AndroidManifest.xml").readText()
        val playManifest = File(appDirectory, "src/play/AndroidManifest.xml").readText()
        val networkPolicy = File(
            appDirectory,
            "src/play/res/xml/network_security_config.xml",
        ).readText()

        assertFalse(commonManifest.contains("android.permission.REQUEST_INSTALL_PACKAGES"))
        assertTrue(commonManifest.contains("android.permission.FOREGROUND_SERVICE\""))
        assertTrue(commonManifest.contains("android.permission.FOREGROUND_SERVICE_DATA_SYNC"))
        assertTrue(playManifest.contains("tools:node=\"remove\""))
        assertTrue(playManifest.contains("android:usesCleartextTraffic=\"true\""))
        assertTrue(networkPolicy.contains("cleartextTrafficPermitted=\"true\""))
    }

    private fun androidAppDirectory(): File = generateSequence(File(System.getProperty("user.dir") ?: ".")) {
        it.parentFile
    }.first { File(it, "src/main/AndroidManifest.xml").isFile }
}
