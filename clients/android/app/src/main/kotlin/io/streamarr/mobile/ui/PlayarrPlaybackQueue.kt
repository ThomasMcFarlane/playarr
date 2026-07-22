package io.streamarr.mobile.ui

import io.streamarr.shared.data.model.PlaylistItem
import io.streamarr.shared.data.model.SeasonDetail
import io.streamarr.shared.data.model.Work
import io.streamarr.shared.data.model.WorkChildren
import io.streamarr.shared.data.model.WorkDetail

internal data class PlayarrPlaybackQueueItem(
    val mediaFileId: String,
    val title: String,
    val subtitle: String? = null,
    val seasonNumber: Int? = null,
    val episodeNumber: Int? = null,
    val music: Boolean = false,
    val albumId: String? = null,
    val artworkWork: Work? = null,
)

internal data class PlayarrPlaybackQueue(
    val items: List<PlayarrPlaybackQueueItem> = emptyList(),
    val currentIndex: Int = -1,
) {
    val currentItem: PlayarrPlaybackQueueItem?
        get() = items.getOrNull(currentIndex)

    val currentMediaFileId: String?
        get() = currentItem?.mediaFileId

    val canPrevious: Boolean
        get() = currentIndex > 0

    val canNext: Boolean
        get() = currentIndex in 0 until items.lastIndex

    fun move(delta: Int): PlayarrPlaybackQueue {
        if (items.isEmpty() || delta == 0) return this
        val nextIndex = (currentIndex + delta).coerceIn(0, items.lastIndex)
        return copy(currentIndex = nextIndex)
    }

    fun select(index: Int): PlayarrPlaybackQueue =
        if (index in items.indices) copy(currentIndex = index) else this
}

internal fun playarrPlaybackQueue(
    mediaFileId: String,
    orderedItems: List<PlayarrPlaybackQueueItem>,
): PlayarrPlaybackQueue {
    val candidates = orderedItems.filter { it.mediaFileId.isNotBlank() }
        .ifEmpty { listOf(PlayarrPlaybackQueueItem(mediaFileId, "Now playing")) }
    val selectedIndex = candidates.indexOfFirst { it.mediaFileId == mediaFileId }.takeIf { it >= 0 }
    return if (selectedIndex != null) {
        PlayarrPlaybackQueue(candidates, selectedIndex)
    } else {
        PlayarrPlaybackQueue(candidates + PlayarrPlaybackQueueItem(mediaFileId, "Now playing"), candidates.size)
    }
}

internal fun playarrAlbumPlaybackQueueItems(
    items: List<PlayarrPlaybackQueueItem>,
    albumId: String,
): List<PlayarrPlaybackQueueItem> = items.filter { it.albumId == albumId }

internal fun shouldAutoAdvancePlayarrMusic(
    hasEnded: Boolean,
    item: PlayarrPlaybackQueueItem?,
    canNext: Boolean,
): Boolean = hasEnded && item?.music == true && canNext

internal fun playarrPlayableSeasons(series: WorkChildren.Series): List<SeasonDetail> =
    series.seasons
        .sortedBy { it.season.seasonNumber }
        .map { season ->
            season.copy(
                episodes = season.episodes
                    .filter { it.mediaFileId != null }
                    .sortedBy { it.episode.episodeNumber },
            )
        }
        .filter { it.episodes.isNotEmpty() }

internal fun WorkDetail.playarrPlaybackQueueItems(): List<PlayarrPlaybackQueueItem> = when (val tree = children) {
    WorkChildren.Movie -> listOfNotNull(
        mediaFileId?.let { PlayarrPlaybackQueueItem(it, work.title, artworkWork = work) },
    )
    is WorkChildren.Series -> tree.seasons.flatMap { season ->
        season.episodes.mapNotNull { episode ->
            episode.mediaFileId?.let { mediaFileId ->
                PlayarrPlaybackQueueItem(
                    mediaFileId = mediaFileId,
                    title = episode.episode.title ?: "Episode ${episode.episode.episodeNumber}",
                    subtitle = buildString {
                        append(work.title)
                        append(" · S")
                        append(season.season.seasonNumber.toString().padStart(2, '0'))
                        append(" E")
                        append(episode.episode.episodeNumber.toString().padStart(2, '0'))
                    },
                    seasonNumber = season.season.seasonNumber,
                    episodeNumber = episode.episode.episodeNumber,
                    artworkWork = work,
                )
            }
        }
    }
    is WorkChildren.Artist -> tree.albums.flatMap { album ->
        album.tracks.mapNotNull { track ->
            track.mediaFileId?.let { mediaFileId ->
                PlayarrPlaybackQueueItem(
                    mediaFileId = mediaFileId,
                    title = track.track.title,
                    subtitle = "${work.title} · ${album.album.title}",
                    music = true,
                    albumId = album.album.id,
                    artworkWork = work,
                )
            }
        }
    }
    is WorkChildren.Author -> tree.books.mapNotNull { book ->
        book.mediaFileId?.let { mediaFileId ->
            PlayarrPlaybackQueueItem(
                mediaFileId = mediaFileId,
                title = book.book.title,
                subtitle = work.title,
                artworkWork = work,
            )
        }
    }
}

internal fun WorkDetail.playarrPlaybackQueueItem(item: PlaylistItem): PlayarrPlaybackQueueItem? =
    playarrPlaybackQueueItems().firstOrNull { candidate ->
        when (val tree = children) {
            WorkChildren.Movie -> candidate.mediaFileId == mediaFileId
            is WorkChildren.Series -> tree.seasons.any { season ->
                season.episodes.any { episode ->
                    episode.mediaFileId == candidate.mediaFileId &&
                        (item.trackId == null || episode.episode.id == item.trackId)
                }
            }
            is WorkChildren.Artist -> tree.albums.any { album ->
                album.tracks.any { track ->
                    track.mediaFileId == candidate.mediaFileId && track.track.id == item.trackId
                }
            }
            is WorkChildren.Author -> tree.books.any { book ->
                book.mediaFileId == candidate.mediaFileId &&
                    (item.trackId == null || book.book.id == item.trackId)
            }
        }
    }
