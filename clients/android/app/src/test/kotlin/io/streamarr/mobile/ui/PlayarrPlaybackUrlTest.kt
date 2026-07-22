package io.streamarr.mobile.ui

import io.streamarr.shared.data.remote.StreamarrServerAccess
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlayarrPlaybackUrlTest {
    @Test
    fun `relative Streamarr playback paths resolve against the selected server`() {
        assertEquals(
            "https://streamarr.example/api/v1/media/mf-1/stream?playback_session_id=session-1",
            resolveStreamarrPlaybackUrl(
                "https://streamarr.example",
                "/api/v1/media/mf-1/stream?playback_session_id=session-1",
            ),
        )
    }

    @Test
    fun `absolute peer playback URLs remain unchanged`() {
        assertEquals(
            "https://peer.example/api/v1/media/mf-1/stream",
            resolveStreamarrPlaybackUrl(
                "https://streamarr.example/",
                "https://peer.example/api/v1/media/mf-1/stream",
            ),
        )
    }

    @Test
    fun `bearer token is attached only to the owning server origin`() {
        val access = StreamarrServerAccess("https://secondary.example", "secondary-token")

        assertEquals(
            "secondary-token",
            playarrAccessTokenForUrl(access, "https://secondary.example:443/api/v1/artwork/work/one/poster"),
        )
        assertNull(playarrAccessTokenForUrl(access, "https://images.example/poster.jpg"))
        assertNull(playarrAccessTokenForUrl(access, "not a URL"))
    }
}
