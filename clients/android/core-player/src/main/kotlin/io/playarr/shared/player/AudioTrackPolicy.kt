package io.playarr.shared.player

import androidx.media3.common.C

/**
 * One decodable-or-not audio track, flattened from Media3's track groups so
 * the selection policy stays pure and unit-testable.
 */
internal data class AudioCandidate(
    val groupIndex: Int,
    val trackIndex: Int,
    val language: String?,
    val channelCount: Int,
    val isSupported: Boolean,
    val isDefault: Boolean,
    val isCommentary: Boolean,
)

internal sealed interface AudioChoice {
    /** Leave Media3's own selection alone. */
    data object Keep : AudioChoice

    /** Override to [candidate]; [onlyCommentary] is true when nothing else was decodable. */
    data class Override(val candidate: AudioCandidate, val onlyCommentary: Boolean) : AudioChoice
}

/**
 * Media3 skips an undecodable track and takes the next supported one, which
 * on a remux with a DTS-HD main track and stereo AC3 commentaries means the
 * commentary plays. When the main (default) track cannot be decoded we pick
 * the best supported non-commentary track instead.
 */
internal object AudioTrackPolicy {

    fun isCommentary(roleFlags: Int, label: String?): Boolean =
        roleFlags and C.ROLE_FLAG_COMMENTARY != 0 ||
            label?.contains("commentary", ignoreCase = true) == true

    fun choose(candidates: List<AudioCandidate>, preferredLanguage: String?): AudioChoice {
        if (candidates.isEmpty()) return AudioChoice.Keep
        val main = candidates.firstOrNull { it.isDefault } ?: candidates.first()
        if (main.isSupported) return AudioChoice.Keep
        val supported = candidates.filter { it.isSupported }
        if (supported.isEmpty()) return AudioChoice.Keep

        val language = (preferredLanguage ?: main.language)?.let(::primaryLanguage)
        val ranked = compareByDescending<AudioCandidate> { it.language?.let(::primaryLanguage) == language && language != null }
            .thenByDescending { it.channelCount }
            .thenByDescending { it.isDefault }

        val mains = supported.filterNot { it.isCommentary }
        if (mains.isNotEmpty()) {
            return AudioChoice.Override(mains.sortedWith(ranked).first(), onlyCommentary = false)
        }
        return AudioChoice.Override(supported.sortedWith(ranked).first(), onlyCommentary = true)
    }

    private fun primaryLanguage(tag: String): String =
        tag.substringBefore('-').substringBefore('_').lowercase()
}
