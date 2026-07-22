package io.streamarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrLocalizationTest {
    @Test
    fun `explicit preference overrides device languages`() {
        assertEquals(
            PlayarrResolvedLanguage.Japanese,
            resolvePlayarrLanguage("ja", listOf("th-TH", "en-US")),
        )
    }

    @Test
    fun `system preference selects the first supported base language`() {
        assertEquals(
            PlayarrResolvedLanguage.Thai,
            resolvePlayarrLanguage("system", listOf("fr-FR", "th-TH", "ja-JP")),
        )
        assertEquals(
            PlayarrResolvedLanguage.Japanese,
            resolvePlayarrLanguage("system", listOf("ja_JP")),
        )
    }

    @Test
    fun `unknown preferences and unsupported device languages fall back to English`() {
        assertEquals("system", parsePlayarrLanguagePreference("de"))
        assertEquals(
            PlayarrResolvedLanguage.English,
            resolvePlayarrLanguage("de", listOf("de-DE", "fr-FR")),
        )
    }

    @Test
    fun `translations interpolate known parameters and preserve unknown tokens`() {
        assertEquals(
            "Pairing code ABCD-2345",
            PlayarrLanguageState("en", PlayarrResolvedLanguage.English).text(
                PlayarrString.DeviceLoginPairingCode,
                mapOf("code" to "ABCD-2345"),
            ),
        )
        assertEquals(
            "Pairing code {{code}}",
            interpolatePlayarrTranslation("Pairing code {{code}}", emptyMap()),
        )
    }

    @Test
    fun `localized messages resolve nested subject keys while dynamic diagnostics remain unchanged`() {
        val thai = PlayarrLanguageState("th", PlayarrResolvedLanguage.Thai)
        assertEquals(
            "โปรไฟล์นี้ไม่มีสิทธิ์เข้าถึงการตั้งค่า",
            thai.text(
                PlayarrMessage.Localized(
                    PlayarrString.ErrorProfileCannotAccess,
                    mapOf("subject" to PlayarrString.ErrorSubjectSettings),
                ),
            ),
        )
        assertEquals(
            "upstream diagnostic 42",
            thai.text(PlayarrMessage.Dynamic("upstream diagnostic 42")),
        )
    }

    @Test
    fun `playback queue fallback titles follow the active language`() {
        val japanese = PlayarrLanguageState("ja", PlayarrResolvedLanguage.Japanese)
        assertEquals(
            "エピソード7",
            PlayarrPlaybackQueueItem(
                mediaFileId = "episode-7",
                title = "",
                fallbackTitle = PlayarrString.DetailEpisodeNumber,
                fallbackTitleParameters = mapOf("number" to 7),
            ).displayTitle(japanese),
        )
        assertEquals(
            "再生中",
            PlayarrPlaybackQueueItem("unknown", "").displayTitle(japanese),
        )
    }

    @Test
    fun `player queue units match web singular plural and music rules`() {
        assertEquals(PlayarrString.PlayerUnitTrack, playarrPlayerQueueUnit(1, music = true))
        assertEquals(PlayarrString.PlayerUnitTracks, playarrPlayerQueueUnit(2, music = true))
        assertEquals(PlayarrString.PlayerUnitItem, playarrPlayerQueueUnit(1, music = false))
        assertEquals(PlayarrString.PlayerUnitEpisodes, playarrPlayerQueueUnit(2, music = false))
    }

    @Test
    fun `every locale has nonblank text and matching interpolation tokens`() {
        val tokenPattern = "\\{\\{(\\w+)\\}\\}".toRegex()
        PlayarrString.entries.forEach { key ->
            assertTrue("${key.name} English is blank", key.english.isNotBlank())
            assertTrue("${key.name} Thai is blank", key.thai.isNotBlank())
            assertTrue("${key.name} Japanese is blank", key.japanese.isNotBlank())
            val expected = tokenPattern.findAll(key.english).map { it.groupValues[1] }.toSet()
            assertEquals("${key.name} Thai tokens", expected, tokenPattern.findAll(key.thai).map { it.groupValues[1] }.toSet())
            assertEquals("${key.name} Japanese tokens", expected, tokenPattern.findAll(key.japanese).map { it.groupValues[1] }.toSet())
        }
    }
}
