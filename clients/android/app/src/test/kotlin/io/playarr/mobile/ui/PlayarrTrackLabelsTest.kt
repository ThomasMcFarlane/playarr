package io.playarr.mobile.ui

import io.playarr.shared.data.model.PlaybackAudioTrackOption
import io.playarr.shared.data.model.PlaybackSubtitleTrackOption
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlayarrTrackLabelsTest {
    private val en = Locale.ENGLISH

    private fun audio(label: String, language: String?, codec: String?, channels: Int?) =
        PlaybackAudioTrackOption("a", 1, label, language, codec, channels)

    @Test
    fun identicalLanguageCodesBecomeDistinguishableByCodecAndLayout() {
        val a = playarrAudioTrackLabel(audio("eng", "eng", "dts", 8), en)
        val b = playarrAudioTrackLabel(audio("eng", "eng", "ac3", 2), en)
        assertEquals("English · DTS 7.1", a)
        assertEquals("English · AC3 2.0", b)
        assertNotEquals(a, b)
    }

    @Test
    fun commentaryTitleIsKept() {
        assertEquals(
            "English · Commentary · AC3 2.0",
            playarrAudioTrackLabel(audio("Commentary", "eng", "ac3", 2), en),
        )
        assertEquals(
            "English · Director's Commentary · AAC 2.0",
            playarrAudioTrackLabel(audio("Director's Commentary", "eng", "aac", 2), en),
        )
    }

    @Test
    fun titleRepeatingTheLanguageIsDropped() {
        assertEquals("English · TrueHD 5.1", playarrAudioTrackLabel(audio("English TrueHD Atmos", "eng", "truehd", 6), en))
        assertNull(playarrTrackTitle("Audio 2", null, null))
        assertNull(playarrTrackTitle("eng", "eng", "English"))
    }

    @Test
    fun bibliographicAndUnknownLanguageCodes() {
        assertEquals("French", playarrLanguageName("fre", en))
        assertEquals("German", playarrLanguageName("deu", en))
        assertEquals("Japanese", playarrLanguageName("jpn", en))
        assertNull(playarrLanguageName("und", en))
        assertNull(playarrLanguageName(null, en))
        assertEquals("zzz", playarrLanguageName("zzz", en))
    }

    @Test
    fun noLanguageFallsBackToCodecAndLayoutOrServerLabel() {
        assertEquals("AAC 2.0", playarrAudioTrackLabel(audio("Audio 1", null, "aac", 2), en))
        assertEquals("Audio 1", playarrAudioTrackLabel(audio("Audio 1", null, null, null), en))
    }

    @Test
    fun channelLayouts() {
        assertEquals("5.1", playarrChannelLayout(6))
        assertEquals("7.1", playarrChannelLayout(8))
        assertEquals("1.0", playarrChannelLayout(1))
        assertEquals("10 ch", playarrChannelLayout(10))
        assertNull(playarrChannelLayout(null))
    }

    @Test
    fun subtitleLabelsCarryLanguageTitleAndForcedFlag() {
        val sdh = PlaybackSubtitleTrackOption("s1", 3, "SDH", "eng", "subrip", forced = false, url = "u")
        val forced = PlaybackSubtitleTrackOption("s2", 4, "eng", "eng", "subrip", forced = true, url = "u")
        assertEquals("English · SDH", playarrSubtitleTrackLabel(sdh, en))
        assertEquals("English · Forced", playarrSubtitleTrackLabel(forced, en))
    }
}
