package io.streamarr.mobile.ui

import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Tv
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
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
import io.streamarr.mobile.R
import io.streamarr.shared.auth.TokenStore
import io.streamarr.shared.data.model.ImageKind
import io.streamarr.shared.data.model.Work
import io.streamarr.shared.data.model.WorkChildren
import io.streamarr.shared.data.model.WorkDetail
import io.streamarr.shared.data.model.WorkKind
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.usecase.BrowseLibraryUseCase
import io.streamarr.shared.domain.usecase.GetPlaybackInfoUseCase
import io.streamarr.shared.domain.usecase.GetWorkDetailsUseCase
import io.streamarr.shared.domain.usecase.ListCatalogKindsUseCase
import io.streamarr.shared.domain.usecase.SearchCatalogUseCase
import io.streamarr.shared.player.StreamFormat
import io.streamarr.shared.player.StreamarrPlayer
import java.net.URI
import javax.inject.Inject
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

private val WebBackground = Color(0xFF151315)
private val WebSurface = Color(0xFF1B181B)
private val WebSurfaceStrong = Color(0xFF211D21)
private val WebSurfaceSoft = Color(0xFF312A30)
private val WebInk = Color(0xFFF4F0F1)
private val WebInkSoft = Color(0xFFC5B8BD)
private val WebInkMuted = Color(0xFF887A82)
private val WebPink = Color(0xFFCF3157)

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
) : ViewModel() {
    private val _home = MutableStateFlow<ExperienceLoad<List<HomeRail>>>(ExperienceLoad.Loading)
    val home: StateFlow<ExperienceLoad<List<HomeRail>>> = _home.asStateFlow()

    private val _libraries = MutableStateFlow<Map<WorkKind, ExperienceLoad<List<Work>>>>(emptyMap())
    val libraries: StateFlow<Map<WorkKind, ExperienceLoad<List<Work>>>> = _libraries.asStateFlow()

    private val _search = MutableStateFlow<ExperienceLoad<List<Work>>>(ExperienceLoad.Ready(emptyList()))
    val search: StateFlow<ExperienceLoad<List<Work>>> = _search.asStateFlow()

    private val _availableKinds = MutableStateFlow<Set<WorkKind>?>(null)
    val availableKinds: StateFlow<Set<WorkKind>?> = _availableKinds.asStateFlow()

    val accessToken = tokenStore.accessToken.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    init {
        loadAvailableKinds()
        loadHome()
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
            _home.value = ExperienceLoad.Ready(buildHomeRails(byKind))
        }
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
            return
        }
        viewModelScope.launch {
            _search.value = ExperienceLoad.Loading
            _search.value = when (val result = searchCatalog(normalised, limit = 80)) {
                is StreamarrResult.Success -> ExperienceLoad.Ready(result.value)
                is StreamarrResult.Failure -> ExperienceLoad.Failed(result.error.userMessageForExperience("search"))
            }
        }
    }

    private fun buildHomeRails(byKind: Map<WorkKind, List<Work>>): List<HomeRail> {
        val movies = byKind[WorkKind.Movie].orEmpty()
        val series = byKind[WorkKind.Series].orEmpty()
        val sites = byKind[WorkKind.Site].orEmpty()
        val music = byKind[WorkKind.Artist].orEmpty()
        val recent = (movies + series + sites).sortedByDescending(Work::addedAt)
        return listOf(
            HomeRail("Start watching", recent.take(12)),
            HomeRail("New movies", movies.take(12)),
            HomeRail("New series", series.take(12)),
            HomeRail("New sites", sites.take(12)),
            HomeRail("Music", music.take(12)),
        ).filter { it.works.isNotEmpty() }
    }
}

private data class ExperienceDestination(
    val route: String,
    val label: String,
    val icon: ImageVector,
    val kind: WorkKind? = null,
)

