package io.playarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrPlaybackControlsTest {
    @Test
    fun `native negotiation advertises the documented Media3 capability set`() {
        assertEquals("mp4,webm,mkv,mp3,flac,m4a,ogg,opus,wav", playarrAndroidContainers)
        assertEquals("h264,h265,vp9,av1", playarrAndroidVideoCodecs)
        assertEquals("aac,opus,mp3,flac,vorbis,pcm_s16le,pcm_s24le", playarrAndroidAudioCodecs)
    }
}
