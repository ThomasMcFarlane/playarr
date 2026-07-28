package io.playarr.mobile.ui

import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [buildTvWebBootstrapScript] — the real script injected into the
 * television WebView so the SPA boots with the same session the native
 * shell already redeemed.
 */
class PlayarrTvWebShellTest {
    @Test
    fun `bootstrap script embeds session tokens and api base`() {
        val script = buildTvWebBootstrapScript(
            apiBaseUrl = "http://192.0.2.58:8484",
            accessToken = "access-token-value",
            refreshToken = "refresh-token-value",
            userId = "user-1",
            userName = "Test User A",
            darkTheme = true,
        )
        assertTrue(script.contains("access-token-value"))
        assertTrue(script.contains("refresh-token-value"))
        assertTrue(script.contains("http://192.0.2.58:8484"))
        assertTrue(script.contains("Test User A"))
        assertTrue(script.contains("playarr.profileSessions.v4"))
        assertTrue(script.contains("streamarr:session"))
        assertTrue(script.contains("dark"))
    }

    @Test
    fun `bootstrap script selects light theme when requested`() {
        val script = buildTvWebBootstrapScript(
            apiBaseUrl = "https://example.test",
            accessToken = "a",
            refreshToken = "r",
            userId = "u",
            userName = "N",
            darkTheme = false,
        )
        assertTrue(script.contains("playarr-theme"))
        assertTrue(script.contains("light"))
    }
}
