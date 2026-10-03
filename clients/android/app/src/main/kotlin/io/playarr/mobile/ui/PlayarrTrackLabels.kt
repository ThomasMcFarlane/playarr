package io.playarr.mobile.ui

import io.playarr.shared.data.model.PlaybackAudioTrackOption
import io.playarr.shared.data.model.PlaybackSubtitleTrackOption
import java.util.Locale

/**
 * Human labels for the player's audio and subtitle menus. The server's `label` is the
 * container title or, failing that, the bare language code, so two English tracks both read
 * "eng". These helpers combine the language name, a distinguishing title (commentary, SDH...),
 * the codec and the channel layout, e.g. "English · DTS 5.1" or "English · Commentary · AC3 2.0".
 */
internal fun playarrAudioTrackLabel(track: PlaybackAudioTrackOption, displayLocale: Locale = Locale.getDefault()): String {
    val language = playarrLanguageName(track.language, displayLocale)
    val parts = buildList {
        language?.let(::add)
        playarrTrackTitle(track.label, track.language, language)?.let(::add)
        val format = listOfNotNull(playarrAudioCodecName(track.codec), playarrChannelLayout(track.channels))
            .joinToString(" ")
        if (format.isNotEmpty()) add(format)
    }
    return parts.joinToString(" · ").ifBlank { track.label }
}

internal fun playarrSubtitleTrackLabel(
    track: PlaybackSubtitleTrackOption,
    displayLocale: Locale = Locale.getDefault(),
    forcedLabel: String = "Forced",
): String {
    val language = playarrLanguageName(track.language, displayLocale)
    val parts = buildList {
        language?.let(::add)
        playarrTrackTitle(track.label, track.language, language)?.let(::add)
        if (track.forced) add(forcedLabel)
    }
    return parts.joinToString(" · ").ifBlank { track.label }
}

/** The track's own title when it adds something beyond the language ("Commentary", "SDH"). */
internal fun playarrTrackTitle(label: String, languageCode: String?, languageName: String?): String? {
    val title = label.trim()
    if (title.isEmpty()) return null
    val normalised = title.lowercase(Locale.ROOT)
    if (normalised == languageCode?.trim()?.lowercase(Locale.ROOT)) return null
    if (languageName != null && normalised.contains(languageName.lowercase(Locale.ROOT))) return null
    // The server's own fallbacks ("Audio 2", "Subtitles 3") say nothing.
    if (Regex("^(audio|subtitles?)\\s*\\d+$").matches(normalised)) return null
    return title
}

private val bibliographicLanguageCodes = mapOf(
    "fre" to "fra", "ger" to "deu", "dut" to "nld", "chi" to "zho", "cze" to "ces", "gre" to "ell",
    "ice" to "isl", "mac" to "mkd", "mao" to "mri", "may" to "msa", "per" to "fas", "rum" to "ron",
    "slo" to "slk", "tib" to "bod", "wel" to "cym", "arm" to "hye", "baq" to "eus", "bur" to "mya",
    "geo" to "kat", "alb" to "sqi",
)

/** ISO 639-2/T (three letter) to ISO 639-1, which `Locale` display names are keyed by. */
private val iso3ToIso2: Map<String, String> by lazy {
    Locale.getISOLanguages().associateBy { runCatching { Locale.forLanguageTag(it).isO3Language }.getOrDefault(it) }
}

internal fun playarrLanguageName(code: String?, displayLocale: Locale = Locale.getDefault()): String? {
    val trimmed = code?.trim()?.lowercase(Locale.ROOT)?.takeIf { it.isNotEmpty() && it != "und" } ?: return null
    val canonical = bibliographicLanguageCodes[trimmed] ?: trimmed
    val tag = iso3ToIso2[canonical] ?: canonical
    val name = Locale.forLanguageTag(tag).getDisplayLanguage(displayLocale)
    return name.takeIf { it.isNotBlank() && !it.equals(tag, ignoreCase = true) }
        ?.replaceFirstChar { it.titlecase(displayLocale) }
        ?: trimmed
}

internal fun playarrAudioCodecName(codec: String?): String? {
    val value = codec?.trim()?.lowercase(Locale.ROOT)?.takeIf { it.isNotEmpty() } ?: return null
    return when {
        value == "ac3" -> "AC3"
        value == "eac3" -> "E-AC3"
        value == "dts" -> "DTS"
        value == "truehd" -> "TrueHD"
        value == "aac" -> "AAC"
        value == "mp3" -> "MP3"
        value == "mp2" -> "MP2"
        value == "opus" -> "Opus"
        value == "vorbis" -> "Vorbis"
        value == "flac" -> "FLAC"
        value == "alac" -> "ALAC"
        value.startsWith("pcm") -> "PCM"
        else -> value.uppercase(Locale.ROOT)
    }
}

internal fun playarrChannelLayout(channels: Int?): String? = when (channels) {
    null, 0 -> null
    1 -> "1.0"
    2 -> "2.0"
    3 -> "2.1"
    4 -> "4.0"
    5 -> "5.0"
    6 -> "5.1"
    7 -> "6.1"
    8 -> "7.1"
    else -> "$channels ch"
}
