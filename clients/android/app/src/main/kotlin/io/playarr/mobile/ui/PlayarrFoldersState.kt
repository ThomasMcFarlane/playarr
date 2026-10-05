package io.playarr.mobile.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.playarr.shared.data.events.LiveFetchStamp
import io.playarr.shared.data.events.LiveInvalidationBus
import io.playarr.shared.data.model.FolderBrowseResponse
import io.playarr.shared.data.model.FolderEntry
import io.playarr.shared.data.model.FolderRoot
import io.playarr.shared.domain.model.PlayarrError
import io.playarr.shared.domain.model.PlayarrResult
import io.playarr.shared.domain.model.runCatchingPlayarr
import io.playarr.shared.domain.repository.FolderRepository
import java.net.URLDecoder
import java.net.URLEncoder
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

// ---- URL state -------------------------------------------------------------------------------------------------------
//
// Everything the Folders page shows is one query string whose parameter names match the web client
// (`/folders?root=<id>&path=Season%20A&view=list&size=large&sort=modified&order=desc&q=clip&type=media&panel=filters`),
// so state survives process death, rotation and deep links identically on every client. Pure Kotlin.

internal enum class FolderViewMode(val wire: String) { List("list"), Cover("cover") }
internal enum class FolderSize(val wire: String) { Small("small"), Medium("medium"), Large("large") }
internal enum class FolderSort(val wire: String) { Name("name"), Modified("modified"), Size("size"), Duration("duration") }
internal enum class FolderOrder(val wire: String) { Asc("asc"), Desc("desc") }
internal enum class FolderType(val wire: String) { All("all"), Directories("directories"), Media("media") }
internal enum class FolderPanel(val wire: String) { Filters("filters") }

internal data class FolderUrlState(
    val root: String? = null,
    /** Root-relative directory, `a/b/c`; empty is the root itself. */
    val path: String = "",
    /** Library kind filter for the root list (`movie`, `series`, ...). */
    val kind: String? = null,
    val view: FolderViewMode = FolderViewMode.Cover,
    val size: FolderSize = FolderSize.Medium,
    val sort: FolderSort = FolderSort.Name,
    val order: FolderOrder = FolderOrder.Asc,
    val q: String = "",
    val type: FolderType = FolderType.All,
    val panel: FolderPanel? = null,
) {
    /** True when [other] lists the same directory the same way (view, size and panel do not change the listing). */
    fun sameListing(other: FolderUrlState): Boolean =
        root == other.root && path == other.path && q == other.q && sort == other.sort && order == other.order && type == other.type

    /** Filters that narrow the listing (the Filters badge). */
    val activeFilterCount: Int get() = (if (q.isNotEmpty()) 1 else 0) + (if (type != FolderType.All) 1 else 0)
}

private val kinds = setOf("movie", "series", "site", "artist", "author")
private val rootId = Regex("^[0-9a-fA-F-]{32,40}$")

private fun decode(value: String): String = runCatching { URLDecoder.decode(value, "UTF-8") }.getOrDefault(value)

private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")

/** A root-relative path with no empty, `.` or `..` parts and no backslashes (matches web `normaliseFolderPath`). */
internal fun normaliseFolderPath(raw: String?): String {
    if (raw.isNullOrEmpty() || raw.contains('\\') || raw.contains('\u0000')) return ""
    val parts = mutableListOf<String>()
    for (part in raw.split('/')) {
        when (part) {
            "", "." -> Unit
            ".." -> return ""
            else -> parts += part
        }
    }
    return parts.joinToString("/")
}

internal fun parentFolderPath(path: String): String =
    normaliseFolderPath(path).split('/').filter(String::isNotEmpty).dropLast(1).joinToString("/")

/** Ancestor paths of [path], outermost first, ending with [path] itself. */
internal fun folderAncestors(path: String): List<String> {
    val parts = normaliseFolderPath(path).split('/').filter(String::isNotEmpty)
    return parts.indices.map { parts.take(it + 1).joinToString("/") }
}

