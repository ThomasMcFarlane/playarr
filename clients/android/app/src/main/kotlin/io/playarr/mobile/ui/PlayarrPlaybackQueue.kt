package io.playarr.mobile.ui

import io.playarr.shared.data.model.PlaylistItem
import io.playarr.shared.data.model.MediaChapter
import io.playarr.shared.data.model.SeasonDetail
import io.playarr.shared.data.model.Work
import io.playarr.shared.data.model.WorkChildren
import io.playarr.shared.data.model.WorkDetail
import java.util.Locale

internal data class PlayarrPlaybackQueueItem(
    val mediaFileId: String,
    val title: String,
    val subtitle: String? = null,
    val seasonNumber: Int? = null,
    val episodeNumber: Int? = null,
    val music: Boolean = false,
    val albumId: String? = null,
    val artworkWork: Work? = null,
    val startPositionMs: Long? = null,
    val launchSettings: PlayarrPlaybackLaunchSettings? = null,
    val fallbackTitle: PlayarrString? = null,
    val fallbackTitleParameters: Map<String, Any> = emptyMap(),
)

internal fun PlayarrPlaybackQueueItem.displayTitle(language: PlayarrLanguageState): String =
    title.takeIf(String::isNotBlank)
        ?: fallbackTitle?.let { language.text(it, fallbackTitleParameters) }
        ?: language.text(PlayarrString.PlayerNowPlaying)

internal data class PlayarrPlaybackLaunchSettings(
    val qualityId: String,
    val profile: String?,
    val forceTranscode: Boolean,
    val audioStreamIndex: Int?,
    val subtitleTrackId: String?,
)

internal data class PlayarrResolvedSourcePlayback(
    val mediaFileId: String,
    val queueItems: List<PlayarrPlaybackQueueItem>,
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
    startPositionMs: Long? = null,
    launchSettings: PlayarrPlaybackLaunchSettings? = null,
): PlayarrPlaybackQueue {
    val candidates = orderedItems.filter { it.mediaFileId.isNotBlank() }
        .ifEmpty {
            listOf(PlayarrPlaybackQueueItem(mediaFileId, "", fallbackTitle = PlayarrString.PlayerNowPlaying))
        }
    val selectedIndex = candidates.indexOfFirst { it.mediaFileId == mediaFileId }.takeIf { it >= 0 }
    val queue = if (selectedIndex != null) {
        PlayarrPlaybackQueue(candidates, selectedIndex)
    } else {
        PlayarrPlaybackQueue(
            candidates + PlayarrPlaybackQueueItem(
                mediaFileId,
                "",
                fallbackTitle = PlayarrString.PlayerNowPlaying,
            ),
            candidates.size,
        )
    }
    if (startPositionMs == null && launchSettings == null) return queue
    return queue.copy(
        items = queue.items.mapIndexed { index, item ->
            if (index == queue.currentIndex) {
                item.copy(
                    startPositionMs = startPositionMs?.coerceAtLeast(0L),
                    launchSettings = launchSettings,
                )
            } else {
                item
            }
        },
    )
}

internal fun playarrAlbumPlaybackQueueItems(
    items: List<PlayarrPlaybackQueueItem>,
    albumId: String,
): List<PlayarrPlaybackQueueItem> = items.filter { it.albumId == albumId }

