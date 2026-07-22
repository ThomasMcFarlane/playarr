package io.streamarr.mobile.ui

internal data class PlayarrPlaybackQueue(
    val mediaFileIds: List<String> = emptyList(),
    val currentIndex: Int = -1,
) {
    val currentMediaFileId: String?
        get() = mediaFileIds.getOrNull(currentIndex)

    val canPrevious: Boolean
        get() = currentIndex > 0

    val canNext: Boolean
        get() = currentIndex in 0 until mediaFileIds.lastIndex

    fun move(delta: Int): PlayarrPlaybackQueue {
        if (mediaFileIds.isEmpty() || delta == 0) return this
        val nextIndex = (currentIndex + delta).coerceIn(0, mediaFileIds.lastIndex)
        return copy(currentIndex = nextIndex)
    }
}

internal fun playarrPlaybackQueue(
    mediaFileId: String,
    orderedMediaFileIds: List<String>,
): PlayarrPlaybackQueue {
    val candidates = orderedMediaFileIds.filter(String::isNotBlank)
        .ifEmpty { listOf(mediaFileId) }
    val selectedIndex = candidates.indexOf(mediaFileId).takeIf { it >= 0 }
    return if (selectedIndex != null) {
        PlayarrPlaybackQueue(candidates, selectedIndex)
    } else {
        PlayarrPlaybackQueue(candidates + mediaFileId, candidates.size)
    }
}
