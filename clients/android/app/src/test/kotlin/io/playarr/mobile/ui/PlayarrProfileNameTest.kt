package io.playarr.mobile.ui

import io.playarr.shared.data.model.AvailableProfile
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrProfileNameTest {
    private fun profile(id: String, display: String, current: Boolean) =
        AvailableProfile(id = id, username = "user-$id", displayName = display, isCurrent = current, pinLocked = false)

    private fun sync(saved: String?, profiles: suspend () -> List<AvailableProfile>): List<Pair<String, String>> {
        val saves = mutableListOf<Pair<String, String>>()
        runBlocking { syncProfileDisplayName(saved, profiles) { id, name -> saves += id to name } }
        return saves
    }

    @Test
    fun `the typed username is replaced by the server display name`() {
        val saves = sync("fx-viewer") { listOf(profile("1", "Other", false), profile("2", "Fixture Viewer", true)) }
        assertEquals(listOf("2" to "Fixture Viewer"), saves)
    }

    @Test
    fun `an up to date name is not written again`() {
        assertEquals(emptyList<Pair<String, String>>(), sync("Fixture Viewer") { listOf(profile("2", "Fixture Viewer", true)) })
    }

    @Test
    fun `a failed or blank lookup keeps the saved name`() {
        assertEquals(emptyList<Pair<String, String>>(), sync("fx-viewer") { error("offline") })
        assertEquals(emptyList<Pair<String, String>>(), sync("fx-viewer") { listOf(profile("2", " ", true)) })
        assertEquals(emptyList<Pair<String, String>>(), sync("fx-viewer") { listOf(profile("2", "Someone", false)) })
    }
}