/** Maps the selected logical movie/episode/track/book onto another joined server's local ids. */
internal fun resolvePlayarrSourcePlayback(
    originalDetail: WorkDetail,
    sourceDetail: WorkDetail,
    requestedMediaFileId: String,
): PlayarrResolvedSourcePlayback? {
    val sourceItems = sourceDetail.playarrPlaybackQueueItems()
    val resolved = when (val originalChildren = originalDetail.children) {
        WorkChildren.Movie -> sourceItems.firstOrNull()
        is WorkChildren.Series -> {
            val requested = originalDetail.playarrPlaybackQueueItems()
                .firstOrNull { it.mediaFileId == requestedMediaFileId }
                ?: return null
            sourceItems.firstOrNull {
                it.seasonNumber == requested.seasonNumber && it.episodeNumber == requested.episodeNumber
            }
        }
        is WorkChildren.Artist -> {
            val requestedAlbum = originalChildren.albums.firstNotNullOfOrNull { album ->
                album.tracks.firstOrNull { it.mediaFileId == requestedMediaFileId }?.let { album to it }
            } ?: return null
            val sourceAlbums = sourceDetail.children as? WorkChildren.Artist ?: return null
            val album = sourceAlbums.albums.firstOrNull { candidate ->
                candidate.album.title.normalizedMediaTitle() == requestedAlbum.first.album.title.normalizedMediaTitle() &&
                    candidate.album.releaseDate == requestedAlbum.first.album.releaseDate
            } ?: return null
            val track = album.tracks.firstOrNull { candidate ->
                candidate.track.trackNumber == requestedAlbum.second.track.trackNumber ||
                    candidate.track.title.normalizedMediaTitle() == requestedAlbum.second.track.title.normalizedMediaTitle()
            } ?: return null
            sourceItems.firstOrNull { it.mediaFileId == track.mediaFileId }
        }
        is WorkChildren.Author -> {
            val requested = originalChildren.books.firstOrNull { it.mediaFileId == requestedMediaFileId }
                ?: return null
            val sourceBooks = sourceDetail.children as? WorkChildren.Author ?: return null
            val requestedIsbn = requested.book.isbn?.takeIf(String::isNotBlank)
            val book = sourceBooks.books.firstOrNull { candidate ->
                (requestedIsbn != null && candidate.book.isbn == requestedIsbn) ||
                    candidate.book.title.normalizedMediaTitle() == requested.book.title.normalizedMediaTitle()
            } ?: return null
            sourceItems.firstOrNull { it.mediaFileId == book.mediaFileId }
        }
    } ?: return null
    val queue = if (resolved.music && resolved.albumId != null) {
        playarrAlbumPlaybackQueueItems(sourceItems, resolved.albumId)
    } else {
        sourceItems
    }
    return PlayarrResolvedSourcePlayback(resolved.mediaFileId, queue)
}

private fun String.normalizedMediaTitle(): String = trim().lowercase(Locale.ROOT)

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

internal fun playarrDisplayedMovieChapters(
    chapters: List<MediaChapter>,
    runtimeMs: Long,
): List<MediaChapter> {
    if (chapters.isNotEmpty()) return chapters
    if (runtimeMs <= 0L) return emptyList()
    val targetIntervalMs = runtimeMs / 10.0
    val intervals = listOf(5L, 10L, 15L, 20L, 30L).map { it * 60_000L }
    val intervalMs = intervals.firstOrNull { it >= targetIntervalMs } ?: intervals.last()
    val chapterCount = ((runtimeMs + intervalMs - 1L) / intervalMs).coerceAtLeast(1L).toInt()
    return List(chapterCount) { index ->
        val startMs = index * intervalMs
        MediaChapter(
            index = index,
            startMs = startMs,
            endMs = minOf(runtimeMs, startMs + intervalMs),
            title = "Chapter ${index + 1}",
        )
    }
}

internal fun WorkDetail.playarrPlaybackQueueItems(): List<PlayarrPlaybackQueueItem> = when (val tree = children) {
    WorkChildren.Movie -> listOfNotNull(
        mediaFileId?.let { PlayarrPlaybackQueueItem(it, work.title, artworkWork = work) },
    )
    is WorkChildren.Series -> tree.seasons.flatMap { season ->
        season.episodes.mapNotNull { episode ->
            episode.mediaFileId?.let { mediaFileId ->
                PlayarrPlaybackQueueItem(
                    mediaFileId = mediaFileId,
                    title = episode.episode.title.orEmpty(),
                    fallbackTitle = PlayarrString.DetailEpisodeNumber,
                    fallbackTitleParameters = mapOf("number" to episode.episode.episodeNumber),
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