internal fun parseFolderQuery(query: String): FolderUrlState {
    val params = query.removePrefix("?").split('&').filter { it.contains('=') }.associate {
        val (key, value) = it.split('=', limit = 2)
        decode(key) to decode(value)
    }
    return FolderUrlState(
        root = params["root"]?.takeIf(rootId::matches),
        path = normaliseFolderPath(params["path"]),
        kind = params["kind"]?.takeIf(kinds::contains),
        view = FolderViewMode.entries.firstOrNull { it.wire == params["view"] } ?: FolderViewMode.Cover,
        size = FolderSize.entries.firstOrNull { it.wire == params["size"] } ?: FolderSize.Medium,
        sort = FolderSort.entries.firstOrNull { it.wire == params["sort"] } ?: FolderSort.Name,
        order = FolderOrder.entries.firstOrNull { it.wire == params["order"] } ?: FolderOrder.Asc,
        q = params["q"].orEmpty().trim(),
        type = FolderType.entries.firstOrNull { it.wire == params["type"] } ?: FolderType.All,
        panel = FolderPanel.entries.firstOrNull { it.wire == params["panel"] },
    )
}

/** Canonical, deterministic query string (stable key order); defaults and empty values are omitted. */
internal fun FolderUrlState.toQuery(): String {
    val defaults = FolderUrlState()
    val parts = mutableListOf<String>()
    fun add(key: String, value: String?) {
        if (!value.isNullOrEmpty()) parts += "$key=$value"
    }
    add("root", root)
    add("path", path.takeIf(String::isNotEmpty)?.let(::encode))
    add("kind", kind)
    add("view", view.wire.takeIf { view != defaults.view })
    add("size", size.wire.takeIf { size != defaults.size })
    add("sort", sort.wire.takeIf { sort != defaults.sort })
    add("order", order.wire.takeIf { order != defaults.order })
    add("q", q.takeIf(String::isNotEmpty)?.let(::encode))
    add("type", type.wire.takeIf { type != defaults.type })
    add("panel", panel?.wire)
    return parts.joinToString("&")
}

// ---- State machine ---------------------------------------------------------------------------------------------------

internal sealed interface FolderRootsLoad {
    data object Loading : FolderRootsLoad
    data class Ready(val roots: List<FolderRoot>) : FolderRootsLoad
    data class Failed(val message: PlayarrMessage) : FolderRootsLoad
}

internal sealed interface FolderListing {
    data object Idle : FolderListing
    data object Loading : FolderListing
    data class Ready(val data: FolderBrowseResponse, val entries: List<FolderEntry>, val loadingMore: Boolean = false) : FolderListing {
        val hasMore: Boolean get() = entries.size < data.total
    }
    /** The directory no longer exists (404). */
    data object Missing : FolderListing
    data class Failed(val message: PlayarrMessage) : FolderListing
}

internal data class FolderUiState(
    val url: FolderUrlState = FolderUrlState(),
    val roots: FolderRootsLoad = FolderRootsLoad.Loading,
    val listing: FolderListing = FolderListing.Idle,
) {
    val currentRoot: FolderRoot?
        get() = (roots as? FolderRootsLoad.Ready)?.roots?.firstOrNull { it.id == url.root }
}

private fun foldersFailure(error: PlayarrError): PlayarrMessage =
    error.userMessageForExperience(PlayarrString.ErrorSubjectFolders)

internal const val FOLDER_PAGE_SIZE = 200

