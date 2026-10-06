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

    private fun audio(label: String, language: String?, codec: String?, channels: Int?, codecLabel: String? = null) =
        PlaybackAudioTrackOption("a", 1, label, language, codec, codecLabel, channels)

    @Test
    fun identicalLanguageCodesBecomeDistinguishableByCodecAndLayout() {
        val a = playarrAudioTrackLabel(audio("eng", "eng", "dts", 8), en)
        val b = playarrAudioTrackLabel(audio("eng", "eng", "ac3", 2), en)
        assertEquals("English · DTS · 7.1", a)
        assertEquals("English · AC3 · Stereo", b)
        assertNotEquals(a, b)
    }

    /** The same label the Web client shows for this dub (`trackLabels.test.ts`). */
    @Test
    fun dubReadsLikeTheWebClient() {
        assertEquals("German · AAC · Stereo", playarrAudioTrackLabel(audio("deu", "deu", "aac", 2), en))
        assertEquals(
            "German · DTS-HD MA · 5.1",
            playarrAudioTrackLabel(audio("deu", "deu", "dts", 6, codecLabel = "DTS-HD MA"), en),
        )
    }

    @Test
    fun localisedChannelWordsAreUsed() {
        assertEquals(
            "German · AAC · ステレオ",
            playarrAudioTrackLabel(audio("deu", "deu", "aac", 2), en, monoLabel = "モノラル", stereoLabel = "ステレオ"),
        )
    }

    @Test
    fun commentaryTitleIsKept() {
        assertEquals(
            "English · Commentary · AC3 · Stereo",
            playarrAudioTrackLabel(audio("Commentary", "eng", "ac3", 2), en),
        )
        assertEquals(
            "English · Director's Commentary · AAC · Stereo",
            playarrAudioTrackLabel(audio("Director's Commentary", "eng", "aac", 2), en),
        )
    }

    @Test
    fun titleRepeatingTheLanguageIsDropped() {
        assertEquals("English · TrueHD · 5.1", playarrAudioTrackLabel(audio("English TrueHD Atmos", "eng", "truehd", 6), en))
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
        assertEquals("AAC · Stereo", playarrAudioTrackLabel(audio("Audio 1", null, "aac", 2), en))
        assertEquals("Audio 1", playarrAudioTrackLabel(audio("Audio 1", null, null, null), en))
    }

    @Test
    fun channelLayouts() {
        assertEquals("5.1", playarrChannelLayout(6))
        assertEquals("7.1", playarrChannelLayout(8))
        assertEquals("Mono", playarrChannelLayout(1))
        assertEquals("Stereo", playarrChannelLayout(2))
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
