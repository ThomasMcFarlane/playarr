package io.streamarr.mobile.ui

import io.streamarr.shared.data.model.MediaPlaybackOptionsResponse
import io.streamarr.shared.data.model.MediaPlaybackPreferenceResponse
import io.streamarr.shared.data.model.PlaybackAudioTrackOption
import io.streamarr.shared.data.model.PlaybackQualityOption
import io.streamarr.shared.data.model.PlaybackSubtitleTrackOption
import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrPlayerDefaultsTest {
    @Test
    fun `quality ladder matches Playarr Web and rejects unknown stored values`() {
        assertEquals(12, playarrQualityTiers.sumOf { it.options.size })
        assertEquals("h264-2160p-12mbps", playarrQualityTiers.first().options.first().id)
        assertEquals("h264-480p-3mbps", playarrQualityTiers.last().options.last().id)
        assertEquals("h264-1080p-8mbps", parsePlayarrQualityDefault("h264-1080p-8mbps"))
        assertEquals("original", parsePlayarrQualityDefault("4k"))
        assertEquals("original", parsePlayarrQualityDefault(null))
    }

    @Test
    fun `subtitle defaults fail safe and normalise language`() {
        assertEquals(PlayarrSubtitleDefault.Off, parsePlayarrSubtitleDefault(null))
        assertEquals(PlayarrSubtitleDefault.Off, parsePlayarrSubtitleDefault("sometimes"))
        assertEquals(PlayarrSubtitleDefault.Forced, parsePlayarrSubtitleDefault("forced"))
        assertEquals(PlayarrSubtitleDefault.Always, parsePlayarrSubtitleDefault("always"))
        assertEquals("en", parsePlayarrSubtitleLanguage("  EN "))
        assertEquals("en", parsePlayarrSubtitleLanguage("  "))
        assertEquals("th", parsePlayarrSubtitleLanguage("TH"))
    }

    @Test
    fun `language choices match Playarr Web`() {
        assertEquals(
            listOf("en", "es", "fr", "de", "it", "pt", "ja", "ko", "zh", "hi", "ar", "th"),
            playarrLanguageOptions.map(PlayarrLanguageOption::code),
        )
    }

    @Test
    fun `subtitle selection matches language forced and fallback policy`() {
        val tracks = listOf(
            subtitle("default", "spa", isDefault = true),
            subtitle("english", "eng"),
            subtitle("forced-english", "eng", forced = true),
        )

        assertEquals(
            null,
            selectPlayarrDefaultSubtitleTrackId(tracks, PlayarrPlayerDefaults(subtitleMode = PlayarrSubtitleDefault.Off)),
        )
        assertEquals(
            "english",
            selectPlayarrDefaultSubtitleTrackId(
                tracks,
                PlayarrPlayerDefaults(subtitleMode = PlayarrSubtitleDefault.Always, subtitleLanguage = "en"),
            ),
        )
        assertEquals(
            "forced-english",
            selectPlayarrDefaultSubtitleTrackId(
                tracks,
                PlayarrPlayerDefaults(subtitleMode = PlayarrSubtitleDefault.Forced, subtitleLanguage = "en"),
            ),
        )
        assertEquals(
            "default",
            selectPlayarrDefaultSubtitleTrackId(
                tracks,
                PlayarrPlayerDefaults(subtitleMode = PlayarrSubtitleDefault.Always, subtitleLanguage = "th"),
            ),
        )
    }

    @Test
    fun `movie launch combines saved choices with device defaults like web`() {
        val options = MediaPlaybackOptionsResponse(
            qualityOptions = listOf(
                PlaybackQualityOption("original", "Original"),
                PlaybackQualityOption("h264-1080p-8mbps", "FHD", profile = "h264-1080p-8mbps"),
            ),
            audioTracks = listOf(PlaybackAudioTrackOption("english", 2, "English")),
            subtitleTracks = listOf(subtitle("forced", "eng", forced = true)),
            preferences = MediaPlaybackPreferenceResponse(
                qualityId = "original",
                audioTrackId = "english",
            ),
        )

        val settings = resolvePlayarrPlaybackLaunchSettings(
            options,
            PlayarrPlayerDefaults(
                qualityId = "h264-1080p-8mbps",
                subtitleMode = PlayarrSubtitleDefault.Forced,
                subtitleLanguage = "en",
            ),
        )

        assertEquals("h264-1080p-8mbps", settings.qualityId)
        assertEquals(2, settings.audioStreamIndex)
        assertEquals("forced", settings.subtitleTrackId)
        assertEquals(true, settings.forceTranscode)
    }

    private fun subtitle(
        id: String,
        language: String,
        isDefault: Boolean = false,
        forced: Boolean = false,
    ) = PlaybackSubtitleTrackOption(
        id = id,
        streamIndex = 1,
        label = id,
        language = language,
        codec = "subrip",
        isDefault = isDefault,
        forced = forced,
        url = "/subtitles/$id",
    )
}
