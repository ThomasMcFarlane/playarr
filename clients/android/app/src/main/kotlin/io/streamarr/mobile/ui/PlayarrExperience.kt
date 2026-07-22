package io.streamarr.mobile.ui

import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PlaylistPlay
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
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
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import coil3.compose.AsyncImage
import coil3.network.NetworkHeaders
import coil3.network.httpHeaders
import coil3.request.ImageRequest
import dagger.hilt.android.lifecycle.HiltViewModel
import io.streamarr.mobile.BuildConfig
import io.streamarr.mobile.R
import io.streamarr.shared.auth.TokenStore
import io.streamarr.shared.data.model.ImageKind
import io.streamarr.shared.data.model.Playlist
import io.streamarr.shared.data.model.PlaybackEventRequest
import io.streamarr.shared.data.model.PlaybackInfoResponse
import io.streamarr.shared.data.model.PlaybackStopReason
import io.streamarr.shared.data.model.ProfileAvatarPreference
import io.streamarr.shared.data.model.Work
import io.streamarr.shared.data.model.WorkChildren
import io.streamarr.shared.data.model.WorkDetail
import io.streamarr.shared.data.model.WorkKind
import io.streamarr.shared.data.model.WatchProgress
import io.streamarr.shared.data.model.WatchState
import io.streamarr.shared.data.model.UpdateWatchProgressRequest
import io.streamarr.shared.data.model.wireName
import io.streamarr.shared.data.remote.StreamarrApi
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
import io.streamarr.shared.player.StreamarrPlayer
import io.streamarr.shared.player.StreamarrSubtitleTrack
import java.net.URI
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.Dispatchers
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
    data class Failed(val message: String) : ExperienceLoad<Nothing>
}

internal data class HomeRail(val title: String, val works: List<Work>)

@HiltViewModel
internal class PlayarrExperienceViewModel @Inject constructor(
    private val browseLibrary: BrowseLibraryUseCase,
    private val searchCatalog: SearchCatalogUseCase,
    private val listCatalogKinds: ListCatalogKindsUseCase,
    private val tokenStore: TokenStore,
    private val api: StreamarrApi,
) : ViewModel() {
    private val _home = MutableStateFlow<ExperienceLoad<List<HomeRail>>>(ExperienceLoad.Loading)
    val home: StateFlow<ExperienceLoad<List<HomeRail>>> = _home.asStateFlow()

    private val _libraries = MutableStateFlow<Map<WorkKind, ExperienceLoad<List<Work>>>>(emptyMap())
    val libraries: StateFlow<Map<WorkKind, ExperienceLoad<List<Work>>>> = _libraries.asStateFlow()

    private val _search = MutableStateFlow<ExperienceLoad<List<Work>>>(ExperienceLoad.Ready(emptyList()))
    val search: StateFlow<ExperienceLoad<List<Work>>> = _search.asStateFlow()

    private val _searchPlaylists = MutableStateFlow<List<Playlist>>(emptyList())
    val searchPlaylists: StateFlow<List<Playlist>> = _searchPlaylists.asStateFlow()

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
            val kinds = listOf(WorkKind.Movie, WorkKind.Series, WorkKind.Site, WorkKind.Artist)
            val results = kinds.map { kind ->
                async { kind to browseLibrary(kind = kind, availableOnly = true, sort = "recent", limit = 36) }
            }.awaitAll()
            val failure = results.firstNotNullOfOrNull { (_, result) ->
                (result as? StreamarrResult.Failure)?.error
            }
            if (failure != null && results.all { it.second is StreamarrResult.Failure }) {
                _home.value = ExperienceLoad.Failed(failure.userMessageForExperience("home"))
                return@launch
            }
            val byKind = results.associate { (kind, result) ->
                kind to ((result as? StreamarrResult.Success)?.value ?: emptyList())
            }
            val progress = progressRequest.await()
            _progress.value = progress
            _home.value = ExperienceLoad.Ready(buildHomeRails(byKind, progress))
        }
    }

    fun reloadForProfile() {
        _availableKinds.value = null
        _canDownload.value = null
        _libraries.value = emptyMap()
        _search.value = ExperienceLoad.Ready(emptyList())
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
                is StreamarrResult.Failure -> ExperienceLoad.Failed(result.error.userMessageForExperience(kind.label()))
            })
        }
    }

    fun search(query: String) {
        val normalised = query.trim()
        if (normalised.isEmpty()) {
            _search.value = ExperienceLoad.Ready(emptyList())
            _searchPlaylists.value = emptyList()
            return
        }
        viewModelScope.launch {
            _search.value = ExperienceLoad.Loading
            val playlists = async {
                runCatching { api.listPlaylists().filter { it.name.contains(normalised, ignoreCase = true) } }.getOrDefault(emptyList())
            }
            _search.value = when (val result = searchCatalog(normalised, limit = 80)) {
                is StreamarrResult.Success -> ExperienceLoad.Ready(result.value)
                is StreamarrResult.Failure -> ExperienceLoad.Failed(result.error.userMessageForExperience("search"))
            }
            _searchPlaylists.value = playlists.await()
        }
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

    fun startPlayback(mediaFileId: String, orderedMediaFileIds: List<String>) {
        _playbackQueue.value = playarrPlaybackQueue(mediaFileId, orderedMediaFileIds)
    }

    fun movePlayback(delta: Int) {
        _playbackQueue.value = _playbackQueue.value.move(delta)
    }

    private fun buildHomeRails(byKind: Map<WorkKind, List<Work>>, progress: List<WatchProgress>): List<HomeRail> {
        val movies = byKind[WorkKind.Movie].orEmpty()
        val series = byKind[WorkKind.Series].orEmpty()
        val sites = byKind[WorkKind.Site].orEmpty()
        val music = byKind[WorkKind.Artist].orEmpty()
        val recent = (movies + series + sites).sortedByDescending(Work::addedAt)
        val partWatchedIds = progress.filter { it.state == WatchState.PartWatched }.map(WatchProgress::workId).toSet()
        val continueWatching = (movies + series + sites).filter { it.id in partWatchedIds }
        return listOf(
            HomeRail("Continue watching", continueWatching.take(12)),
            HomeRail("Start watching", recent.filterNot { it.id in partWatchedIds }.take(12)),
            HomeRail("New movies", movies.take(12)),
            HomeRail("New series", series.take(12)),
            HomeRail("New sites", sites.take(12)),
            HomeRail("Music", music.take(12)),
        ).filter { it.works.isNotEmpty() }
    }
}

