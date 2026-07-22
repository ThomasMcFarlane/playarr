package io.streamarr.mobile.ui

import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.PlaylistPlay
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.PictureInPictureAlt
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Tv
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import coil3.compose.AsyncImage
import coil3.network.NetworkHeaders
import coil3.network.httpHeaders
import coil3.request.ImageRequest
import dagger.hilt.android.lifecycle.HiltViewModel
import io.streamarr.mobile.BuildConfig
import io.streamarr.mobile.R
import io.streamarr.mobile.connected.PlayarrWorkSourceChoice
import io.streamarr.mobile.connected.PlayarrWorkSourceSelector
import io.streamarr.shared.auth.TokenStore
import io.streamarr.shared.data.model.AlbumDetail
import io.streamarr.shared.data.model.CreditResponse
import io.streamarr.shared.data.model.EpisodeDetail
import io.streamarr.shared.data.model.ImageKind
import io.streamarr.shared.data.model.MediaChapter
import io.streamarr.shared.data.model.MediaMetadata
import io.streamarr.shared.data.model.MediaPlaybackOptionsResponse
import io.streamarr.shared.data.model.Playlist
import io.streamarr.shared.data.model.PlaybackEventRequest
import io.streamarr.shared.data.model.PlaybackInfoResponse
import io.streamarr.shared.data.model.PlaybackStopReason
import io.streamarr.shared.data.model.ProfileAvatarPreference
import io.streamarr.shared.data.model.SeasonDetail
import io.streamarr.shared.data.model.TrackDetail
import io.streamarr.shared.data.model.Work
import io.streamarr.shared.data.model.WorkChildren
import io.streamarr.shared.data.model.WorkDetail
import io.streamarr.shared.data.model.WorkKind
import io.streamarr.shared.data.model.WorkCreditsResponse
import io.streamarr.shared.data.model.WatchProgress
import io.streamarr.shared.data.model.WatchState
import io.streamarr.shared.data.model.UpdateMediaPlaybackPreferencesRequest
import io.streamarr.shared.data.model.UpdateWatchProgressRequest
import io.streamarr.shared.data.model.ViewSummary
import io.streamarr.shared.data.model.wireName
import io.streamarr.shared.data.remote.StreamarrApi
import io.streamarr.shared.data.remote.StreamarrServerAccess
import io.streamarr.shared.data.remote.StreamarrServerAccessResolver
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.usecase.BrowseLibraryUseCase
import io.streamarr.shared.domain.usecase.GetPlaybackInfoUseCase
import io.streamarr.shared.domain.usecase.GetWorkDetailsUseCase
import io.streamarr.shared.domain.usecase.ListCatalogKindsUseCase
import io.streamarr.shared.domain.usecase.SearchCatalogUseCase
import io.streamarr.shared.download.DownloadCandidate
import io.streamarr.shared.download.DownloadRepository
import io.streamarr.shared.download.OfflineProgressRepository
import io.streamarr.shared.player.StreamFormat
import io.streamarr.shared.player.PlaybackState
import io.streamarr.shared.player.StreamarrPlayer
import io.streamarr.shared.player.StreamarrSubtitleTrack
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

private data class WebPalette(
    val background: Color,
    val surface: Color,
    val surfaceStrong: Color,
    val surfaceSoft: Color,
    val ink: Color,
    val inkSoft: Color,
    val inkMuted: Color,
    val accent: Color,
)

private data class PlayarrSessionClosure(
    val sessionId: String,
    val positionMs: Long,
    val terminal: PlaybackEventRequest,
)

private val darkWebPalette = WebPalette(
    Color(0xFF151315), Color(0xFF1B181B), Color(0xFF211D21), Color(0xFF312A30),
    Color(0xFFF4F0F1), Color(0xFFC5B8BD), Color(0xFF887A82), Color(0xFFDFDCDD),
)
private val lightWebPalette = WebPalette(
    Color(0xFFF5F3F2), Color(0xFFFBFAF9), Color.White, Color(0xFFDFDCDD),
    Color(0xFF382621), Color(0xFF675961), Color(0xFFA5969E), Color(0xFF675961),
)
private var webPalette = darkWebPalette

internal fun setPlayarrWebPalette(darkTheme: Boolean) {
    webPalette = if (darkTheme) darkWebPalette else lightWebPalette
}

internal val WebBackground get() = webPalette.background
internal val WebSurface get() = webPalette.surface
internal val WebSurfaceStrong get() = webPalette.surfaceStrong
internal val WebSurfaceSoft get() = webPalette.surfaceSoft
internal val WebInk get() = webPalette.ink
internal val WebInkSoft get() = webPalette.inkSoft
internal val WebInkMuted get() = webPalette.inkMuted
internal val WebPink get() = webPalette.accent

internal sealed interface ExperienceLoad<out T> {
    data object Loading : ExperienceLoad<Nothing>
    data class Ready<T>(val value: T) : ExperienceLoad<T>
    data class Failed(val message: PlayarrMessage) : ExperienceLoad<Nothing>
}

private class PlayarrMessageException(val playarrMessage: PlayarrMessage) : IllegalStateException()

@HiltViewModel
internal class PlayarrExperienceViewModel @Inject constructor(
    private val browseLibrary: BrowseLibraryUseCase,
    private val searchCatalog: SearchCatalogUseCase,
    private val listCatalogKinds: ListCatalogKindsUseCase,
    private val tokenStore: TokenStore,
    private val api: StreamarrApi,
    val serverAccessResolver: StreamarrServerAccessResolver,
) : ViewModel() {
    private val _home = MutableStateFlow<ExperienceLoad<List<HomeRail>>>(ExperienceLoad.Loading)
    val home: StateFlow<ExperienceLoad<List<HomeRail>>> = _home.asStateFlow()

    private val _libraries = MutableStateFlow<Map<WorkKind, ExperienceLoad<List<Work>>>>(emptyMap())
    val libraries: StateFlow<Map<WorkKind, ExperienceLoad<List<Work>>>> = _libraries.asStateFlow()

    private val _search = MutableStateFlow<ExperienceLoad<PlayarrSearchResults>>(
        ExperienceLoad.Ready(PlayarrSearchResults()),
    )
    val search: StateFlow<ExperienceLoad<PlayarrSearchResults>> = _search.asStateFlow()

    private val _searchViews = MutableStateFlow<List<ViewSummary>>(emptyList())
    val searchViews: StateFlow<List<ViewSummary>> = _searchViews.asStateFlow()

    private var searchJob: Job? = null
    private var availableSearchWorkIds: Set<String>? = null
    private val searchAvailabilityMutex = Mutex()

    private val _availableKinds = MutableStateFlow<Set<WorkKind>?>(null)
    val availableKinds: StateFlow<Set<WorkKind>?> = _availableKinds.asStateFlow()

    private val _canDownload = MutableStateFlow<Boolean?>(null)
    val canDownload: StateFlow<Boolean?> = _canDownload.asStateFlow()

    private val _progress = MutableStateFlow<List<WatchProgress>>(emptyList())
    val progress: StateFlow<List<WatchProgress>> = _progress.asStateFlow()

    private val _profileAvatar = MutableStateFlow<ProfileAvatarPreference?>(null)
    val profileAvatar: StateFlow<ProfileAvatarPreference?> = _profileAvatar.asStateFlow()

    private val _playbackQueue = MutableStateFlow(PlayarrPlaybackQueue())
    val playbackQueue: StateFlow<PlayarrPlaybackQueue> = _playbackQueue.asStateFlow()

    val accessToken = tokenStore.accessToken.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val currentUserId = tokenStore.currentUserId.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val currentUserName = tokenStore.currentUserName.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    init {
        loadAvailableKinds()
        loadHome()
        viewModelScope.launch {
            while (isActive) {
                refreshCapabilities()
                delay(CAPABILITIES_POLL_MS)
            }
        }
    }

    private fun loadAvailableKinds() {
        viewModelScope.launch {
            _availableKinds.value = when (val result = listCatalogKinds()) {
                is StreamarrResult.Success -> result.value.toSet()
                is StreamarrResult.Failure -> emptySet()
            }
        }
    }

    fun loadHome() {
        viewModelScope.launch {
            _home.value = ExperienceLoad.Loading
            val progressRequest = async { runCatching { api.listWatchProgress() }.getOrDefault(emptyList()) }
            val kinds = listOf(WorkKind.Movie, WorkKind.Series, WorkKind.Site)
            val results = kinds.map { kind ->
                async { kind to browseLibrary(kind = kind, availableOnly = true, sort = "recent", limit = 36) }
            }.awaitAll()
            val failure = results.firstNotNullOfOrNull { (_, result) ->
                (result as? StreamarrResult.Failure)?.error
            }
            if (failure != null && results.all { it.second is StreamarrResult.Failure }) {
                _home.value = ExperienceLoad.Failed(
                    failure.userMessageForExperience(PlayarrString.ErrorSubjectHome),
                )
                return@launch
            }
            val byKind = results.associate { (kind, result) ->
                kind to ((result as? StreamarrResult.Success)?.value ?: emptyList())
            }
            val progress = progressRequest.await()
            val onDeck = progress
                .asSequence()
                .filter { it.state == WatchState.PartWatched }
                .sortedByDescending { it.updatedAt.orEmpty() }
                .distinctBy(WatchProgress::workId)
                .take(10)
                .map { row ->
                    async {
                        runCatching { api.getWork(row.workId) }
                            .getOrNull()
                            ?.let { resolvePlayarrOnDeckEntry(it, row) }
                    }
                }
                .toList()
                .awaitAll()
                .filterNotNull()
            _progress.value = progress
            _home.value = ExperienceLoad.Ready(buildPlayarrHomeRails(byKind, onDeck))
        }
    }

    fun reloadForProfile() {
        _availableKinds.value = null
        _canDownload.value = null
        _libraries.value = emptyMap()
        searchJob?.cancel()
        availableSearchWorkIds = null
        _search.value = ExperienceLoad.Ready(PlayarrSearchResults())
        _searchViews.value = emptyList()
        loadAvailableKinds()
        loadHome()
        viewModelScope.launch {
            refreshCapabilities()
            refreshProfileAvatar()
        }
    }

    fun refreshProfileAvatar() {
        viewModelScope.launch { _profileAvatar.value = runCatching { api.getProfileAvatar().preference }.getOrNull() }
    }

    private suspend fun refreshCapabilities() {
        _canDownload.value = runCatching { api.getSelfCapabilities().canDownload }.getOrDefault(false)
    }

    fun loadLibrary(kind: WorkKind) {
        if (_libraries.value[kind] is ExperienceLoad.Ready) return
        viewModelScope.launch {
            _libraries.value = _libraries.value + (kind to ExperienceLoad.Loading)
            _libraries.value = _libraries.value + (kind to when (
                val result = browseLibrary(kind = kind, availableOnly = true, sort = "title", limit = 240)
            ) {
                is StreamarrResult.Success -> ExperienceLoad.Ready(result.value)
                is StreamarrResult.Failure -> ExperienceLoad.Failed(
                    result.error.userMessageForExperience(kind.playarrPluralKey()),
                )
            })
        }
    }

    fun prepareSearch() {
        viewModelScope.launch {
            _searchViews.value = runCatching { api.listViews() }.getOrDefault(emptyList())
        }
    }

    fun search(
        query: String,
        mediaType: PlayarrSearchMediaType = PlayarrSearchMediaType.All,
        libraryId: String? = null,
        debounce: Boolean = true,
    ) {
        searchJob?.cancel()
        val normalised = query.trim()
        if (normalised.isEmpty()) {
            _search.value = ExperienceLoad.Ready(PlayarrSearchResults())
            return
        }
        searchJob = viewModelScope.launch {
            if (debounce) delay(SEARCH_DEBOUNCE_MS)
            _search.value = ExperienceLoad.Loading
            try {
                val includesWorks = mediaType != PlayarrSearchMediaType.Playlist
                val worksRequest = async {
                    if (!includesWorks) return@async emptyList()
                    when (val result = searchCatalog(normalised, limit = SEARCH_LIMIT)) {
                        is StreamarrResult.Success -> result.value
                        is StreamarrResult.Failure -> throw PlayarrMessageException(
                            result.error.userMessageForExperience(PlayarrString.ErrorSubjectSearch),
                        )
                    }
                }
                val availableIdsRequest = async {
                    if (includesWorks) loadAvailableSearchWorkIds() else emptySet()
                }
                val libraryIdsRequest = async {
                    if (includesWorks && libraryId != null) {
                        api.resolveView(libraryId, limit = SEARCH_LIBRARY_LIMIT).items.mapTo(mutableSetOf(), Work::id)
                    } else {
                        null
                    }
                }
                val playlistsRequest = async {
                    if (libraryId == null && mediaType in setOf(
                            PlayarrSearchMediaType.All,
                            PlayarrSearchMediaType.Playlist,
                        )
                    ) {
                        try {
                            api.listPlaylists()
                        } catch (cancelled: CancellationException) {
                            throw cancelled
                        } catch (error: Throwable) {
                            if (mediaType == PlayarrSearchMediaType.Playlist) throw error
                            emptyList()
                        }
                    } else {
                        emptyList()
                    }
                }
                val works = filterPlayarrSearchWorks(
                    works = worksRequest.await(),
                    availableWorkIds = availableIdsRequest.await(),
                    mediaType = mediaType,
                    libraryWorkIds = libraryIdsRequest.await(),
                )
                val playlists = filterPlayarrSearchPlaylists(
                    playlists = playlistsRequest.await(),
                    query = normalised,
                    mediaType = mediaType,
                    libraryId = libraryId,
                )
                _search.value = ExperienceLoad.Ready(PlayarrSearchResults(works, playlists))
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Throwable) {
                _search.value = ExperienceLoad.Failed(
                    (error as? PlayarrMessageException)?.playarrMessage
                        ?: error.message?.takeIf(String::isNotBlank)?.let(PlayarrMessage::Dynamic)
                        ?: PlayarrMessage.Localized(PlayarrString.ErrorUnableSearch),
                )
            }
        }
    }

    private suspend fun loadAvailableSearchWorkIds(): Set<String> = searchAvailabilityMutex.withLock {
        availableSearchWorkIds?.let { return@withLock it }
        val ids = mutableSetOf<String>()
        var offset = 0L
        while (true) {
            val page = api.browseCatalog(
                availableOnly = true,
                limit = SEARCH_AVAILABILITY_PAGE_SIZE,
                offset = offset,
            )
            page.items.mapTo(ids, Work::id)
            offset += page.items.size
            if (page.items.isEmpty() || page.total?.let { offset >= it } == true) break
        }
        ids.toSet().also { availableSearchWorkIds = it }
    }

    fun markWork(work: Work, watched: Boolean) {
        viewModelScope.launch {
            val detail = runCatching { api.getWork(work.id) }.getOrNull() ?: return@launch
            val existing = _progress.value.associateBy(WatchProgress::mediaFileId)
            detail.mediaFileIds().forEach { mediaFileId ->
                val current = existing[mediaFileId]
                val duration = current?.durationMs?.takeIf { it > 0 } ?: 1L
                runCatching {
                    api.updateWatchProgress(
                        mediaFileId,
                        UpdateWatchProgressRequest(
                            positionMs = if (watched) duration else 0L,
                            durationMs = duration,
                            completed = watched,
                        ),
                    )
                }
            }
            loadHome()
        }
    }

    fun startPlayback(
        mediaFileId: String,
        orderedItems: List<PlayarrPlaybackQueueItem>,
        startPositionMs: Long? = null,
        launchSettings: PlayarrPlaybackLaunchSettings? = null,
    ) {
        _playbackQueue.value = playarrPlaybackQueue(mediaFileId, orderedItems, startPositionMs, launchSettings)
    }

    fun movePlayback(delta: Int) {
        _playbackQueue.value = _playbackQueue.value.move(delta)
    }

    fun selectPlayback(index: Int) {
        _playbackQueue.value = _playbackQueue.value.select(index)
    }

    fun clearPlayback() {
        _playbackQueue.value = PlayarrPlaybackQueue()
    }

}

internal data class ExperienceDestination(
    val route: String,
    val label: PlayarrString,
    val icon: ImageVector,
    val kind: WorkKind? = null,
)

private enum class LibraryViewMode { List, Screen, Cover, CoverFlow }
private enum class LibraryArtworkSize { Small, Medium, Large }

internal val experienceDestinations = listOf(
    ExperienceDestination("downloads", PlayarrString.NavDownloads, Icons.Outlined.Download),
    ExperienceDestination("search", PlayarrString.NavSearch, Icons.Outlined.Search),
    ExperienceDestination("home", PlayarrString.NavHome, Icons.Outlined.Home),
    ExperienceDestination("series", PlayarrString.NavSeries, Icons.Outlined.Tv, WorkKind.Series),
    ExperienceDestination("movies", PlayarrString.NavMovies, Icons.Outlined.Movie, WorkKind.Movie),
    ExperienceDestination("sites", PlayarrString.NavSites, Icons.Outlined.Language, WorkKind.Site),
    ExperienceDestination("music", PlayarrString.NavMusic, Icons.Outlined.MusicNote, WorkKind.Artist),
    ExperienceDestination("playlists", PlayarrString.NavPlaylists, Icons.AutoMirrored.Outlined.PlaylistPlay),
)

internal fun visibleExperienceDestinations(
    availableKinds: Set<WorkKind>?,
    canDownload: Boolean?,
): List<ExperienceDestination> = experienceDestinations.filter { destination ->
    (destination.kind == null || availableKinds?.contains(destination.kind) == true) &&
        (destination.route != "downloads" || canDownload == true)
}

internal fun televisionDestinationGroups(
    destinations: List<ExperienceDestination>,
): List<List<ExperienceDestination>> = listOf(
    destinations.filter { it.route in setOf("downloads", "search") },
    destinations.filter { it.route in setOf("home", "series", "movies", "sites", "music") },
    destinations.filter { it.route == "playlists" },
).filter(List<ExperienceDestination>::isNotEmpty)

private const val CAPABILITIES_POLL_MS = 60_000L
private const val SEARCH_DEBOUNCE_MS = 320L
private const val SEARCH_LIMIT = 60L
private const val SEARCH_LIBRARY_LIMIT = 500L
private const val SEARCH_AVAILABILITY_PAGE_SIZE = 500L
private val LocalPlayarrServerAccessResolver = staticCompositionLocalOf<StreamarrServerAccessResolver?> { null }

@Composable
internal fun rememberPlayarrWorkServerAccess(
    workId: String,
    fallbackServerUrl: String,
    fallbackAccessToken: String?,
): StreamarrServerAccess? = rememberPlayarrServerAccess(
    key = workId,
    fallbackServerUrl = fallbackServerUrl,
    fallbackAccessToken = fallbackAccessToken,
) { resolver -> resolver.forWork(workId) }

@Composable
internal fun rememberPlayarrMediaServerAccess(
    mediaFileId: String,
    fallbackServerUrl: String,
    fallbackAccessToken: String?,
): StreamarrServerAccess? = rememberPlayarrServerAccess(
    key = mediaFileId,
    fallbackServerUrl = fallbackServerUrl,
    fallbackAccessToken = fallbackAccessToken,
) { resolver -> resolver.forMedia(mediaFileId) }

@Composable
internal fun rememberPlayarrUrlServerAccess(
    serverUrl: String,
    fallbackAccessToken: String?,
): StreamarrServerAccess? = rememberPlayarrServerAccess(
    key = serverUrl,
    fallbackServerUrl = serverUrl,
    fallbackAccessToken = fallbackAccessToken,
) { resolver -> resolver.forServerUrl(serverUrl) }

@Composable
private fun rememberPlayarrServerAccess(
    key: String,
    fallbackServerUrl: String,
    fallbackAccessToken: String?,
    resolve: suspend (StreamarrServerAccessResolver) -> StreamarrServerAccess,
): StreamarrServerAccess? {
    val resolver = LocalPlayarrServerAccessResolver.current
    val fallback = remember(fallbackServerUrl, fallbackAccessToken) {
        StreamarrServerAccess(fallbackServerUrl, fallbackAccessToken)
    }
    val access by produceState<StreamarrServerAccess?>(
        initialValue = if (resolver == null) fallback else null,
        resolver,
        key,
        fallback,
    ) {
        if (resolver != null) value = runCatching { resolve(resolver) }.getOrNull()
    }
    return access
}

@Composable
internal fun PlayarrExperience(
    serverUrl: String,
    isTelevision: Boolean,
    viewModel: PlayarrExperienceViewModel = hiltViewModel(),
    playerViewModel: ExperiencePlayerViewModel = hiltViewModel(),
) {
    val navController = rememberNavController()
    val entry by navController.currentBackStackEntryAsState()
    val currentRoute = entry?.destination?.route.orEmpty()
    val token by viewModel.accessToken.collectAsState()
    val currentUserId by viewModel.currentUserId.collectAsState()
    val currentUserName by viewModel.currentUserName.collectAsState()
    val profileAvatar by viewModel.profileAvatar.collectAsState()
    val availableKinds by viewModel.availableKinds.collectAsState()
    val canDownload by viewModel.canDownload.collectAsState()
    val playbackQueue by viewModel.playbackQueue.collectAsState()
    val persistentPlayerState by playerViewModel.state.collectAsState()
    val playbackState by playerViewModel.player.state.collectAsState()
    val playerDefaults = LocalPlayarrDisplayPreferences.current.playerDefaults
    val activePlaybackItem = playbackQueue.currentItem
    val isPlayer = currentRoute.startsWith("experience-player")
    val isProfiles = currentRoute == "profiles"

    LaunchedEffect(currentUserId) {
        if (currentUserId != null) viewModel.reloadForProfile()
    }
    LaunchedEffect(currentRoute, currentUserId) {
        if (currentUserId != null) viewModel.refreshProfileAvatar()
    }
    LaunchedEffect(activePlaybackItem, playerDefaults) {
        activePlaybackItem?.let {
            playerViewModel.play(it.mediaFileId, playerDefaults, it.startPositionMs, it.launchSettings)
        }
    }
    LaunchedEffect(playbackState.hasEnded, activePlaybackItem?.mediaFileId, playbackQueue.canNext) {
        if (shouldAutoAdvancePlayarrMusic(playbackState.hasEnded, activePlaybackItem, playbackQueue.canNext)) {
            viewModel.movePlayback(1)
        }
    }
    LaunchedEffect(persistentPlayerState, activePlaybackItem?.mediaFileId) {
        if (persistentPlayerState !is ExperienceLoad.Ready || activePlaybackItem == null) return@LaunchedEffect
        while (true) {
            delay(10_000)
            playerViewModel.checkpoint()
        }
    }

    val closePlayback = {
        playerViewModel.stopPlayback()
        viewModel.clearPlayback()
        if (isPlayer) navController.popBackStack()
    }

    if (activePlaybackItem != null && persistentPlayerState is ExperienceLoad.Ready) {
        PlayarrMediaSession(
            player = playerViewModel.player.rawPlayer,
            canPrevious = playbackQueue.canPrevious,
            canNext = playbackQueue.canNext,
            onPlay = playerViewModel.player::play,
            onPause = playerViewModel.player::pause,
            onTogglePlayback = playerViewModel::togglePlayback,
            onStop = closePlayback,
            onSeekBackward = { playerViewModel.seekBy(-10_000L) },
            onSeekForward = { playerViewModel.seekBy(10_000L) },
            onPrevious = { viewModel.movePlayback(-1) },
            onNext = { viewModel.movePlayback(1) },
        )
    }

    CompositionLocalProvider(LocalPlayarrServerAccessResolver provides viewModel.serverAccessResolver) {
        Box(modifier = Modifier.fillMaxSize().background(WebBackground)) {
            ExperienceNavHost(navController, serverUrl, token, isTelevision, canDownload, viewModel, playerViewModel)

            if (!isPlayer && !isProfiles) {
                ExperienceNavigation(
                    destinations = visibleExperienceDestinations(availableKinds, canDownload),
                    currentRoute = currentRoute,
                    isTelevision = isTelevision,
                    onNavigate = { navController.openExperienceTopLevel(it) },
                    modifier = Modifier.align(if (isTelevision) Alignment.CenterStart else Alignment.BottomCenter),
                )
                ProfileControl(
                    isTelevision = isTelevision,
                    userId = currentUserId.orEmpty(),
                    userName = currentUserName,
                    avatar = profileAvatar,
                    onClick = { navController.openExperienceTopLevel("profiles") },
                    modifier = Modifier.align(if (isTelevision) Alignment.BottomStart else Alignment.TopEnd),
                )
                if (isTelevision) {
                    PlayarrLogo(
                        modifier = Modifier.align(Alignment.TopStart).padding(start = 59.dp, top = 34.dp),
                    )
                    Box(
                        modifier = Modifier.fillMaxWidth(0.38f).align(Alignment.TopStart).padding(top = 34.dp, end = 28.dp),
                        contentAlignment = Alignment.TopEnd,
                    ) {
                        ExperienceClock()
                    }
                }
            }

            if (!isPlayer && activePlaybackItem != null) {
                PlayarrMiniPlayer(
                    item = activePlaybackItem,
                    playbackState = playbackState,
                    serverUrl = serverUrl,
                    accessToken = token,
                    isTelevision = isTelevision,
                    onMaximise = {
                        navController.navigate("experience-player/${Uri.encode(activePlaybackItem.mediaFileId)}")
                    },
                    modifier = Modifier.align(if (isTelevision) Alignment.BottomEnd else Alignment.BottomCenter),
                )
            }
        }
    }
}

