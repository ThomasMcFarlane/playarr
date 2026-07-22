package io.streamarr.mobile.ui

import org.junit.Assert.assertEquals
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
}