/** Folders page state; scope-driven and free of Android types so it is unit-testable. */
internal class FolderStateHolder(
    private val scope: CoroutineScope,
    private val repository: FolderRepository,
    initial: FolderUrlState = FolderUrlState(),
    private val failureMessage: (PlayarrError) -> PlayarrMessage = ::foldersFailure,
) {
    private val _state = MutableStateFlow(FolderUiState(url = initial))
    val state: StateFlow<FolderUiState> = _state.asStateFlow()
    private var rootsJob: Job? = null
    private var listingJob: Job? = null
    private val fetchStamp = LiveFetchStamp()

    /** Start of the latest fetch (`0` before the first). */
    val fetchStartedMs: Long get() = fetchStamp.startedMs

    fun loadRoots() {
        rootsJob?.cancel()
        _state.update { it.copy(roots = FolderRootsLoad.Loading) }
        rootsJob = scope.launch {
            fetchStamp.begin()
            val kind = _state.value.url.kind
            when (val result = runCatchingPlayarr { repository.roots(kind) }) {
                is PlayarrResult.Success -> {
                    _state.update { it.copy(roots = FolderRootsLoad.Ready(result.value)) }
                    // With exactly one root there is nothing to choose: open it.
                    val only = result.value.singleOrNull()
                    if (only != null && _state.value.url.root == null) openRoot(only.id) else loadListing(silent = false)
                }
                is PlayarrResult.Failure ->
                    _state.update { it.copy(roots = FolderRootsLoad.Failed(failureMessage(result.error))) }
            }
        }
    }

    /** Live-event / fallback refresh: refetches roots and the open directory in place; shown entries stay until new arrive. */
    fun refresh() {
        if (_state.value.roots !is FolderRootsLoad.Ready) return
        scope.launch {
            fetchStamp.begin()
            val kind = _state.value.url.kind
            val result = runCatchingPlayarr { repository.roots(kind) }
            if (result is PlayarrResult.Success) _state.update { it.copy(roots = FolderRootsLoad.Ready(result.value)) }
        }
        loadListing(silent = true)
    }

    fun openRoot(id: String?) = navigate(_state.value.url.copy(root = id, path = "", q = ""))

    fun openDirectory(path: String) = navigate(_state.value.url.copy(path = normaliseFolderPath(path), q = ""))

    /** One level up; returns false when already at the top (the caller then leaves the page). */
    fun up(rootCount: Int): Boolean {
        val url = _state.value.url
        return when {
            url.root != null && url.path.isNotEmpty() -> { openDirectory(parentFolderPath(url.path)); true }
            url.root != null && rootCount > 1 -> { openRoot(null); true }
            else -> false
        }
    }

    fun setView(view: FolderViewMode) = _state.update { it.copy(url = it.url.copy(view = view)) }
    fun setSize(size: FolderSize) = _state.update { it.copy(url = it.url.copy(size = size)) }
    fun setSort(sort: FolderSort) = navigate(_state.value.url.copy(sort = sort))
    fun setOrder(order: FolderOrder) = navigate(_state.value.url.copy(order = order))
    fun setType(type: FolderType) = navigate(_state.value.url.copy(type = type))
    fun setQuery(q: String) = navigate(_state.value.url.copy(q = q.trim()))
    fun clearFilters() = navigate(_state.value.url.copy(q = "", type = FolderType.All))
    fun openPanel(panel: FolderPanel?) = _state.update { it.copy(url = it.url.copy(panel = if (it.url.panel == panel) null else panel)) }

    fun loadMore() {
        val listing = _state.value.listing as? FolderListing.Ready ?: return
        val root = _state.value.currentRoot ?: return
        if (listing.loadingMore || !listing.hasMore) return
        val url = _state.value.url
        _state.update { it.copy(listing = listing.copy(loadingMore = true)) }
        scope.launch {
            val result = runCatchingPlayarr {
                repository.browse(root.id, url.path, url.q, url.sort.wire, url.order.wire, url.type.wire, FOLDER_PAGE_SIZE, listing.entries.size)
            }
            // A newer navigation replaced this listing while the page was in flight.
            if (!_state.value.url.sameListing(url)) return@launch
            _state.update { current ->
                val now = current.listing as? FolderListing.Ready ?: return@update current
                when (result) {
                    is PlayarrResult.Success -> current.copy(
                        listing = FolderListing.Ready(result.value, mergeFolderPage(now.entries, result.value.entries)),
                    )
                    is PlayarrResult.Failure -> current.copy(listing = now.copy(loadingMore = false))
                }
            }
        }
    }

    /** Applies a change that alters what is listed and refetches it. */
    private fun navigate(next: FolderUrlState) {
        if (next == _state.value.url) return
        _state.update { it.copy(url = next) }
        loadListing(silent = false)
    }

    private fun loadListing(silent: Boolean) {
        listingJob?.cancel()
        val url = _state.value.url
        val root = _state.value.currentRoot
        if (root == null) {
            _state.update { it.copy(listing = FolderListing.Idle) }
            return
        }
        if (!silent || _state.value.listing !is FolderListing.Ready) _state.update { it.copy(listing = FolderListing.Loading) }
        listingJob = scope.launch {
            fetchStamp.begin()
            val result = runCatchingPlayarr {
                repository.browse(root.id, url.path, url.q, url.sort.wire, url.order.wire, url.type.wire, FOLDER_PAGE_SIZE, 0)
            }
            if (!_state.value.url.sameListing(url)) return@launch
            _state.update {
                when (result) {
                    is PlayarrResult.Success -> it.copy(listing = FolderListing.Ready(result.value, result.value.entries))
                    is PlayarrResult.Failure ->
                        if (result.error.httpCode() == 404) {
                            it.copy(listing = FolderListing.Missing)
                        } else if (silent && it.listing is FolderListing.Ready) {
                            it
                        } else {
                            it.copy(listing = FolderListing.Failed(failureMessage(result.error)))
                        }
                }
            }
        }
    }
}

