package io.playarr.shared.player

import androidx.media3.common.C
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioTrackPolicyTest {
    private fun track(
        index: Int,
        supported: Boolean = true,
        default: Boolean = false,
        commentary: Boolean = false,
        channels: Int = 2,
        language: String? = "en",
    ) = AudioCandidate(0, index, language, channels, supported, default, commentary)

    private fun picked(choice: AudioChoice) = (choice as AudioChoice.Override).candidate.trackIndex

    @Test
    fun `keeps media3 choice when main track is supported`() {
        val tracks = listOf(track(0, default = true, channels = 8), track(1, commentary = true))
        assertEquals(AudioChoice.Keep, AudioTrackPolicy.choose(tracks, "en"))
    }

    @Test
    fun `avoids commentary when main track is undecodable`() {
        val tracks = listOf(
            track(0, supported = false, default = true, channels = 8),
            track(1, commentary = true),
            track(2, commentary = true),
            track(3, channels = 6),
        )
        val choice = AudioTrackPolicy.choose(tracks, "en") as AudioChoice.Override
        assertEquals(3, choice.candidate.trackIndex)
        assertFalse(choice.onlyCommentary)
    }

    @Test
    fun `prefers same language then highest channel count`() {
        val tracks = listOf(
            track(0, supported = false, default = true, channels = 8, language = "en"),
            track(1, channels = 8, language = "fr"),
            track(2, channels = 2, language = "en"),
            track(3, channels = 6, language = "en-GB"),
        )
        assertEquals(3, picked(AudioTrackPolicy.choose(tracks, null)))
    }

    @Test
    fun `falls back to commentary and flags it when it is all that decodes`() {
        val tracks = listOf(
            track(0, supported = false, default = true, channels = 8),
            track(1, commentary = true, channels = 2),
            track(2, commentary = true, channels = 1),
        )
        val choice = AudioTrackPolicy.choose(tracks, "en") as AudioChoice.Override
        assertEquals(1, choice.candidate.trackIndex)
        assertTrue(choice.onlyCommentary)
    }

    @Test
    fun `keeps when nothing is supported or no tracks`() {
        assertEquals(AudioChoice.Keep, AudioTrackPolicy.choose(emptyList(), "en"))
        assertEquals(AudioChoice.Keep, AudioTrackPolicy.choose(listOf(track(0, supported = false)), "en"))
    }

    @Test
    fun `detects commentary by role flag or label`() {
        assertTrue(AudioTrackPolicy.isCommentary(C.ROLE_FLAG_COMMENTARY, null))
        assertTrue(AudioTrackPolicy.isCommentary(0, "Director's Commentary"))
        assertFalse(AudioTrackPolicy.isCommentary(C.ROLE_FLAG_MAIN, "English DTS-HD"))
    }
}
