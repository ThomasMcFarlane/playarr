package io.streamarr.mobile.ui

import io.streamarr.shared.data.model.Availability
import io.streamarr.shared.data.model.Playlist
import io.streamarr.shared.data.model.PlaylistItem
import io.streamarr.shared.data.model.PlaylistMediaType
import io.streamarr.shared.data.model.Work
import io.streamarr.shared.data.model.WorkChildren
import io.streamarr.shared.data.model.WorkDetail
import io.streamarr.shared.data.model.WorkKind
import java.time.Instant
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrPlaylistsTest {
    @Test
    fun `directory shows only roots and applies visibility`() {
        val directory = directory(
            playlist("personal", "Mine"),
            playlist("shared", "Shared", system = true),
            playlist("child", "Nested", parent = "personal"),
            playlist("orphan", "Orphan", parent = "missing"),
        )

        assertEquals(
            listOf("personal", "orphan", "shared"),
            visibleRootPlaylists(directory, PlaylistVisibility.All, PlaylistOrder.Ascending, Locale.ENGLISH)
                .map(Playlist::id),
        )
        assertEquals(
            listOf("personal", "orphan"),
            visibleRootPlaylists(directory, PlaylistVisibility.Personal, PlaylistOrder.Ascending, Locale.ENGLISH)
                .map(Playlist::id),
        )
        assertEquals(
            listOf("shared"),
            visibleRootPlaylists(directory, PlaylistVisibility.Shared, PlaylistOrder.Ascending, Locale.ENGLISH)
                .map(Playlist::id),
        )
        assertEquals(1, playlistChildCount(directory, "personal"))
    }

    @Test
    fun `directory ordering matches web numeric name sorting`() {
        val directory = directory(
            playlist("ten", "Folder 10"),
            playlist("two", "Folder 2"),
            playlist("one", "Folder 1"),
        )

        assertEquals(
            listOf("one", "two", "ten"),
            visibleRootPlaylists(directory, PlaylistVisibility.All, PlaylistOrder.Ascending, Locale.ENGLISH)
                .map(Playlist::id),
        )
        assertEquals(
            listOf("ten", "two", "one"),
            visibleRootPlaylists(directory, PlaylistVisibility.All, PlaylistOrder.Descending, Locale.ENGLISH)
                .map(Playlist::id),
        )
    }

    @Test
    fun `root covers inherit artwork candidates from nested playlists`() {
        val root = playlist("root", "Root")
        val child = playlist("child", "Child", parent = root.id)
        val item = PlaylistItem(
            id = "item",
            playlistId = child.id,
            workId = "work",
            position = 0,
            addedAt = "2026-01-01T00:00:00Z",
        )
        val work = Work(
            id = "work",
            kind = WorkKind.Movie,
            title = "Movie",
            sortTitle = "Movie",
            addedAt = Instant.EPOCH,
            monitored = true,
            availability = Availability.Available,
        )
        val directory = ResolvedPlaylistDirectory(
            playlists = listOf(root, child),
            itemsByPlaylist = mapOf(child.id to listOf(item)),
            details = mapOf(work.id to WorkDetail(work, WorkChildren.Movie)),
        )

        assertEquals(listOf(work.id), playlistCoverWorks(directory, root.id).map(Work::id))
    }

    private fun directory(vararg playlists: Playlist) = ResolvedPlaylistDirectory(
        playlists = playlists.toList(),
        itemsByPlaylist = emptyMap(),
        details = emptyMap(),
    )

    private fun playlist(
        id: String,
        name: String,
        system: Boolean = false,
        parent: String? = null,
    ) = Playlist(
        id = id,
        name = name,
        isSystem = system,
        mediaType = PlaylistMediaType.Video,
        createdAt = "2026-01-01T00:00:00Z",
        updatedAt = "2026-01-01T00:00:00Z",
        parentPlaylistId = parent,
    )
}