private val experienceDestinations = listOf(
    ExperienceDestination("search", "Search", Icons.Outlined.Search),
    ExperienceDestination("home", "Home", Icons.Outlined.Home),
    ExperienceDestination("series", "Series", Icons.Outlined.Tv, WorkKind.Series),
    ExperienceDestination("movies", "Movies", Icons.Outlined.Movie, WorkKind.Movie),
    ExperienceDestination("sites", "Sites", Icons.Outlined.Language, WorkKind.Site),
    ExperienceDestination("music", "Music", Icons.Outlined.MusicNote, WorkKind.Artist),
)

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
    val availableKinds by viewModel.availableKinds.collectAsState()
    val isPlayer = currentRoute.startsWith("experience-player")

    Box(modifier = Modifier.fillMaxSize().background(WebBackground)) {
        ExperienceNavHost(navController, serverUrl, token, isTelevision, viewModel)

        if (!isPlayer) {
            ExperienceNavigation(
                destinations = experienceDestinations.filter { destination ->
                    destination.kind == null || availableKinds?.contains(destination.kind) == true
                },
                currentRoute = currentRoute,
                isTelevision = isTelevision,
                onNavigate = { navController.openExperienceTopLevel(it) },
                modifier = Modifier.align(Alignment.BottomCenter),
            )
            ProfileControl(
                isTelevision = isTelevision,
                onClick = { navController.openExperienceTopLevel("settings") },
                modifier = Modifier.align(if (isTelevision) Alignment.BottomStart else Alignment.TopEnd),
            )
            if (isTelevision) {
                PlayarrLogo(
                    modifier = Modifier.align(Alignment.TopStart).padding(start = 34.dp, top = 30.dp),
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
private fun ProfileControl(isTelevision: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        onClick = onClick,
        modifier = modifier
            .windowInsetsPadding(if (isTelevision) WindowInsets(0) else WindowInsets.safeDrawing)
            .padding(if (isTelevision) 26.dp else 16.dp)
            .size(42.dp),
        shape = CircleShape,
        color = WebSurfaceStrong.copy(alpha = 0.94f),
        contentColor = WebInkSoft,
        border = androidx.compose.foundation.BorderStroke(1.dp, WebInkMuted.copy(alpha = 0.35f)),
        shadowElevation = 12.dp,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Person, contentDescription = "Profiles and settings", modifier = Modifier.size(22.dp))
        }
    }
}

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
    viewModel: PlayarrExperienceViewModel,
) {
    NavHost(navController, startDestination = "home", modifier = Modifier.fillMaxSize()) {
        composable("home") {
            ExperienceHomeScreen(serverUrl, accessToken, isTelevision, navController, viewModel)
        }
        composable("search") {
            ExperienceSearchScreen(serverUrl, accessToken, isTelevision, navController, viewModel)
        }
        listOf(
            "series" to WorkKind.Series,
            "movies" to WorkKind.Movie,
            "sites" to WorkKind.Site,
            "music" to WorkKind.Artist,
        ).forEach { (route, kind) ->
            composable(route) {
                ExperienceLibraryScreen(kind, serverUrl, accessToken, isTelevision, navController, viewModel)
            }
        }
        composable("experience-detail/{workId}") { entry ->
            ExperienceDetailScreen(
                workId = entry.arguments?.getString("workId").orEmpty(),
                serverUrl = serverUrl,
                accessToken = accessToken,
                isTelevision = isTelevision,
                onBack = navController::popBackStack,
                onPlay = { navController.navigate("experience-player/${Uri.encode(it)}") },
            )
        }
        composable("experience-player/{mediaFileId}") { entry ->
            ExperiencePlayerScreen(
                mediaFileId = entry.arguments?.getString("mediaFileId").orEmpty(),
                onBack = navController::popBackStack,
            )
        }
        composable("settings") { ExperienceSettingsScreen(serverUrl, isTelevision) }
    }
}

