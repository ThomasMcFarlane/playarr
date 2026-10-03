package io.playarr.mobile.ui

import io.playarr.shared.data.model.Playlist
import io.playarr.shared.data.model.Work
import io.playarr.shared.data.model.WorkKind

internal enum class PlayarrSearchMediaType(
    val value: String,
    val label: PlayarrString,
    val workKind: WorkKind? = null,
) {
    All("all", PlayarrString.SearchAll),
    Movie("movie", PlayarrString.SearchFilterMovies, WorkKind.Movie),
    Series("series", PlayarrString.SearchFilterSeries, WorkKind.Series),
    Site("site", PlayarrString.SearchFilterSites, WorkKind.Site),
    Artist("artist", PlayarrString.SearchFilterMusic, WorkKind.Artist),
    Playlist("playlist", PlayarrString.SearchFilterPlaylists),
    Game("game", PlayarrString.SearchFilterGames),
}

internal data class PlayarrSearchResults(
    val works: List<Work> = emptyList(),
    val playlists: List<Playlist> = emptyList(),
) {
    val count: Int get() = works.size + playlists.size

    fun keys(): List<String> = works.map { "work:${it.id}" } + playlists.map { "playlist:${it.id}" }
}

internal fun playarrSearchSelection(
    results: PlayarrSearchResults,
    current: String?,
): String? = results.keys().let { keys -> current?.takeIf(keys::contains) ?: keys.firstOrNull() }

internal fun filterPlayarrSearchWorks(
    works: List<Work>,
    availableWorkIds: Set<String>,
    mediaType: PlayarrSearchMediaType,
    libraryWorkIds: Set<String>? = null,
): List<Work> = works
    .asSequence()
    .filter { mediaType != PlayarrSearchMediaType.Playlist && mediaType != PlayarrSearchMediaType.Game }
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