@Composable
private fun PlayarrMiniPlayer(
    item: PlayarrPlaybackQueueItem,
    playbackState: PlaybackState,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    onMaximise: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val displayTitle = item.displayTitle(LocalPlayarrLanguage.current)
    val maximiseDescription = playarrString(PlayarrString.PlayerMaximiseTitle, "title" to displayTitle)
    Surface(
        onClick = onMaximise,
        color = WebSurfaceStrong.copy(alpha = 0.97f),
        contentColor = WebInk,
        shape = RoundedCornerShape(18.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, WebInkMuted.copy(alpha = 0.28f)),
        shadowElevation = 20.dp,
        modifier = modifier
            .then(if (isTelevision) Modifier.width(500.dp) else Modifier.fillMaxWidth())
            .padding(
                start = if (isTelevision) 0.dp else 10.dp,
                end = if (isTelevision) 48.dp else 10.dp,
                bottom = if (isTelevision) 42.dp else 78.dp,
            )
            .semantics { contentDescription = maximiseDescription },
    ) {
        BoxWithConstraints(Modifier.height(if (isTelevision) 118.dp else 82.dp)) {
            val artworkModifier = Modifier
                .fillMaxHeight()
                .fillMaxWidth(0.48f)
                .clip(RoundedCornerShape(topStart = 18.dp, bottomStart = 18.dp))
            item.artworkWork?.let { work ->
                if (item.music) {
                    AuthenticatedAlbumArtwork(work, item.albumId, serverUrl, accessToken, artworkModifier)
                } else {
                    AuthenticatedArtwork(
                        work = work,
                        kinds = listOf(ImageKind.Thumb, ImageKind.Backdrop, ImageKind.Poster),
                        serverUrl = serverUrl,
                        accessToken = accessToken,
                        contentScale = ContentScale.Crop,
                        modifier = artworkModifier,
                    )
                }
            } ?: Box(
                artworkModifier.background(
                    Brush.radialGradient(
                        listOf(WebPink.copy(alpha = 0.5f), Color(0xFF0D090B)),
                    ),
                ),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    displayTitle.take(1).uppercase(LocalPlayarrLanguage.current.locale),
                    color = Color.White.copy(alpha = 0.78f),
                    fontSize = if (isTelevision) 44.sp else 30.sp,
                    fontWeight = FontWeight.Light,
                )
            }

            Box(
                Modifier
                    .fillMaxSize()
                    .background(
                        Brush.horizontalGradient(
                            0.28f to Color.Transparent,
                            0.43f to Color(0x9E090708),
                            0.58f to Color(0xF5090708),
                        ),
                    ),
            )

            Column(
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .padding(start = maxWidth * 0.43f, end = 42.dp),
                verticalArrangement = Arrangement.spacedBy(if (isTelevision) 7.dp else 5.dp),
            ) {
                Text(
                    displayTitle,
                    color = Color.White,
                    fontSize = if (isTelevision) 14.sp else 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "${formatPlayarrPlayerTime(playbackState.positionMs)} / ${formatPlayarrPlayerTime(playbackState.durationMs)}",
                    color = Color.White.copy(alpha = 0.64f),
                    fontSize = if (isTelevision) 10.sp else 9.sp,
                    maxLines = 1,
                )
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(3.dp)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.2f)),
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth(playarrPlaybackProgress(playbackState.positionMs, playbackState.durationMs))
                            .fillMaxHeight()
                            .clip(CircleShape)
                            .background(WebPink),
                    )
                }
            }

            Surface(
                color = Color.White.copy(alpha = 0.12f),
                contentColor = Color.White.copy(alpha = 0.78f),
                shape = CircleShape,
                modifier = Modifier.align(Alignment.TopEnd).padding(12.dp).size(24.dp),
            ) {
                Icon(
                    Icons.Outlined.PictureInPictureAlt,
                    contentDescription = null,
                    modifier = Modifier.padding(5.dp),
                )
            }
        }
    }
}

