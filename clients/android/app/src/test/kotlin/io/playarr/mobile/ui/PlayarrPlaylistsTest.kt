package io.playarr.mobile.ui

import io.playarr.shared.data.model.Availability
import io.playarr.shared.data.model.Playlist
import io.playarr.shared.data.model.PlaylistItem
import io.playarr.shared.data.model.PlaylistMediaType
import io.playarr.shared.data.model.Work
import io.playarr.shared.data.model.WorkChildren
import io.playarr.shared.data.model.WorkDetail
import io.playarr.shared.data.model.WorkKind
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

    @Test
    fun `detail resolves the root and every nested track in natural order`() {
        val root = playlist("root", "Root")
        val ten = playlist("ten", "Track 10", parent = root.id)
        val two = playlist("two", "Track 2", parent = root.id)
        val nested = playlist("nested", "Nested", parent = two.id)
        val playlists = listOf(ten, nested, root, two)

        assertEquals(root.id, nested.rootPlaylist(playlists).id)
        assertEquals(listOf(two.id, nested.id, ten.id), root.descendantPlaylists(playlists).map(Playlist::id))
    }

    @Test
    fun `edit parent options exclude self descendants shared and mismatched media`() {
        val root = playlist("root", "Root")
        val active = playlist("active", "Active", parent = root.id)
        val descendant = playlist("descendant", "Descendant", parent = active.id)
        val destination = playlist("destination", "Destination")
        val shared = playlist("shared", "Shared", system = true)
        val audio = playlist("audio", "Audio", mediaType = PlaylistMediaType.Audio)

        assertEquals(
            listOf(destination.id, root.id),
            playlistParentOptions(active, listOf(root, active, descendant, destination, shared, audio)).map(Playlist::id),
        )
        assertEquals("Root › Active › Descendant", descendant.playlistPath(listOf(root, active, descendant)))
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
        mediaType: PlaylistMediaType = PlaylistMediaType.Video,
    ) = Playlist(
        id = id,
        name = name,
        isSystem = system,
        mediaType = mediaType,
        createdAt = "2026-01-01T00:00:00Z",
        updatedAt = "2026-01-01T00:00:00Z",
        parentPlaylistId = parent,
    )
}
