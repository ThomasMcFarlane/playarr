package io.streamarr.mobile.ui

import io.streamarr.shared.data.model.MediaPlaybackOptionsResponse
import io.streamarr.shared.data.model.PlaybackSubtitleTrackOption

internal enum class PlayarrSubtitleDefault(val storageValue: String) {
    Off("off"),
    Forced("forced"),
    Always("always"),
}

internal data class PlayarrQualityOption(
    val id: String,
    val level: String,
    val bitrateMbps: Int,
)

internal data class PlayarrQualityTier(
    val label: String,
    val resolution: String,
    val options: List<PlayarrQualityOption>,
)

internal data class PlayarrLanguageOption(val code: String, val label: String)

internal data class PlayarrPlayerDefaults(
    val qualityId: String = "original",
    val subtitleMode: PlayarrSubtitleDefault = PlayarrSubtitleDefault.Off,
    val subtitleLanguage: String = "en",
)

internal val playarrQualityTiers = listOf(
    PlayarrQualityTier(
        "UHD",
        "2160p",
        listOf(
            PlayarrQualityOption("h264-2160p-12mbps", "Low", 12),
            PlayarrQualityOption("h264-2160p-20mbps", "Medium", 20),
            PlayarrQualityOption("h264-2160p-35mbps", "High", 35),
        ),
    ),
    PlayarrQualityTier(
        "FHD",
        "1080p",
        listOf(
            PlayarrQualityOption("h264-1080p-4mbps", "Low", 4),
            PlayarrQualityOption("h264-1080p-8mbps", "Medium", 8),
            PlayarrQualityOption("h264-1080p-12mbps", "High", 12),
        ),
    ),
    PlayarrQualityTier(
        "HD",
        "720p",
        listOf(
            PlayarrQualityOption("h264-720p-2mbps", "Low", 2),
            PlayarrQualityOption("h264-720p-4mbps", "Medium", 4),
            PlayarrQualityOption("h264-720p-6mbps", "High", 6),
        ),
    ),
    PlayarrQualityTier(
        "SD",
        "480p",
        listOf(
            PlayarrQualityOption("h264-480p-1mbps", "Low", 1),
            PlayarrQualityOption("h264-480p-2mbps", "Medium", 2),
            PlayarrQualityOption("h264-480p-3mbps", "High", 3),
        ),
    ),
)

internal val playarrLanguageOptions = listOf(
    PlayarrLanguageOption("en", "English"),
    PlayarrLanguageOption("es", "Spanish"),
    PlayarrLanguageOption("fr", "French"),
    PlayarrLanguageOption("de", "German"),
    PlayarrLanguageOption("it", "Italian"),
    PlayarrLanguageOption("pt", "Portuguese"),
    PlayarrLanguageOption("ja", "Japanese"),
    PlayarrLanguageOption("ko", "Korean"),
    PlayarrLanguageOption("zh", "Chinese"),
    PlayarrLanguageOption("hi", "Hindi"),
    PlayarrLanguageOption("ar", "Arabic"),
    PlayarrLanguageOption("th", "Thai"),
)

private val playarrQualityIds = playarrQualityTiers.flatMap { tier -> tier.options.map(PlayarrQualityOption::id) }.toSet()

internal fun parsePlayarrQualityDefault(value: String?): String =
    value?.takeIf { it == "original" || it in playarrQualityIds } ?: "original"

internal fun parsePlayarrSubtitleDefault(value: String?): PlayarrSubtitleDefault =
    PlayarrSubtitleDefault.entries.firstOrNull { it.storageValue == value } ?: PlayarrSubtitleDefault.Off

internal fun parsePlayarrSubtitleLanguage(value: String?): String =
    value?.trim()?.lowercase()?.takeIf(String::isNotEmpty) ?: "en"

private val playarrLanguageAliases = mapOf(
    "ara" to "ar",
    "chi" to "zh",
    "deu" to "de",
    "eng" to "en",
    "fra" to "fr",
    "fre" to "fr",
    "ger" to "de",
    "hin" to "hi",
    "ita" to "it",
    "jpn" to "ja",
    "kor" to "ko",
    "por" to "pt",
    "spa" to "es",
    "tha" to "th",
    "zho" to "zh",
)

private fun normalisePlayarrTrackLanguage(value: String?): String {
    val language = value?.trim()?.lowercase()?.split('-', '_')?.firstOrNull().orEmpty()
    return playarrLanguageAliases[language] ?: language
}

internal fun selectPlayarrDefaultSubtitleTrackId(
    tracks: List<PlaybackSubtitleTrackOption>,
    defaults: PlayarrPlayerDefaults,
): String? {
    if (defaults.subtitleMode == PlayarrSubtitleDefault.Off) return null
    val eligible = if (defaults.subtitleMode == PlayarrSubtitleDefault.Forced) {
        tracks.filter(PlaybackSubtitleTrackOption::forced)
    } else {
        tracks
    }
    if (eligible.isEmpty()) return null
    val language = normalisePlayarrTrackLanguage(defaults.subtitleLanguage)
    return eligible.firstOrNull { normalisePlayarrTrackLanguage(it.language) == language }?.id
        ?: eligible.firstOrNull(PlaybackSubtitleTrackOption::isDefault)?.id
        ?: eligible.first().id
}

internal fun resolvePlayarrPlaybackLaunchSettings(
    options: MediaPlaybackOptionsResponse,
    defaults: PlayarrPlayerDefaults,
): PlayarrPlaybackLaunchSettings {
    val preferredQualityId = if (options.preferences.qualityId == "original") {
        defaults.qualityId
    } else {
        options.preferences.qualityId
    }
    val quality = options.qualityOptions.firstOrNull { it.id == preferredQualityId }
    val audio = options.audioTracks.firstOrNull { it.id == options.preferences.audioTrackId }
    return PlayarrPlaybackLaunchSettings(
        qualityId = quality?.id ?: "original",
        profile = quality?.profile,
        forceTranscode = quality?.id != null && quality.id != "original",
        audioStreamIndex = audio?.streamIndex,
        subtitleTrackId = options.preferences.subtitleTrackId
            ?: selectPlayarrDefaultSubtitleTrackId(options.subtitleTracks, defaults),
    )
}
