package io.playarr.mobile.ui

import org.junit.Assert.assertEquals
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

    @Test
    fun miniPlayerOnlyShowsWhenPlaybackIsReady() {
        assertTrue(shouldShowPlayarrMiniPlayer(isPlayer = false, hasPlayback = true, playerReady = true))
        assertFalse(shouldShowPlayarrMiniPlayer(isPlayer = false, hasPlayback = true, playerReady = false))
        assertFalse(shouldShowPlayarrMiniPlayer(isPlayer = true, hasPlayback = true, playerReady = true))
        assertFalse(shouldShowPlayarrMiniPlayer(isPlayer = false, hasPlayback = false, playerReady = true))
    }

    @Test
    fun minimiseFallsBackToTheMiniPlayerWhenPictureInPictureIsUnavailable() {
        assertEquals(PlayarrMinimiseTarget.PictureInPicture, playarrMinimiseTarget(isMusic = false, pipSupported = true))
        assertEquals(PlayarrMinimiseTarget.MiniPlayer, playarrMinimiseTarget(isMusic = false, pipSupported = false))
        assertEquals(PlayarrMinimiseTarget.MiniPlayer, playarrMinimiseTarget(isMusic = true, pipSupported = true))
        assertEquals(PlayarrMinimiseTarget.MiniPlayer, playarrMinimiseTarget(isMusic = true, pipSupported = false))
    }

    @Test
    fun miniPlayerShowsLiveVideoForVideoOnly() {
        assertTrue(playarrMiniPlayerShowsVideo(isMusic = false))
        assertFalse(playarrMiniPlayerShowsVideo(isMusic = true))
    }

    @Test
    fun failedPlaybackIsClearedOnlyOffThePlayerScreen() {
        assertTrue(shouldClearPlayarrFailedPlayback(playerFailed = true, isPlayer = false, hasPlayback = true))
        assertFalse(shouldClearPlayarrFailedPlayback(playerFailed = true, isPlayer = true, hasPlayback = true))
        assertFalse(shouldClearPlayarrFailedPlayback(playerFailed = false, isPlayer = false, hasPlayback = true))
    }

    @Test
    fun `settings section numbers are two digits like web`() {
        assertEquals("01", settingsSectionNumber(0))
        assertEquals("09", settingsSectionNumber(8))
        assertEquals("10", settingsSectionNumber(9))
    }
}
