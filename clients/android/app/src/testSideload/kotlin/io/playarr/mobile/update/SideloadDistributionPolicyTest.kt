package io.playarr.mobile.update

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class SideloadDistributionPolicyTest {
    @Test
    fun `sideload runtime and manifest retain signed APK updates and LAN HTTP`() {
        Class.forName("io.playarr.mobile.update.AndroidSelfUpdater")

        val appDirectory = androidAppDirectory()
        val manifest = File(appDirectory, "src/sideload/AndroidManifest.xml").readText()
        val networkPolicy = File(
            appDirectory,
            "src/main/res/xml/network_security_config.xml",
        ).readText()

        assertTrue(manifest.contains("android.permission.REQUEST_INSTALL_PACKAGES"))
        assertTrue(networkPolicy.contains("cleartextTrafficPermitted=\"true\""))
    }

    private fun androidAppDirectory(): File = generateSequence(File(System.getProperty("user.dir") ?: ".")) {
        it.parentFile
    }.first { File(it, "src/main/AndroidManifest.xml").isFile }
}
