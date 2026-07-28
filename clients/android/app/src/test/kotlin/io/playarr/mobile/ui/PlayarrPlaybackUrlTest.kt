package io.playarr.mobile.ui

import io.playarr.shared.data.remote.PlayarrServerAccess
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlayarrPlaybackUrlTest {
    @Test
    fun `relative Playarr Server playback paths resolve against the selected server`() {
        assertEquals(
            "https://playarr.example/api/v1/media/mf-1/stream?playback_session_id=session-1",
            resolvePlayarrPlaybackUrl(
                "https://playarr.example",
                "/api/v1/media/mf-1/stream?playback_session_id=session-1",
            ),
        )
    }

    @Test
    fun `absolute peer playback URLs remain unchanged`() {
        assertEquals(
            "https://peer.example/api/v1/media/mf-1/stream",
            resolvePlayarrPlaybackUrl(
                "https://playarr.example/",
                "https://peer.example/api/v1/media/mf-1/stream",
            ),
        )
    }

    @Test
    fun `bearer token is attached only to the owning server origin`() {
        val access = PlayarrServerAccess("https://secondary.example", "secondary-token")

        assertEquals(
            "secondary-token",
            playarrAccessTokenForUrl(access, "https://secondary.example:443/api/v1/artwork/work/one/poster"),
        )
        assertNull(playarrAccessTokenForUrl(access, "https://images.example/poster.jpg"))
        assertNull(playarrAccessTokenForUrl(access, "not a URL"))
    }
}