@Composable
private fun ExperienceHomeScreen(
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    navController: NavHostController,
    viewModel: PlayarrExperienceViewModel,
) {
    val state by viewModel.home.collectAsState()
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
            val selected = allWorks.firstOrNull { it.id == selectedId } ?: allWorks.first()
            ExperienceStage(
                selected = selected,
                serverUrl = serverUrl,
                accessToken = accessToken,
                isTelevision = isTelevision,
                feature = {
                    FeatureCopy(selected)
                },
                rails = {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(
                            top = if (isTelevision) 210.dp else 68.dp,
                            bottom = if (isTelevision) 120.dp else 98.dp,
                        ),
                        verticalArrangement = Arrangement.spacedBy(if (isTelevision) 30.dp else 16.dp),
                    ) {
                        items(current.value, key = HomeRail::title) { rail ->
                            ExperienceMediaRail(
                                rail = rail,
                                serverUrl = serverUrl,
                                accessToken = accessToken,
                                isTelevision = isTelevision,
                                selectedId = selectedId,
                                onSelected = { selectedId = it.id },
                                onClick = { navController.navigate("experience-detail/${it.id}") },
                            )
                        }
                    }
                },
            )
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
            Box(Modifier.fillMaxWidth(0.38f).fillMaxHeight().padding(start = 64.dp, end = 28.dp), contentAlignment = Alignment.CenterStart) {
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
private fun FeatureCopy(work: Work) {
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
            fontSize = 50.sp,
            fontWeight = FontWeight.Medium,
            letterSpacing = (-2).sp,
            lineHeight = 46.sp,
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
    selectedId: String,
    onSelected: (Work) -> Unit,
    onClick: (Work) -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth().padding(start = if (isTelevision) 24.dp else 16.dp)) {
        Text(rail.title, color = WebInk, fontSize = if (isTelevision) 18.sp else 16.sp, fontWeight = FontWeight.SemiBold)
        Text("${rail.works.size} titles", color = WebInkMuted, fontSize = 10.sp, modifier = Modifier.padding(top = 2.dp))
        LazyRow(
            modifier = Modifier.fillMaxWidth().padding(top = 7.dp),
            contentPadding = PaddingValues(end = 20.dp, top = 6.dp, bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(rail.works, key = Work::id) { work ->
                ExperienceLandscapeCard(
                    work = work,
                    serverUrl = serverUrl,
                    accessToken = accessToken,
                    width = if (isTelevision) 194.dp else 178.dp,
                    selected = selectedId == work.id,
                    onSelected = { onSelected(work) },
                    onClick = { onClick(work) },
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
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.045f else 1f, label = "playarrCardFocus")
    Column(
        modifier = modifier
            .width(width)
            .scale(scale)
            .onFocusChanged { if (it.isFocused) { focused = true; onSelected() } else focused = false }
            .focusable()
            .clickable { onSelected(); onClick() },
    ) {
        AuthenticatedArtwork(
            work = work,
            kinds = listOf(ImageKind.Backdrop, ImageKind.Thumb, ImageKind.Poster),
            serverUrl = serverUrl,
            accessToken = accessToken,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f)
                .clip(RoundedCornerShape(10.dp))
                .background(WebSurfaceSoft)
                .then(if (focused || selected) Modifier.border(1.dp, WebInk.copy(alpha = 0.62f), RoundedCornerShape(10.dp)) else Modifier),
        )
        Text(work.title, color = WebInk, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 7.dp))
        Text(work.kind.label(), color = WebInkMuted, fontSize = 10.sp, maxLines = 1)
    }
}

@Composable
private fun ExperienceLibraryScreen(
    kind: WorkKind,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    navController: NavHostController,
    viewModel: PlayarrExperienceViewModel,
) {
    val states by viewModel.libraries.collectAsState()
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
            val selected = state.value.firstOrNull { it.id == selectedId } ?: state.value.first()
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
                    Box(Modifier.fillMaxWidth(0.35f).fillMaxHeight().padding(start = 64.dp, end = 26.dp), contentAlignment = Alignment.CenterStart) { FeatureCopy(selected) }
                }
                Column(
                    modifier = Modifier
                        .then(if (isTelevision) Modifier.fillMaxWidth(0.65f).fillMaxHeight().align(Alignment.CenterEnd) else Modifier.fillMaxSize())
                        .background(if (isTelevision) WebSurfaceStrong.copy(alpha = 0.93f) else Color.Transparent)
                        .padding(top = if (isTelevision) 76.dp else 18.dp),
                ) {
                    Text(kind.label(), color = WebInk, fontSize = if (isTelevision) 28.sp else 22.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(horizontal = if (isTelevision) 32.dp else 16.dp))
                    Text("${state.value.size} titles", color = WebInkMuted, fontSize = 11.sp, modifier = Modifier.padding(horizontal = if (isTelevision) 32.dp else 16.dp, vertical = 4.dp))
                    LazyVerticalGrid(
                        columns = GridCells.Adaptive(if (isTelevision) 190.dp else 164.dp),
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(start = if (isTelevision) 32.dp else 16.dp, end = 16.dp, top = if (isTelevision) 24.dp else 160.dp, bottom = 104.dp),
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                        verticalArrangement = Arrangement.spacedBy(22.dp),
                    ) {
                        items(state.value, key = Work::id) { work ->
                            ExperienceLandscapeCard(
                                work = work,
                                serverUrl = serverUrl,
                                accessToken = accessToken,
                                width = if (isTelevision) 190.dp else 164.dp,
                                selected = work.id == selectedId,
                                onSelected = { selectedId = work.id },
                                onClick = { navController.navigate("experience-detail/${work.id}") },
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ExperienceSearchScreen(
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    navController: NavHostController,
    viewModel: PlayarrExperienceViewModel,
) {
    val state by viewModel.search.collectAsState()
    var query by remember { mutableStateOf("") }
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
        when (val current = state) {
            ExperienceLoad.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = WebPink) }
            is ExperienceLoad.Failed -> ExperienceFailure(current.message) { viewModel.search(query) }
            is ExperienceLoad.Ready -> if (query.isBlank()) {
                Text("Find films, series, sites, and music.", color = WebInkMuted, modifier = Modifier.padding(top = 26.dp))
            } else if (current.value.isEmpty()) {
                Text("No results for ‘$query’.", color = WebInkMuted, modifier = Modifier.padding(top = 26.dp))
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(if (isTelevision) 210.dp else 164.dp),
                    modifier = Modifier.fillMaxSize().padding(top = 22.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                    verticalArrangement = Arrangement.spacedBy(22.dp),
                    contentPadding = PaddingValues(bottom = 104.dp),
                ) {
                    items(current.value, key = Work::id) { work ->
                        ExperienceLandscapeCard(
                            work, serverUrl, accessToken,
                            width = if (isTelevision) 210.dp else 164.dp,
                            selected = false,
                            onSelected = {},
                            onClick = { navController.navigate("experience-detail/${work.id}") },
                        )
                    }
                }
            }
        }
    }
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
    onBack: () -> Unit,
    onPlay: (String) -> Unit,
    viewModel: ExperienceDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    LaunchedEffect(workId) { viewModel.load(workId) }
    when (val current = state) {
        ExperienceLoad.Loading -> ExperienceLoading("Loading title")
        is ExperienceLoad.Failed -> ExperienceFailure(current.message) { viewModel.load(workId) }
        is ExperienceLoad.Ready -> {
            val detail = current.value
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
                    Box(Modifier.fillMaxWidth(0.38f).fillMaxHeight().padding(start = 64.dp, end = 24.dp), contentAlignment = Alignment.CenterStart) { FeatureCopy(detail.work) }
                    Surface(
                        modifier = Modifier.fillMaxWidth(0.55f).fillMaxHeight(0.62f).align(Alignment.CenterEnd).padding(end = 52.dp),
                        color = WebSurfaceStrong.copy(alpha = 0.88f),
                        shape = RoundedCornerShape(2.dp),
                    ) { DetailChildren(detail, onPlay, PaddingValues(30.dp), scrollable = true) }
                } else {
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 250.dp, bottom = 108.dp)) {
                        item { FeatureCopy(detail.work) }
                        item { Spacer(Modifier.height(22.dp)) }
                        item { DetailChildren(detail, onPlay, PaddingValues(0.dp), scrollable = false) }
                    }
                }
            }
        }
    }
}

