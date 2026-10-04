package io.playarr.mobile.ui

import java.net.URLDecoder

/**
 * The Library's view, artwork size and sort order as query parameters, mirroring the web client
 * (`/series?view=cover&size=large&sort=date_added&order=desc`), so a shared link, a deep link, rotation and
 * process death all land on the same page. Defaults are omitted from the query. Pure Kotlin.
 *
 * Wire values match the web `Library` page: view `list|screen|cover|cover-flow`, size `small|medium|large`,
 * sort `title|date_added`, order `asc|desc`.
 */
internal enum class LibrarySort(val wire: String) { Title("title"), DateAdded("date_added") }

internal val LibraryViewMode.wire: String
    get() = when (this) {
        LibraryViewMode.List -> "list"
        LibraryViewMode.Screen -> "screen"
        LibraryViewMode.Cover -> "cover"
        LibraryViewMode.CoverFlow -> "cover-flow"
    }

internal val LibraryArtworkSize.wire: String get() = name.lowercase()

internal data class LibraryUrlState(
    val view: LibraryViewMode = LibraryViewMode.Screen,
    val size: LibraryArtworkSize = LibraryArtworkSize.Medium,
    val sort: LibrarySort = LibrarySort.Title,
    val descending: Boolean = false,
) {
    /** Canonical, deterministic query string (stable key order); parameters at their default are omitted. */
    fun toQuery(): String {
        val d = LibraryUrlState()
        val parts = mutableListOf<String>()
        if (view != d.view) parts += "view=${view.wire}"
        if (size != d.size) parts += "size=${size.wire}"
        if (sort != d.sort) parts += "sort=${sort.wire}"
        if (descending != d.descending) parts += "order=desc"
        return parts.joinToString("&")
    }

    companion object {
        const val VIEW = "view"
        const val SIZE = "size"
        const val SORT = "sort"
        const val ORDER = "order"

        /** Builds the state from raw parameter values; unknown or missing values fall back to the defaults. */
        fun of(view: String?, size: String?, sort: String?, order: String?, allowCoverFlow: Boolean): LibraryUrlState {
            val parsedView = LibraryViewMode.entries.firstOrNull { it.wire == view }
                ?.takeIf { it != LibraryViewMode.CoverFlow || allowCoverFlow }
            return LibraryUrlState(
                view = parsedView ?: LibraryUrlState().view,
                size = LibraryArtworkSize.entries.firstOrNull { it.wire == size } ?: LibraryUrlState().size,
                sort = LibrarySort.entries.firstOrNull { it.wire == sort } ?: LibraryUrlState().sort,
                descending = order == "desc",
            )
        }

        fun parse(query: String, allowCoverFlow: Boolean = true): LibraryUrlState {
            val params = query.removePrefix("?").split('&').filter { it.contains('=') }.associate {
                val (key, value) = it.split('=', limit = 2)
                decode(key) to decode(value)
            }
            return of(params[VIEW], params[SIZE], params[SORT], params[ORDER], allowCoverFlow)
        }

        private fun decode(value: String): String = runCatching { URLDecoder.decode(value, "UTF-8") }.getOrDefault(value)
    }
}

/** The Library routes: bare route name, then the optional state query. */
internal val libraryRoutes = listOf("series", "movies", "sites", "music")

internal const val LIBRARY_ROUTE_QUERY = "?view={view}&size={size}&sort={sort}&order={order}"

internal fun libraryRoutePattern(route: String): String = route + LIBRARY_ROUTE_QUERY

/** Concrete route (`series?view=cover`) for [route] carrying [state]. */
internal fun libraryRouteFor(route: String, state: LibraryUrlState): String =
    state.toQuery().let { if (it.isEmpty()) route else "$route?$it" }
