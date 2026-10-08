package io.playarr.mobile.ui

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Customise Home lives in Settings (owner ruling, 8 October); Home has no action button and no dialog for it. */
class PlayarrCustomiseHomeInSettingsTest {
    private fun ui(name: String): String {
        val dir = File("src/main/kotlin/io/playarr/mobile/ui").takeIf { it.isDirectory }
            ?: File("app/src/main/kotlin/io/playarr/mobile/ui")
        return File(dir, name).readText()
    }

    @Test
    fun `home no longer shows a Customise Home button or dialog`() {
        val home = ui("PlayarrExperience.kt")
        assertFalse(home.contains("PlayarrString.HomeCustomise)"))
        assertFalse(home.contains("CustomiseHomeDialog"))
    }

    @Test
    fun `settings has a Customise Home section with the same controls`() {
        val settings = ui("PlayarrParityScreens.kt")
        assertTrue(settings.contains("Home(PlayarrString.HomeCustomise)"))
        assertTrue(settings.contains("SettingsSection.Home to PlayarrString.HomeCustomiseDescription"))
        listOf("HomeCustomiseUp", "HomeCustomiseDown", "HomeCustomiseHide", "HomeCustomiseShow", "HomeCustomiseReset")
            .forEach { assertTrue(it, settings.contains("PlayarrString.$it")) }
    }
}
