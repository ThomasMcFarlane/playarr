package io.streamarr.mobile.ui

import io.streamarr.shared.data.model.Playlist
import io.streamarr.shared.data.model.Work
import io.streamarr.shared.data.model.WorkKind

internal enum class PlayarrSearchMediaType(
    val value: String,
    val label: String,
    val workKind: WorkKind? = null,
) {
    All("all", "All"),
    Movie("movie", "Movies", WorkKind.Movie),
    Series("series", "Series", WorkKind.Series),
    Site("site", "Sites", WorkKind.Site),
    Artist("artist", "Music", WorkKind.Artist),
    Playlist("playlist", "Playlists"),
}

internal data class PlayarrSearchResults(
    val works: List<Work> = emptyList(),
    val playlists: List<Playlist> = emptyList(),
)

internal fun filterPlayarrSearchWorks(
    works: List<Work>,
    availableWorkIds: Set<String>,
    mediaType: PlayarrSearchMediaType,
    libraryWorkIds: Set<String>? = null,
): List<Work> = works
    .asSequence()
    .filter { mediaType != PlayarrSearchMediaType.Playlist }
    .filter { it.kind in playarrSearchWorkKinds }
    .filter { it.id in availableWorkIds }
    .filter { mediaType.workKind == null || it.kind == mediaType.workKind }
    .filter { libraryWorkIds == null || it.id in libraryWorkIds }
    .toList()

internal fun filterPlayarrSearchPlaylists(
    playlists: List<Playlist>,
    query: String,
    mediaType: PlayarrSearchMediaType,
    libraryId: String?,
): List<Playlist> {
    if (libraryId != null || mediaType !in setOf(PlayarrSearchMediaType.All, PlayarrSearchMediaType.Playlist)) {
        return emptyList()
    }
    return playlists.filter { it.name.contains(query, ignoreCase = true) }
}

internal val playarrSearchWorkKinds = setOf(
    WorkKind.Movie,
    WorkKind.Series,
    WorkKind.Site,
    WorkKind.Artist,
)