private fun NavHostController.openExperienceTopLevel(route: String) {
    navigate(route) {
        popUpTo("home") { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

@Composable
private fun ExperienceNavigation(
    destinations: List<ExperienceDestination>,
    currentRoute: String,
    isTelevision: Boolean,
    onNavigate: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (isTelevision) {
        TelevisionNavigation(destinations, currentRoute, onNavigate, modifier)
        return
    }
    val bottomInsets = if (isTelevision) WindowInsets(0) else WindowInsets.navigationBars.only(androidx.compose.foundation.layout.WindowInsetsSides.Bottom)
    Surface(
        modifier = modifier
            .windowInsetsPadding(bottomInsets)
            .padding(horizontal = if (isTelevision) 0.dp else 10.dp, vertical = if (isTelevision) 26.dp else 8.dp),
        color = WebSurfaceStrong.copy(alpha = 0.94f),
        shape = RoundedCornerShape(if (isTelevision) 28.dp else 20.dp),
        shadowElevation = 18.dp,
        tonalElevation = 0.dp,
    ) {
        LazyRow(
            modifier = Modifier.padding(5.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            contentPadding = PaddingValues(0.dp),
        ) {
            items(destinations, key = { it.route }) { destination ->
                val selected = currentRoute == destination.route
                val label = playarrString(destination.label)
                Surface(
                    onClick = { onNavigate(destination.route) },
                    color = if (selected) WebInk else Color.Transparent,
                    contentColor = if (selected) WebBackground else WebInkMuted,
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.height(if (isTelevision) 46.dp else 46.dp),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = if (selected && isTelevision) 16.dp else 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        Icon(destination.icon, contentDescription = label, modifier = Modifier.size(21.dp))
                        AnimatedVisibility(visible = selected && isTelevision) {
                            Text(
                                label.uppercase(LocalPlayarrLanguage.current.locale),
                                modifier = Modifier.padding(start = 8.dp),
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = 1.sp,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TelevisionNavigation(
    destinations: List<ExperienceDestination>,
    currentRoute: String,
    onNavigate: (String) -> Unit,
    modifier: Modifier,
) {
    val groups = televisionDestinationGroups(destinations)
    Column(
        modifier = modifier.padding(start = 42.dp),
        verticalArrangement = Arrangement.spacedBy(13.dp),
    ) {
        groups.forEach { group ->
            Surface(
                color = WebSurfaceStrong.copy(alpha = 0.72f),
                shape = RoundedCornerShape(22.dp),
                border = androidx.compose.foundation.BorderStroke(1.dp, WebInkMuted.copy(alpha = 0.18f)),
                shadowElevation = 16.dp,
            ) {
                Column(Modifier.padding(horizontal = 6.dp, vertical = 7.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    group.forEach { destination ->
                        val selected = currentRoute == destination.route
                        val label = playarrString(destination.label)
                        var focused by remember { mutableStateOf(false) }
                        Surface(
                            onClick = { onNavigate(destination.route) },
                            color = if (selected || focused) WebInk.copy(alpha = if (focused) 0.14f else 0.09f) else Color.Transparent,
                            contentColor = if (selected || focused) WebInk else WebInkMuted,
                            shape = RoundedCornerShape(16.dp),
                            modifier = Modifier
                                .size(64.dp)
                                .scale(if (focused) 1.1f else if (selected) 1.05f else 1f)
                                .onFocusChanged { focused = it.isFocused },
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                                Icon(destination.icon, contentDescription = null, modifier = Modifier.size(20.dp))
                                Text(label, fontSize = 7.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 4.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ExperienceClock(modifier: Modifier = Modifier) {
    var now by remember { mutableStateOf(LocalDateTime.now()) }
    val locale = LocalPlayarrLanguage.current.locale
    val dateFormatter = remember(locale) { DateTimeFormatter.ofPattern("EEE d MMM", locale) }
    LaunchedEffect(Unit) {
        while (true) {
            kotlinx.coroutines.delay(30_000)
            now = LocalDateTime.now()
        }
    }
    Row(modifier, verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(now.format(DateTimeFormatter.ofPattern("HH:mm")), color = WebInk, fontSize = 14.sp, fontWeight = FontWeight.ExtraBold)
        Text(now.format(dateFormatter), color = WebInkMuted, fontSize = 9.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun ProfileControl(
    isTelevision: Boolean,
    userId: String,
    userName: String?,
    avatar: ProfileAvatarPreference?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewer = playarrString(PlayarrString.ProfileViewerFallback)
    val profileDescription = playarrString(
        PlayarrString.ProfileControl,
        "name" to (userName ?: viewer),
    )
    Column(
        modifier = modifier
            .windowInsetsPadding(if (isTelevision) WindowInsets(0) else WindowInsets.safeDrawing)
            .padding(if (isTelevision) 42.dp else 16.dp),
        horizontalAlignment = Alignment.Start,
    ) {
        Surface(
            onClick = onClick,
            modifier = (if (isTelevision) Modifier.height(46.dp) else Modifier.size(42.dp))
                .semantics { contentDescription = profileDescription },
            shape = CircleShape,
            color = WebSurfaceStrong.copy(alpha = 0.94f),
            contentColor = WebInkSoft,
            border = androidx.compose.foundation.BorderStroke(1.dp, WebInkMuted.copy(alpha = 0.35f)),
            shadowElevation = 12.dp,
        ) {
            Row(
                modifier = Modifier.padding(horizontal = if (isTelevision) 7.dp else 0.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
            ) {
                PlayarrProfileAvatar(
                    userId = userId,
                    preference = avatar,
                    modifier = Modifier.size(if (isTelevision) 32.dp else 42.dp),
                    glyphSize = if (isTelevision) 17.sp else 20.sp,
                )
                if (isTelevision) {
                    Text(
                        userName ?: playarrString(PlayarrString.ProfileViewerFallback),
                        fontSize = 9.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(horizontal = 9.dp),
                    )
                }
            }
        }
        Box(
            modifier = Modifier.width(if (isTelevision) 36.dp else 42.dp).padding(top = 5.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                profileVersionLabel(BuildConfig.VERSION_NAME),
                color = WebInkMuted,
                fontSize = if (isTelevision) 7.sp else 8.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.3.sp,
                modifier = Modifier.clearAndSetSemantics { },
            )
        }
    }
}

internal fun profileVersionLabel(versionName: String): String = "v$versionName"

@Composable
private fun PlayarrLogo(modifier: Modifier = Modifier) {
    Icon(
        painter = painterResource(R.drawable.playarr_mark),
        contentDescription = "Playarr",
        tint = Color.Unspecified,
        modifier = modifier.size(42.dp),
    )
}

@Composable
private fun ExperienceNavHost(
    navController: NavHostController,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    canDownload: Boolean?,
    viewModel: PlayarrExperienceViewModel,
    playerViewModel: ExperiencePlayerViewModel,
) {
    val playbackQueue by viewModel.playbackQueue.collectAsState()
    NavHost(navController, startDestination = "home", modifier = Modifier.fillMaxSize()) {
        composable("home") {
            ExperienceHomeScreen(serverUrl, accessToken, isTelevision, canDownload == true, navController, viewModel)
        }
        composable("search") {
            ExperienceSearchScreen(serverUrl, accessToken, isTelevision, canDownload == true, navController, viewModel)
        }
        listOf(
            "series" to WorkKind.Series,
            "movies" to WorkKind.Movie,
            "sites" to WorkKind.Site,
            "music" to WorkKind.Artist,
        ).forEach { (route, kind) ->
            composable(route) {
                ExperienceLibraryScreen(kind, serverUrl, accessToken, isTelevision, canDownload == true, navController, viewModel)
            }
        }
        composable(
            route = "experience-detail/{workId}?mediaFileId={mediaFileId}",
            arguments = listOf(
                navArgument("mediaFileId") {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                },
            ),
        ) { entry ->
            ExperienceDetailScreen(
                workId = entry.arguments?.getString("workId").orEmpty(),
                initialMediaFileId = entry.arguments?.getString("mediaFileId"),
                serverUrl = serverUrl,
                accessToken = accessToken,
                isTelevision = isTelevision,
                canDownload = canDownload == true,
                onBack = navController::popBackStack,
                onOpenWork = { navController.navigate("experience-detail/$it") },
                onPlay = { mediaFileId, orderedItems, startPositionMs, launchSettings ->
                    viewModel.startPlayback(mediaFileId, orderedItems, startPositionMs, launchSettings)
                    if (orderedItems.none { it.music }) {
                        navController.navigate("experience-player/${Uri.encode(mediaFileId)}")
                    }
                },
            )
        }
        composable("experience-player/{mediaFileId}") { entry ->
            ExperiencePlayerScreen(
                mediaFileId = entry.arguments?.getString("mediaFileId").orEmpty(),
                serverUrl = serverUrl,
                accessToken = accessToken,
                isTelevision = isTelevision,
                playbackQueue = playbackQueue,
                onMovePlayback = viewModel::movePlayback,
                onSelectPlayback = viewModel::selectPlayback,
                onBack = {
                    playerViewModel.stopPlayback()
                    viewModel.clearPlayback()
                    navController.popBackStack()
                },
                onMinimise = navController::popBackStack,
                viewModel = playerViewModel,
            )
        }
        composable("playlists") {
            ExperiencePlaylistsScreen(serverUrl, accessToken, isTelevision, navController)
        }
        composable("playlists/{playlistId}") { entry ->
            ExperiencePlaylistDetailScreen(
                playlistId = entry.arguments?.getString("playlistId").orEmpty(),
                serverUrl = serverUrl,
                accessToken = accessToken,
                isTelevision = isTelevision,
                onBack = navController::popBackStack,
                onOpenWork = { navController.navigate("experience-detail/$it") },
                onPlay = { mediaFileId, orderedItems, startPositionMs, launchSettings ->
                    viewModel.startPlayback(mediaFileId, orderedItems, startPositionMs, launchSettings)
                    if (orderedItems.none { it.music }) {
                        navController.navigate("experience-player/${Uri.encode(mediaFileId)}")
                    }
                },
            )
        }
        composable("profiles") {
            val profileAvatar by viewModel.profileAvatar.collectAsState()
            val currentUserId by viewModel.currentUserId.collectAsState()
            ExperienceProfilesScreen(
                isTelevision = isTelevision,
                currentUserId = currentUserId.orEmpty(),
                currentAvatar = profileAvatar,
                onHome = { navController.openExperienceTopLevel("home") },
                onSettings = { navController.openExperienceTopLevel("settings") },
            )
        }
        composable("settings") { ExperienceParitySettingsScreen(serverUrl, isTelevision) }
        composable("downloads") {
            when (canDownload) {
                null -> ExperienceLoading(playarrString(PlayarrString.DownloadsLoading))
                false -> ExperienceNotFoundScreen()
                true -> ExperienceDownloadsScreen(
                    serverUrl = serverUrl,
                    accessToken = accessToken,
                    isTelevision = isTelevision,
                    onPlay = { download ->
                        val item = download.playarrPlaybackQueueItem()
                        viewModel.startPlayback(download.mediaFileId, listOf(item))
                        if (!item.music) {
                            navController.navigate("experience-player/${Uri.encode(download.mediaFileId)}")
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun ExperienceHomeScreen(
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    canDownload: Boolean,
    navController: NavHostController,
    viewModel: PlayarrExperienceViewModel,
) {
    val homeView = LocalPlayarrDisplayPreferences.current.homeView
    val state by viewModel.home.collectAsState()
    val progress by viewModel.progress.collectAsState()
    val progressByWork = remember(progress) { progress.associateBy(WatchProgress::workId) }
    when (val current = state) {
        ExperienceLoad.Loading -> ExperienceLoading(playarrString(PlayarrString.HomePreparing))
        is ExperienceLoad.Failed -> ExperienceFailure(current.message, viewModel::loadHome)
        is ExperienceLoad.Ready -> {
            if (current.value.isEmpty()) {
                ExperienceEmpty(
                    playarrString(PlayarrString.HomeEmptyTitle),
                    playarrString(PlayarrString.HomeEmptyDescription),
                )
                return
            }
            val allWorks = current.value.flatMap(HomeRail::works)
            var selectedId by remember(allWorks) { mutableStateOf(allWorks.first().id) }
            var contextWork by remember { mutableStateOf<Work?>(null) }
            val selected = allWorks.firstOrNull { it.id == selectedId } ?: allWorks.first()
            ExperienceStage(
                selected = selected,
                serverUrl = serverUrl,
                accessToken = accessToken,
                isTelevision = isTelevision,
                feature = {
                    FeatureCopy(selected, true)
                },
                rails = {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(
                            top = if (isTelevision) 480.dp else 68.dp,
                            bottom = if (isTelevision) 120.dp else 98.dp,
                        ),
                        verticalArrangement = Arrangement.spacedBy(if (isTelevision) 48.dp else 16.dp),
                    ) {
                        items(current.value, key = HomeRail::title) { rail ->
                            ExperienceMediaRail(
                                rail = rail,
                                serverUrl = serverUrl,
                                accessToken = accessToken,
                                isTelevision = isTelevision,
                                homeView = homeView,
                                selectedId = selectedId,
                                progressByWork = progressByWork,
                                onSelected = { selectedId = it.id },
                                onClick = { work, onDeck ->
                                    val mediaFileId = onDeck?.episode?.mediaFileId
                                        ?: onDeck?.progress?.mediaFileId
                                    val route = "experience-detail/${Uri.encode(work.id)}"
                                    navController.navigate(
                                        if (mediaFileId == null) route
                                        else "$route?mediaFileId=${Uri.encode(mediaFileId)}",
                                    )
                                },
                                onContext = { contextWork = it },
                            )
                        }
                    }
                },
            )
            contextWork?.let { work ->
                MediaContextDialog(
                    work = work,
                    onDismiss = { contextWork = null },
                    onOpen = { contextWork = null; navController.navigate("experience-detail/${work.id}") },
                    onMark = { watched -> viewModel.markWork(work, watched); contextWork = null },
                    canDownload = canDownload,
                )
            }
        }
    }
}

@Composable
private fun ExperienceStage(
    selected: Work,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    feature: @Composable () -> Unit,
    rails: @Composable () -> Unit,
) {
    Box(modifier = Modifier.fillMaxSize().background(WebSurface)) {
        AuthenticatedArtwork(
            work = selected,
            kinds = listOf(ImageKind.Backdrop, ImageKind.Poster),
            serverUrl = serverUrl,
            accessToken = accessToken,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .fillMaxSize()
                .then(if (isTelevision) Modifier.fillMaxWidth(0.53f) else Modifier.fillMaxHeight(0.55f)),
        )
        Box(
            Modifier.fillMaxSize().background(
                if (isTelevision) {
                    Brush.horizontalGradient(listOf(WebSurface.copy(alpha = 0.18f), WebSurface.copy(alpha = 0.82f), WebSurface))
                } else {
                    Brush.verticalGradient(listOf(Color.Transparent, WebSurface.copy(alpha = 0.78f), WebSurface), endY = 980f)
                },
            ),
        )
        if (isTelevision) {
            Box(Modifier.fillMaxWidth(0.38f).fillMaxHeight().padding(start = 154.dp, top = 259.dp, end = 28.dp), contentAlignment = Alignment.TopStart) {
                feature()
            }
            Box(
                Modifier.fillMaxHeight().fillMaxWidth(0.62f).align(Alignment.CenterEnd).background(
                    Brush.horizontalGradient(listOf(Color.Transparent, WebSurfaceSoft.copy(alpha = 0.88f), WebSurfaceStrong)),
                ),
            ) { rails() }
        } else {
            Box(Modifier.fillMaxSize()) { rails() }
        }
    }
}

@Composable
private fun FeatureCopy(work: Work, isTelevision: Boolean = false) {
    val language = LocalPlayarrLanguage.current
    val kind = work.kind.playarrSingularLabel()
    val genre = work.genres.firstOrNull() ?: playarrString(PlayarrString.HomeDefaultGenre)
    Column {
        Text(
            playarrString(PlayarrString.HomeKindGenre, "kind" to kind, "genre" to genre).uppercase(language.locale),
            color = WebPink,
            fontSize = 11.sp,
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = 1.2.sp,
        )
        Text(
            work.title,
            color = WebInk,
            fontSize = if (isTelevision) 69.sp else 42.sp,
            fontWeight = FontWeight.Medium,
            letterSpacing = (-2).sp,
            lineHeight = if (isTelevision) 62.sp else 38.sp,
            modifier = Modifier.padding(top = 20.dp),
        )
        Text(
            work.overview?.takeIf(String::isNotBlank) ?: playarrString(PlayarrString.HomeNoSynopsis),
            color = WebInkMuted,
            fontSize = 14.sp,
            lineHeight = 21.sp,
            maxLines = 5,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 20.dp),
        )
    }
}

@Composable
private fun ExperienceMediaRail(
    rail: HomeRail,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    homeView: PlayarrHomeViewPreference,
    selectedId: String,
    progressByWork: Map<String, WatchProgress>,
    onSelected: (Work) -> Unit,
    onClick: (Work, PlayarrOnDeckEntry?) -> Unit,
    onContext: (Work) -> Unit,
) {
    val collection = playarrString(PlayarrString.LibraryCollectionTitles)
    Column(modifier = Modifier.fillMaxWidth().padding(start = if (isTelevision) 46.dp else 16.dp)) {
        Text(playarrString(rail.title), color = WebInk, fontSize = if (isTelevision) 18.sp else 16.sp, fontWeight = FontWeight.SemiBold)
        Text(
            playarrString(PlayarrString.LibraryCollectionCount, "count" to rail.works.size, "collection" to collection),
            color = WebInkMuted,
            fontSize = 10.sp,
            modifier = Modifier.padding(top = 2.dp),
        )
        LazyRow(
            modifier = Modifier.fillMaxWidth().padding(top = 7.dp),
            contentPadding = PaddingValues(end = 20.dp, top = 6.dp, bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(if (isTelevision) 24.dp else 12.dp),
        ) {
            items(rail.works, key = Work::id) { work ->
                val onDeck = rail.onDeckByWork[work.id]
                val episode = onDeck?.episode
                ExperienceLandscapeCard(
                    work = work,
                    serverUrl = serverUrl,
                    accessToken = accessToken,
                    width = when (homeView) {
                        PlayarrHomeViewPreference.Thumbnail -> if (isTelevision) 219.dp else 150.dp
                        PlayarrHomeViewPreference.Cover -> if (isTelevision) 172.dp else 118.dp
                    },
                    homeView = homeView,
                    selected = selectedId == work.id,
                    progress = onDeck?.progress ?: progressByWork[work.id],
                    onSelected = { onSelected(work) },
                    onClick = { onClick(work, onDeck) },
                    onContext = { onContext(work) },
                    mediaFileId = episode?.mediaFileId ?: onDeck?.progress?.mediaFileId,
                    displayTitle = episode?.title?.takeIf(String::isNotBlank)
                        ?: episode?.let {
                            playarrString(PlayarrString.HomeEpisodeLabel, "number" to it.episodeNumber)
                        }
                        ?: work.title,
                    displaySubtitle = episode?.let {
                        playarrString(
                            PlayarrString.HomeEpisodeProvider,
                            "title" to work.title,
                            "season" to it.seasonNumber.toString().padStart(2, '0'),
                            "episode" to it.episodeNumber.toString().padStart(2, '0'),
                        )
                    } ?: work.kind.playarrSingularLabel(),
                )
            }
        }
    }
}

@Composable
private fun ExperienceLandscapeCard(
    work: Work,
    serverUrl: String,
    accessToken: String?,
    width: Dp,
    selected: Boolean,
    onSelected: () -> Unit,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    progress: WatchProgress? = null,
    onContext: (() -> Unit)? = null,
    homeView: PlayarrHomeViewPreference = PlayarrHomeViewPreference.Thumbnail,
    mediaFileId: String? = null,
    displayTitle: String = work.title,
    displaySubtitle: String? = null,
) {
    val resolvedSubtitle = displaySubtitle ?: work.kind.playarrSingularLabel()
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.045f else 1f, label = "playarrCardFocus")
    Column(
        modifier = modifier
            .width(width)
            .scale(scale)
            .onFocusChanged { if (it.isFocused) { focused = true; onSelected() } else focused = false }
            .focusable()
            .combinedClickable(
                onClick = { onSelected(); onClick() },
                onLongClick = onContext,
            ),
    ) {
        Box(
            Modifier.fillMaxWidth()
                .aspectRatio(if (homeView == PlayarrHomeViewPreference.Cover) 2f / 3f else 16f / 9f)
                .clip(RoundedCornerShape(10.dp)).background(WebSurfaceSoft)
                .then(if (focused || selected) Modifier.border(1.dp, WebInk.copy(alpha = 0.62f), RoundedCornerShape(10.dp)) else Modifier),
        ) {
            AuthenticatedArtwork(
                work = work,
                kinds = if (homeView == PlayarrHomeViewPreference.Cover) {
                    listOf(ImageKind.Poster, ImageKind.Backdrop)
                } else {
                    listOf(ImageKind.Backdrop, ImageKind.Thumb, ImageKind.Poster)
                },
                serverUrl = serverUrl,
                accessToken = accessToken,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            if (mediaFileId != null && homeView == PlayarrHomeViewPreference.Thumbnail) {
                AuthenticatedMediaThumbnail(
                    mediaFileId = mediaFileId,
                    serverUrl = serverUrl,
                    accessToken = accessToken,
                    contentDescription = displayTitle,
                    modifier = Modifier.fillMaxSize(),
                )
            }
            progress?.takeIf { it.state != WatchState.Unseen }?.let {
                Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(3.dp).background(Color.White.copy(alpha = 0.28f))) {
                    Box(Modifier.fillMaxWidth(it.fraction).fillMaxHeight().background(WebPink))
                }
            }
        }
        Text(displayTitle, color = WebInk, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 7.dp))
        Text(resolvedSubtitle, color = WebInkMuted, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun LibraryResults(
    works: List<Work>,
    viewMode: LibraryViewMode,
    artworkSize: LibraryArtworkSize,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    selectedId: String,
    progressByWork: Map<String, WatchProgress>,
    onSelected: (Work) -> Unit,
    onOpen: (Work) -> Unit,
    onContext: (Work) -> Unit,
) {
    val landscapeWidth = when (artworkSize) {
        LibraryArtworkSize.Small -> if (isTelevision) 150.dp else 132.dp
        LibraryArtworkSize.Medium -> if (isTelevision) 190.dp else 164.dp
        LibraryArtworkSize.Large -> if (isTelevision) 250.dp else 206.dp
    }
    val padding = PaddingValues(start = if (isTelevision) 32.dp else 16.dp, end = if (isTelevision) 82.dp else 16.dp, top = if (isTelevision) 18.dp else 28.dp, bottom = 104.dp)
    when (viewMode) {
        LibraryViewMode.Screen -> LazyVerticalGrid(
            columns = GridCells.Adaptive(landscapeWidth),
            modifier = Modifier.fillMaxSize(),
            contentPadding = padding,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            items(works, key = Work::id) { work ->
                ExperienceLandscapeCard(
                    work = work,
                    serverUrl = serverUrl,
                    accessToken = accessToken,
                    width = landscapeWidth,
                    selected = work.id == selectedId,
                    onSelected = { onSelected(work) },
                    onClick = { onOpen(work) },
                    modifier = Modifier.fillMaxWidth(),
                    progress = progressByWork[work.id],
                    onContext = { onContext(work) },
                )
            }
        }
        LibraryViewMode.List -> LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = padding,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(works, key = Work::id) { work ->
                Row(
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(WebSurfaceSoft.copy(alpha = 0.72f))
                        .combinedClickable(onClick = { onSelected(work); onOpen(work) }, onLongClick = { onContext(work) }).padding(9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    AuthenticatedArtwork(work, listOf(ImageKind.Backdrop, ImageKind.Poster), serverUrl, accessToken, ContentScale.Crop, Modifier.width(126.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(8.dp)))
                    Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                        Text(work.title, color = WebInk, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(work.genres.take(2).joinToString(" · "), color = WebInkMuted, fontSize = 10.sp)
                    }
                    Text("›", color = WebInkMuted, fontSize = 22.sp)
                }
            }
        }
        LibraryViewMode.Cover -> LazyVerticalGrid(
            columns = GridCells.Adaptive(landscapeWidth * 0.72f),
            modifier = Modifier.fillMaxSize(),
            contentPadding = padding,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            items(works, key = Work::id) { work ->
                LibraryCoverCard(work, serverUrl, accessToken, landscapeWidth * 0.72f, work.id == selectedId, onSelected, onOpen, onContext)
            }
        }
        LibraryViewMode.CoverFlow -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            LazyRow(
                modifier = Modifier.fillMaxWidth(),
                contentPadding = PaddingValues(
                    start = if (isTelevision) 120.dp else 32.dp,
                    end = if (isTelevision) 120.dp else 32.dp,
                    bottom = 80.dp,
                ),
                horizontalArrangement = Arrangement.spacedBy(if (isTelevision) 34.dp else 18.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                items(works, key = Work::id) { work ->
                    LibraryCoverCard(work, serverUrl, accessToken, landscapeWidth * 0.84f, work.id == selectedId, onSelected, onOpen, onContext)
                }
            }
        }
    }
}

@Composable
private fun LibraryCoverCard(
    work: Work,
    serverUrl: String,
    accessToken: String?,
    width: Dp,
    selected: Boolean,
    onSelected: (Work) -> Unit,
    onOpen: (Work) -> Unit,
    onContext: (Work) -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    Column(
        Modifier.width(width).scale(if (focused || selected) 1.04f else 1f)
            .onFocusChanged { focused = it.isFocused; if (it.isFocused) onSelected(work) }.focusable()
            .combinedClickable(onClick = { onSelected(work); onOpen(work) }, onLongClick = { onContext(work) }),
    ) {
        AuthenticatedArtwork(
            work, listOf(ImageKind.Poster, ImageKind.Backdrop), serverUrl, accessToken, ContentScale.Crop,
            Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(RoundedCornerShape(12.dp))
                .then(if (focused || selected) Modifier.border(1.dp, WebInkSoft, RoundedCornerShape(12.dp)) else Modifier),
        )
        Text(work.title, color = WebInk, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp))
    }
}

@Composable
private fun LibraryFiltersDialog(
    viewMode: LibraryViewMode,
    artworkSize: LibraryArtworkSize,
    sortMode: String,
    descending: Boolean,
    onViewMode: (LibraryViewMode) -> Unit,
    onArtworkSize: (LibraryArtworkSize) -> Unit,
    onSortMode: (String) -> Unit,
    onDescending: (Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(playarrString(PlayarrString.LibraryFilters)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                LibraryFilterChoices(
                    playarrString(PlayarrString.LibraryView),
                    LibraryViewMode.entries,
                    viewMode,
                    onViewMode,
                ) {
                    playarrString(
                        when (it) {
                            LibraryViewMode.List -> PlayarrString.LibraryViewList
                            LibraryViewMode.Screen -> PlayarrString.LibraryViewScreen
                            LibraryViewMode.Cover -> PlayarrString.LibraryViewCover
                            LibraryViewMode.CoverFlow -> PlayarrString.LibraryViewCoverFlow
                        },
                    )
                }
                LibraryFilterChoices(
                    playarrString(PlayarrString.LibraryArtworkSize),
                    LibraryArtworkSize.entries,
                    artworkSize,
                    onArtworkSize,
                ) {
                    playarrString(
                        when (it) {
                            LibraryArtworkSize.Small -> PlayarrString.LibrarySizeSmall
                            LibraryArtworkSize.Medium -> PlayarrString.LibrarySizeMedium
                            LibraryArtworkSize.Large -> PlayarrString.LibrarySizeLarge
                        },
                    )
                }
                LibraryFilterChoices(
                    playarrString(PlayarrString.LibrarySortBy),
                    listOf("title", "recent"),
                    sortMode,
                    onSortMode,
                ) {
                    playarrString(if (it == "title") PlayarrString.LibrarySortTitle else PlayarrString.LibrarySortDateAdded)
                }
                LibraryFilterChoices(
                    playarrString(PlayarrString.LibraryOrder),
                    listOf(false, true),
                    descending,
                    onDescending,
                ) {
                    playarrString(
                        when {
                            sortMode == "title" && !it -> PlayarrString.LibrarySortAscAlpha
                            sortMode == "title" -> PlayarrString.LibrarySortDescAlpha
                            !it -> PlayarrString.LibrarySortAscDate
                            else -> PlayarrString.LibrarySortDescDate
                        },
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(playarrString(PlayarrString.LibraryCloseFilters)) } },
    )
}

@Composable
private fun <T> LibraryFilterChoices(
    title: String,
    values: List<T>,
    selected: T,
    onSelected: (T) -> Unit,
    label: @Composable (T) -> String,
) {
    val language = LocalPlayarrLanguage.current
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title.uppercase(language.locale), color = WebInkMuted, fontSize = 9.sp, fontWeight = FontWeight.Bold)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            items(values) { value -> OutlinedButton(onClick = { onSelected(value) }, enabled = value != selected) { Text(label(value)) } }
        }
    }
}

@Composable
private fun ExperienceLibraryScreen(
    kind: WorkKind,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    canDownload: Boolean,
    navController: NavHostController,
    viewModel: PlayarrExperienceViewModel,
) {
    val states by viewModel.libraries.collectAsState()
    val progress by viewModel.progress.collectAsState()
    val progressByWork = remember(progress) { progress.associateBy(WatchProgress::workId) }
    val language = LocalPlayarrLanguage.current
    val plural = kind.playarrPluralLabel()
    val collection = kind.playarrCollectionNoun()
    LaunchedEffect(kind) { viewModel.loadLibrary(kind) }
    when (val state = states[kind] ?: ExperienceLoad.Loading) {
        ExperienceLoad.Loading -> ExperienceLoading(
            playarrString(PlayarrString.LibraryLoading, "label" to plural),
        )
        is ExperienceLoad.Failed -> ExperienceFailure(state.message) { viewModel.loadLibrary(kind) }
        is ExperienceLoad.Ready -> {
            if (state.value.isEmpty()) {
                ExperienceEmpty(
                    playarrString(PlayarrString.LibraryEmptyTitle, "plural" to plural.lowercase(language.locale)),
                    playarrString(PlayarrString.LibraryEmptyDescription, "collection" to collection),
                )
                return
            }
            var selectedId by remember(state.value) { mutableStateOf(state.value.first().id) }
            var contextWork by remember { mutableStateOf<Work?>(null) }
            var activeLetter by remember(kind) { mutableStateOf("#") }
            var filtersOpen by remember { mutableStateOf(false) }
            var viewMode by remember { mutableStateOf(LibraryViewMode.Screen) }
            var artworkSize by remember { mutableStateOf(LibraryArtworkSize.Medium) }
            var sortMode by remember { mutableStateOf("title") }
            var descending by remember { mutableStateOf(false) }
            val filteredWorks = remember(state.value, activeLetter, sortMode, descending) {
                val matching = state.value.filter { work -> activeLetter == "#" || work.sortTitle.startsWith(activeLetter, ignoreCase = true) }
                val sorted = if (sortMode == "recent") matching.sortedBy(Work::addedAt) else matching.sortedBy(Work::sortTitle)
                if (descending) sorted.reversed() else sorted
            }
            val selected = filteredWorks.firstOrNull { it.id == selectedId } ?: filteredWorks.firstOrNull() ?: state.value.first()
            Box(modifier = Modifier.fillMaxSize().background(WebSurface)) {
                AuthenticatedArtwork(
                    work = selected,
                    kinds = listOf(ImageKind.Backdrop, ImageKind.Poster),
                    serverUrl = serverUrl,
                    accessToken = accessToken,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize().then(if (isTelevision) Modifier.fillMaxWidth(0.52f) else Modifier.fillMaxHeight(0.43f)),
                )
                Box(Modifier.fillMaxSize().background(if (isTelevision) Brush.horizontalGradient(listOf(WebSurface.copy(alpha = 0.16f), WebSurface)) else Brush.verticalGradient(listOf(Color.Transparent, WebSurface), endY = 820f)))
                if (isTelevision) {
                    Box(Modifier.fillMaxWidth(0.35f).fillMaxHeight().padding(start = 154.dp, top = 259.dp, end = 26.dp), contentAlignment = Alignment.TopStart) { FeatureCopy(selected, true) }
                }
                Column(
                    modifier = Modifier
                        .then(if (isTelevision) Modifier.fillMaxWidth(0.65f).fillMaxHeight().align(Alignment.CenterEnd) else Modifier.fillMaxSize())
                        .background(if (isTelevision) WebSurfaceStrong.copy(alpha = 0.93f) else Color.Transparent)
                        .padding(top = if (isTelevision) 76.dp else 18.dp),
                ) {
                    Text(plural, color = WebInk, fontSize = if (isTelevision) 28.sp else 22.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(horizontal = if (isTelevision) 32.dp else 16.dp))
                    Text(
                        playarrString(PlayarrString.LibraryCollectionCount, "count" to state.value.size, "collection" to collection),
                        color = WebInkMuted,
                        fontSize = 11.sp,
                        modifier = Modifier.padding(horizontal = if (isTelevision) 32.dp else 16.dp, vertical = 4.dp),
                    )
                    LibraryResults(
                        works = filteredWorks,
                        viewMode = viewMode,
                        artworkSize = artworkSize,
                        serverUrl = serverUrl,
                        accessToken = accessToken,
                        isTelevision = isTelevision,
                        selectedId = selectedId,
                        progressByWork = progressByWork,
                        onSelected = { selectedId = it.id },
                        onOpen = { navController.navigate("experience-detail/${it.id}") },
                        onContext = { contextWork = it },
                    )
                }
                Surface(
                    onClick = { filtersOpen = true },
                    color = WebSurfaceStrong.copy(alpha = 0.9f),
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .windowInsetsPadding(if (isTelevision) WindowInsets(0) else WindowInsets.statusBars)
                        .padding(top = if (isTelevision) 116.dp else 14.dp, end = if (isTelevision) 14.dp else 66.dp)
                        .size(44.dp),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.FilterList, playarrString(PlayarrString.LibraryFilters), tint = WebInkMuted)
                    }
                }
                if (isTelevision && sortMode == "title") {
                    LazyColumn(
                        modifier = Modifier.align(Alignment.CenterEnd).width(28.dp).fillMaxHeight(0.72f),
                        verticalArrangement = Arrangement.SpaceEvenly,
                    ) {
                        items(listOf("#") + ('A'..'Z').map(Char::toString)) { letter ->
                            Text(
                                letter,
                                color = if (activeLetter == letter) WebInk else WebInkMuted,
                                fontSize = 9.sp,
                                fontWeight = if (activeLetter == letter) FontWeight.Bold else FontWeight.Normal,
                                modifier = Modifier.fillMaxWidth().clickable { activeLetter = letter },
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                            )
                        }
                    }
                }
            }
            if (filtersOpen) {
                LibraryFiltersDialog(
                    viewMode = viewMode,
                    artworkSize = artworkSize,
                    sortMode = sortMode,
                    descending = descending,
                    onViewMode = { viewMode = it },
                    onArtworkSize = { artworkSize = it },
                    onSortMode = { sortMode = it; if (it != "title") activeLetter = "#" },
                    onDescending = { descending = it },
                    onDismiss = { filtersOpen = false },
                )
            }
            contextWork?.let { work ->
                MediaContextDialog(
                    work = work,
                    onDismiss = { contextWork = null },
                    onOpen = { contextWork = null; navController.navigate("experience-detail/${work.id}") },
                    onMark = { watched -> viewModel.markWork(work, watched); contextWork = null },
                    canDownload = canDownload,
                )
            }
        }
    }
}

@Composable
private fun ExperienceSearchScreen(
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    canDownload: Boolean,
    navController: NavHostController,
    viewModel: PlayarrExperienceViewModel,
) {
    val state by viewModel.search.collectAsState()
    val views by viewModel.searchViews.collectAsState()
    val availableKinds by viewModel.availableKinds.collectAsState()
    val progress by viewModel.progress.collectAsState()
    val searchResults = when (val current = state) {
        is ExperienceLoad.Ready -> current.value
        else -> null
    }
    val progressByWork = remember(progress) { progress.associateBy(WatchProgress::workId) }
    var query by remember { mutableStateOf("") }
    var mediaFilter by remember { mutableStateOf(PlayarrSearchMediaType.All) }
    var libraryId by remember { mutableStateOf<String?>(null) }
    var filtersOpen by remember { mutableStateOf(false) }
    var contextWork by remember { mutableStateOf<Work?>(null) }
    var selectedResultKey by remember { mutableStateOf<String?>(null) }
    val visibleMediaTypes = remember(availableKinds) {
        PlayarrSearchMediaType.entries.filter { type ->
            type.workKind == null || availableKinds?.contains(type.workKind) == true
        }
    }
    val activeLibrary = views.firstOrNull { it.id == libraryId }
    val selectedWork = searchResults?.works?.firstOrNull { "work:${it.id}" == selectedResultKey }
    val selectedPlaylist = searchResults?.playlists?.firstOrNull { "playlist:${it.id}" == selectedResultKey }
    fun submitSearch(debounce: Boolean) {
        viewModel.search(query, mediaFilter, libraryId, debounce)
    }
    LaunchedEffect(Unit) { viewModel.prepareSearch() }
    LaunchedEffect(searchResults) {
        searchResults?.let { selectedResultKey = playarrSearchSelection(it, selectedResultKey) }
    }
    LaunchedEffect(availableKinds, mediaFilter) {
        if (mediaFilter.workKind != null && availableKinds?.contains(mediaFilter.workKind) == false) {
            mediaFilter = PlayarrSearchMediaType.All
            viewModel.search(query, mediaFilter, libraryId, debounce = false)
        }
    }
    Column(
        modifier = Modifier.fillMaxSize().background(WebSurface).padding(
            start = if (isTelevision) 72.dp else 16.dp,
            end = if (isTelevision) 72.dp else 16.dp,
            top = if (isTelevision) 92.dp else 72.dp,
        ),
    ) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                playarrString(PlayarrString.SearchTitle),
                color = WebInk,
                fontSize = if (isTelevision) 44.sp else 30.sp,
                fontWeight = FontWeight.Medium,
                letterSpacing = (-1).sp,
            )
            if (query.isNotBlank()) {
                val resultStatus = when (val current = state) {
                    ExperienceLoad.Loading -> playarrString(PlayarrString.SearchSearching)
                    is ExperienceLoad.Ready -> playarrString(
                        if (current.value.count == 1) PlayarrString.SearchResultCountOne else PlayarrString.SearchResultCountOther,
                        "count" to current.value.count,
                    )
                    is ExperienceLoad.Failed -> playarrString(PlayarrString.SearchZeroResults)
                }
                Text(
                    resultStatus,
                    color = WebInkMuted,
                    fontSize = 11.sp,
                    modifier = Modifier.padding(start = 12.dp, bottom = 5.dp),
                )
            }
        }
        OutlinedTextField(
            value = query,
            onValueChange = {
                query = it
                viewModel.search(it, mediaFilter, libraryId, debounce = true)
            },
            modifier = Modifier.fillMaxWidth(if (isTelevision) 0.58f else 1f).padding(top = 18.dp),
            placeholder = { Text(playarrString(PlayarrString.SearchPlaceholder)) },
            leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
            trailingIcon = if (query.isNotEmpty()) {
                {
                    TextButton(
                        onClick = {
                            query = ""
                            viewModel.search("", mediaFilter, libraryId, debounce = false)
                        },
                    ) {
                        Text(playarrString(PlayarrString.SearchClear))
                    }
                }
            } else {
                null
            },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { submitSearch(debounce = false) }),
            shape = RoundedCornerShape(18.dp),
        )
        OutlinedButton(
            onClick = { filtersOpen = !filtersOpen },
            modifier = Modifier.padding(top = 10.dp),
            shape = RoundedCornerShape(14.dp),
        ) {
            Icon(Icons.Outlined.FilterList, contentDescription = null, modifier = Modifier.size(18.dp))
            Column(modifier = Modifier.padding(start = 7.dp)) {
                Text(playarrString(PlayarrString.SearchFilters))
                Text(
                    playarrString(mediaFilter.label) + playarrString(
                        PlayarrString.SearchLibraryFilter,
                        "library" to (activeLibrary?.name ?: playarrString(PlayarrString.SearchAllLibraries)),
                    ),
                    fontSize = 10.sp,
                )
            }
        }
        if (filtersOpen) {
            Text(playarrString(PlayarrString.SearchType), color = WebInkMuted, fontSize = 10.sp, modifier = Modifier.padding(top = 10.dp))
            LazyRow(
                modifier = Modifier.fillMaxWidth().padding(top = 5.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                items(visibleMediaTypes, key = PlayarrSearchMediaType::value) { type ->
                    OutlinedButton(
                        onClick = {
                            mediaFilter = type
                            if (type == PlayarrSearchMediaType.Playlist) libraryId = null
                            submitSearch(debounce = false)
                        },
                        enabled = mediaFilter != type,
                        modifier = Modifier.height(36.dp),
                        contentPadding = PaddingValues(horizontal = 12.dp),
                    ) { Text(playarrString(type.label), fontSize = 10.sp) }
                }
            }
            Text(playarrString(PlayarrString.SearchLibrary), color = WebInkMuted, fontSize = 10.sp, modifier = Modifier.padding(top = 8.dp))
            LazyRow(
                modifier = Modifier.fillMaxWidth().padding(top = 5.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                item {
                    OutlinedButton(
                        onClick = {
                            libraryId = null
                            submitSearch(debounce = false)
                        },
                        enabled = libraryId != null,
                        modifier = Modifier.height(36.dp),
                        contentPadding = PaddingValues(horizontal = 12.dp),
                    ) { Text(playarrString(PlayarrString.SearchAll), fontSize = 10.sp) }
                }
                items(views, key = ViewSummary::id) { view ->
                    OutlinedButton(
                        onClick = {
                            libraryId = view.id
                            if (mediaFilter == PlayarrSearchMediaType.Playlist) {
                                mediaFilter = PlayarrSearchMediaType.All
                            }
                            submitSearch(debounce = false)
                        },
                        enabled = libraryId != view.id,
                        modifier = Modifier.height(36.dp),
                        contentPadding = PaddingValues(horizontal = 12.dp),
                    ) { Text(view.name, fontSize = 10.sp) }
                }
            }
        }
        if (selectedWork != null || selectedPlaylist != null) {
            ExperienceSearchPreview(
                work = selectedWork,
                playlist = selectedPlaylist,
                isTelevision = isTelevision,
                modifier = Modifier.fillMaxWidth(if (isTelevision) 0.72f else 1f).padding(top = 14.dp),
            )
        }
        when (val current = state) {
            ExperienceLoad.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = WebPink) }
            is ExperienceLoad.Failed -> ExperienceFailure(current.message) { submitSearch(debounce = false) }
            is ExperienceLoad.Ready -> if (query.isBlank()) {
                ExperienceEmpty(
                    playarrString(PlayarrString.SearchIdleTitle),
                    playarrString(PlayarrString.SearchEmptyPrompt),
                )
            } else if (current.value.works.isEmpty() && current.value.playlists.isEmpty()) {
                ExperienceEmpty(
                    playarrString(PlayarrString.SearchNoResultsTitle),
                    playarrString(PlayarrString.SearchNoResultsDescription),
                )
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(if (isTelevision) 210.dp else 164.dp),
                    modifier = Modifier.fillMaxSize().padding(top = 22.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                    verticalArrangement = Arrangement.spacedBy(22.dp),
                    contentPadding = PaddingValues(bottom = 104.dp),
                ) {
                    items(current.value.works, key = { "work:${it.id}" }) { work ->
                        ExperienceLandscapeCard(
                            work, serverUrl, accessToken,
                            width = if (isTelevision) 210.dp else 164.dp,
                            selected = selectedResultKey == "work:${work.id}",
                            progress = progressByWork[work.id],
                            onSelected = { selectedResultKey = "work:${work.id}" },
                            onClick = { navController.navigate("experience-detail/${work.id}") },
                            onContext = { contextWork = work },
                        )
                    }
                    items(current.value.playlists, key = { "playlist:${it.id}" }) { playlist ->
                        PlaylistCard(
                            playlist = playlist,
                            onClick = { navController.navigate("playlists/${playlist.id}") },
                            selected = selectedResultKey == "playlist:${playlist.id}",
                            onSelected = { selectedResultKey = "playlist:${playlist.id}" },
                        )
                    }
                }
            }
        }
    }
    contextWork?.let { work ->
        MediaContextDialog(
            work = work,
            onDismiss = { contextWork = null },
            onOpen = { contextWork = null; navController.navigate("experience-detail/${work.id}") },
            onMark = { watched -> viewModel.markWork(work, watched); contextWork = null },
            canDownload = canDownload,
        )
    }
}

@Composable
private fun ExperienceSearchPreview(
    work: Work?,
    playlist: Playlist?,
    isTelevision: Boolean,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        color = WebSurfaceStrong.copy(alpha = 0.74f),
        shape = RoundedCornerShape(18.dp),
    ) {
        Column(Modifier.padding(horizontal = 18.dp, vertical = 14.dp)) {
            if (work != null) {
                val language = LocalPlayarrLanguage.current
                Text(
                    work.kind.playarrSingularLabel().uppercase(language.locale),
                    color = WebPink,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    work.title,
                    color = WebInk,
                    fontSize = if (isTelevision) 24.sp else 18.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                val year = work.releaseDate?.atZone(java.time.ZoneOffset.UTC)?.year?.toString()
                val metadata = listOfNotNull(year, work.genres.take(2).joinToString(" · ").takeIf(String::isNotBlank))
                if (metadata.isNotEmpty()) {
                    Text(metadata.joinToString(" · "), color = WebInkMuted, fontSize = 10.sp, maxLines = 1)
                }
                Text(
                    work.overview?.takeIf(String::isNotBlank) ?: playarrString(PlayarrString.SearchNoSynopsis),
                    color = WebInkSoft,
                    fontSize = 11.sp,
                    maxLines = if (isTelevision) 2 else 3,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 5.dp),
                )
            } else if (playlist != null) {
                val language = LocalPlayarrLanguage.current
                Text(
                    playarrString(
                        if (playlist.isSystem) PlayarrString.SearchSystemPlaylist else PlayarrString.SearchPlaylist,
                    ).uppercase(language.locale),
                    color = WebPink,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    playlist.name,
                    color = WebInk,
                    fontSize = if (isTelevision) 24.sp else 18.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@HiltViewModel
internal class MediaContextDownloadViewModel @Inject constructor(
    private val getWorkDetails: GetWorkDetailsUseCase,
) : ViewModel() {
    /**
     * Resolves the full [WorkDetail] for [work] on demand -- a bare [Work]
     * (all this dialog otherwise has) doesn't carry any `mediaFileId`, so a
     * movie needs this resolved just as much as a series/artist/author
     * container does to fan out to every child leaf.
     */
    fun resolveDownloadCandidates(
        work: Work,
        language: PlayarrLanguageState,
        onResolved: (List<DownloadCandidate>) -> Unit,
    ) {
        viewModelScope.launch {
            val candidates = when (val result = getWorkDetails(work.id)) {
                is StreamarrResult.Success -> result.value.toDownloadCandidates(language)
                is StreamarrResult.Failure -> emptyList()
            }
            onResolved(candidates)
        }
    }
}

@Composable
private fun MediaContextDialog(
    work: Work,
    onDismiss: () -> Unit,
    onOpen: () -> Unit,
    onMark: (Boolean) -> Unit,
    canDownload: Boolean,
    viewModel: MediaContextDownloadViewModel = hiltViewModel(),
) {
    val language = LocalPlayarrLanguage.current
    var addToPlaylist by remember(work.id) { mutableStateOf(false) }
    var resolvingDownload by remember(work.id) { mutableStateOf(false) }
    var downloadCandidates by remember(work.id) { mutableStateOf<List<DownloadCandidate>?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(work.title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onOpen, modifier = Modifier.fillMaxWidth()) {
                    Text(playarrString(PlayarrString.ContextOpen))
                }
                OutlinedButton(onClick = { addToPlaylist = true }, modifier = Modifier.fillMaxWidth()) {
                    Text(playarrString(PlayarrString.ContextAddToPlaylist))
                }
                if (canDownload) {
                    OutlinedButton(
                        onClick = {
                            resolvingDownload = true
                            viewModel.resolveDownloadCandidates(work, language) { candidates ->
                                resolvingDownload = false
                                downloadCandidates = candidates
                            }
                        },
                        enabled = !resolvingDownload,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            playarrString(
                                if (resolvingDownload) PlayarrString.ContextResolving else PlayarrString.ContextDownload,
                            ),
                        )
                    }
                }
                OutlinedButton(onClick = { onMark(true) }, modifier = Modifier.fillMaxWidth()) {
                    Text(playarrString(PlayarrString.ContextMarkWatched))
                }
                OutlinedButton(onClick = { onMark(false) }, modifier = Modifier.fillMaxWidth()) {
                    Text(playarrString(PlayarrString.ContextMarkUnwatched))
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(playarrString(PlayarrString.CommonClose)) } },
    )
    if (addToPlaylist) {
        AddToPlaylistDialog(
            workId = work.id,
            trackId = null,
            mediaType = if (work.kind == WorkKind.Artist) io.streamarr.shared.data.model.PlaylistMediaType.Audio else io.streamarr.shared.data.model.PlaylistMediaType.Video,
            onDismiss = { addToPlaylist = false; onDismiss() },
        )
    }
    downloadCandidates?.let { candidates ->
        DownloadOptionsSheet(candidates = candidates, onDismiss = { downloadCandidates = null; onDismiss() })
    }
}

/** Every playable leaf under [WorkDetail.children], mapped to what [DownloadRepository.enqueue] needs -- shared by [MediaContextDialog]'s fan-out and `DetailChildren`'s per-row/"download all" actions. */
private fun WorkDetail.toDownloadCandidates(language: PlayarrLanguageState): List<DownloadCandidate> {
    val posterUrl = work.images.firstOrNull { it.kind == ImageKind.Poster }?.url
    return when (val tree = children) {
        WorkChildren.Movie -> listOfNotNull(
            mediaFileId?.let { DownloadCandidate(it, work.id, work.title, work.title, posterUrl, "movie") },
        )
        is WorkChildren.Series -> tree.seasons.flatMap { it.episodes }.mapNotNull { episode ->
            episode.mediaFileId?.let {
                DownloadCandidate(
                    it,
                    work.id,
                    episode.episode.title ?: language.text(
                        PlayarrString.DetailEpisodeNumber,
                        mapOf("number" to episode.episode.episodeNumber),
                    ),
                    work.title,
                    posterUrl,
                    "episode",
                )
            }
        }
        is WorkChildren.Artist -> tree.albums.flatMap { it.tracks }.mapNotNull { track ->
            track.mediaFileId?.let { DownloadCandidate(it, work.id, track.track.title, work.title, posterUrl, "track") }
        }
        is WorkChildren.Author -> tree.books.mapNotNull { book ->
            book.mediaFileId?.let { DownloadCandidate(it, work.id, book.book.title, work.title, posterUrl, "book") }
        }
    }
}

private fun WorkDetail.mediaFileIds(): List<String> = when (val tree = children) {
    WorkChildren.Movie -> listOfNotNull(mediaFileId)
    is WorkChildren.Series -> tree.seasons.flatMap { it.episodes }.mapNotNull { it.mediaFileId }
    is WorkChildren.Artist -> tree.albums.flatMap { it.tracks }.mapNotNull { it.mediaFileId }
    is WorkChildren.Author -> tree.books.mapNotNull { it.mediaFileId }
}

internal sealed interface ExperienceDetailMessage {
    data object PlaybackSettingsSaved : ExperienceDetailMessage
    data class Failure(val message: PlayarrMessage) : ExperienceDetailMessage
}

@HiltViewModel
internal class ExperienceDetailViewModel @Inject constructor(
    private val getWorkDetails: GetWorkDetailsUseCase,
    private val api: StreamarrApi,
    private val workSourceSelector: PlayarrWorkSourceSelector,
) : ViewModel() {
    private val _state = MutableStateFlow<ExperienceLoad<ExperienceDetailSnapshot>>(ExperienceLoad.Loading)
    val state = _state.asStateFlow()
    private val _message = MutableStateFlow<ExperienceDetailMessage?>(null)
    val message = _message.asStateFlow()
    private val _sourceChoices = MutableStateFlow<ExperienceLoad<List<PlayarrWorkSourceChoice>>>(ExperienceLoad.Loading)
    val sourceChoices = _sourceChoices.asStateFlow()
    private val _sourceSelection = MutableStateFlow<PlayarrSourceSelection>(PlayarrSourceSelection.Idle)
    val sourceSelection = _sourceSelection.asStateFlow()
    private var loadJob: Job? = null

    fun load(id: String) {
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            _state.value = ExperienceLoad.Loading
            _sourceChoices.value = ExperienceLoad.Loading
            _sourceSelection.value = PlayarrSourceSelection.Idle
            when (val result = getWorkDetails(id)) {
                is StreamarrResult.Success -> {
                    val detail = result.value
                    val videoDetail = detail.children == WorkChildren.Movie || detail.children is WorkChildren.Series
                    _state.value = ExperienceLoad.Ready(ExperienceDetailSnapshot(detail, emptyMap()))
                    launch {
                        _sourceChoices.value = runCatching { workSourceSelector.choices(detail.work.id) }
                            .fold(
                                { ExperienceLoad.Ready(it) },
                                {
                                    ExperienceLoad.Failed(
                                        it.message?.takeIf(String::isNotBlank)?.let(PlayarrMessage::Dynamic)
                                            ?: PlayarrMessage.Localized(
                                                PlayarrString.ErrorCouldNotLoad,
                                                mapOf("subject" to PlayarrString.ErrorSubjectAvailableServers),
                                            ),
                                    )
                                },
                            )
                    }
                    launch {
                        val progress = runCatching { api.listWatchProgress() }.getOrDefault(emptyList())
                        updateSnapshot(detail.work.id) {
                            copy(progressByMedia = progress.associateBy(WatchProgress::mediaFileId))
                        }
                    }
                    if (!videoDetail) return@launch
                    launch {
                        val credits = runCatching { api.getWorkCredits(detail.work.id) }
                            .getOrDefault(WorkCreditsResponse())
                        updateSnapshot(detail.work.id) { copy(credits = credits) }
                    }
                    launch {
                        val similar = loadPlayarrSimilarWorks(detail.work)
                        updateSnapshot(detail.work.id) { copy(similarWorks = similar) }
                    }
                    val movieMediaFileId = detail.mediaFileId.takeIf { detail.children == WorkChildren.Movie }
                    if (movieMediaFileId == null) return@launch
                    launch {
                        val chapters = runCatching { api.getMediaChapters(movieMediaFileId) }.getOrDefault(emptyList())
                        updateSnapshot(detail.work.id) { copy(movieChapters = chapters) }
                    }
                    launch {
                        val metadata = runCatching { api.getMediaMetadata(movieMediaFileId) }.getOrNull()
                        updateSnapshot(detail.work.id) { copy(movieMetadata = metadata) }
                    }
                    launch {
                        val options = runCatching { api.getMediaPlaybackOptions(movieMediaFileId) }.getOrNull()
                        updateSnapshot(detail.work.id) { copy(moviePlaybackOptions = options) }
                    }
                }
                is StreamarrResult.Failure -> {
                    _state.value = ExperienceLoad.Failed(
                        result.error.userMessageForExperience(PlayarrString.ErrorSubjectTitle),
                    )
                }
            }
        }
    }

    private fun updateSnapshot(workId: String, transform: ExperienceDetailSnapshot.() -> ExperienceDetailSnapshot) {
        val current = (_state.value as? ExperienceLoad.Ready)?.value ?: return
        if (current.detail.work.id != workId) return
        _state.value = ExperienceLoad.Ready(current.transform())
    }

    private suspend fun loadPlayarrSimilarWorks(work: Work): List<Work> {
        val semantic = runCatching { api.getSimilarWorks(work.id, 20) }.getOrNull()
        if (!semantic.isNullOrEmpty()) return semantic.filterNot { it.id == work.id }
        val pages = if (work.genres.isNotEmpty()) {
            work.genres.take(3).map { genre ->
                runCatching {
                    api.browseCatalog(genre = genre, availableOnly = true, limit = 100)
                }.getOrNull()
            }
        } else {
            listOf(
                runCatching {
                    api.browseCatalog(kind = work.kind.wireName(), availableOnly = true, sort = "recent", limit = 100)
                }.getOrNull(),
            )
        }
        return pages.flatMap { it?.items.orEmpty() }
            .distinctBy(Work::id)
            .filterNot { it.id == work.id }
            .sortedByDescending { playarrRelatedWorkScore(work, it) }
            .take(20)
    }

    fun saveMoviePlaybackOptions(mediaFileId: String, request: UpdateMediaPlaybackPreferencesRequest) {
        viewModelScope.launch {
            val result = runCatching { api.updateMediaPlaybackOptions(mediaFileId, request) }
            result.onSuccess { options ->
                val current = (_state.value as? ExperienceLoad.Ready)?.value ?: return@onSuccess
                _state.value = ExperienceLoad.Ready(current.copy(moviePlaybackOptions = options))
                _message.value = ExperienceDetailMessage.PlaybackSettingsSaved
            }.onFailure {
                _message.value = ExperienceDetailMessage.Failure(
                    it.message?.takeIf(String::isNotBlank)?.let(PlayarrMessage::Dynamic)
                        ?: PlayarrMessage.Localized(PlayarrString.ErrorCouldNotSavePlaybackPreferences),
                )
            }
        }
    }

    fun clearMessage() {
        _message.value = null
    }

    fun selectSource(
        originalDetail: WorkDetail,
        requestedMediaFileId: String,
        choice: PlayarrWorkSourceChoice,
        onSelected: (PlayarrResolvedSourcePlayback) -> Unit,
    ) {
        if (_sourceSelection.value is PlayarrSourceSelection.Selecting) return
        viewModelScope.launch {
            _sourceSelection.value = PlayarrSourceSelection.Selecting(choice.serverUrl)
            runCatching {
                val sourceDetail = workSourceSelector.select(originalDetail.work.id, choice.serverUrl)
                resolvePlayarrSourcePlayback(originalDetail, sourceDetail, requestedMediaFileId)
                    ?: throw PlayarrMessageException(
                        PlayarrMessage.Localized(PlayarrString.ErrorSourceSelectedUnavailable),
                    )
            }.onSuccess {
                _sourceSelection.value = PlayarrSourceSelection.Idle
                onSelected(it)
            }.onFailure {
                _sourceSelection.value = PlayarrSourceSelection.Failed(
                    (it as? PlayarrMessageException)?.playarrMessage
                        ?: it.message?.takeIf(String::isNotBlank)?.let(PlayarrMessage::Dynamic)
                        ?: PlayarrMessage.Localized(PlayarrString.ErrorSourceUseFailed),
                )
            }
        }
    }

    fun clearSourceSelection() {
        _sourceSelection.value = PlayarrSourceSelection.Idle
    }
}

internal fun playarrRelatedWorkScore(target: Work, candidate: Work): Double {
    val targetGenres = target.genres.map { it.trim().lowercase() }.toSet()
    val sharedGenres = candidate.genres.count { it.trim().lowercase() in targetGenres }
    val sameKind = if (target.kind == candidate.kind) 1 else 0
    val targetYear = target.releaseDate?.atZone(java.time.ZoneOffset.UTC)?.year
    val candidateYear = candidate.releaseDate?.atZone(java.time.ZoneOffset.UTC)?.year
    val yearProximity = if (targetYear != null && candidateYear != null) {
        maxOf(0.0, 5.0 - kotlin.math.abs(targetYear - candidateYear) / 5.0)
    } else {
        0.0
    }
    return sharedGenres * 100.0 + sameKind * 10.0 + yearProximity
}

internal data class ExperienceDetailSnapshot(
    val detail: WorkDetail,
    val progressByMedia: Map<String, WatchProgress>,
    val credits: WorkCreditsResponse = WorkCreditsResponse(),
    val similarWorks: List<Work> = emptyList(),
    val movieChapters: List<MediaChapter> = emptyList(),
    val movieMetadata: MediaMetadata? = null,
    val moviePlaybackOptions: MediaPlaybackOptionsResponse? = null,
)

internal sealed interface PlayarrSourceSelection {
    data object Idle : PlayarrSourceSelection
    data class Selecting(val serverUrl: String) : PlayarrSourceSelection
    data class Failed(val message: PlayarrMessage) : PlayarrSourceSelection
}

private data class PendingSourcePlayback(
    val mediaFileId: String,
    val title: String,
    val queueItems: List<PlayarrPlaybackQueueItem>,
    val startPositionMs: Long?,
    val launchSettings: PlayarrPlaybackLaunchSettings?,
)

@Composable
private fun ExperienceDetailScreen(
    workId: String,
    initialMediaFileId: String?,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    canDownload: Boolean,
    onBack: () -> Unit,
    onOpenWork: (String) -> Unit,
    onPlay: (String, List<PlayarrPlaybackQueueItem>, Long?, PlayarrPlaybackLaunchSettings?) -> Unit,
    viewModel: ExperienceDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val message by viewModel.message.collectAsState()
    val sourceChoices by viewModel.sourceChoices.collectAsState()
    val sourceSelection by viewModel.sourceSelection.collectAsState()
    var pendingSourcePlayback by remember(workId) { mutableStateOf<PendingSourcePlayback?>(null) }
    LaunchedEffect(workId) { viewModel.load(workId) }
    when (val current = state) {
        ExperienceLoad.Loading -> ExperienceLoading(playarrString(PlayarrString.DetailLoadingDetails))
        is ExperienceLoad.Failed -> ExperienceFailure(current.message) { viewModel.load(workId) }
        is ExperienceLoad.Ready -> {
            val detail = current.value.detail
            val progressByMedia = current.value.progressByMedia
            val orderedItems = remember(detail) { detail.playarrPlaybackQueueItems() }
            val playInContext: (String, Long?, PlayarrPlaybackLaunchSettings?) -> Unit =
                { mediaFileId, startPositionMs, launchSettings ->
                    val pending = PendingSourcePlayback(
                        mediaFileId,
                        orderedItems.firstOrNull { it.mediaFileId == mediaFileId }?.title ?: detail.work.title,
                        orderedItems,
                        startPositionMs,
                        launchSettings,
                    )
                    val choices = (sourceChoices as? ExperienceLoad.Ready)?.value
                    if (choices != null && choices.size <= 1) {
                        onPlay(mediaFileId, orderedItems, startPositionMs, launchSettings)
                    } else {
                        pendingSourcePlayback = pending
                    }
            }
            var pendingPlaylistTrackId by remember(detail.work.id) { mutableStateOf<String?>(null) }
            var addWorkToPlaylist by remember(detail.work.id) { mutableStateOf(false) }
            var pendingDownloadCandidates by remember(detail.work.id) { mutableStateOf<List<DownloadCandidate>?>(null) }
            Box(Modifier.fillMaxSize().background(WebSurface)) {
                val artistChildren = detail.children as? WorkChildren.Artist
                if (artistChildren != null) {
                    ExperienceMusicDetailContent(
                        detail = detail,
                        children = artistChildren,
                        initialMediaFileId = initialMediaFileId,
                        serverUrl = serverUrl,
                        accessToken = accessToken,
                        isTelevision = isTelevision,
                        canDownload = canDownload,
                        onBack = onBack,
                        onPlay = { mediaFileId, albumId ->
                            val albumItems = playarrAlbumPlaybackQueueItems(orderedItems, albumId)
                            val choices = (sourceChoices as? ExperienceLoad.Ready)?.value
                            if (choices != null && choices.size <= 1) {
                                onPlay(mediaFileId, albumItems, null, null)
                            } else {
                                pendingSourcePlayback = PendingSourcePlayback(
                                    mediaFileId,
                                    albumItems.firstOrNull { it.mediaFileId == mediaFileId }?.title ?: detail.work.title,
                                    albumItems,
                                    null,
                                    null,
                                )
                            }
                        },
                        onAddToPlaylist = { trackId ->
                            pendingPlaylistTrackId = trackId
                            addWorkToPlaylist = true
                        },
                        onDownload = { candidates -> pendingDownloadCandidates = candidates },
                    )
                } else if (detail.children == WorkChildren.Movie || detail.children is WorkChildren.Series) {
                    ExperienceVideoDetailContent(
                        detail = detail,
                        progressByMedia = progressByMedia,
                        credits = current.value.credits,
                        similarWorks = current.value.similarWorks,
                        movieChapters = current.value.movieChapters,
                        movieMetadata = current.value.movieMetadata,
                        moviePlaybackOptions = current.value.moviePlaybackOptions,
                        initialMediaFileId = initialMediaFileId,
                        serverUrl = serverUrl,
                        accessToken = accessToken,
                        isTelevision = isTelevision,
                        canDownload = canDownload,
                        onBack = onBack,
                        onOpenWork = onOpenWork,
                        onPlay = playInContext,
                        onSavePlaybackOptions = viewModel::saveMoviePlaybackOptions,
                        onAddToPlaylist = { leafId ->
                            pendingPlaylistTrackId = leafId
                            addWorkToPlaylist = true
                        },
                        onDownload = { candidates -> pendingDownloadCandidates = candidates },
                    )
                } else {
                    AuthenticatedArtwork(
                        work = detail.work,
                        kinds = listOf(ImageKind.Backdrop, ImageKind.Poster),
                        serverUrl = serverUrl,
                        accessToken = accessToken,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize().then(if (isTelevision) Modifier.fillMaxWidth(0.55f) else Modifier.fillMaxHeight(0.48f)),
                    )
                    Box(Modifier.fillMaxSize().background(if (isTelevision) Brush.horizontalGradient(listOf(WebSurface.copy(alpha = 0.2f), WebSurface)) else Brush.verticalGradient(listOf(Color.Transparent, WebSurface), endY = 960f)))
                    IconButton(
                        onClick = onBack,
                        modifier = Modifier
                            .windowInsetsPadding(WindowInsets.safeDrawing)
                            .padding(start = if (isTelevision) 104.dp else 16.dp, top = 16.dp)
                            .background(WebSurfaceStrong.copy(alpha = 0.8f), CircleShape),
                    ) {
                        Icon(
                            Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = playarrString(PlayarrString.CommonBack),
                            tint = WebInk,
                        )
                    }
                    if (isTelevision) {
                        Box(Modifier.fillMaxWidth(0.38f).fillMaxHeight().padding(start = 154.dp, top = 259.dp, end = 24.dp), contentAlignment = Alignment.TopStart) { FeatureCopy(detail.work, true) }
                        Surface(
                            modifier = Modifier.fillMaxWidth(0.55f).fillMaxHeight(0.62f).align(Alignment.CenterEnd).padding(end = 52.dp),
                            color = WebSurfaceStrong.copy(alpha = 0.88f),
                            shape = RoundedCornerShape(2.dp),
                        ) {
                            DetailChildren(
                                detail, { mediaFileId -> playInContext(mediaFileId, null, null) },
                                { trackId -> pendingPlaylistTrackId = trackId; addWorkToPlaylist = true },
                                { candidates -> pendingDownloadCandidates = candidates },
                                canDownload,
                                PaddingValues(30.dp), scrollable = true,
                            )
                        }
                    } else {
                        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 250.dp, bottom = 108.dp)) {
                            item { FeatureCopy(detail.work) }
                            item { Spacer(Modifier.height(22.dp)) }
                            item {
                                DetailChildren(
                                    detail, { mediaFileId -> playInContext(mediaFileId, null, null) },
                                    { trackId -> pendingPlaylistTrackId = trackId; addWorkToPlaylist = true },
                                    { candidates -> pendingDownloadCandidates = candidates },
                                    canDownload,
                                    PaddingValues(0.dp), scrollable = false,
                                )
                            }
                        }
                    }
                }
                message?.let { currentMessage ->
                    val success = currentMessage == ExperienceDetailMessage.PlaybackSettingsSaved
                    val text = when (currentMessage) {
                        ExperienceDetailMessage.PlaybackSettingsSaved -> playarrString(PlayarrString.DetailPlaybackSaved)
                        is ExperienceDetailMessage.Failure -> playarrText(currentMessage.message)
                    }
                    Surface(
                        onClick = viewModel::clearMessage,
                        color = WebSurfaceStrong,
                        contentColor = if (success) WebPink else MaterialTheme.colorScheme.error,
                        shape = RoundedCornerShape(12.dp),
                        shadowElevation = 16.dp,
                        modifier = Modifier.align(Alignment.TopCenter).windowInsetsPadding(WindowInsets.safeDrawing).padding(top = 18.dp),
                    ) {
                        Text(text, modifier = Modifier.padding(horizontal = 18.dp, vertical = 12.dp), fontWeight = FontWeight.SemiBold)
                    }
                }
            }
            if (addWorkToPlaylist) {
                AddToPlaylistDialog(
                    workId = detail.work.id,
                    trackId = pendingPlaylistTrackId,
                    mediaType = if (detail.work.kind == WorkKind.Artist) io.streamarr.shared.data.model.PlaylistMediaType.Audio else io.streamarr.shared.data.model.PlaylistMediaType.Video,
                    onDismiss = { addWorkToPlaylist = false },
                )
            }
            pendingDownloadCandidates?.let { candidates ->
                DownloadOptionsSheet(candidates = candidates, onDismiss = { pendingDownloadCandidates = null })
            }
            pendingSourcePlayback?.let { pending ->
                LaunchedEffect(sourceChoices, pending) {
                    val choices = (sourceChoices as? ExperienceLoad.Ready)?.value ?: return@LaunchedEffect
                    if (choices.size <= 1) {
                        pendingSourcePlayback = null
                        onPlay(
                            pending.mediaFileId,
                            pending.queueItems,
                            pending.startPositionMs,
                            pending.launchSettings,
                        )
                    }
                }
                PlayarrServerChoiceDialog(
                    title = pending.title,
                    choices = sourceChoices,
                    selection = sourceSelection,
                    onCancel = {
                        pendingSourcePlayback = null
                        viewModel.clearSourceSelection()
                    },
                    onRetry = { viewModel.load(detail.work.id) },
                    onSelect = { choice ->
                        viewModel.selectSource(detail, pending.mediaFileId, choice) { resolved ->
                            pendingSourcePlayback = null
                            onPlay(
                                resolved.mediaFileId,
                                resolved.queueItems,
                                pending.startPositionMs,
                                pending.launchSettings.takeIf { choice.defaultSource },
                            )
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun PlayarrServerChoiceDialog(
    title: String,
    choices: ExperienceLoad<List<PlayarrWorkSourceChoice>>,
    selection: PlayarrSourceSelection,
    onCancel: () -> Unit,
    onRetry: () -> Unit,
    onSelect: (PlayarrWorkSourceChoice) -> Unit,
) {
    val firstChoiceFocus = remember { FocusRequester() }
    val rows = (choices as? ExperienceLoad.Ready)?.value.orEmpty()
    LaunchedEffect(rows) {
        if (rows.isNotEmpty()) runCatching { firstChoiceFocus.requestFocus() }
    }
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text(playarrString(PlayarrString.ServerChoiceWhere, "title" to title)) },
        text = {
            Column(
                Modifier.fillMaxWidth().height(360.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                when (choices) {
                    ExperienceLoad.Loading -> {
                        CircularProgressIndicator(color = WebPink)
                        Text(playarrString(PlayarrString.ServerChoiceLoading), color = WebInkMuted)
                    }
                    is ExperienceLoad.Failed -> {
                        Text(playarrText(choices.message), color = MaterialTheme.colorScheme.error)
                        OutlinedButton(onClick = onRetry) { Text(playarrString(PlayarrString.CommonTryAgain)) }
                    }
                    is ExperienceLoad.Ready -> {
                        Text(
                            playarrString(PlayarrString.ServerChoiceAvailable, "count" to choices.value.size),
                            color = WebPink,
                            fontSize = 11.sp,
                        )
                        Text(playarrString(PlayarrString.ServerChoiceChoose), color = WebInkMuted)
                        choices.value.forEachIndexed { index, choice ->
                            OutlinedButton(
                                onClick = { onSelect(choice) },
                                enabled = selection !is PlayarrSourceSelection.Selecting,
                                modifier = Modifier.fillMaxWidth().then(
                                    if (index == 0) Modifier.focusRequester(firstChoiceFocus) else Modifier,
                                ),
                            ) {
                                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.Start) {
                                    Text(choice.label, fontWeight = FontWeight.SemiBold)
                                    Text(
                                        if ((selection as? PlayarrSourceSelection.Selecting)?.serverUrl == choice.serverUrl) {
                                            playarrString(PlayarrString.ServerChoiceConnecting)
                                        } else {
                                            choice.serverUrl
                                        },
                                        color = WebInkMuted,
                                        fontSize = 10.sp,
                                    )
                                }
                            }
                        }
                    }
                }
                if (selection is PlayarrSourceSelection.Failed) {
                    Text(playarrText(selection.message), color = MaterialTheme.colorScheme.error)
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onCancel) { Text(playarrString(PlayarrString.CommonCancel)) } },
    )
}

@Composable
private fun ExperienceVideoDetailContent(
    detail: WorkDetail,
    progressByMedia: Map<String, WatchProgress>,
    credits: WorkCreditsResponse,
    similarWorks: List<Work>,
    movieChapters: List<MediaChapter>,
    movieMetadata: MediaMetadata?,
    moviePlaybackOptions: MediaPlaybackOptionsResponse?,
    initialMediaFileId: String?,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    canDownload: Boolean,
    onBack: () -> Unit,
    onOpenWork: (String) -> Unit,
    onPlay: (String, Long?, PlayarrPlaybackLaunchSettings?) -> Unit,
    onSavePlaybackOptions: (String, UpdateMediaPlaybackPreferencesRequest) -> Unit,
    onAddToPlaylist: (String?) -> Unit,
    onDownload: (List<DownloadCandidate>) -> Unit,
) {
    val series = detail.children as? WorkChildren.Series
    val playableSeasons = remember(detail) {
        series?.let(::playarrPlayableSeasons).orEmpty()
    }
    val initialEpisode = remember(detail.work.id, initialMediaFileId) {
        playableSeasons.firstNotNullOfOrNull { season ->
            season.episodes.firstOrNull { it.mediaFileId == initialMediaFileId }
                ?.let { season.season.seasonNumber to it }
        }
    }
    var selectedSeasonNumber by remember(detail.work.id, initialMediaFileId) {
        mutableStateOf(initialEpisode?.first ?: playableSeasons.firstOrNull()?.season?.seasonNumber)
    }
    val selectedSeason = playableSeasons.firstOrNull { it.season.seasonNumber == selectedSeasonNumber }
        ?: playableSeasons.firstOrNull()
    var selectedEpisodeId by remember(detail.work.id, initialMediaFileId) {
        mutableStateOf(
            initialEpisode?.second?.episode?.id
                ?: selectedSeason?.episodes?.firstOrNull { it.mediaFileId != null }?.episode?.id,
        )
    }
    val selectedEpisode = selectedSeason?.episodes
        ?.firstOrNull { it.episode.id == selectedEpisodeId && it.mediaFileId != null }
        ?: selectedSeason?.episodes?.firstOrNull { it.mediaFileId != null }
    val mediaFileId = detail.mediaFileId ?: selectedEpisode?.mediaFileId
    val activeProgress = mediaFileId?.let(progressByMedia::get)
    val posterUrl = detail.work.images.firstOrNull { it.kind == ImageKind.Poster }?.url
    val playerDefaults = LocalPlayarrDisplayPreferences.current.playerDefaults
    val movieLaunchSettings = moviePlaybackOptions?.let { resolvePlayarrPlaybackLaunchSettings(it, playerDefaults) }
    var playbackSettingsOpen by remember(mediaFileId) { mutableStateOf(false) }

    fun selectEpisode(episode: EpisodeDetail, seasonNumber: Int) {
        selectedSeasonNumber = seasonNumber
        selectedEpisodeId = episode.episode.id
    }

    Box(Modifier.fillMaxSize().background(WebSurface)) {
        AuthenticatedArtwork(
            work = detail.work,
            kinds = listOf(ImageKind.Backdrop, ImageKind.Poster),
            serverUrl = serverUrl,
            accessToken = accessToken,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .fillMaxSize()
                .then(if (isTelevision) Modifier.fillMaxWidth(0.55f) else Modifier.fillMaxHeight(0.48f)),
        )
        Box(
            Modifier.fillMaxSize().background(
                if (isTelevision) {
                    Brush.horizontalGradient(listOf(WebSurface.copy(alpha = 0.18f), WebSurface.copy(alpha = 0.78f), WebSurface))
                } else {
                    Brush.verticalGradient(listOf(Color.Transparent, WebSurface.copy(alpha = 0.76f), WebSurface), endY = 960f)
                },
            ),
        )
        IconButton(
            onClick = onBack,
            modifier = Modifier
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .padding(start = if (isTelevision) 104.dp else 16.dp, top = 16.dp)
                .background(WebSurfaceStrong.copy(alpha = 0.82f), CircleShape),
        ) {
            Icon(
                Icons.AutoMirrored.Outlined.ArrowBack,
                contentDescription = playarrString(PlayarrString.CommonBack),
                tint = WebInk,
            )
        }

        if (isTelevision) {
            Column(
                Modifier
                    .fillMaxWidth(0.39f)
                    .fillMaxHeight()
                    .padding(start = 154.dp, top = 224.dp, end = 28.dp, bottom = 64.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                VideoDetailCopy(
                    detail.work,
                    selectedSeason?.season?.seasonNumber,
                    selectedEpisode,
                    activeProgress,
                    movieMetadata?.durationMs,
                    true,
                )
                VideoDetailActions(
                    work = detail.work,
                    episode = selectedEpisode,
                    mediaFileId = mediaFileId,
                    progress = activeProgress,
                    canDownload = canDownload,
                    posterUrl = posterUrl,
                    onPlay = onPlay,
                    launchSettings = movieLaunchSettings,
                    onPlaybackSettings = moviePlaybackOptions?.let { { playbackSettingsOpen = true } },
                    onAddToPlaylist = onAddToPlaylist,
                    onDownload = onDownload,
                )
            }
            if (series != null) {
                SeriesEpisodeBrowser(
                    seasons = playableSeasons,
                    selectedEpisodeId = selectedEpisode?.episode?.id,
                    work = detail.work,
                    progressByMedia = progressByMedia,
                    serverUrl = serverUrl,
                    accessToken = accessToken,
                    isTelevision = true,
                    canDownload = canDownload,
                    onSelect = ::selectEpisode,
                    onPlay = { mediaFileId -> onPlay(mediaFileId, null, null) },
                    onDownload = onDownload,
                    credits = credits,
                    similarWorks = similarWorks,
                    onOpenWork = onOpenWork,
                    modifier = Modifier
                        .fillMaxWidth(0.57f)
                        .fillMaxHeight(0.72f)
                        .align(Alignment.CenterEnd)
                        .padding(end = 50.dp),
                )
            } else if (mediaFileId != null) {
                MovieDetailBrowser(
                    mediaFileId = mediaFileId,
                    chapters = playarrDisplayedMovieChapters(movieChapters, movieMetadata?.durationMs ?: 0L),
                    credits = credits,
                    similarWorks = similarWorks,
                    serverUrl = serverUrl,
                    accessToken = accessToken,
                    isTelevision = true,
                    launchSettings = movieLaunchSettings,
                    onPlay = onPlay,
                    onOpenWork = onOpenWork,
                    modifier = Modifier
                        .fillMaxWidth(0.57f)
                        .fillMaxHeight(0.72f)
                        .align(Alignment.CenterEnd)
                        .padding(end = 50.dp),
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 245.dp, bottom = 112.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                item {
                    VideoDetailCopy(
                        detail.work,
                        selectedSeason?.season?.seasonNumber,
                        selectedEpisode,
                        activeProgress,
                        movieMetadata?.durationMs,
                        false,
                    )
                }
                item {
                    VideoDetailActions(
                        work = detail.work,
                        episode = selectedEpisode,
                        mediaFileId = mediaFileId,
                        progress = activeProgress,
                        canDownload = canDownload,
                        posterUrl = posterUrl,
                        onPlay = onPlay,
                        launchSettings = movieLaunchSettings,
                        onPlaybackSettings = moviePlaybackOptions?.let { { playbackSettingsOpen = true } },
                        onAddToPlaylist = onAddToPlaylist,
                        onDownload = onDownload,
                    )
                }
                if (series != null) {
                    item {
                        SeriesEpisodeBrowser(
                            seasons = playableSeasons,
                            selectedEpisodeId = selectedEpisode?.episode?.id,
                            work = detail.work,
                            progressByMedia = progressByMedia,
                            serverUrl = serverUrl,
                            accessToken = accessToken,
                            isTelevision = false,
                            canDownload = canDownload,
                            onSelect = ::selectEpisode,
                            onPlay = { mediaFileId -> onPlay(mediaFileId, null, null) },
                            onDownload = onDownload,
                            credits = credits,
                            similarWorks = similarWorks,
                            onOpenWork = onOpenWork,
                        )
                    }
                } else if (mediaFileId != null) {
                    item {
                        MovieDetailBrowser(
                            mediaFileId = mediaFileId,
                            chapters = playarrDisplayedMovieChapters(movieChapters, movieMetadata?.durationMs ?: 0L),
                            credits = credits,
                            similarWorks = similarWorks,
                            serverUrl = serverUrl,
                            accessToken = accessToken,
                            isTelevision = false,
                            launchSettings = movieLaunchSettings,
                            onPlay = onPlay,
                            onOpenWork = onOpenWork,
                        )
                    }
                }
            }
        }
    }
    if (playbackSettingsOpen && mediaFileId != null && moviePlaybackOptions != null) {
        MoviePlaybackOptionsDialog(
            options = moviePlaybackOptions,
            onDismiss = { playbackSettingsOpen = false },
            onSave = { request ->
                onSavePlaybackOptions(mediaFileId, request)
                playbackSettingsOpen = false
            },
        )
    }
}

@Composable
private fun VideoDetailCopy(
    work: Work,
    seasonNumber: Int?,
    episode: EpisodeDetail?,
    progress: WatchProgress?,
    movieRuntimeMs: Long?,
    isTelevision: Boolean,
) {
    val language = LocalPlayarrLanguage.current
    val episodeNumber = episode?.episode?.episodeNumber
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            if (episodeNumber != null) {
                "S${seasonNumber.toString().padStart(2, '0')} · E${episodeNumber.toString().padStart(2, '0')}"
            } else {
                (work.genres.firstOrNull() ?: work.kind.playarrSingularLabel()).uppercase(language.locale)
            },
            color = WebPink,
            fontSize = 11.sp,
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = 1.2.sp,
        )
        Text(
            work.title,
            color = WebInk,
            fontSize = if (isTelevision) 48.sp else 38.sp,
            lineHeight = if (isTelevision) 46.sp else 38.sp,
            fontWeight = FontWeight.Medium,
            letterSpacing = (-1.5).sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        episode?.episode?.title?.let { title ->
            Text(title, color = WebInkSoft, fontSize = if (isTelevision) 20.sp else 18.sp, fontWeight = FontWeight.SemiBold)
        }
        Text(
            buildList {
                episode?.episode?.runtimeMinutes?.let {
                    add(playarrString(PlayarrString.DetailRuntimeMinutes, "minutes" to it))
                }
                if (episode == null && movieRuntimeMs != null && movieRuntimeMs > 0L) {
                    add(formatPlayarrVideoRuntime(movieRuntimeMs, language))
                }
                episode?.episode?.airDate?.let { add(it.toString()) }
                addAll(work.genres.take(3))
            }.joinToString(" · "),
            color = WebInkMuted,
            fontSize = 11.sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            episode?.episode?.overview?.takeIf(String::isNotBlank)
                ?: work.overview?.takeIf(String::isNotBlank)
                ?: playarrString(
                    if (episode == null) PlayarrString.DetailNoSynopsis else PlayarrString.DetailNoEpisodeSynopsis,
                ),
            color = WebInkMuted,
            fontSize = 13.sp,
            lineHeight = 20.sp,
            maxLines = if (isTelevision) 5 else 7,
            overflow = TextOverflow.Ellipsis,
        )
        if (progress?.state == WatchState.PartWatched && progress.durationMs > 0L) {
            Text(
                playarrString(
                    PlayarrString.DetailResumeFrom,
                    "position" to formatPlayarrPlayerTime(progress.positionMs),
                ),
                color = WebInkSoft,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

internal fun formatPlayarrVideoRuntime(runtimeMs: Long, language: PlayarrLanguageState): String {
    val totalMinutes = maxOf(
        1,
        kotlin.math.floor(runtimeMs.coerceAtLeast(0L) / 60_000.0 + 0.5).toInt(),
    )
    val hours = totalMinutes / 60
    val minutes = totalMinutes % 60
    val key = when {
        hours <= 0 -> PlayarrString.DetailRuntimeMinutes
        minutes == 0 -> PlayarrString.DetailRuntimeHours
        else -> PlayarrString.DetailRuntimeHoursMinutes
    }
    return language.text(key, mapOf("hours" to hours, "minutes" to minutes))
}

@Composable
private fun VideoDetailActions(
    work: Work,
    episode: EpisodeDetail?,
    mediaFileId: String?,
    progress: WatchProgress?,
    canDownload: Boolean,
    posterUrl: String?,
    launchSettings: PlayarrPlaybackLaunchSettings?,
    onPlaybackSettings: (() -> Unit)?,
    onPlay: (String, Long?, PlayarrPlaybackLaunchSettings?) -> Unit,
    onAddToPlaylist: (String?) -> Unit,
    onDownload: (List<DownloadCandidate>) -> Unit,
) {
    if (mediaFileId == null) {
        Text(playarrString(PlayarrString.DetailNoPlayableMedia), color = WebInkMuted)
        return
    }
    val title = episode?.episode?.title
        ?: episode?.let {
            playarrString(PlayarrString.DetailEpisodeNumber, "number" to it.episode.episodeNumber)
        }
        ?: work.title
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Button(onClick = { onPlay(mediaFileId, null, launchSettings) }) {
            Icon(Icons.Outlined.PlayArrow, contentDescription = null)
            Text(
                if (progress?.state == WatchState.PartWatched) {
                    playarrString(
                        PlayarrString.DetailResumeFrom,
                        "position" to formatPlayarrPlayerTime(progress.positionMs),
                    )
                } else {
                    playarrString(PlayarrString.DetailPlay)
                },
            )
        }
        OutlinedButton(onClick = { onAddToPlaylist(episode?.episode?.id) }) {
            Icon(Icons.Outlined.Add, contentDescription = null)
            Text(playarrString(PlayarrString.ContextAddToPlaylist))
        }
        onPlaybackSettings?.let { openSettings ->
            OutlinedButton(onClick = openSettings) { Text(playarrString(PlayarrString.DetailPlayback)) }
        }
        if (canDownload) {
            IconButton(
                onClick = {
                    onDownload(
                        listOf(
                            DownloadCandidate(
                                mediaFileId,
                                work.id,
                                title,
                                work.title,
                                posterUrl,
                                if (episode == null) "movie" else "episode",
                            ),
                        ),
                    )
                },
            ) {
                Icon(
                    Icons.Outlined.Download,
                    contentDescription = playarrString(PlayarrString.DetailDownloadTitle, "title" to title),
                    tint = WebInk,
                )
            }
        }
    }
}

@Composable
private fun MoviePlaybackOptionsDialog(
    options: MediaPlaybackOptionsResponse,
    onDismiss: () -> Unit,
    onSave: (UpdateMediaPlaybackPreferencesRequest) -> Unit,
) {
    var qualityId by remember(options) { mutableStateOf(options.preferences.qualityId) }
    var audioTrackId by remember(options) { mutableStateOf(options.preferences.audioTrackId) }
    var subtitleTrackId by remember(options) { mutableStateOf(options.preferences.subtitleTrackId) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(playarrString(PlayarrString.DetailPlaybackSettingsTitle)) },
        text = {
            Column(
                Modifier.fillMaxWidth().height(420.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                MoviePlaybackChoiceGroup(
                    title = playarrString(PlayarrString.DetailQuality),
                    choices = options.qualityOptions.map { it.id to it.label },
                    selected = qualityId,
                    onSelected = { qualityId = it },
                )
                MoviePlaybackChoiceGroup(
                    title = playarrString(PlayarrString.DetailAudio),
                    choices = listOf("" to playarrString(PlayarrString.DetailAutomatic)) + options.audioTracks.map { it.id to it.label },
                    selected = audioTrackId.orEmpty(),
                    onSelected = { audioTrackId = it.ifBlank { null } },
                )
                MoviePlaybackChoiceGroup(
                    title = playarrString(PlayarrString.DetailSubtitles),
                    choices = listOf("" to playarrString(PlayarrString.DetailSubtitlesOff)) + options.subtitleTracks.map { it.id to it.label },
                    selected = subtitleTrackId.orEmpty(),
                    onSelected = { subtitleTrackId = it.ifBlank { null } },
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    onSave(
                        UpdateMediaPlaybackPreferencesRequest(
                            qualityId = qualityId,
                            audioTrackId = audioTrackId,
                            subtitleTrackId = subtitleTrackId,
                        ),
                    )
                },
            ) { Text(playarrString(PlayarrString.DetailSave)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(playarrString(PlayarrString.CommonCancel)) } },
    )
}

@Composable
private fun MoviePlaybackChoiceGroup(
    title: String,
    choices: List<Pair<String, String>>,
    selected: String,
    onSelected: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, color = WebInk, fontWeight = FontWeight.SemiBold)
        choices.forEach { (id, label) ->
            OutlinedButton(
                onClick = { onSelected(id) },
                enabled = id != selected,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(label, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun SeriesEpisodeBrowser(
    seasons: List<SeasonDetail>,
    selectedEpisodeId: String?,
    work: Work,
    progressByMedia: Map<String, WatchProgress>,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    canDownload: Boolean,
    onSelect: (EpisodeDetail, Int) -> Unit,
    onPlay: (String) -> Unit,
    onDownload: (List<DownloadCandidate>) -> Unit,
    credits: WorkCreditsResponse,
    similarWorks: List<Work>,
    onOpenWork: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (seasons.isEmpty()) {
        ExperienceEmpty(playarrString(PlayarrString.DetailNoPlayableMedia))
        return
    }
    val posterUrl = work.images.firstOrNull { it.kind == ImageKind.Poster }?.url
    Column(
        modifier = modifier
            .background(WebSurfaceStrong.copy(alpha = 0.9f), RoundedCornerShape(16.dp))
            .padding(if (isTelevision) 22.dp else 14.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Text(
            playarrString(PlayarrString.DetailTitleSeasonsAndEpisodes, "title" to work.title),
            color = WebInk,
            fontSize = 20.sp,
            fontWeight = FontWeight.SemiBold,
        )
        val content: @Composable (SeasonDetail) -> Unit = { season ->
            val candidates = season.episodes.mapNotNull { episode ->
                episode.mediaFileId?.let { mediaId ->
                    DownloadCandidate(
                        mediaId,
                        work.id,
                        episode.episode.title ?: playarrString(
                            PlayarrString.DetailEpisodeNumber,
                            "number" to episode.episode.episodeNumber,
                        ),
                        work.title,
                        posterUrl,
                        "episode",
                    )
                }
            }
            SectionHeaderRow(
                season.season.title ?: playarrString(
                    PlayarrString.DetailSeasonNumber,
                    "number" to season.season.seasonNumber,
                ),
                if (canDownload) candidates else emptyList(),
                onDownload,
            )
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = PaddingValues(vertical = 6.dp),
            ) {
                items(season.episodes, key = { it.episode.id }) { episode ->
                    EpisodeDetailCard(
                        episode = episode,
                        seasonNumber = season.season.seasonNumber,
                        work = work,
                        progress = episode.mediaFileId?.let(progressByMedia::get),
                        serverUrl = serverUrl,
                        accessToken = accessToken,
                        selected = episode.episode.id == selectedEpisodeId,
                        isTelevision = isTelevision,
                        onSelect = { onSelect(episode, season.season.seasonNumber) },
                        onPlay = {
                            onSelect(episode, season.season.seasonNumber)
                            episode.mediaFileId?.let(onPlay)
                        },
                    )
                }
            }
        }
        if (isTelevision) {
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                items(seasons, key = { it.season.id }) { content(it) }
                if (credits.cast.isNotEmpty()) {
                    item { DetailCreditsRail(credits.cast) }
                }
                if (similarWorks.isNotEmpty()) {
                    item { SimilarWorksRail(similarWorks, serverUrl, accessToken, onOpenWork) }
                }
            }
        } else {
            for (season in seasons) content(season)
            if (credits.cast.isNotEmpty()) DetailCreditsRail(credits.cast)
            if (similarWorks.isNotEmpty()) SimilarWorksRail(similarWorks, serverUrl, accessToken, onOpenWork)
        }
    }
}

@Composable
private fun EpisodeDetailCard(
    episode: EpisodeDetail,
    seasonNumber: Int,
    work: Work,
    progress: WatchProgress?,
    serverUrl: String,
    accessToken: String?,
    selected: Boolean,
    isTelevision: Boolean,
    onSelect: () -> Unit,
    onPlay: () -> Unit,
) {
    var focused by remember(episode.episode.id) { mutableStateOf(false) }
    val available = episode.mediaFileId != null
    Column(Modifier.width(if (isTelevision) 220.dp else 184.dp)) {
        Surface(
            onClick = onPlay,
            enabled = available,
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f)
                .scale(if (focused) 1.04f else 1f)
                .onFocusChanged { state -> focused = state.isFocused; if (state.isFocused) onSelect() }
                .then(if (selected) Modifier.border(2.dp, WebPink, RoundedCornerShape(10.dp)) else Modifier),
            shape = RoundedCornerShape(10.dp),
            color = WebSurfaceSoft,
        ) {
            Box {
                AuthenticatedArtwork(
                    work = work,
                    kinds = listOf(ImageKind.Backdrop, ImageKind.Thumb, ImageKind.Poster),
                    serverUrl = serverUrl,
                    accessToken = accessToken,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.72f)))))
                Text(
                    "S${seasonNumber.toString().padStart(2, '0')} · E${episode.episode.episodeNumber.toString().padStart(2, '0')}",
                    color = Color.White,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.ExtraBold,
                    modifier = Modifier.align(Alignment.BottomStart).padding(10.dp),
                )
                progress?.takeIf { it.state != WatchState.Unseen }?.let {
                    Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(3.dp).background(Color.White.copy(alpha = 0.28f))) {
                        Box(Modifier.fillMaxWidth(it.fraction).fillMaxHeight().background(WebPink))
                    }
                }
            }
        }
        Text(
            episode.episode.title ?: playarrString(
                PlayarrString.DetailEpisodeNumber,
                "number" to episode.episode.episodeNumber,
            ),
            color = if (available) WebInk else WebInkMuted,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 8.dp),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            episode.episode.runtimeMinutes?.let {
                Text(
                    playarrString(PlayarrString.DetailRuntimeMinutes, "minutes" to it),
                    color = WebInkMuted,
                    fontSize = 10.sp,
                )
            }
            if (!available) Text(playarrString(PlayarrString.DetailUnavailable), color = WebInkMuted, fontSize = 10.sp)
        }
    }
}

@Composable
private fun MovieDetailBrowser(
    mediaFileId: String,
    chapters: List<MediaChapter>,
    credits: WorkCreditsResponse,
    similarWorks: List<Work>,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    launchSettings: PlayarrPlaybackLaunchSettings?,
    onPlay: (String, Long?, PlayarrPlaybackLaunchSettings?) -> Unit,
    onOpenWork: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (chapters.isEmpty() && credits.cast.isEmpty() && similarWorks.isEmpty()) return
    val container = modifier
        .background(WebSurfaceStrong.copy(alpha = 0.9f), RoundedCornerShape(16.dp))
        .then(if (isTelevision) Modifier.verticalScroll(rememberScrollState()) else Modifier)
        .padding(if (isTelevision) 22.dp else 14.dp)
    Column(container, verticalArrangement = Arrangement.spacedBy(22.dp)) {
        if (chapters.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(playarrString(PlayarrString.DetailChapters), color = WebInk, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(vertical = 4.dp)) {
                    items(chapters, key = MediaChapter::index) { chapter ->
                        Surface(
                            onClick = { onPlay(mediaFileId, chapter.startMs, launchSettings) },
                            color = WebSurfaceSoft,
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.width(if (isTelevision) 190.dp else 156.dp),
                        ) {
                            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                                Text(
                                    chapter.title ?: playarrString(
                                        PlayarrString.DetailChapterNumber,
                                        "number" to chapter.index + 1,
                                    ),
                                    color = WebInk,
                                    fontWeight = FontWeight.SemiBold,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(formatPlayarrPlayerTime(chapter.startMs), color = WebInkMuted, fontSize = 11.sp)
                            }
                        }
                    }
                }
            }
        }
        if (credits.cast.isNotEmpty()) DetailCreditsRail(credits.cast)
        if (similarWorks.isNotEmpty()) SimilarWorksRail(similarWorks, serverUrl, accessToken, onOpenWork)
    }
}

@Composable
private fun DetailCreditsRail(credits: List<CreditResponse>) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(playarrString(PlayarrString.DetailCast), color = WebInk, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(vertical = 4.dp)) {
            items(credits, key = CreditResponse::id) { credit ->
                Column(Modifier.width(104.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(
                        Modifier
                            .size(78.dp)
                            .clip(CircleShape)
                            .background(WebSurfaceSoft),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            credit.person.name.firstOrNull()?.uppercase() ?: "?",
                            color = WebInkMuted,
                            fontSize = 22.sp,
                            fontWeight = FontWeight.Bold,
                        )
                        credit.person.headshotUrl?.let { url ->
                            AsyncImage(
                                model = url,
                                contentDescription = credit.person.name,
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.fillMaxSize(),
                            )
                        }
                    }
                    Text(
                        credit.person.name,
                        color = WebInk,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 7.dp),
                    )
                    credit.character?.let {
                        Text(it, color = WebInkMuted, fontSize = 9.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

@Composable
private fun SimilarWorksRail(
    works: List<Work>,
    serverUrl: String,
    accessToken: String?,
    onOpenWork: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(playarrString(PlayarrString.DetailSimilarTitles), color = WebInk, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(vertical = 4.dp)) {
            items(works, key = Work::id) { work ->
                Column(Modifier.width(150.dp)) {
                    Surface(
                        onClick = { onOpenWork(work.id) },
                        color = WebSurfaceSoft,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth().aspectRatio(16f / 9f),
                    ) {
                        AuthenticatedArtwork(
                            work = work,
                            kinds = listOf(ImageKind.Backdrop, ImageKind.Poster),
                            serverUrl = serverUrl,
                            accessToken = accessToken,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize(),
                        )
                    }
                    Text(
                        work.title,
                        color = WebInk,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 7.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun ExperienceMusicDetailContent(
    detail: WorkDetail,
    children: WorkChildren.Artist,
    initialMediaFileId: String?,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    canDownload: Boolean,
    onBack: () -> Unit,
    onPlay: (mediaFileId: String, albumId: String) -> Unit,
    onAddToPlaylist: (trackId: String) -> Unit,
    onDownload: (List<DownloadCandidate>) -> Unit,
) {
    val language = LocalPlayarrLanguage.current
    val albums = remember(children) {
        children.albums.filter { album -> album.tracks.any { it.mediaFileId != null } }
    }
    val initialSelection = remember(detail.work.id, albums, initialMediaFileId) {
        resolvePlayarrMusicSelection(albums, initialMediaFileId)
    }
    var selectedAlbumId by remember(detail.work.id, albums, initialMediaFileId) {
        mutableStateOf(initialSelection?.albumId)
    }
    var selectedTrackId by remember(detail.work.id, albums, initialMediaFileId) {
        mutableStateOf(initialSelection?.trackId)
    }
    val selectedAlbum = albums.firstOrNull { it.album.id == selectedAlbumId } ?: albums.firstOrNull()
    val selectedTracks = selectedAlbum?.tracks?.filter { it.mediaFileId != null }.orEmpty()
    val selectedTrack = selectedTracks.firstOrNull { it.track.id == selectedTrackId } ?: selectedTracks.firstOrNull()
    val posterUrl = remember(detail.work.id) {
        detail.work.images.firstOrNull { it.kind == ImageKind.Poster }?.url
    }

    Box(Modifier.fillMaxSize().background(WebSurface)) {
        if (detail.work.images.any { it.kind == ImageKind.Backdrop }) {
            AuthenticatedArtwork(
                work = detail.work,
                kinds = listOf(ImageKind.Backdrop),
                serverUrl = serverUrl,
                accessToken = accessToken,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize().then(if (isTelevision) Modifier.fillMaxWidth(0.58f) else Modifier.fillMaxHeight(0.42f)),
            )
        } else if (selectedAlbum != null) {
            AuthenticatedAlbumArtwork(
                artistWork = detail.work,
                albumId = selectedAlbum.album.id,
                serverUrl = serverUrl,
                accessToken = accessToken,
                modifier = Modifier.fillMaxSize().then(if (isTelevision) Modifier.fillMaxWidth(0.58f) else Modifier.fillMaxHeight(0.42f)),
            )
        }
        Box(
            Modifier.fillMaxSize().background(
                if (isTelevision) {
                    Brush.horizontalGradient(listOf(WebSurface.copy(alpha = 0.28f), WebSurface.copy(alpha = 0.9f), WebSurface))
                } else {
                    Brush.verticalGradient(listOf(Color.Transparent, WebSurface), endY = 900f)
                },
            ),
        )
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                start = if (isTelevision) 118.dp else 16.dp,
                end = if (isTelevision) 64.dp else 16.dp,
                top = if (isTelevision) 60.dp else 42.dp,
                bottom = if (isTelevision) 118.dp else 110.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(if (isTelevision) 24.dp else 16.dp),
        ) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    IconButton(onClick = onBack, modifier = Modifier.background(WebSurfaceStrong.copy(alpha = 0.88f), CircleShape)) {
                        Icon(
                            Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = playarrString(PlayarrString.MusicBackToMusic),
                            tint = WebInk,
                        )
                    }
                    Column {
                        Text(
                            playarrString(PlayarrString.MusicTitle).uppercase(language.locale),
                            color = WebPink,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.ExtraBold,
                            letterSpacing = 1.2.sp,
                        )
                        Text(detail.work.title, color = WebInk, fontSize = if (isTelevision) 32.sp else 24.sp, fontWeight = FontWeight.Medium)
                    }
                }
            }
            item {
                Column(
                    modifier = Modifier.fillMaxWidth(if (isTelevision) 0.48f else 1f),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        (
                            selectedAlbum?.album?.albumType?.name?.replace('_', ' ')
                                ?: detail.work.genres.firstOrNull()
                                ?: playarrString(PlayarrString.MusicArtist)
                            ).uppercase(language.locale),
                        color = WebInkMuted,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        selectedAlbum?.album?.title ?: detail.work.title,
                        color = WebInk,
                        fontSize = if (isTelevision) 46.sp else 32.sp,
                        fontWeight = FontWeight.Medium,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(detail.work.title, color = WebInkSoft, fontWeight = FontWeight.SemiBold)
                        selectedAlbum?.album?.releaseDate?.year?.let { Text(it.toString(), color = WebInkMuted) }
                        if (selectedAlbum != null) {
                            Text(
                                playarrString(
                                    PlayarrString.MusicTrackCount,
                                    "count" to selectedTracks.size,
                                    "unit" to playarrString(
                                        if (selectedTracks.size == 1) PlayarrString.MusicTrackSingular else PlayarrString.MusicTrackPlural,
                                    ),
                                ),
                                color = WebInkMuted,
                            )
                        }
                    }
                    selectedTrack?.let { track ->
                        Text(
                            "${track.track.title} · ${formatMusicDurationLabel(track.track.durationSeconds)}",
                            color = WebInkSoft,
                            fontSize = if (isTelevision) 18.sp else 16.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Text(
                        detail.work.overview?.takeIf(String::isNotBlank)
                            ?: playarrString(PlayarrString.MusicOverviewFallback),
                        color = WebInkSoft,
                        maxLines = if (isTelevision) 3 else 4,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            if (albums.isEmpty()) {
                item {
                    Column(
                        modifier = Modifier.padding(vertical = 48.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            playarrString(PlayarrString.MusicNoAlbumsTitle),
                            color = WebInk,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(playarrString(PlayarrString.MusicNoAlbumsDescription), color = WebInkMuted)
                    }
                }
            } else {
                item {
                    Text(playarrString(PlayarrString.MusicAlbums), color = WebInk, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                    LazyRow(
                        modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(if (isTelevision) 22.dp else 12.dp),
                    ) {
                        items(albums, key = { it.album.id }) { album ->
                            val firstTrack = album.tracks.firstOrNull { it.mediaFileId != null }
                            MusicAlbumCard(
                                album = album,
                                artist = detail.work,
                                serverUrl = serverUrl,
                                accessToken = accessToken,
                                selected = album.album.id == selectedAlbum?.album?.id,
                                isTelevision = isTelevision,
                                onSelect = {
                                    selectedAlbumId = album.album.id
                                    selectedTrackId = firstTrack?.track?.id
                                },
                                onPlay = {
                                    selectedAlbumId = album.album.id
                                    selectedTrackId = firstTrack?.track?.id
                                    firstTrack?.mediaFileId?.let { onPlay(it, album.album.id) }
                                },
                            )
                        }
                    }
                }
                selectedAlbum?.let { album ->
                    item {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(album.album.title, color = WebInk, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                                Text(
                                    playarrString(
                                        PlayarrString.MusicTrackCount,
                                        "count" to selectedTracks.size,
                                        "unit" to playarrString(
                                            if (selectedTracks.size == 1) PlayarrString.MusicTrackSingular else PlayarrString.MusicTrackPlural,
                                        ),
                                    ),
                                    color = WebInkMuted,
                                    fontSize = 10.sp,
                                )
                            }
                            val albumDownloads = album.tracks.mapNotNull { track ->
                                track.mediaFileId?.let {
                                    DownloadCandidate(it, detail.work.id, track.track.title, detail.work.title, posterUrl, "track")
                                }
                            }
                            if (canDownload && albumDownloads.isNotEmpty()) {
                                IconButton(onClick = { onDownload(albumDownloads) }) {
                                    Icon(
                                        Icons.Outlined.Download,
                                        contentDescription = playarrString(
                                            PlayarrString.DetailDownloadTitle,
                                            "title" to album.album.title,
                                        ),
                                        tint = WebInk,
                                    )
                                }
                            }
                        }
                    }
                    items(selectedTracks, key = { it.track.id }) { track ->
                        MusicTrackRow(
                            track = track,
                            artistWorkId = detail.work.id,
                            artistTitle = detail.work.title,
                            posterUrl = posterUrl,
                            canDownload = canDownload,
                            selected = track.track.id == selectedTrack?.track?.id,
                            onSelect = { selectedTrackId = track.track.id },
                            onPlay = {
                                selectedTrackId = track.track.id
                                track.mediaFileId?.let { onPlay(it, album.album.id) }
                            },
                            onAddToPlaylist = { onAddToPlaylist(track.track.id) },
                            onDownload = { candidate -> onDownload(listOf(candidate)) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun MusicAlbumCard(
    album: AlbumDetail,
    artist: Work,
    serverUrl: String,
    accessToken: String?,
    selected: Boolean,
    isTelevision: Boolean,
    onSelect: () -> Unit,
    onPlay: () -> Unit,
) {
    var focused by remember(album.album.id) { mutableStateOf(false) }
    Column(
        modifier = Modifier.width(if (isTelevision) 200.dp else 142.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Surface(
            onClick = onPlay,
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .scale(if (focused) 1.05f else 1f)
                .onFocusChanged { state -> focused = state.isFocused; if (state.isFocused) onSelect() }
                .then(if (selected) Modifier.border(2.dp, WebPink, RoundedCornerShape(12.dp)) else Modifier),
            shape = RoundedCornerShape(12.dp),
            color = WebSurfaceStrong,
        ) {
            AuthenticatedAlbumArtwork(
                artistWork = artist,
                albumId = album.album.id,
                serverUrl = serverUrl,
                accessToken = accessToken,
                modifier = Modifier.fillMaxSize(),
            )
        }
        Text(album.album.title, color = WebInk, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(
            album.album.releaseDate?.year?.toString() ?: album.album.albumType.name.replace('_', ' '),
            color = WebInkMuted,
            fontSize = 10.sp,
            maxLines = 1,
        )
    }
}

@Composable
private fun MusicTrackRow(
    track: TrackDetail,
    artistWorkId: String,
    artistTitle: String,
    posterUrl: String?,
    canDownload: Boolean,
    selected: Boolean,
    onSelect: () -> Unit,
    onPlay: () -> Unit,
    onAddToPlaylist: () -> Unit,
    onDownload: (DownloadCandidate) -> Unit,
) {
    val mediaFileId = track.mediaFileId ?: return
    var focused by remember(track.track.id) { mutableStateOf(false) }
    Surface(
        onClick = onPlay,
        color = if (focused || selected) WebSurfaceSoft else WebSurfaceStrong.copy(alpha = 0.92f),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth().onFocusChanged {
            focused = it.isFocused
            if (it.isFocused) onSelect()
        },
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(track.track.trackNumber.toString().padStart(2, '0'), color = WebInkMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            Text(track.track.title, color = WebInk, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(formatMusicDurationLabel(track.track.durationSeconds), color = WebInkMuted, fontSize = 11.sp)
            IconButton(onClick = onAddToPlaylist) {
                Icon(
                    Icons.Outlined.Add,
                    contentDescription = playarrString(
                        PlayarrString.MusicAddTrackToPlaylist,
                        "title" to track.track.title,
                    ),
                    tint = WebInkMuted,
                )
            }
            if (canDownload) {
                IconButton(
                    onClick = {
                        onDownload(DownloadCandidate(mediaFileId, artistWorkId, track.track.title, artistTitle, posterUrl, "track"))
                    },
                ) {
                    Icon(
                        Icons.Outlined.Download,
                        contentDescription = playarrString(
                            PlayarrString.DetailDownloadTitle,
                            "title" to track.track.title,
                        ),
                        tint = WebInkMuted,
                    )
                }
            }
            Icon(
                Icons.Outlined.PlayArrow,
                contentDescription = playarrString(PlayarrString.DetailPlayTitle, "title" to track.track.title),
                tint = WebPink,
            )
        }
    }
}

@Composable
private fun formatMusicDurationLabel(seconds: Int?): String =
    if (seconds == null || seconds <= 0) {
        playarrString(PlayarrString.MusicDurationUnavailable)
    } else {
        formatMusicDuration(seconds)
    }

internal fun formatMusicDuration(seconds: Int?): String {
    if (seconds == null || seconds <= 0) return "--:--"
    return "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
}

internal data class PlayarrMusicSelection(val albumId: String, val trackId: String)

internal fun resolvePlayarrMusicSelection(
    albums: List<AlbumDetail>,
    requestedMediaFileId: String?,
): PlayarrMusicSelection? {
    val requested = requestedMediaFileId?.let { mediaFileId ->
        albums.firstNotNullOfOrNull { album ->
            album.tracks.firstOrNull { it.mediaFileId == mediaFileId }?.let { track ->
                PlayarrMusicSelection(album.album.id, track.track.id)
            }
        }
    }
    if (requested != null) return requested
    return albums.firstNotNullOfOrNull { album ->
        album.tracks.firstOrNull { it.mediaFileId != null }?.let { track ->
            PlayarrMusicSelection(album.album.id, track.track.id)
        }
    }
}

@Composable
private fun DetailChildren(
    detail: WorkDetail,
    onPlay: (String) -> Unit,
    onAddToPlaylist: (String?) -> Unit,
    onDownload: (List<DownloadCandidate>) -> Unit,
    canDownload: Boolean,
    padding: PaddingValues,
    scrollable: Boolean,
) {
    val posterUrl = remember(detail.work.id) { detail.work.images.firstOrNull { it.kind == ImageKind.Poster }?.url }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (scrollable) Modifier.fillMaxHeight().verticalScroll(rememberScrollState()) else Modifier)
            .padding(padding),
        verticalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        when (val children = detail.children) {
            WorkChildren.Movie -> detail.mediaFileId?.let { id ->
                PlayRow(
                    title = playarrString(PlayarrString.DetailPlayTitle, "title" to detail.work.title),
                    available = true,
                    onAddToPlaylist = { onAddToPlaylist(null) },
                    onDownload = if (canDownload) {
                        {
                            onDownload(
                                listOf(DownloadCandidate(id, detail.work.id, detail.work.title, detail.work.title, posterUrl, "movie")),
                            )
                        }
                    } else {
                        null
                    },
                ) { onPlay(id) }
            } ?: Text(playarrString(PlayarrString.DetailNoPlayableMedia), color = WebInkMuted)
            is WorkChildren.Series -> children.seasons.forEach { season ->
                val seasonCandidates = season.episodes.mapNotNull { episode ->
                    episode.mediaFileId?.let {
                        DownloadCandidate(
                            it,
                            detail.work.id,
                            episode.episode.title ?: playarrString(
                                PlayarrString.DetailEpisodeNumber,
                                "number" to episode.episode.episodeNumber,
                            ),
                            detail.work.title,
                            posterUrl,
                            "episode",
                        )
                    }
                }
                SectionHeaderRow(
                    season.season.title ?: playarrString(
                        PlayarrString.DetailSeasonNumber,
                        "number" to season.season.seasonNumber,
                    ),
                    if (canDownload) seasonCandidates else emptyList(),
                ) { onDownload(it) }
                season.episodes.forEach { episode ->
                    val episodeTitle = episode.episode.title ?: playarrString(
                        PlayarrString.DetailEpisodeNumber,
                        "number" to episode.episode.episodeNumber,
                    )
                    PlayRow(
                        title = episodeTitle,
                        available = episode.mediaFileId != null,
                        onAddToPlaylist = { onAddToPlaylist(episode.episode.id) },
                        onDownload = episode.mediaFileId?.takeIf { canDownload }?.let { id ->
                            {
                                onDownload(
                                    listOf(
                                        DownloadCandidate(
                                            id, detail.work.id,
                                            episodeTitle,
                                            detail.work.title, posterUrl, "episode",
                                        ),
                                    ),
                                )
                            }
                        },
                    ) { episode.mediaFileId?.let(onPlay) }
                }
            }
            is WorkChildren.Artist -> children.albums.forEach { album ->
                val albumCandidates = album.tracks.mapNotNull { track ->
                    track.mediaFileId?.let { DownloadCandidate(it, detail.work.id, track.track.title, detail.work.title, posterUrl, "track") }
                }
                SectionHeaderRow(album.album.title, if (canDownload) albumCandidates else emptyList()) { onDownload(it) }
                album.tracks.forEach { track ->
                    PlayRow(
                        title = track.track.title,
                        available = track.mediaFileId != null,
                        onAddToPlaylist = { onAddToPlaylist(track.track.id) },
                        onDownload = track.mediaFileId?.takeIf { canDownload }?.let { id ->
                            { onDownload(listOf(DownloadCandidate(id, detail.work.id, track.track.title, detail.work.title, posterUrl, "track"))) }
                        },
                    ) { track.mediaFileId?.let(onPlay) }
                }
            }
            is WorkChildren.Author -> children.books.forEach { book ->
                PlayRow(
                    title = book.book.title,
                    available = book.mediaFileId != null,
                    onAddToPlaylist = { onAddToPlaylist(book.book.id) },
                    onDownload = book.mediaFileId?.takeIf { canDownload }?.let { id ->
                        { onDownload(listOf(DownloadCandidate(id, detail.work.id, book.book.title, detail.work.title, posterUrl, "book"))) }
                    },
                ) { book.mediaFileId?.let(onPlay) }
            }
        }
    }
}

/** Season/album header, with a "download all" action when at least one child has a resolved `mediaFileId`. */
@Composable
private fun SectionHeaderRow(title: String, candidates: List<DownloadCandidate>, onDownloadAll: (List<DownloadCandidate>) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, color = WebInk, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        if (candidates.isNotEmpty()) {
            IconButton(onClick = { onDownloadAll(candidates) }) {
                Icon(
                    Icons.Outlined.Download,
                    contentDescription = playarrString(
                        PlayarrString.ContextDownloadCount,
                        "count" to candidates.size,
                    ),
                    tint = WebInkMuted,
                )
            }
        }
    }
}

@Composable
private fun PlayRow(
    title: String,
    available: Boolean,
    onAddToPlaylist: (() -> Unit)? = null,
    onDownload: (() -> Unit)? = null,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        enabled = available,
        modifier = Modifier.fillMaxWidth(),
        color = WebSurfaceSoft.copy(alpha = if (available) 0.88f else 0.42f),
        contentColor = WebInk,
        shape = RoundedCornerShape(12.dp),
    ) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(title, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
            onAddToPlaylist?.let { add ->
                IconButton(onClick = add) {
                    Icon(
                        Icons.Outlined.Add,
                        contentDescription = playarrString(PlayarrString.ContextAddToPlaylist),
                        tint = WebInkMuted,
                    )
                }
            }
            onDownload?.let { download ->
                IconButton(onClick = download) {
                    Icon(
                        Icons.Outlined.Download,
                        contentDescription = playarrString(PlayarrString.ContextDownload),
                        tint = WebInkMuted,
                    )
                }
            }
            Icon(
                Icons.Outlined.PlayArrow,
                contentDescription = playarrString(
                    if (available) PlayarrString.DetailPlay else PlayarrString.DetailUnavailable,
                ),
                tint = if (available) WebPink else WebInkMuted,
            )
        }
    }
}

@HiltViewModel
internal class ExperiencePlayerViewModel @Inject constructor(
    val player: StreamarrPlayer,
    private val getPlaybackInfo: GetPlaybackInfoUseCase,
    private val api: StreamarrApi,
    private val serverAccessResolver: StreamarrServerAccessResolver,
    private val downloadRepository: DownloadRepository,
    private val offlineProgressRepository: OfflineProgressRepository,
) : ViewModel() {
    private val _state = MutableStateFlow<ExperienceLoad<Unit>>(ExperienceLoad.Loading)
    val state = _state.asStateFlow()
    private val _controls = MutableStateFlow(PlayarrPlaybackControls())
    val controls = _controls.asStateFlow()
    private var activeMediaFileId: String? = null
    private var activeServerUrl = ""
    private var activeDefaults = PlayarrPlayerDefaults()
    private var activeSessionId: String? = null
    private var activeSourceOffsetMs = 0L
    private var activeSourceDurationMs = 0L
    private var activeOnDemandHls = false
    private var activePlaybackUrl = ""
    private var automaticRecoveryUrl: String? = null
    private var prepareJob: Job? = null
    private var switchJob: Job? = null
    private var previousPlayerState = player.state.value
    private val telemetryMutex = Mutex()

    init {
        viewModelScope.launch {
            player.state.collect { current ->
                val previous = previousPlayerState
                val currentError = current.error
                previousPlayerState = current
                if (activeSessionId == null) return@collect

                when {
                    current.hasEnded && !previous.hasEnded -> {
                        persistProgress(completed = true)
                        closeActiveSession(PlaybackStopReason.Completed)
                    }
                    currentError != null && previous.error == null -> {
                        if (
                            shouldRecoverPlayarrHlsSession(
                                activeOnDemandHls,
                                currentError.httpStatus,
                                currentError.requestUri,
                            ) && automaticRecoveryUrl != activePlaybackUrl
                        ) {
                            automaticRecoveryUrl = activePlaybackUrl
                            recoverExpiredHlsSession(currentError.message)
                        } else {
                            persistProgress()
                            closeActiveSession(PlaybackStopReason.Error, currentError.message)
                            _state.value = ExperienceLoad.Failed(
                                PlayarrMessage.Localized(
                                    PlayarrString.ErrorPlaybackFailed,
                                    mapOf(
                                        "message" to currentError.message.replace('_', ' ').lowercase(),
                                    ),
                                ),
                            )
                        }
                    }
                    previous.isPlaying && !current.isPlaying && !current.isBuffering -> checkpoint()
                }
            }
        }
    }

    fun play(
        mediaFileId: String,
        defaults: PlayarrPlayerDefaults,
        requestedStartPositionMs: Long? = null,
        launchSettings: PlayarrPlaybackLaunchSettings? = null,
    ) {
        prepareJob?.cancel()
        switchJob?.cancel()
        prepareJob = viewModelScope.launch {
            if (activeMediaFileId != null) persistProgress(ensureCompletion = true)
            closeActiveSessionAndWait(PlaybackStopReason.UserStopped)
            activeMediaFileId = mediaFileId
            activeServerUrl = serverAccessResolver.forMedia(mediaFileId).serverUrl
            activeDefaults = defaults
            activeSourceOffsetMs = 0L
            activeSourceDurationMs = 0L
            activeOnDemandHls = false
            activePlaybackUrl = ""
            automaticRecoveryUrl = null
            _controls.value = PlayarrPlaybackControls()
            _state.value = ExperienceLoad.Loading
            val resumePosition = requestedStartPositionMs ?: runCatching { api.getWatchProgress(mediaFileId) }
                .getOrNull()
                ?.takeIf { it.state == WatchState.PartWatched }
                ?.positionMs
                ?: 0L

            // Local-download short-circuit: a completed, contiguously-cached
            // download plays straight from disk without ever touching
            // GetPlaybackInfoUseCase/the network -- the whole point of
            // downloading being able to watch fully offline.
            val localFile = runCatching { downloadRepository.localFile(mediaFileId) }.getOrNull()
            if (localFile != null) {
                player.prepare(Uri.fromFile(localFile).toString(), StreamFormat.Direct, resumePosition)
                player.play()
                _state.value = ExperienceLoad.Ready(Unit)
                return@launch
            }

            val selectedQuality = launchSettings?.qualityId ?: parsePlayarrQualityDefault(defaults.qualityId)
            _state.value = when (val result = getPlaybackInfo(
                mediaFileId = mediaFileId,
                containers = playarrAndroidContainers,
                videoCodecs = playarrAndroidVideoCodecs,
                audioCodecs = playarrAndroidAudioCodecs,
                profile = launchSettings?.profile ?: selectedQuality.takeUnless { it == "original" },
                forceTranscode = launchSettings?.forceTranscode ?: (selectedQuality != "original"),
                startPositionMs = resumePosition,
                audioStreamIndex = launchSettings?.audioStreamIndex,
                ignoreSavedPreferences = launchSettings == null && selectedQuality == "original",
            )) {
                is StreamarrResult.Success -> {
                    prepareNegotiatedPlayback(
                        result.value,
                        resumePosition,
                        shouldPlay = true,
                        preferredSubtitleId = launchSettings?.subtitleTrackId,
                    )
                    ExperienceLoad.Ready(Unit)
                }
                is StreamarrResult.Failure -> ExperienceLoad.Failed(
                    result.error.userMessageForExperience(PlayarrString.ErrorSubjectMedia),
                )
            }
        }
    }

    fun selectQuality(qualityId: String) {
        val option = _controls.value.qualityOptions.firstOrNull { it.id == qualityId } ?: return
        if (_controls.value.switching || _controls.value.activeQualityId == qualityId) return
        switchNegotiatedPlayback(
            profile = option.profile ?: option.id.takeUnless { it == "original" },
            forceTranscode = option.id != "original",
            audioStreamIndex = selectedAudioStreamIndex(),
            ignoreSavedPreferences = option.id == "original",
        )
    }

    fun selectAudioTrack(trackId: String) {
        val track = _controls.value.audioTracks.firstOrNull { it.id == trackId } ?: return
        if (_controls.value.switching || _controls.value.selectedAudioTrackId == trackId) return
        val quality = _controls.value.qualityOptions
            .firstOrNull { it.id == _controls.value.activeQualityId }
        switchNegotiatedPlayback(
            profile = quality?.profile ?: quality?.id?.takeUnless { it == "original" },
            forceTranscode = quality?.id != null && quality.id != "original",
            audioStreamIndex = track.streamIndex,
            ignoreSavedPreferences = false,
        )
    }

    fun selectSubtitleTrack(trackId: String?) {
        if (trackId != null && _controls.value.subtitleTracks.none { it.id == trackId }) return
        player.selectSubtitleTrack(trackId)
        _controls.value = _controls.value.copy(selectedSubtitleTrackId = trackId)
    }

    private fun switchNegotiatedPlayback(
        profile: String?,
        forceTranscode: Boolean,
        audioStreamIndex: Int?,
        ignoreSavedPreferences: Boolean,
        requestedSourcePositionMs: Long? = null,
        stopReason: PlaybackStopReason = PlaybackStopReason.UserStopped,
        errorMessage: String? = null,
        shouldPlayOverride: Boolean? = null,
    ) {
        val mediaFileId = activeMediaFileId ?: return
        prepareJob?.cancel()
        switchJob?.cancel()
        switchJob = viewModelScope.launch {
            val sourcePosition = requestedSourcePositionMs ?: currentSourcePositionMs()
            val shouldPlay = shouldPlayOverride ?: player.state.value.playWhenReady
            persistProgress(ensureCompletion = true)
            player.pause()
            _controls.value = _controls.value.copy(switching = true)
            closeActiveSessionAndWait(stopReason, errorMessage)
            when (val result = getPlaybackInfo(
                mediaFileId = mediaFileId,
                containers = playarrAndroidContainers,
                videoCodecs = playarrAndroidVideoCodecs,
                audioCodecs = playarrAndroidAudioCodecs,
                profile = profile,
                forceTranscode = forceTranscode,
                startPositionMs = sourcePosition,
                audioStreamIndex = audioStreamIndex,
                ignoreSavedPreferences = ignoreSavedPreferences,
            )) {
                is StreamarrResult.Success -> {
                    val preferredSubtitleId = _controls.value.selectedSubtitleTrackId
                    prepareNegotiatedPlayback(
                        result.value,
                        sourcePosition,
                        shouldPlay,
                        preferredSubtitleId,
                    )
                    _state.value = ExperienceLoad.Ready(Unit)
                }
                is StreamarrResult.Failure -> {
                    val message = result.error.userMessageForExperience(PlayarrString.ErrorSubjectMedia)
                    _controls.value = _controls.value.copy(switching = false)
                    _state.value = ExperienceLoad.Failed(message)
                }
            }
        }
    }

    private fun selectedAudioStreamIndex(): Int? = _controls.value.audioTracks
        .firstOrNull { it.id == _controls.value.selectedAudioTrackId }
        ?.streamIndex

    private fun prepareNegotiatedPlayback(
        playback: PlaybackInfoResponse,
        sourcePositionMs: Long,
        shouldPlay: Boolean,
        preferredSubtitleId: String? = null,
    ) {
        activeSessionId = playback.sessionId
        activeSourceOffsetMs = playback.sourceOffsetMs.coerceAtLeast(0L)
        activeSourceDurationMs = playback.durationMs.coerceAtLeast(0L)
        activeOnDemandHls = playback.mode == io.streamarr.shared.data.model.PlaybackMode.Hls &&
            isPlayarrOnDemandHls(playback.url)
        activePlaybackUrl = playback.url
        val selectedSubtitleId = preferredSubtitleId
            ?.takeIf { selected -> playback.subtitleTracks.any { it.id == selected } }
            ?: playback.selectedSubtitleTrackId
            ?: selectPlayarrDefaultSubtitleTrackId(playback.subtitleTracks, activeDefaults)
        val selectedAudioLanguage = playback.audioTracks
            .firstOrNull { it.id == playback.selectedAudioTrackId }
            ?.language
        player.prepare(
            resolveStreamarrPlaybackUrl(activeServerUrl, playback.url),
            if (playback.mode == io.streamarr.shared.data.model.PlaybackMode.Hls) StreamFormat.Hls else StreamFormat.Direct,
            playarrEnginePositionMs(sourcePositionMs, activeSourceOffsetMs),
            subtitles = playback.subtitleTracks.map { subtitle ->
                StreamarrSubtitleTrack(
                    id = subtitle.id,
                    url = resolveStreamarrPlaybackUrl(activeServerUrl, subtitle.url),
                    label = subtitle.label,
                    language = subtitle.language,
                    isDefault = subtitle.isDefault,
                    forced = subtitle.forced,
                )
            },
            selectedSubtitleId = selectedSubtitleId,
            preferredAudioLanguage = selectedAudioLanguage,
            preferredSubtitleLanguage = activeDefaults.subtitleLanguage,
        )
        previousPlayerState = player.state.value
        _controls.value = PlayarrPlaybackControls(
            qualityOptions = playback.qualityOptions,
            activeQualityId = playback.selectedQualityId,
            audioTracks = playback.audioTracks,
            selectedAudioTrackId = playback.selectedAudioTrackId,
            subtitleTracks = playback.subtitleTracks,
            selectedSubtitleTrackId = selectedSubtitleId,
        )
        if (shouldPlay) player.play()
    }

    fun persistProgress(completed: Boolean = false, ensureCompletion: Boolean = false) {
        val mediaFileId = activeMediaFileId ?: return
        val position = currentSourcePositionMs()
        val duration = currentSourceDurationMs()
        if (duration <= 0L) return
        val context = if (ensureCompletion) Dispatchers.IO + NonCancellable else Dispatchers.IO
        viewModelScope.launch(context) {
            // Buffers locally (see OfflineProgressRepository) rather than
            // silently dropping the update when this device has no
            // network right now -- the expected case while watching a
            // downloaded file offline.
            offlineProgressRepository.record(mediaFileId, position, duration, completed || position >= duration - 5_000L)
        }
    }

    fun checkpoint() {
        persistProgress()
        val sessionId = activeSessionId ?: return
        recordEvent(sessionId, PlaybackEventRequest.heartbeat(currentSourcePositionMs()))
    }

    fun stopPlayback() {
        prepareJob?.cancel()
        switchJob?.cancel()
        prepareJob = null
        switchJob = null
        persistProgress(ensureCompletion = true)
        closeActiveSession(PlaybackStopReason.UserStopped)
        player.pause()
        activeMediaFileId = null
        activePlaybackUrl = ""
        automaticRecoveryUrl = null
    }

    fun togglePlayback() {
        if (player.state.value.playWhenReady) {
            player.pause()
        } else {
            player.play()
        }
    }

    fun seekBy(deltaMs: Long) {
        seekToSourcePosition(currentSourcePositionMs() + deltaMs)
    }

    fun seekToSourcePosition(positionMs: Long) {
        val sourceDuration = currentSourceDurationMs()
        val sourcePosition = if (sourceDuration > 0L) {
            positionMs.coerceIn(0L, sourceDuration)
        } else {
            positionMs.coerceAtLeast(0L)
        }
        if (activeOnDemandHls) {
            val quality = _controls.value.qualityOptions
                .firstOrNull { it.id == _controls.value.activeQualityId }
            switchNegotiatedPlayback(
                profile = quality?.profile ?: quality?.id?.takeUnless { it == "original" },
                forceTranscode = quality?.id != null && quality.id != "original",
                audioStreamIndex = selectedAudioStreamIndex(),
                ignoreSavedPreferences = false,
                requestedSourcePositionMs = sourcePosition,
            )
            return
        }
        player.seekTo(playarrEnginePositionMs(sourcePosition, activeSourceOffsetMs))
        checkpoint()
    }

    private fun recoverExpiredHlsSession(errorMessage: String) {
        val quality = _controls.value.qualityOptions
            .firstOrNull { it.id == _controls.value.activeQualityId }
        switchNegotiatedPlayback(
            profile = quality?.profile ?: quality?.id?.takeUnless { it == "original" },
            forceTranscode = quality?.id != null && quality.id != "original",
            audioStreamIndex = selectedAudioStreamIndex(),
            ignoreSavedPreferences = false,
            requestedSourcePositionMs = currentSourcePositionMs(),
            stopReason = PlaybackStopReason.Error,
            errorMessage = errorMessage,
            shouldPlayOverride = true,
        )
    }

    fun timelineSnapshot(): PlayarrPlayerTimeline {
        val durationMs = currentSourceDurationMs()
        val positionMs = currentSourcePositionMs()
        val bufferedPositionMs = playarrSourcePositionMs(
            enginePositionMs = player.rawPlayer.bufferedPosition,
            sourceOffsetMs = activeSourceOffsetMs,
            sourceDurationMs = durationMs,
        ).coerceAtLeast(positionMs)
        return PlayarrPlayerTimeline(positionMs, durationMs, bufferedPositionMs)
    }

    private fun currentSourcePositionMs(): Long = playarrSourcePositionMs(
        enginePositionMs = player.rawPlayer.currentPosition,
        sourceOffsetMs = activeSourceOffsetMs,
        sourceDurationMs = currentSourceDurationMs(),
    )

    private fun currentSourceDurationMs(): Long = activeSourceDurationMs.takeIf { it > 0L }
        ?: player.rawPlayer.duration.coerceAtLeast(0L).let { engineDuration ->
            if (engineDuration > 0L) engineDuration + activeSourceOffsetMs else 0L
        }

    private fun recordEvent(sessionId: String, event: PlaybackEventRequest) {
        viewModelScope.launch(Dispatchers.IO) {
            telemetryMutex.withLock {
                runCatching { api.recordPlaybackEvent(sessionId, event) }
            }
        }
    }

    private fun closeActiveSession(reason: PlaybackStopReason, errorMessage: String? = null) {
        val closure = takeActiveSession(reason, errorMessage) ?: return
        viewModelScope.launch(Dispatchers.IO + NonCancellable) { sendSessionClosure(closure) }
    }

    private suspend fun closeActiveSessionAndWait(
        reason: PlaybackStopReason,
        errorMessage: String? = null,
    ) {
        val closure = takeActiveSession(reason, errorMessage) ?: return
        withContext(Dispatchers.IO + NonCancellable) { sendSessionClosure(closure) }
    }

    private fun takeActiveSession(
        reason: PlaybackStopReason,
        errorMessage: String?,
    ): PlayarrSessionClosure? {
        val sessionId = activeSessionId ?: return null
        activeSessionId = null
        val position = currentSourcePositionMs()
        val terminal = if (reason == PlaybackStopReason.Error) {
            PlaybackEventRequest.error(errorMessage ?: "Player entered a terminal error state")
        } else {
            PlaybackEventRequest.stop(reason, position)
        }
        return PlayarrSessionClosure(sessionId, position, terminal)
    }

    private suspend fun sendSessionClosure(closure: PlayarrSessionClosure) {
        telemetryMutex.withLock {
            runCatching {
                api.recordPlaybackEvent(
                    closure.sessionId,
                    PlaybackEventRequest.heartbeat(closure.positionMs),
                )
            }
            runCatching { api.recordPlaybackEvent(closure.sessionId, closure.terminal) }
        }
    }

    override fun onCleared() {
        stopPlayback()
    }
}

@Composable
private fun ExperiencePlayerScreen(
    mediaFileId: String,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    playbackQueue: PlayarrPlaybackQueue,
    onMovePlayback: (Int) -> Unit,
    onSelectPlayback: (Int) -> Unit,
    onBack: () -> Unit,
    onMinimise: () -> Unit,
    viewModel: ExperiencePlayerViewModel = hiltViewModel(),
) {
    val activeMediaFileId = playbackQueue.currentMediaFileId ?: mediaFileId
    val playerDefaults = LocalPlayarrDisplayPreferences.current.playerDefaults
    val state by viewModel.state.collectAsState()
    val controls by viewModel.controls.collectAsState()
    val playbackState by viewModel.player.state.collectAsState()
    var timeline by remember(activeMediaFileId) { mutableStateOf(PlayarrPlayerTimeline()) }
    LaunchedEffect(state, activeMediaFileId) {
        if (state !is ExperienceLoad.Ready) return@LaunchedEffect
        while (true) {
            timeline = viewModel.timelineSnapshot()
            kotlinx.coroutines.delay(250)
        }
    }
    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        when (val current = state) {
            ExperienceLoad.Loading -> PlayarrPlayerStatus(
                loading = true,
                kicker = playarrString(PlayarrString.PlayerOneMoment),
                title = playarrString(PlayarrString.PlayerPreparingPlayback),
                message = playarrString(PlayarrString.PlayerPreparingMessage),
            )
            is ExperienceLoad.Failed -> PlayarrPlayerStatus(
                loading = false,
                kicker = playarrString(PlayarrString.PlayerPlaybackUnavailable),
                title = playarrString(PlayarrString.PlayerCouldNotStart),
                message = playarrText(current.message),
                onRetry = { viewModel.play(activeMediaFileId, playerDefaults) },
                onBack = onBack,
            )
            is ExperienceLoad.Ready -> {
                val item = playbackQueue.currentItem
                if (item?.music == true) {
                    PlayarrMusicPlayerVisual(
                        item = item,
                        serverUrl = serverUrl,
                        accessToken = accessToken,
                        isTelevision = isTelevision,
                        playing = playbackState.playWhenReady,
                    )
                } else {
                    androidx.compose.ui.viewinterop.AndroidView(
                        modifier = Modifier.fillMaxSize(),
                        factory = { context ->
                            androidx.media3.ui.PlayerView(context).apply {
                                player = viewModel.player.rawPlayer
                                useController = false
                            }
                        },
                    )
                }
            }
        }
        if (state is ExperienceLoad.Ready) {
            PlayarrPlayerChrome(
                playbackState = playbackState,
                timeline = timeline,
                controls = controls,
                isTelevision = isTelevision,
                queue = playbackQueue,
                serverUrl = serverUrl,
                accessToken = accessToken,
                canPrevious = playbackQueue.canPrevious,
                canNext = playbackQueue.canNext,
                onPrevious = { onMovePlayback(-1) },
                onNext = { onMovePlayback(1) },
                onSelectQueueItem = onSelectPlayback,
                onBack = onBack,
                onMinimise = onMinimise,
                onTogglePlayback = viewModel::togglePlayback,
                onSeek = viewModel::seekToSourcePosition,
                onQuality = viewModel::selectQuality,
                onAudio = viewModel::selectAudioTrack,
                onSubtitle = viewModel::selectSubtitleTrack,
            )
        } else {
            IconButton(
                onClick = onBack,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .windowInsetsPadding(WindowInsets.safeDrawing)
                    .padding(16.dp)
                    .background(Color.Black.copy(alpha = 0.62f), CircleShape),
            ) {
                Icon(
                    Icons.AutoMirrored.Outlined.ArrowBack,
                    contentDescription = playarrString(PlayarrString.PlayerBackToDetails),
                    tint = Color.White,
                )
            }
        }
    }
}

@Composable
private fun PlayarrPlayerStatus(
    loading: Boolean,
    kicker: String,
    title: String,
    message: String,
    onRetry: (() -> Unit)? = null,
    onBack: (() -> Unit)? = null,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (loading) {
            CircularProgressIndicator(color = Color.White, modifier = Modifier.size(38.dp))
        } else {
            Icon(
                Icons.Outlined.ErrorOutline,
                contentDescription = null,
                tint = Color(0xFFEE9297),
                modifier = Modifier.size(42.dp),
            )
        }
        Text(
            kicker.uppercase(LocalPlayarrLanguage.current.locale),
            color = WebInkMuted,
            fontSize = 10.sp,
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = 1.7.sp,
        )
        Text(
            title,
            color = Color.White,
            fontSize = 28.sp,
            fontWeight = FontWeight.Medium,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        Text(
            message,
            color = WebInkSoft,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            modifier = Modifier.fillMaxWidth(0.8f),
        )
        if (onRetry != null || onBack != null) {
            Row(
                modifier = Modifier.padding(top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                onRetry?.let {
                    Button(onClick = it) { Text(playarrString(PlayarrString.CommonTryAgain)) }
                }
                onBack?.let {
                    OutlinedButton(onClick = it) {
                        Text(playarrString(PlayarrString.PlayerBackToDetails), color = Color.White)
                    }
                }
            }
        }
    }
}

@Composable
private fun PlayarrMusicPlayerVisual(
    item: PlayarrPlaybackQueueItem,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    playing: Boolean,
) {
    val work = item.artworkWork
    val displayTitle = item.displayTitle(LocalPlayarrLanguage.current)
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        work?.let {
            AuthenticatedArtwork(
                work = it,
                kinds = listOf(ImageKind.Backdrop, ImageKind.Poster),
                serverUrl = serverUrl,
                accessToken = accessToken,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.radialGradient(
                        listOf(Color.Black.copy(alpha = 0.28f), Color.Black.copy(alpha = 0.88f)),
                    ),
                ),
        )
        Column(
            modifier = Modifier
                .align(Alignment.Center)
                .padding(bottom = if (isTelevision) 72.dp else 92.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(if (isTelevision) 390.dp else 260.dp)
                    .clip(RoundedCornerShape(if (isTelevision) 12.dp else 18.dp))
                    .background(WebSurfaceStrong),
            ) {
                work?.let {
                    AuthenticatedAlbumArtwork(
                        artistWork = it,
                        albumId = item.albumId,
                        serverUrl = serverUrl,
                        accessToken = accessToken,
                        modifier = Modifier.fillMaxSize(),
                    )
                }
                PlayarrMusicVisualiser(
                    active = playing,
                    modifier = Modifier.align(Alignment.BottomEnd).padding(18.dp),
                )
            }
            Text(
                displayTitle,
                color = Color.White,
                fontSize = if (isTelevision) 30.sp else 22.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
            )
            item.subtitle?.let { subtitle ->
                Text(
                    subtitle,
                    color = Color.White.copy(alpha = 0.7f),
                    fontSize = if (isTelevision) 16.sp else 13.sp,
                    maxLines = 1,
                )
            }
        }
    }
}

@Composable
private fun AuthenticatedAlbumArtwork(
    artistWork: Work,
    albumId: String?,
    serverUrl: String,
    accessToken: String?,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val serverAccess = rememberPlayarrWorkServerAccess(artistWork.id, serverUrl, accessToken)
    Box(modifier) {
        AuthenticatedArtwork(
            work = artistWork,
            kinds = listOf(ImageKind.Poster, ImageKind.Backdrop),
            serverUrl = serverUrl,
            accessToken = accessToken,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
        )
        if (albumId != null && serverAccess != null) {
            val resolved = remember(serverAccess.serverUrl, artistWork.id, albumId) {
                resolveAlbumArtworkUrl(serverAccess.serverUrl, artistWork.id, albumId)
            }
            val requestToken = playarrAccessTokenForUrl(serverAccess, resolved)
            val request = remember(resolved, requestToken) {
                ImageRequest.Builder(context)
                    .data(resolved)
                    .apply {
                        if (!requestToken.isNullOrBlank()) {
                            httpHeaders(
                                NetworkHeaders.Builder()
                                    .set("Authorization", "Bearer $requestToken")
                                    .build(),
                            )
                        }
                    }
                    .build()
            }
            AsyncImage(
                model = request,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

internal fun resolveAlbumArtworkUrl(serverUrl: String, artistWorkId: String, albumId: String): String =
    "${serverUrl.trimEnd('/')}/api/v1/artwork/album/${artistWorkId.asUrlPathSegment()}/${albumId.asUrlPathSegment()}/poster"

private fun String.asUrlPathSegment(): String =
    URLEncoder.encode(this, StandardCharsets.UTF_8.name()).replace("+", "%20")

@Composable
private fun PlayarrMusicVisualiser(active: Boolean, modifier: Modifier = Modifier) {
    val transition = rememberInfiniteTransition(label = "music visualiser")
    val levels = listOf(410, 570, 460, 630, 520).mapIndexed { index, duration ->
        transition.animateFloat(
            initialValue = 0.24f + (index * 0.04f),
            targetValue = 1f - (index * 0.05f),
            animationSpec = infiniteRepeatable(
                animation = tween(durationMillis = duration),
                repeatMode = RepeatMode.Reverse,
            ),
            label = "music bar $index",
        ).value
    }
    Row(
        modifier = modifier.height(56.dp),
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        levels.forEach { level ->
            Box(
                Modifier
                    .width(5.dp)
                    .height(if (active) 50.dp * level else 10.dp)
                    .background(WebPink, RoundedCornerShape(3.dp)),
            )
        }
    }
}

internal fun resolveStreamarrPlaybackUrl(serverUrl: String, playbackUrl: String): String =
    runCatching {
        val base = URI(if (serverUrl.endsWith('/')) serverUrl else "$serverUrl/")
        base.resolve(playbackUrl).toString()
    }.getOrDefault(playbackUrl)

@Composable
internal fun AuthenticatedArtwork(
    work: Work,
    kinds: List<ImageKind>,
    serverUrl: String,
    accessToken: String?,
    contentScale: ContentScale,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val serverAccess = rememberPlayarrWorkServerAccess(work.id, serverUrl, accessToken)
    val image = kinds.firstNotNullOfOrNull { kind -> work.images.firstOrNull { it.kind == kind } }
    val resolved = serverAccess?.let { access -> image?.url?.let { resolveArtworkUrl(access.serverUrl, it) } }
    if (resolved == null) {
        Box(modifier.background(WebSurfaceSoft), contentAlignment = Alignment.Center) {
            Text(work.title, color = WebInkMuted, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(12.dp))
        }
        return
    }
    val requestToken = playarrAccessTokenForUrl(serverAccess, resolved)
    val request = remember(resolved, requestToken) {
        ImageRequest.Builder(context)
            .data(resolved)
            .apply {
                if (!requestToken.isNullOrBlank()) {
                    httpHeaders(
                        NetworkHeaders.Builder()
                            .set("Authorization", "Bearer $requestToken")
                            .build(),
                    )
                }
            }
            .build()
    }
    AsyncImage(
        model = request,
        contentDescription = work.title,
        contentScale = contentScale,
        modifier = modifier,
    )
}

@Composable
private fun AuthenticatedMediaThumbnail(
    mediaFileId: String,
    serverUrl: String,
    accessToken: String?,
    contentDescription: String,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val serverAccess = rememberPlayarrMediaServerAccess(mediaFileId, serverUrl, accessToken)
    if (serverAccess == null) {
        Box(modifier.background(WebSurfaceSoft))
        return
    }
    val url = remember(serverAccess.serverUrl, mediaFileId) {
        "${serverAccess.serverUrl.trimEnd('/')}/api/v1/media/${Uri.encode(mediaFileId)}/thumbnail"
    }
    val requestToken = playarrAccessTokenForUrl(serverAccess, url)
    val request = remember(url, requestToken) {
        ImageRequest.Builder(context)
            .data(url)
            .apply {
                if (!requestToken.isNullOrBlank()) {
                    httpHeaders(
                        NetworkHeaders.Builder()
                            .set("Authorization", "Bearer $requestToken")
                            .build(),
                    )
                }
            }
            .build()
    }
    AsyncImage(
        model = request,
        contentDescription = contentDescription,
        contentScale = ContentScale.Crop,
        modifier = modifier,
    )
}

internal fun resolveArtworkUrl(serverUrl: String, artworkUrl: String): String = runCatching {
    val value = artworkUrl.trim()
    if (value.startsWith("http://") || value.startsWith("https://")) value
    else URI("${serverUrl.trimEnd('/')}/").resolve(value.trimStart('/')).toString()
}.getOrDefault(artworkUrl)

internal fun playarrAccessTokenForUrl(access: StreamarrServerAccess, requestUrl: String): String? {
    val token = access.accessToken?.takeIf(String::isNotBlank) ?: return null
    val server = serverOrigin(access.serverUrl) ?: return null
    return token.takeIf { server == serverOrigin(requestUrl) }
}

private fun serverOrigin(value: String): Triple<String, String, Int>? = runCatching {
    val uri = URI(value.trim())
    val scheme = requireNotNull(uri.scheme?.lowercase())
    val host = requireNotNull(uri.host?.lowercase())
    Triple(
        scheme,
        host,
        uri.port.takeIf { it >= 0 } ?: when (scheme) {
            "http" -> 80
            "https" -> 443
            else -> -1
        },
    )
}.getOrNull()

/** `internal` (not `private`): reused by `PlayarrDownloads.kt`'s Downloads screen -- Kotlin's `private` on a top-level declaration is file-scoped, not package-scoped. */
@Composable
internal fun ExperienceLoading(label: String) {
    Box(Modifier.fillMaxSize().background(WebSurface), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) {
            PlayarrLogo()
            CircularProgressIndicator(color = WebPink)
            Text(label, color = WebInkMuted, fontSize = 12.sp)
        }
    }
}

@Composable
internal fun ExperienceFailure(message: PlayarrMessage, retry: () -> Unit) {
    Box(Modifier.fillMaxSize().background(WebSurface), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.padding(32.dp)) {
            Text(playarrText(message), color = MaterialTheme.colorScheme.error)
            Button(onClick = retry) { Text(playarrString(PlayarrString.CommonTryAgain)) }
        }
    }
}

@Composable
internal fun ExperienceEmpty(message: String, description: String? = null) {
    Box(Modifier.fillMaxSize().background(WebSurface), contentAlignment = Alignment.Center) {
        Column(
            modifier = Modifier.padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                message,
                color = if (description == null) WebInkMuted else WebInk,
                fontWeight = if (description == null) null else FontWeight.SemiBold,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
            description?.let {
                Text(
                    it,
                    color = WebInkMuted,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
            }
        }
    }
}

@Composable
private fun ExperienceNotFoundScreen() {
    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .background(WebSurface)
            .background(Brush.radialGradient(listOf(WebPink.copy(alpha = 0.12f), Color.Transparent))),
    ) {
        val wide = maxWidth >= 760.dp
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(
                    start = if (wide) 142.dp else 32.dp,
                    end = if (wide) 96.dp else 32.dp,
                    top = if (wide) 96.dp else 72.dp,
                    bottom = if (wide) 130.dp else 112.dp,
                ),
            horizontalAlignment = Alignment.Start,
            verticalArrangement = Arrangement.Center,
        ) {
            PlayarrNotFoundArtwork(
                Modifier
                    .then(if (wide) Modifier.width(640.dp) else Modifier.fillMaxWidth())
                    .widthIn(max = 640.dp)
                    .aspectRatio(8f / 5f),
            )
            Text(
                playarrString(PlayarrString.NotFoundKicker).uppercase(LocalPlayarrLanguage.current.locale),
                color = WebPink,
                fontSize = 10.sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = 1.2.sp,
            )
            Text(
                playarrString(PlayarrString.NotFoundHeading),
                color = WebInk,
                fontSize = if (wide) 72.sp else 44.sp,
                fontWeight = FontWeight.Medium,
                lineHeight = if (wide) 68.sp else 44.sp,
                modifier = Modifier.padding(top = 8.dp),
            )
            Text(
                playarrString(PlayarrString.NotFoundDescription),
                color = WebInkMuted,
                fontSize = if (wide) 18.sp else 14.sp,
                modifier = Modifier.widthIn(max = 530.dp).padding(top = 14.dp),
            )
        }
    }
}

@Composable
private fun PlayarrNotFoundArtwork(modifier: Modifier = Modifier) {
    Box(modifier.clearAndSetSemantics {}, contentAlignment = Alignment.Center) {
        Text(
            "404",
            color = WebInk.copy(alpha = 0.06f),
            fontSize = 150.sp,
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = (-12).sp,
        )
        val accent = WebPink.copy(alpha = 0.82f)
        val fill = WebSurfaceStrong.copy(alpha = 0.88f)
        val orbit = WebInkMuted.copy(alpha = 0.45f)
        Canvas(Modifier.fillMaxSize()) {
            val scaleX = size.width / 640f
            val scaleY = size.height / 420f
            scale(scaleX = scaleX, scaleY = scaleY, pivot = Offset.Zero) {
                val orbitPath = Path().apply {
                    moveTo(88f, 236f)
                    cubicTo(117f, 91f, 281f, 24f, 430f, 81f)
                    cubicTo(546f, 126f, 598f, 258f, 524f, 348f)
                }
                drawPath(
                    orbitPath,
                    color = orbit,
                    style = Stroke(width = 2f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(4f, 13f))),
                )
                listOf(Offset(104f, 190f) to 5f, Offset(487f, 95f) to 4f, Offset(533f, 308f) to 6f)
                    .forEach { (center, radius) -> drawCircle(accent.copy(alpha = 0.72f), radius, center) }

                drawRoundRect(
                    color = fill,
                    topLeft = Offset(171f, 104f),
                    size = Size(292f, 190f),
                    cornerRadius = CornerRadius(28f),
                )
                drawRoundRect(
                    color = accent,
                    topLeft = Offset(171f, 104f),
                    size = Size(292f, 190f),
                    cornerRadius = CornerRadius(28f),
                    style = Stroke(5f),
                )
                drawLine(accent, Offset(198f, 140f), Offset(436f, 140f), strokeWidth = 5f)
                drawCircle(accent, 4f, Offset(207f, 122f))
                drawCircle(accent, 4f, Offset(223f, 122f))
                val play = Path().apply {
                    moveTo(298f, 182f)
                    lineTo(349f, 213f)
                    lineTo(298f, 244f)
                    close()
                }
                drawPath(play, accent, style = Stroke(5f))
                val crack = Path().apply {
                    moveTo(370f, 104f)
                    lineTo(350f, 139f)
                    lineTo(375f, 164f)
                    lineTo(346f, 198f)
                    lineTo(370f, 227f)
                    lineTo(352f, 258f)
                    lineTo(374f, 294f)
                }
                drawPath(crack, accent, style = Stroke(5f))

                drawCircle(fill.copy(alpha = 0.96f), 61f, Offset(449f, 286f))
                drawCircle(accent, 61f, Offset(449f, 286f), style = Stroke(5f))
                drawLine(accent, Offset(493f, 331f), Offset(543f, 381f), strokeWidth = 5f)
                val question = Path().apply {
                    moveTo(432f, 270f)
                    cubicTo(434f, 255f, 465f, 252f, 466f, 270f)
                    cubicTo(468f, 283f, 449f, 285f, 449f, 299f)
                }
                drawPath(question, accent, style = Stroke(5f))
                drawCircle(accent, 3f, Offset(449f, 313f))
            }
        }
    }
}

@Composable
private fun WorkKind.playarrSingularLabel(): String = playarrString(
    when (this) {
        WorkKind.Movie -> PlayarrString.WorkKindMovie
        WorkKind.Series -> PlayarrString.WorkKindSeries
        WorkKind.Site -> PlayarrString.WorkKindSite
        WorkKind.Artist -> PlayarrString.WorkKindArtist
        WorkKind.Author -> PlayarrString.WorkKindAuthor
    },
)

private fun WorkKind.playarrPluralKey(): PlayarrString = when (this) {
        WorkKind.Movie -> PlayarrString.WorkKindMovies
        WorkKind.Series -> PlayarrString.WorkKindSeries
        WorkKind.Site -> PlayarrString.WorkKindSites
        WorkKind.Artist -> PlayarrString.WorkKindMusic
        WorkKind.Author -> PlayarrString.WorkKindBooks
}

@Composable
private fun WorkKind.playarrPluralLabel(): String = playarrString(playarrPluralKey())

@Composable
private fun WorkKind.playarrCollectionNoun(): String = playarrString(
    if (this == WorkKind.Artist) PlayarrString.LibraryCollectionArtists else PlayarrString.LibraryCollectionTitles,
)

private fun io.streamarr.shared.domain.model.StreamarrError.userMessageForExperience(
    subject: PlayarrString,
): PlayarrMessage = when (this) {
    is io.streamarr.shared.domain.model.StreamarrError.Network -> {
        PlayarrMessage.Localized(PlayarrString.ErrorServerUnreachable)
    }
    is io.streamarr.shared.domain.model.StreamarrError.Http -> when (code) {
        401 -> PlayarrMessage.Localized(PlayarrString.ErrorSessionExpired)
        403 -> PlayarrMessage.Localized(
            PlayarrString.ErrorAccountCannotAccess,
            mapOf("subject" to subject),
        )
        404 -> PlayarrMessage.Localized(
            PlayarrString.ErrorSubjectNotFound,
            mapOf("subject" to subject),
        )
        else -> PlayarrMessage.Localized(
            PlayarrString.ErrorServerStatus,
            mapOf("code" to code),
        )
    }
    is io.streamarr.shared.domain.model.StreamarrError.Unknown -> PlayarrMessage.Localized(
        PlayarrString.ErrorSomethingWrongLoading,
        mapOf("subject" to subject),
    )
}
