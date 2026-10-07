package io.playarr.mobile.ui

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Play opens the player directly: no "Preparing playback" interstitial strings or screen remain. */
class PlayarrNoPreparingScreenTest {
    @Test
    fun `no preparing playback strings remain`() {
        val names = PlayarrString.values().map { it.name }
        assertFalse(names.any { it.startsWith("PlayerPreparing") })
        assertFalse(names.contains("PlayerOneMoment"))
        assertFalse(PlayarrString.values().any { s -> s.name.startsWith("Player") && s.toString().contains("Preparing playback") })
    }

    @Test
    fun `loading state mounts the player with a spinner and a close control, not a status page`() {
        val source = File("src/main/kotlin/io/playarr/mobile/ui/PlayarrExperience.kt").readText()
        val loading = source.substringAfter("// Play opens the player straight away").substringBefore("is ExperienceLoad.Failed")
        assertTrue(loading.contains("CircularProgressIndicator"))
        assertFalse(loading.contains("PlayarrPlayerStatus"))
        assertTrue(source.contains("PlayarrPlayerLoadingClose("))
    }
}
