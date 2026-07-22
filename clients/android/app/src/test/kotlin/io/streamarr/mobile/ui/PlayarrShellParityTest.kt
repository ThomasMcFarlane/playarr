package io.streamarr.mobile.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrShellParityTest {
    @Test
    fun `offline shell gates connection-required routes`() {
        listOf(
            "home",
            "search",
            "series",
            "movies",
            "sites",
            "music",
            "playlists",
            "playlists/{playlistId}",
            "settings",
            "experience-detail/{workId}?mediaFileId={mediaFileId}",
        ).forEach { route ->
            assertTrue(route, shouldShowPlayarrOfflineState(isOnline = false, currentRoute = route))
        }
    }

    @Test
    fun `offline shell leaves offline-capable routes available`() {
        listOf(
            "downloads",
            "profiles",
            "experience-player/{mediaFileId}",
        ).forEach { route ->
            assertFalse(route, shouldShowPlayarrOfflineState(isOnline = false, currentRoute = route))
        }
    }

    @Test
    fun `online shell never shows the offline state`() {
        assertFalse(shouldShowPlayarrOfflineState(isOnline = true, currentRoute = "home"))
    }

    @Test
    fun `back closes only a minimised active player`() {
        assertTrue(shouldHandlePlayarrMiniPlayerBack(isPlayer = false, hasPlayback = true))
        assertFalse(shouldHandlePlayarrMiniPlayerBack(isPlayer = false, hasPlayback = false))
        assertFalse(shouldHandlePlayarrMiniPlayerBack(isPlayer = true, hasPlayback = true))
    }
}
