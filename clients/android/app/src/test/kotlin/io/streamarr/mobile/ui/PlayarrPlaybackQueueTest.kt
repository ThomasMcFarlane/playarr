package io.streamarr.mobile.ui

import io.streamarr.shared.data.model.Album
import io.streamarr.shared.data.model.AlbumDetail
import io.streamarr.shared.data.model.AlbumType
import io.streamarr.shared.data.model.Availability
import io.streamarr.shared.data.model.Episode
import io.streamarr.shared.data.model.EpisodeDetail
import io.streamarr.shared.data.model.MediaChapter
import io.streamarr.shared.data.model.Season
import io.streamarr.shared.data.model.SeasonDetail
import io.streamarr.shared.data.model.Track
import io.streamarr.shared.data.model.TrackDetail
import io.streamarr.shared.data.model.Work
import io.streamarr.shared.data.model.WorkChildren
import io.streamarr.shared.data.model.WorkDetail
import io.streamarr.shared.data.model.WorkKind
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrPlaybackQueueTest {
    @Test
    fun `queue retains ordered context and moves within its boundaries`() {
        val items = listOf(
            PlayarrPlaybackQueueItem("first", "Episode one", "Series · S01 E01", 1, 1),
            PlayarrPlaybackQueueItem("second", "Episode two", "Series · S01 E02", 1, 2),
            PlayarrPlaybackQueueItem("third", "Episode three", "Series · S01 E03", 1, 3),
        )
        val queue = playarrPlaybackQueue("second", items)

        assertTrue(queue.canPrevious)
        assertTrue(queue.canNext)
        assertEquals("first", queue.move(-1).currentMediaFileId)
        assertEquals("third", queue.move(1).currentMediaFileId)
        assertEquals("first", queue.move(-10).currentMediaFileId)
        assertEquals("third", queue.move(10).currentMediaFileId)
        assertEquals("Episode two", queue.currentItem?.title)
        assertEquals(2, queue.currentItem?.episodeNumber)
        assertEquals("third", queue.select(2).currentMediaFileId)
        assertEquals(queue, queue.select(20))
    }

    @Test
    fun `standalone playback creates a one item queue`() {
        val queue = playarrPlaybackQueue("only", emptyList())

        assertEquals("only", queue.currentMediaFileId)
        assertEquals(
            "Now playing",
            queue.currentItem?.displayTitle(
                PlayarrLanguageState("en", PlayarrResolvedLanguage.English),
            ),
        )
        assertFalse(queue.canPrevious)
        assertFalse(queue.canNext)
    }

    @Test
    fun `chapter playback overrides only the selected queue item start`() {
        val first = PlayarrPlaybackQueueItem("first", "First")
        val second = PlayarrPlaybackQueueItem("second", "Second")

        val queue = playarrPlaybackQueue("second", listOf(first, second), 65_432L)

        assertEquals(null, queue.items.first().startPositionMs)
        assertEquals(65_432L, queue.currentItem?.startPositionMs)
    }

    @Test
    fun `artist playback items retain web music context`() {
        val artist = Work(
            id = "artist",
            kind = WorkKind.Artist,
            title = "Artist name",
            sortTitle = "Artist name",
            addedAt = Instant.EPOCH,
            monitored = true,
            availability = Availability.Available,
        )
        val detail = WorkDetail(
            work = artist,
            children = WorkChildren.Artist(
                listOf(
                    AlbumDetail(
                        album = Album(
                            id = "album",
                            artistWorkId = artist.id,
                            title = "Album name",
                            albumType = AlbumType.Studio,
                            monitored = true,
                            availability = Availability.Available,
                        ),
                        tracks = listOf(
                            TrackDetail(
                                track = Track(
                                    id = "track",
                                    albumId = "album",
                                    discNumber = 1,
                                    trackNumber = 1,
                                    title = "Track name",
                                    availability = Availability.Available,
                                ),
                                mediaFileId = "media",
                            ),
                        ),
                    ),
                ),
            ),
        )

        val item = detail.playarrPlaybackQueueItems().single()

        assertEquals("media", item.mediaFileId)
        assertEquals("Track name", item.title)
        assertEquals("Artist name · Album name", item.subtitle)
        assertTrue(item.music)
        assertEquals("album", item.albumId)
        assertEquals(artist, item.artworkWork)
    }

    @Test
    fun `album artwork URL authenticates against the selected server`() {
        assertEquals(
            "https://media.example/api/v1/artwork/album/artist%20id/album%2Fid/poster",
            resolveAlbumArtworkUrl("https://media.example/", "artist id", "album/id"),
        )
    }

    @Test
    fun `album queue remains scoped to the selected album`() {
        val first = PlayarrPlaybackQueueItem("one", "One", music = true, albumId = "album-a")
        val second = PlayarrPlaybackQueueItem("two", "Two", music = true, albumId = "album-b")

        assertEquals(listOf(first), playarrAlbumPlaybackQueueItems(listOf(first, second), "album-a"))
    }

    @Test
    fun `music detail restores the requested track or falls back to the first playable track`() {
        fun album(id: String, mediaFileId: String?) = AlbumDetail(
            album = Album(
                id = id,
                artistWorkId = "artist",
                title = id,
                albumType = AlbumType.Studio,
                monitored = true,
                availability = Availability.Available,
            ),
            tracks = listOf(
                TrackDetail(
                    track = Track(
                        id = "$id-track",
                        albumId = id,
                        discNumber = 1,
                        trackNumber = 1,
                        title = "$id track",
                        availability = Availability.Available,
                    ),
                    mediaFileId = mediaFileId,
                ),
            ),
        )
        val albums = listOf(album("unavailable", null), album("first", "media-1"), album("requested", "media-2"))

        assertEquals(
            PlayarrMusicSelection("requested", "requested-track"),
            resolvePlayarrMusicSelection(albums, "media-2"),
        )
        assertEquals(
            PlayarrMusicSelection("first", "first-track"),
            resolvePlayarrMusicSelection(albums, "missing"),
        )
    }

    @Test
    fun `joined series source maps the requested episode by season and episode number`() {
        fun detail(workId: String, mediaPrefix: String) = WorkDetail(
            work = work(workId, WorkKind.Series, "Series"),
            children = WorkChildren.Series(
                listOf(
                    SeasonDetail(
                        season = Season(
                            id = "$workId-season",
                            seriesWorkId = workId,
                            seasonNumber = 2,
                            monitored = true,
                            availability = Availability.Available,
                        ),
                        episodes = listOf(1, 2).map { number ->
                            EpisodeDetail(
                                episode = Episode(
                                    id = "$workId-episode-$number",
                                    seasonId = "$workId-season",
                                    episodeNumber = number,
                                    title = "Episode $number",
                                    monitored = true,
                                    availability = Availability.Available,
                                ),
                                mediaFileId = "$mediaPrefix-$number",
                            )
                        },
                    ),
                ),
            ),
        )
        val original = detail("original", "original-media")
        val source = detail("source", "source-media")

        val resolved = resolvePlayarrSourcePlayback(original, source, "original-media-2")

        assertEquals("source-media-2", resolved?.mediaFileId)
        assertEquals(listOf("source-media-1", "source-media-2"), resolved?.queueItems?.map { it.mediaFileId })
    }

    @Test
    fun `joined music source maps album and track while keeping the chosen album queue`() {
        fun detail(workId: String, mediaPrefix: String) = WorkDetail(
            work = work(workId, WorkKind.Artist, "Artist"),
            children = WorkChildren.Artist(
                listOf(
                    AlbumDetail(
                        album = Album(
                            id = "$workId-album",
                            artistWorkId = workId,
                            title = "Shared Album",
                            albumType = AlbumType.Studio,
                            monitored = true,
                            availability = Availability.Available,
                        ),
                        tracks = listOf(1, 2).map { number ->
                            TrackDetail(
                                track = Track(
                                    id = "$workId-track-$number",
                                    albumId = "$workId-album",
                                    discNumber = 1,
                                    trackNumber = number,
                                    title = "Track $number",
                                    availability = Availability.Available,
                                ),
                                mediaFileId = "$mediaPrefix-$number",
                            )
                        },
                    ),
                ),
            ),
        )
        val original = detail("original", "original-media")
        val source = detail("source", "source-media")

        val resolved = resolvePlayarrSourcePlayback(original, source, "original-media-2")

        assertEquals("source-media-2", resolved?.mediaFileId)
        assertEquals(listOf("source-media-1", "source-media-2"), resolved?.queueItems?.map { it.mediaFileId })
        assertTrue(resolved?.queueItems?.all { it.albumId == "source-album" } == true)
    }

    @Test
    fun `music durations match Playarr Web formatting`() {
        assertEquals("3:07", formatMusicDuration(187))
        assertEquals("--:--", formatMusicDuration(null))
        assertEquals("--:--", formatMusicDuration(0))
    }

    @Test
    fun `music advances at the end only when another track exists`() {
        val music = PlayarrPlaybackQueueItem("one", "One", music = true)
        val video = PlayarrPlaybackQueueItem("movie", "Movie")

        assertTrue(shouldAutoAdvancePlayarrMusic(true, music, true))
        assertFalse(shouldAutoAdvancePlayarrMusic(true, music, false))
        assertFalse(shouldAutoAdvancePlayarrMusic(false, music, true))
        assertFalse(shouldAutoAdvancePlayarrMusic(true, video, true))
    }

    @Test
    fun `series browser keeps playable episodes in web season order`() {
        fun episode(id: String, seasonId: String, number: Int, mediaFileId: String?) = EpisodeDetail(
            episode = Episode(
                id = id,
                seasonId = seasonId,
                episodeNumber = number,
                title = "Episode $number",
                monitored = true,
                availability = if (mediaFileId == null) Availability.Pending else Availability.Available,
            ),
            mediaFileId = mediaFileId,
        )
        fun season(id: String, number: Int, episodes: List<EpisodeDetail>) = SeasonDetail(
            season = Season(
                id = id,
                seriesWorkId = "series",
                seasonNumber = number,
                monitored = true,
                availability = Availability.Available,
            ),
            episodes = episodes,
        )
        val series = WorkChildren.Series(
            listOf(
                season("s2", 2, listOf(episode("e2", "s2", 2, "media-2"), episode("e1", "s2", 1, "media-1"))),
                season("empty", 3, listOf(episode("missing", "empty", 1, null))),
                season("s1", 1, listOf(episode("pilot", "s1", 1, "pilot-media"))),
            ),
        )

        val playable = playarrPlayableSeasons(series)

        assertEquals(listOf(1, 2), playable.map { it.season.seasonNumber })
        assertEquals(listOf(1, 2), playable.last().episodes.map { it.episode.episodeNumber })
        assertTrue(playable.flatMap { it.episodes }.all { it.mediaFileId != null })
    }

    @Test
    fun `movie chapter fallback uses the web interval ladder`() {
        val generated = playarrDisplayedMovieChapters(emptyList(), 7_200_000L)
        val real = listOf(MediaChapter(0, 42_000L, title = "Real chapter"))

        assertEquals(
            listOf(0L, 900_000L, 1_800_000L, 2_700_000L, 3_600_000L, 4_500_000L, 5_400_000L, 6_300_000L),
            generated.map { it.startMs },
        )
        assertEquals(7_200_000L, generated.last().endMs)
        assertEquals(real, playarrDisplayedMovieChapters(real, 7_200_000L))
    }

    @Test
    fun `similar title fallback uses web genre kind and year scoring`() {
        val target = Work(
            id = "target",
            kind = WorkKind.Movie,
            title = "Target",
            sortTitle = "Target",
            genres = listOf("Action", "Drama"),
            releaseDate = Instant.parse("2000-01-01T00:00:00Z"),
            addedAt = Instant.EPOCH,
            monitored = true,
            availability = Availability.Available,
        )
        val candidate = target.copy(
            id = "candidate",
            genres = listOf("action", "Comedy"),
            releaseDate = Instant.parse("2010-01-01T00:00:00Z"),
        )

        assertEquals(113.0, playarrRelatedWorkScore(target, candidate), 0.0)
    }

    @Test
    fun `video runtime uses web minute rounding`() {
        val english = PlayarrLanguageState("en", PlayarrResolvedLanguage.English)
        val thai = PlayarrLanguageState("th", PlayarrResolvedLanguage.Thai)
        val japanese = PlayarrLanguageState("ja", PlayarrResolvedLanguage.Japanese)

        assertEquals("1 min", formatPlayarrVideoRuntime(30_000L, english))
        assertEquals("1h 31m", formatPlayarrVideoRuntime(5_430_000L, english))
        assertEquals("2h", formatPlayarrVideoRuntime(7_200_000L, english))
        assertEquals("1 ชม. 31 นาที", formatPlayarrVideoRuntime(5_430_000L, thai))
        assertEquals("2時間", formatPlayarrVideoRuntime(7_200_000L, japanese))
    }

    private fun work(id: String, kind: WorkKind, title: String) = Work(
        id = id,
        kind = kind,
        title = title,
        sortTitle = title,
        addedAt = Instant.EPOCH,
        monitored = true,
        availability = Availability.Available,
    )
}