/** Appends [page] to [loaded], dropping entries already present (pages can overlap if the directory changes mid-load). */
internal fun mergeFolderPage(loaded: List<FolderEntry>, page: List<FolderEntry>): List<FolderEntry> {
    if (loaded.isEmpty()) return page
    val seen = loaded.mapTo(HashSet(loaded.size * 2)) { it.entryType to it.path }
    return loaded + page.filter { seen.add(it.entryType to it.path) }
}

/** The playable files of a listing, in order: the player's queue and its previous/next. */
internal fun folderPlaybackQueue(entries: List<FolderEntry>): List<PlayarrPlaybackQueueItem> =
    entries.filter(FolderEntry::isMedia).map {
        PlayarrPlaybackQueueItem(mediaFileId = it.mediaFileId!!, title = it.displayName)
    }

/** `m:ss` / `h:mm:ss`; empty when the duration is unknown. */
internal fun formatFolderDuration(durationMs: Long?): String {
    if (durationMs == null || durationMs <= 0L) return ""
    val total = (durationMs + 500) / 1000
    val hours = total / 3600
    val minutes = (total % 3600) / 60
    val seconds = total % 60
    return if (hours > 0) "%d:%02d:%02d".format(hours, minutes, seconds) else "%d:%02d".format(minutes, seconds)
}

@HiltViewModel
internal class FoldersViewModel @Inject constructor(
    repository: FolderRepository,
    private val savedState: SavedStateHandle,
    val liveBus: LiveInvalidationBus,
) : ViewModel() {
    val folders = FolderStateHolder(
        scope = viewModelScope,
        repository = repository,
        initial = savedState.get<String>(QUERY_KEY)?.let(::parseFolderQuery) ?: FolderUrlState(),
    )

    init {
        folders.loadRoots()
        // Persist the URL-equivalent state so process death restores root, directory, view, filters and panel.
        viewModelScope.launch {
            folders.state.collect { savedState[QUERY_KEY] = it.url.toQuery() }
        }
    }

    private companion object {
        const val QUERY_KEY = "query"
    }
}

/** HTTP status of a failure, if it has one. */
internal fun PlayarrError.httpCode(): Int? = (this as? PlayarrError.Http)?.code