@Composable
private fun DetailChildren(
    detail: WorkDetail,
    onPlay: (String) -> Unit,
    padding: PaddingValues,
    scrollable: Boolean,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (scrollable) Modifier.fillMaxHeight().verticalScroll(rememberScrollState()) else Modifier)
            .padding(padding),
        verticalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        when (val children = detail.children) {
            WorkChildren.Movie -> detail.mediaFileId?.let { id ->
                PlayRow("Play ${detail.work.title}", true) { onPlay(id) }
            } ?: Text("This title is not available to play.", color = WebInkMuted)
            is WorkChildren.Series -> children.seasons.forEach { season ->
                Text("Season ${season.season.seasonNumber}", color = WebInk, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 8.dp, bottom = 4.dp))
                season.episodes.forEach { episode ->
                    PlayRow(episode.episode.title ?: "Episode ${episode.episode.episodeNumber}", episode.mediaFileId != null) { episode.mediaFileId?.let(onPlay) }
                }
            }
            is WorkChildren.Artist -> children.albums.forEach { album ->
                Text(album.album.title, color = WebInk, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 8.dp, bottom = 4.dp))
                album.tracks.forEach { track -> PlayRow(track.track.title, track.mediaFileId != null) { track.mediaFileId?.let(onPlay) } }
            }
            is WorkChildren.Author -> children.books.forEach { book -> PlayRow(book.book.title, book.mediaFileId != null) { book.mediaFileId?.let(onPlay) } }
        }
    }
}