internal data class ExperienceDestination(
    val route: String,
    val label: String,
    val icon: ImageVector,
    val kind: WorkKind? = null,
)

private enum class LibraryViewMode { List, Screen, Cover, CoverFlow }
private enum class LibraryArtworkSize { Small, Medium, Large }

internal val experienceDestinations = listOf(
    ExperienceDestination("downloads", "Downloads", Icons.Outlined.Download),
    ExperienceDestination("search", "Search", Icons.Outlined.Search),
    ExperienceDestination("home", "Home", Icons.Outlined.Home),
    ExperienceDestination("series", "Series", Icons.Outlined.Tv, WorkKind.Series),
    ExperienceDestination("movies", "Movies", Icons.Outlined.Movie, WorkKind.Movie),
    ExperienceDestination("sites", "Sites", Icons.Outlined.Language, WorkKind.Site),
    ExperienceDestination("music", "Music", Icons.Outlined.MusicNote, WorkKind.Artist),
    ExperienceDestination("playlists", "Playlists", Icons.Outlined.PlaylistPlay),
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

@Composable
internal fun PlayarrExperience(
    serverUrl: String,
    isTelevision: Boolean,
    viewModel: PlayarrExperienceViewModel = hiltViewModel(),
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
    val isPlayer = currentRoute.startsWith("experience-player")
    val isProfiles = currentRoute == "profiles"

    LaunchedEffect(currentUserId) {
        if (currentUserId != null) viewModel.reloadForProfile()
    }
    LaunchedEffect(currentRoute, currentUserId) {
        if (currentUserId != null) viewModel.refreshProfileAvatar()
    }

    Box(modifier = Modifier.fillMaxSize().background(WebBackground)) {
        ExperienceNavHost(navController, serverUrl, token, isTelevision, canDownload, viewModel)

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
                        Icon(destination.icon, contentDescription = destination.label, modifier = Modifier.size(21.dp))
                        AnimatedVisibility(visible = selected && isTelevision) {
                            Text(
                                destination.label.uppercase(),
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
                                Text(destination.label, fontSize = 7.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 4.dp))
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
    val locale = LocalConfiguration.current.locales[0]
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
    Column(
        modifier = modifier
            .windowInsetsPadding(if (isTelevision) WindowInsets(0) else WindowInsets.safeDrawing)
            .padding(if (isTelevision) 42.dp else 16.dp),
        horizontalAlignment = Alignment.Start,
    ) {
        Surface(
            onClick = onClick,
            modifier = (if (isTelevision) Modifier.height(46.dp) else Modifier.size(42.dp))
                .semantics { contentDescription = "Profiles for ${userName ?: "Viewer"}" },
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
                    Text(userName ?: "Viewer", fontSize = 9.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 9.dp))
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
        composable("experience-detail/{workId}") { entry ->
            ExperienceDetailScreen(
                workId = entry.arguments?.getString("workId").orEmpty(),
                serverUrl = serverUrl,
                accessToken = accessToken,
                isTelevision = isTelevision,
                canDownload = canDownload == true,
                onBack = navController::popBackStack,
                onPlay = { mediaFileId, orderedMediaFileIds ->
                    viewModel.startPlayback(mediaFileId, orderedMediaFileIds)
                    navController.navigate("experience-player/${Uri.encode(mediaFileId)}")
                },
            )
        }
        composable("experience-player/{mediaFileId}") { entry ->
            ExperiencePlayerScreen(
                mediaFileId = entry.arguments?.getString("mediaFileId").orEmpty(),
                serverUrl = serverUrl,
                isTelevision = isTelevision,
                playbackQueue = playbackQueue,
                onMovePlayback = viewModel::movePlayback,
                onBack = navController::popBackStack,
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
                onPlay = { mediaFileId, orderedMediaFileIds ->
                    viewModel.startPlayback(mediaFileId, orderedMediaFileIds)
                    navController.navigate("experience-player/${Uri.encode(mediaFileId)}")
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
                null -> ExperienceLoading("Loading downloads")
                false -> ExperienceNotFoundScreen()
                true -> ExperienceDownloadsScreen(serverUrl, accessToken, isTelevision)
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
        ExperienceLoad.Loading -> ExperienceLoading("Preparing home")
        is ExperienceLoad.Failed -> ExperienceFailure(current.message, viewModel::loadHome)
        is ExperienceLoad.Ready -> {
            if (current.value.isEmpty()) {
                ExperienceEmpty("Your library is ready for its first title.")
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
                                onClick = { navController.navigate("experience-detail/${it.id}") },
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
    Column {
        Text(
            listOfNotNull(work.kind.label(), work.genres.firstOrNull()).joinToString(" · ").uppercase(),
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
        work.overview?.takeIf(String::isNotBlank)?.let {
            Text(
                it,
                color = WebInkMuted,
                fontSize = 14.sp,
                lineHeight = 21.sp,
                maxLines = 5,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 20.dp),
            )
        }
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
    onClick: (Work) -> Unit,
    onContext: (Work) -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth().padding(start = if (isTelevision) 46.dp else 16.dp)) {
        Text(rail.title, color = WebInk, fontSize = if (isTelevision) 18.sp else 16.sp, fontWeight = FontWeight.SemiBold)
        Text("${rail.works.size} titles", color = WebInkMuted, fontSize = 10.sp, modifier = Modifier.padding(top = 2.dp))
        LazyRow(
            modifier = Modifier.fillMaxWidth().padding(top = 7.dp),
            contentPadding = PaddingValues(end = 20.dp, top = 6.dp, bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(if (isTelevision) 24.dp else 12.dp),
        ) {
            items(rail.works, key = Work::id) { work ->
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
                    progress = progressByWork[work.id],
                    onSelected = { onSelected(work) },
                    onClick = { onClick(work) },
                    onContext = { onContext(work) },
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
    progress: WatchProgress? = null,
    onSelected: () -> Unit,
    onClick: () -> Unit,
    onContext: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    homeView: PlayarrHomeViewPreference = PlayarrHomeViewPreference.Thumbnail,
) {
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
            progress?.takeIf { it.state != WatchState.Unseen }?.let {
                Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(3.dp).background(Color.White.copy(alpha = 0.28f))) {
                    Box(Modifier.fillMaxWidth(it.fraction).fillMaxHeight().background(WebPink))
                }
            }
        }
        Text(work.title, color = WebInk, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 7.dp))
        Text(work.kind.label(), color = WebInkMuted, fontSize = 10.sp, maxLines = 1)
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
                    work, serverUrl, accessToken, landscapeWidth, work.id == selectedId,
                    progressByWork[work.id], { onSelected(work) }, { onOpen(work) }, { onContext(work) }, Modifier.fillMaxWidth(),
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
        title = { Text("Library filters") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                LibraryFilterChoices("View", LibraryViewMode.entries, viewMode, onViewMode)
                LibraryFilterChoices("Artwork size", LibraryArtworkSize.entries, artworkSize, onArtworkSize)
                LibraryFilterChoices("Sort by", listOf("title", "recent"), sortMode, onSortMode)
                LibraryFilterChoices("Order", listOf(false, true), descending, onDescending, label = { if (it) "Descending" else "Ascending" })
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } },
    )
}

@Composable
private fun <T> LibraryFilterChoices(
    title: String,
    values: List<T>,
    selected: T,
    onSelected: (T) -> Unit,
    label: (T) -> String = { it.toString().replace("CoverFlow", "Cover flow") },
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title.uppercase(), color = WebInkMuted, fontSize = 9.sp, fontWeight = FontWeight.Bold)
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
    LaunchedEffect(kind) { viewModel.loadLibrary(kind) }
    when (val state = states[kind] ?: ExperienceLoad.Loading) {
        ExperienceLoad.Loading -> ExperienceLoading("Loading ${kind.label().lowercase()}")
        is ExperienceLoad.Failed -> ExperienceFailure(state.message) { viewModel.loadLibrary(kind) }
        is ExperienceLoad.Ready -> {
            if (state.value.isEmpty()) {
                ExperienceEmpty("No ${kind.label().lowercase()} are available.")
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
                    Text(kind.label(), color = WebInk, fontSize = if (isTelevision) 28.sp else 22.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(horizontal = if (isTelevision) 32.dp else 16.dp))
                    Text("${state.value.size} titles", color = WebInkMuted, fontSize = 11.sp, modifier = Modifier.padding(horizontal = if (isTelevision) 32.dp else 16.dp, vertical = 4.dp))
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
                ) { Box(contentAlignment = Alignment.Center) { Icon(Icons.Outlined.FilterList, "Filters", tint = WebInkMuted) } }
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
    val playlists by viewModel.searchPlaylists.collectAsState()
    val progress by viewModel.progress.collectAsState()
    val progressByWork = remember(progress) { progress.associateBy(WatchProgress::workId) }
    var query by remember { mutableStateOf("") }
    var mediaFilter by remember { mutableStateOf("all") }
    var filtersOpen by remember { mutableStateOf(false) }
    var contextWork by remember { mutableStateOf<Work?>(null) }
    Column(
        modifier = Modifier.fillMaxSize().background(WebSurface).padding(
            start = if (isTelevision) 72.dp else 16.dp,
            end = if (isTelevision) 72.dp else 16.dp,
            top = if (isTelevision) 92.dp else 72.dp,
        ),
    ) {
        Text("Search", color = WebInk, fontSize = if (isTelevision) 44.sp else 30.sp, fontWeight = FontWeight.Medium, letterSpacing = (-1).sp)
        OutlinedTextField(
            value = query,
            onValueChange = { query = it; viewModel.search(it) },
            modifier = Modifier.fillMaxWidth(if (isTelevision) 0.58f else 1f).padding(top = 18.dp),
            placeholder = { Text("Search your library") },
            leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { viewModel.search(query) }),
            shape = RoundedCornerShape(18.dp),
        )
        OutlinedButton(
            onClick = { filtersOpen = !filtersOpen },
            modifier = Modifier.padding(top = 10.dp),
            shape = RoundedCornerShape(14.dp),
        ) {
            Icon(Icons.Outlined.FilterList, contentDescription = null, modifier = Modifier.size(18.dp))
            Text("Filters · ${mediaFilter.replaceFirstChar(Char::uppercase)}", modifier = Modifier.padding(start = 7.dp))
        }
        if (filtersOpen) {
            LazyRow(
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                items(
                    listOf(
                        "all" to "All",
                        "movie" to "Movies",
                        "series" to "Series",
                        "site" to "Sites",
                        "artist" to "Music",
                        "playlist" to "Playlists",
                    ),
                ) { (value, label) ->
                    OutlinedButton(
                        onClick = { mediaFilter = value },
                        enabled = mediaFilter != value,
                        modifier = Modifier.height(36.dp),
                        contentPadding = PaddingValues(horizontal = 12.dp),
                    ) { Text(label, fontSize = 10.sp) }
                }
            }
        }
        when (val current = state) {
            ExperienceLoad.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = WebPink) }
            is ExperienceLoad.Failed -> ExperienceFailure(current.message) { viewModel.search(query) }
            is ExperienceLoad.Ready -> if (query.isBlank()) {
                Text("Find films, series, sites, and music.", color = WebInkMuted, modifier = Modifier.padding(top = 26.dp))
            } else if (
                current.value.none { mediaFilter == "all" || it.kind.wireName() == mediaFilter } &&
                playlists.none { mediaFilter == "all" || mediaFilter == "playlist" }
            ) {
                Text("No results for ‘$query’.", color = WebInkMuted, modifier = Modifier.padding(top = 26.dp))
            } else {
                val visibleWorks = current.value.filter { mediaFilter == "all" || it.kind.wireName() == mediaFilter }
                val visiblePlaylists = if (mediaFilter == "all" || mediaFilter == "playlist") playlists else emptyList()
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(if (isTelevision) 210.dp else 164.dp),
                    modifier = Modifier.fillMaxSize().padding(top = 22.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                    verticalArrangement = Arrangement.spacedBy(22.dp),
                    contentPadding = PaddingValues(bottom = 104.dp),
                ) {
                    items(visibleWorks, key = { "work:${it.id}" }) { work ->
                        ExperienceLandscapeCard(
                            work, serverUrl, accessToken,
                            width = if (isTelevision) 210.dp else 164.dp,
                            selected = false,
                            progress = progressByWork[work.id],
                            onSelected = {},
                            onClick = { navController.navigate("experience-detail/${work.id}") },
                            onContext = { contextWork = work },
                        )
                    }
                    items(visiblePlaylists, key = { "playlist:${it.id}" }) { playlist ->
                        PlaylistCard(playlist) { navController.navigate("playlists/${playlist.id}") }
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
    fun resolveDownloadCandidates(work: Work, onResolved: (List<DownloadCandidate>) -> Unit) {
        viewModelScope.launch {
            val candidates = when (val result = getWorkDetails(work.id)) {
                is StreamarrResult.Success -> result.value.toDownloadCandidates()
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
    var addToPlaylist by remember(work.id) { mutableStateOf(false) }
    var resolvingDownload by remember(work.id) { mutableStateOf(false) }
    var downloadCandidates by remember(work.id) { mutableStateOf<List<DownloadCandidate>?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(work.title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onOpen, modifier = Modifier.fillMaxWidth()) { Text("Open") }
                OutlinedButton(onClick = { addToPlaylist = true }, modifier = Modifier.fillMaxWidth()) { Text("Add to playlist") }
                if (canDownload) {
                    OutlinedButton(
                        onClick = {
                            resolvingDownload = true
                            viewModel.resolveDownloadCandidates(work) { candidates ->
                                resolvingDownload = false
                                downloadCandidates = candidates
                            }
                        },
                        enabled = !resolvingDownload,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(if (resolvingDownload) "Resolving…" else "Download") }
                }
                OutlinedButton(onClick = { onMark(true) }, modifier = Modifier.fillMaxWidth()) { Text("Mark as watched") }
                OutlinedButton(onClick = { onMark(false) }, modifier = Modifier.fillMaxWidth()) { Text("Mark as unwatched") }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
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
private fun WorkDetail.toDownloadCandidates(): List<DownloadCandidate> {
    val posterUrl = work.images.firstOrNull { it.kind == ImageKind.Poster }?.url
    return when (val tree = children) {
        WorkChildren.Movie -> listOfNotNull(
            mediaFileId?.let { DownloadCandidate(it, work.id, work.title, work.title, posterUrl, "movie") },
        )
        is WorkChildren.Series -> tree.seasons.flatMap { it.episodes }.mapNotNull { episode ->
            episode.mediaFileId?.let {
                DownloadCandidate(it, work.id, episode.episode.title ?: "Episode ${episode.episode.episodeNumber}", work.title, posterUrl, "episode")
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

@HiltViewModel
internal class ExperienceDetailViewModel @Inject constructor(
    private val getWorkDetails: GetWorkDetailsUseCase,
) : ViewModel() {
    private val _state = MutableStateFlow<ExperienceLoad<WorkDetail>>(ExperienceLoad.Loading)
    val state = _state.asStateFlow()

    fun load(id: String) {
        viewModelScope.launch {
            _state.value = ExperienceLoad.Loading
            _state.value = when (val result = getWorkDetails(id)) {
                is StreamarrResult.Success -> ExperienceLoad.Ready(result.value)
                is StreamarrResult.Failure -> ExperienceLoad.Failed(result.error.userMessageForExperience("title"))
            }
        }
    }
}

@Composable
private fun ExperienceDetailScreen(
    workId: String,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    canDownload: Boolean,
    onBack: () -> Unit,
    onPlay: (String, List<String>) -> Unit,
    viewModel: ExperienceDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    LaunchedEffect(workId) { viewModel.load(workId) }
    when (val current = state) {
        ExperienceLoad.Loading -> ExperienceLoading("Loading title")
        is ExperienceLoad.Failed -> ExperienceFailure(current.message) { viewModel.load(workId) }
        is ExperienceLoad.Ready -> {
            val detail = current.value
            val orderedMediaFileIds = remember(detail) { detail.mediaFileIds() }
            val playInContext: (String) -> Unit = { mediaFileId ->
                onPlay(mediaFileId, orderedMediaFileIds)
            }
            var pendingPlaylistTrackId by remember(detail.work.id) { mutableStateOf<String?>(null) }
            var addWorkToPlaylist by remember(detail.work.id) { mutableStateOf(false) }
            var pendingDownloadCandidates by remember(detail.work.id) { mutableStateOf<List<DownloadCandidate>?>(null) }
            Box(Modifier.fillMaxSize().background(WebSurface)) {
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
                    Icon(Icons.Outlined.ArrowBack, contentDescription = "Back", tint = WebInk)
                }
                if (isTelevision) {
                    Box(Modifier.fillMaxWidth(0.38f).fillMaxHeight().padding(start = 154.dp, top = 259.dp, end = 24.dp), contentAlignment = Alignment.TopStart) { FeatureCopy(detail.work, true) }
                    Surface(
                        modifier = Modifier.fillMaxWidth(0.55f).fillMaxHeight(0.62f).align(Alignment.CenterEnd).padding(end = 52.dp),
                        color = WebSurfaceStrong.copy(alpha = 0.88f),
                        shape = RoundedCornerShape(2.dp),
                    ) {
                        DetailChildren(
                            detail, playInContext,
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
                                detail, playInContext,
                                { trackId -> pendingPlaylistTrackId = trackId; addWorkToPlaylist = true },
                                { candidates -> pendingDownloadCandidates = candidates },
                                canDownload,
                                PaddingValues(0.dp), scrollable = false,
                            )
                        }
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
                    title = "Play ${detail.work.title}",
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
            } ?: Text("This title is not available to play.", color = WebInkMuted)
            is WorkChildren.Series -> children.seasons.forEach { season ->
                val seasonCandidates = season.episodes.mapNotNull { episode ->
                    episode.mediaFileId?.let {
                        DownloadCandidate(it, detail.work.id, episode.episode.title ?: "Episode ${episode.episode.episodeNumber}", detail.work.title, posterUrl, "episode")
                    }
                }
                SectionHeaderRow("Season ${season.season.seasonNumber}", if (canDownload) seasonCandidates else emptyList()) { onDownload(it) }
                season.episodes.forEach { episode ->
                    PlayRow(
                        title = episode.episode.title ?: "Episode ${episode.episode.episodeNumber}",
                        available = episode.mediaFileId != null,
                        onAddToPlaylist = { onAddToPlaylist(episode.episode.id) },
                        onDownload = episode.mediaFileId?.takeIf { canDownload }?.let { id ->
                            {
                                onDownload(
                                    listOf(
                                        DownloadCandidate(
                                            id, detail.work.id,
                                            episode.episode.title ?: "Episode ${episode.episode.episodeNumber}",
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
                Icon(Icons.Outlined.Download, contentDescription = "Download all", tint = WebInkMuted)
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
                IconButton(onClick = add) { Icon(Icons.Outlined.Add, contentDescription = "Add to playlist", tint = WebInkMuted) }
            }
            onDownload?.let { download ->
                IconButton(onClick = download) { Icon(Icons.Outlined.Download, contentDescription = "Download", tint = WebInkMuted) }
            }
            Icon(Icons.Outlined.PlayArrow, contentDescription = if (available) "Play" else "Unavailable", tint = if (available) WebPink else WebInkMuted)
        }
    }
}

@HiltViewModel
internal class ExperiencePlayerViewModel @Inject constructor(
    val player: StreamarrPlayer,
    private val getPlaybackInfo: GetPlaybackInfoUseCase,
    private val api: StreamarrApi,
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
                                "Playback failed: ${currentError.message.replace('_', ' ').lowercase()}",
                            )
                        }
                    }
                    previous.isPlaying && !current.isPlaying && !current.isBuffering -> checkpoint()
                }
            }
        }
    }

    fun play(mediaFileId: String, serverUrl: String, defaults: PlayarrPlayerDefaults) {
        viewModelScope.launch {
            if (activeMediaFileId != null) persistProgress(ensureCompletion = true)
            closeActiveSessionAndWait(PlaybackStopReason.UserStopped)
            activeMediaFileId = mediaFileId
            activeServerUrl = serverUrl
            activeDefaults = defaults
            activeSourceOffsetMs = 0L
            activeSourceDurationMs = 0L
            activeOnDemandHls = false
            activePlaybackUrl = ""
            automaticRecoveryUrl = null
            _controls.value = PlayarrPlaybackControls()
            _state.value = ExperienceLoad.Loading
            val resumePosition = runCatching { api.getWatchProgress(mediaFileId) }
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

            val selectedQuality = parsePlayarrQualityDefault(defaults.qualityId)
            _state.value = when (val result = getPlaybackInfo(
                mediaFileId = mediaFileId,
                containers = playarrAndroidContainers,
                videoCodecs = playarrAndroidVideoCodecs,
                audioCodecs = playarrAndroidAudioCodecs,
                profile = selectedQuality.takeUnless { it == "original" },
                forceTranscode = selectedQuality != "original",
                startPositionMs = resumePosition,
            )) {
                is StreamarrResult.Success -> {
                    prepareNegotiatedPlayback(result.value, resumePosition, shouldPlay = true)
                    ExperienceLoad.Ready(Unit)
                }
                is StreamarrResult.Failure -> ExperienceLoad.Failed(result.error.userMessageForExperience("media"))
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
        _controls.value = _controls.value.copy(selectedSubtitleTrackId = trackId, error = null)
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
        viewModelScope.launch {
            val sourcePosition = requestedSourcePositionMs ?: currentSourcePositionMs()
            val shouldPlay = shouldPlayOverride ?: player.state.value.playWhenReady
            persistProgress(ensureCompletion = true)
            player.pause()
            _controls.value = _controls.value.copy(switching = true, error = null)
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
                    val message = result.error.userMessageForExperience("media")
                    _controls.value = _controls.value.copy(switching = false, error = message)
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
        persistProgress(ensureCompletion = true)
        closeActiveSession(PlaybackStopReason.UserStopped)
        player.pause()
    }

    fun togglePlayback() {
        if (player.state.value.playWhenReady) {
            player.pause()
        } else {
            player.play()
        }
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
        withContext(Dispatchers.IO) { sendSessionClosure(closure) }
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
    isTelevision: Boolean,
    playbackQueue: PlayarrPlaybackQueue,
    onMovePlayback: (Int) -> Unit,
    onBack: () -> Unit,
    viewModel: ExperiencePlayerViewModel = hiltViewModel(),
) {
    val activeMediaFileId = playbackQueue.currentMediaFileId ?: mediaFileId
    val playerDefaults = LocalPlayarrDisplayPreferences.current.playerDefaults
    val state by viewModel.state.collectAsState()
    val controls by viewModel.controls.collectAsState()
    val playbackState by viewModel.player.state.collectAsState()
    var timeline by remember(activeMediaFileId) { mutableStateOf(PlayarrPlayerTimeline()) }
    LaunchedEffect(activeMediaFileId, serverUrl) { viewModel.play(activeMediaFileId, serverUrl, playerDefaults) }
    LaunchedEffect(state, activeMediaFileId) {
        if (state !is ExperienceLoad.Ready) return@LaunchedEffect
        while (true) {
            timeline = viewModel.timelineSnapshot()
            kotlinx.coroutines.delay(250)
        }
    }
    LaunchedEffect(state, activeMediaFileId) {
        if (state !is ExperienceLoad.Ready) return@LaunchedEffect
        while (true) {
            kotlinx.coroutines.delay(10_000)
            viewModel.checkpoint()
        }
    }
    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        when (val current = state) {
            ExperienceLoad.Loading -> CircularProgressIndicator(color = WebPink)
            is ExperienceLoad.Failed -> ExperienceFailure(current.message) {
                viewModel.play(activeMediaFileId, serverUrl, playerDefaults)
            }
            is ExperienceLoad.Ready -> androidx.compose.ui.viewinterop.AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { context ->
                    androidx.media3.ui.PlayerView(context).apply {
                        player = viewModel.player.rawPlayer
                        useController = false
                    }
                },
            )
        }
        if (state is ExperienceLoad.Ready) {
            PlayarrPlayerChrome(
                playbackState = playbackState,
                timeline = timeline,
                controls = controls,
                isTelevision = isTelevision,
                canPrevious = playbackQueue.canPrevious,
                canNext = playbackQueue.canNext,
                onPrevious = { onMovePlayback(-1) },
                onNext = { onMovePlayback(1) },
                onBack = { viewModel.stopPlayback(); onBack() },
                onTogglePlayback = viewModel::togglePlayback,
                onSeek = viewModel::seekToSourcePosition,
                onQuality = viewModel::selectQuality,
                onAudio = viewModel::selectAudioTrack,
                onSubtitle = viewModel::selectSubtitleTrack,
            )
        } else {
            IconButton(
                onClick = { viewModel.stopPlayback(); onBack() },
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .windowInsetsPadding(WindowInsets.safeDrawing)
                    .padding(16.dp)
                    .background(Color.Black.copy(alpha = 0.62f), CircleShape),
            ) {
                Icon(Icons.Outlined.ArrowBack, contentDescription = "Back", tint = Color.White)
            }
        }
    }
}

internal fun resolveStreamarrPlaybackUrl(serverUrl: String, playbackUrl: String): String =
    runCatching {
        val base = URI(if (serverUrl.endsWith('/')) serverUrl else "$serverUrl/")
        base.resolve(playbackUrl).toString()
    }.getOrDefault(playbackUrl)

@HiltViewModel
internal class ExperienceSettingsViewModel @Inject constructor(private val tokenStore: TokenStore) : ViewModel() {
    fun signOut() = viewModelScope.launch { tokenStore.clear() }
}

@Composable
private fun ExperienceSettingsScreen(
    serverUrl: String,
    isTelevision: Boolean,
    viewModel: ExperienceSettingsViewModel = hiltViewModel(),
) {
    BoxWithConstraints(Modifier.fillMaxSize().background(WebSurface).windowInsetsPadding(WindowInsets.safeDrawing)) {
        val wide = isTelevision || maxWidth >= 760.dp
        if (wide) {
            Row(Modifier.fillMaxSize().padding(horizontal = 72.dp, vertical = 86.dp), horizontalArrangement = Arrangement.spacedBy(34.dp)) {
                Column(Modifier.width(260.dp)) {
                    Text("Settings", color = WebInk, fontSize = 34.sp, fontWeight = FontWeight.Medium)
                    listOf("Appearance", "Language", "Player", "Server").forEachIndexed { index, label ->
                        Text(
                            "0${index + 1}  $label",
                            color = if (label == "Server") WebInk else WebInkMuted,
                            fontWeight = if (label == "Server") FontWeight.Bold else FontWeight.Normal,
                            modifier = Modifier.fillMaxWidth().padding(top = 24.dp),
                        )
                    }
                }
                SettingsServerCard(serverUrl, viewModel::signOut, Modifier.weight(1f))
            }
        } else {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp, 72.dp, 16.dp, 106.dp)) {
                item { Text("Settings", color = WebInk, fontSize = 30.sp, fontWeight = FontWeight.Medium) }
                item { Spacer(Modifier.height(22.dp)) }
                item { SettingsServerCard(serverUrl, viewModel::signOut, Modifier.fillMaxWidth()) }
            }
        }
    }
}

@Composable
private fun SettingsServerCard(serverUrl: String, onSignOut: () -> Unit, modifier: Modifier = Modifier) {
    Surface(modifier = modifier, color = WebSurfaceStrong, shape = RoundedCornerShape(18.dp), border = androidx.compose.foundation.BorderStroke(1.dp, WebInkMuted.copy(alpha = 0.22f))) {
        Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
            Text("SERVER", color = WebPink, fontSize = 10.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.2.sp)
            Text("Connected server", color = WebInk, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            Text(serverUrl, color = WebInkSoft, fontSize = 13.sp)
            Text("The server address belongs to this account on this device.", color = WebInkMuted, fontSize = 12.sp)
            OutlinedButton(onClick = onSignOut, modifier = Modifier.padding(top = 8.dp)) { Text("Sign out") }
        }
    }
}

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
    val image = kinds.firstNotNullOfOrNull { kind -> work.images.firstOrNull { it.kind == kind } }
    val resolved = image?.url?.let { resolveArtworkUrl(serverUrl, it) }
    if (resolved == null) {
        Box(modifier.background(WebSurfaceSoft), contentAlignment = Alignment.Center) {
            Text(work.title, color = WebInkMuted, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(12.dp))
        }
        return
    }
    val request = remember(resolved, accessToken) {
        ImageRequest.Builder(context)
            .data(resolved)
            .apply {
                if (!accessToken.isNullOrBlank()) {
                    httpHeaders(NetworkHeaders.Builder().set("Authorization", "Bearer $accessToken").build())
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

internal fun resolveArtworkUrl(serverUrl: String, artworkUrl: String): String = runCatching {
    val value = artworkUrl.trim()
    if (value.startsWith("http://") || value.startsWith("https://")) value
    else URI("${serverUrl.trimEnd('/')}/").resolve(value.trimStart('/')).toString()
}.getOrDefault(artworkUrl)

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
internal fun ExperienceFailure(message: String, retry: () -> Unit) {
    Box(Modifier.fillMaxSize().background(WebSurface), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.padding(32.dp)) {
            Text(message, color = MaterialTheme.colorScheme.error)
            Button(onClick = retry) { Text("Try again") }
        }
    }
}

@Composable
internal fun ExperienceEmpty(message: String) {
    Box(Modifier.fillMaxSize().background(WebSurface), contentAlignment = Alignment.Center) {
        Text(message, color = WebInkMuted, modifier = Modifier.padding(32.dp))
    }
}

@Composable
private fun ExperienceNotFoundScreen() {
    Column(
        modifier = Modifier.fillMaxSize().background(WebSurface).padding(48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("404", color = WebPink, fontSize = 68.sp, fontWeight = FontWeight.Bold)
        Text("That page drifted out of range.", color = WebInk, fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
        Text("The address does not match an available Playarr view.", color = WebInkMuted, modifier = Modifier.padding(top = 10.dp))
    }
}

private fun WorkKind.label(): String = when (this) {
    WorkKind.Movie -> "Movies"
    WorkKind.Series -> "Series"
    WorkKind.Site -> "Sites"
    WorkKind.Artist -> "Music"
    WorkKind.Author -> "Books"
}

private fun io.streamarr.shared.domain.model.StreamarrError.userMessageForExperience(subject: String): String = when (this) {
    is io.streamarr.shared.domain.model.StreamarrError.Network -> "Can’t reach the Streamarr server. Check the server address and network."
    is io.streamarr.shared.domain.model.StreamarrError.Http -> when (code) {
        401 -> "Your session has expired. Sign in again."
        403 -> "This account cannot access that $subject."
        404 -> "That $subject could not be found."
        else -> "The server returned error $code."
    }
    is io.streamarr.shared.domain.model.StreamarrError.Unknown -> "Something went wrong loading $subject."
}