@Composable
private fun PlayRow(title: String, available: Boolean, onClick: () -> Unit) {
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
            Icon(Icons.Outlined.PlayArrow, contentDescription = if (available) "Play" else "Unavailable", tint = if (available) WebPink else WebInkMuted)
        }
    }
}

@HiltViewModel
internal class ExperiencePlayerViewModel @Inject constructor(
    val player: StreamarrPlayer,
    private val getPlaybackInfo: GetPlaybackInfoUseCase,
) : ViewModel() {
    private val _state = MutableStateFlow<ExperienceLoad<Unit>>(ExperienceLoad.Loading)
    val state = _state.asStateFlow()

    fun play(mediaFileId: String) {
        viewModelScope.launch {
            _state.value = ExperienceLoad.Loading
            _state.value = when (val result = getPlaybackInfo(mediaFileId)) {
                is StreamarrResult.Success -> {
                    player.prepare(result.value.url, if (result.value.mode == io.streamarr.shared.data.model.PlaybackMode.Hls) StreamFormat.Hls else StreamFormat.Direct)
                    player.play()
                    ExperienceLoad.Ready(Unit)
                }
                is StreamarrResult.Failure -> ExperienceLoad.Failed(result.error.userMessageForExperience("media"))
            }
        }
    }

    override fun onCleared() {
        player.pause()
    }
}

@Composable
private fun ExperiencePlayerScreen(
    mediaFileId: String,
    onBack: () -> Unit,
    viewModel: ExperiencePlayerViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    LaunchedEffect(mediaFileId) { viewModel.play(mediaFileId) }
    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        when (val current = state) {
            ExperienceLoad.Loading -> CircularProgressIndicator(color = WebPink)
            is ExperienceLoad.Failed -> ExperienceFailure(current.message) { viewModel.play(mediaFileId) }
            is ExperienceLoad.Ready -> androidx.compose.ui.viewinterop.AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { context -> androidx.media3.ui.PlayerView(context).apply { player = viewModel.player.rawPlayer; useController = true } },
            )
        }
        IconButton(onClick = onBack, modifier = Modifier.align(Alignment.TopStart).windowInsetsPadding(WindowInsets.safeDrawing).padding(16.dp).background(Color.Black.copy(alpha = 0.55f), CircleShape)) {
            Icon(Icons.Outlined.ArrowBack, contentDescription = "Back", tint = Color.White)
        }
    }
}

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
private fun AuthenticatedArtwork(
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

@Composable
private fun ExperienceLoading(label: String) {
    Box(Modifier.fillMaxSize().background(WebSurface), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) {
            PlayarrLogo()
            CircularProgressIndicator(color = WebPink)
            Text(label, color = WebInkMuted, fontSize = 12.sp)
        }
    }
}

@Composable
private fun ExperienceFailure(message: String, retry: () -> Unit) {
    Box(Modifier.fillMaxSize().background(WebSurface), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.padding(32.dp)) {
            Text(message, color = MaterialTheme.colorScheme.error)
            Button(onClick = retry) { Text("Try again") }
        }
    }
}

@Composable
private fun ExperienceEmpty(message: String) {
    Box(Modifier.fillMaxSize().background(WebSurface), contentAlignment = Alignment.Center) {
        Text(message, color = WebInkMuted, modifier = Modifier.padding(32.dp))
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
