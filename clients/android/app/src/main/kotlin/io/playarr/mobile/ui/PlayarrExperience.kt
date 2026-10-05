package io.playarr.mobile.ui

import io.playarr.shared.designsystem.component.PlayarrButton
import io.playarr.shared.designsystem.component.PlayarrButtonVariant
import io.playarr.shared.designsystem.component.PlayarrIconButton
import android.util.Log
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import io.playarr.shared.designsystem.theme.FocusMotion
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
import androidx.compose.foundation.lazy.grid.GridItemSpan
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
import androidx.compose.material.icons.outlined.Bookmark
import androidx.compose.material.icons.outlined.CastConnected
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.PictureInPictureAlt
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Tv
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
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
import androidx.navigation.navDeepLink
import coil3.compose.AsyncImage
import coil3.network.NetworkHeaders
import coil3.network.httpHeaders
import coil3.request.ImageRequest
import coil3.request.allowHardware
import coil3.toBitmap
import dagger.hilt.android.lifecycle.HiltViewModel
import io.playarr.mobile.BuildConfig
import io.playarr.mobile.R
import io.playarr.mobile.cast.PlayarrCastAuthRotatedMessage
import io.playarr.mobile.cast.PlayarrCastConnectionState
import io.playarr.mobile.cast.PlayarrCastCredentials
import io.playarr.mobile.cast.PlayarrCastEndSessionMessage
import io.playarr.mobile.cast.PlayarrCastItem
import io.playarr.mobile.cast.PlayarrCastItemKind
import io.playarr.mobile.cast.PlayarrCastLoadRequest
import io.playarr.mobile.cast.PlayarrCastPlaybackIntent
import io.playarr.mobile.cast.PlayarrCastQueueEntry
import io.playarr.mobile.cast.PlayarrCastRoute
import io.playarr.mobile.cast.PlayarrCastSelectQualityMessage
import io.playarr.mobile.cast.PlayarrCastSelectTracksMessage
import io.playarr.mobile.cast.PlayarrCastSender
import io.playarr.mobile.cast.PlayarrCastSenderPlatform
import io.playarr.mobile.cast.PlayarrCastServer
import io.playarr.mobile.cast.PlayarrCastSession
import io.playarr.mobile.cast.PlayarrCastStateMessage
import io.playarr.mobile.cast.PlayarrCastStopReason
import io.playarr.mobile.cast.PlayarrDelegatedDeviceAuth
import io.playarr.mobile.cast.shouldOfferPlayarrCast
import io.playarr.mobile.connected.PlayarrWorkSourceChoice
import io.playarr.mobile.connected.PlayarrWorkSourceSelector
import io.playarr.shared.auth.TokenStore
import io.playarr.shared.data.events.LiveArea
import io.playarr.shared.data.events.LiveFetchStamp
import io.playarr.shared.data.events.LiveInvalidationBus
import io.playarr.shared.data.events.LiveTarget
import io.playarr.shared.data.model.AlbumDetail
import io.playarr.shared.data.model.CreditResponse
import io.playarr.shared.data.model.EpisodeDetail
import io.playarr.shared.data.model.ImageKind
import io.playarr.shared.data.model.MediaChapter
import io.playarr.shared.data.model.MediaMetadata
import io.playarr.shared.data.model.MediaPlaybackOptionsResponse
import io.playarr.shared.data.model.Playlist
import io.playarr.shared.data.model.PlaybackEventRequest
import io.playarr.shared.data.model.PlaybackInfoResponse
import io.playarr.shared.data.model.PlaybackStopReason
import io.playarr.shared.data.model.ProfileAvatarPreference
import io.playarr.shared.data.model.SeasonDetail
import io.playarr.shared.data.model.TrackDetail
import io.playarr.shared.data.model.LanguageFacetEntry
import io.playarr.shared.data.model.LanguageFacets
import io.playarr.shared.data.model.HomeRailDto
import io.playarr.shared.data.model.RailPreferenceEntry
import io.playarr.shared.data.model.RailPreferencesRequest
import io.playarr.shared.data.model.Work
import io.playarr.shared.data.model.WorkChildren
import io.playarr.shared.data.model.WorkDetail
import io.playarr.shared.data.model.WorkKind
import io.playarr.shared.data.model.WorkCreditsResponse
import io.playarr.shared.data.model.ResumePlan
import io.playarr.shared.data.model.WatchProgress
import io.playarr.shared.data.model.WatchState
import io.playarr.shared.data.model.UpdateMediaPlaybackPreferencesRequest
import io.playarr.shared.data.model.UpdateWatchProgressRequest
import io.playarr.shared.data.model.ViewSummary
import io.playarr.shared.data.model.wireName
import io.playarr.shared.data.remote.PlayarrApi
import io.playarr.shared.data.remote.PlayarrServerAccess
import io.playarr.shared.data.remote.PlayarrServerAccessResolver
import io.playarr.shared.domain.model.PlayarrResult
import io.playarr.shared.domain.usecase.BrowseLibraryUseCase
import io.playarr.shared.domain.usecase.GetPlaybackInfoUseCase
import io.playarr.shared.domain.usecase.GetWorkDetailsUseCase
import io.playarr.shared.domain.usecase.ListCatalogKindsUseCase
import io.playarr.shared.domain.usecase.SearchCatalogUseCase
import io.playarr.shared.download.DownloadCandidate
import io.playarr.shared.download.DownloadRepository
import io.playarr.shared.download.OfflineProgressRepository
import io.playarr.shared.player.StreamFormat
import io.playarr.shared.player.PlaybackState
import io.playarr.shared.player.PlayarrPlayer
import io.playarr.shared.player.PlayarrSubtitleTrack
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
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
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

/** Whether the active Playarr palette is the dark one (drives the key-art filter and glass border tokens). */
internal var webIsDark: Boolean = true
    private set

internal fun setPlayarrWebPalette(darkTheme: Boolean) {
    webPalette = if (darkTheme) darkWebPalette else lightWebPalette
    webIsDark = darkTheme
}

/** Cubic-bezier matching Playarr Web `focusMotion.transitionEasing`. */
private val PlayarrFocusEasing = CubicBezierEasing(
    FocusMotion.easingControlPoints[0],
    FocusMotion.easingControlPoints[1],
    FocusMotion.easingControlPoints[2],
    FocusMotion.easingControlPoints[3],
)

/**
 * Animated focus scale driven by [FocusMotion] tokens so television tiles
 * grow with the same duration/easing as Playarr Web rather than snapping.
 */
@Composable
internal fun rememberPlayarrFocusScale(
    focused: Boolean,
    focusedScale: Float = FocusMotion.tileFocusScale,
    unfocusedScale: Float = FocusMotion.restScale,
    label: String = "playarrFocusScale",
): Float {
    val scale by animateFloatAsState(
        targetValue = if (focused) focusedScale else unfocusedScale,
        animationSpec = tween(
            durationMillis = FocusMotion.transitionMs,
            easing = PlayarrFocusEasing,
        ),
        label = label,
    )
    return scale
}

internal val WebBackground get() = webPalette.background
internal val WebSurface get() = webPalette.surface
internal val WebSurfaceStrong get() = webPalette.surfaceStrong
internal val WebSurfaceSoft get() = webPalette.surfaceSoft
internal val WebInk get() = webPalette.ink
internal val WebInkSoft get() = webPalette.inkSoft
internal val WebInkMuted get() = webPalette.inkMuted
internal val WebPink get() = webPalette.accent

/** Web kicker / eyebrow accent (`#cf3157`), distinct from the neutral palette accent. */
internal val WebKicker = Color(0xFFCF3157)

/** Fraction-sized hero backdrop pinned top-start: `fillMaxSize()` first would make the later fraction a no-op. */
internal fun Modifier.heroBackdrop(isTelevision: Boolean, tvWidthFraction: Float, phoneHeightFraction: Float): Modifier =
    (if (isTelevision) fillMaxHeight().fillMaxWidth(tvWidthFraction) else fillMaxWidth().fillMaxHeight(phoneHeightFraction))
        .heroBackdropFade(isTelevision)

/** Fraction of the backdrop, from its leading edge, kept fully opaque before the trailing fade (web `.tv-key-art img` mask: 72%). */
internal const val HERO_BACKDROP_FADE_START = 0.65f

/** Fades the trailing edge (end on TV, bottom on phone) to transparent so the artwork dissolves into the surface with no seam. */
private fun Modifier.heroBackdropFade(isTelevision: Boolean): Modifier =
    graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
        .drawWithContent {
            drawContent()
            val stops = arrayOf(0f to Color.Black, HERO_BACKDROP_FADE_START to Color.Black, 1f to Color.Transparent)
            drawRect(
                brush = if (isTelevision) Brush.horizontalGradient(colorStops = stops) else Brush.verticalGradient(colorStops = stops),
                blendMode = BlendMode.DstIn,
            )
        }

/**
 * Scrim laid over listing/detail hero artwork. The copy column sits over the
 * strongest stops so Ink Soft text clears WCAG AA (>= 4.5:1) over the filtered
 * artwork's worst-case pixel in both themes (see [heroScrimWorstCaseContrast]).
 */
internal const val HERO_SCRIM_TEXT_ALPHA = 0.70f

@Composable
internal fun heroScrimBrush(isTelevision: Boolean): Brush {
    val surface = WebSurface
    return if (isTelevision) {
        Brush.horizontalGradient(
            0f to surface.copy(alpha = 0.90f),
            0.15f to surface.copy(alpha = HERO_SCRIM_TEXT_ALPHA),
            0.45f to surface.copy(alpha = HERO_SCRIM_TEXT_ALPHA),
            0.60f to surface.copy(alpha = 0.92f),
            1f to surface,
        )
    } else {
        Brush.verticalGradient(
            0f to surface.copy(alpha = 0.30f),
            0.30f to surface.copy(alpha = 0.55f),
            0.45f to surface.copy(alpha = HERO_SCRIM_TEXT_ALPHA),
            0.60f to surface.copy(alpha = 0.95f),
            1f to surface,
        )
    }
}

/**
 * Worst-case contrast of [text] over hero artwork behind a [surface] scrim of
 * [alpha]. Artwork is always drawn through the key-art filter and opacity
 * (see [heroArtFilter]), so the extreme backdrop pixels are the filtered
 * pure-white and pure-black values composited over [surface]; the lower of the
 * two contrast ratios is returned.
 */
internal fun heroScrimWorstCaseContrast(text: Color, surface: Color, alpha: Float, dark: Boolean): Float {
    fun lin(c: Float) = if (c <= 0.03928f) c / 12.92f else Math.pow(((c + 0.055f) / 1.055f).toDouble(), 2.4).toFloat()
    fun lum(c: Color) = 0.2126f * lin(c.red) + 0.7152f * lin(c.green) + 0.0722f * lin(c.blue)
    val contrast = if (dark) WebGlass.ART_CONTRAST_DARK else WebGlass.ART_CONTRAST_LIGHT
    val brightness = if (dark) WebGlass.ART_BRIGHTNESS_DARK else WebGlass.ART_BRIGHTNESS_LIGHT
    val artAlpha = heroArtOpacity(dark)
    return listOf(0f, 1f).minOf { pixel ->
        val art = heroArtFilteredPixelValue(pixel, contrast, brightness)
        fun channel(surfaceChannel: Float): Float {
            val withArt = art * artAlpha + surfaceChannel * (1f - artAlpha)
            return surfaceChannel * alpha + withArt * (1f - alpha)
        }
        val bg = Color(channel(surface.red), channel(surface.green), channel(surface.blue))
        val a = lum(text) + 0.05f
        val b = lum(bg) + 0.05f
        maxOf(a, b) / minOf(a, b)
    }
}

private fun heroArtFilteredPixelValue(gray: Float, contrast: Float, brightness: Float) = heroArtFilteredGray(gray, contrast, brightness)

/** Ghost button for use over hero artwork: opaque-enough fill and Ink content so it never depends on the backdrop. */
@Composable
internal fun HeroOutlinedButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit,
) {
    PlayarrButton(
        onClick = onClick,
        modifier = modifier,
        variant = PlayarrButtonVariant.Secondary,
        containerColor = WebSurfaceStrong.copy(alpha = 0.88f),
        contentColor = WebInk,
        content = content,
    )
}

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
    private val api: PlayarrApi,
    val serverAccessResolver: PlayarrServerAccessResolver,
    val remoteController: io.playarr.mobile.remote.RemoteController,
    val liveBus: LiveInvalidationBus,
) : ViewModel() {
    private val homeStamp = LiveFetchStamp()
    private val libraryStamps = mutableMapOf<WorkKind, LiveFetchStamp>()
    private val progressStamp = LiveFetchStamp()
    private val searchStamp = LiveFetchStamp()
    private var homeRefreshJob: Job? = null
    private var searchRefreshJob: Job? = null
    private var lastSearch: SearchArgs? = null

    private data class SearchArgs(val query: String, val mediaType: PlayarrSearchMediaType, val libraryId: String?)

    /** Start of the latest Home fetch (`0` before the first); lets live events skip data already fetched. */
    val homeFetchStartedMs: Long get() = homeStamp.startedMs
    val progressFetchStartedMs: Long get() = progressStamp.startedMs
    val searchFetchStartedMs: Long get() = searchStamp.startedMs
    fun libraryFetchStartedMs(kind: WorkKind): Long = libraryStamps[kind]?.startedMs ?: 0L

    private val _home = MutableStateFlow<ExperienceLoad<List<HomeRail>>>(ExperienceLoad.Loading)
    val home: StateFlow<ExperienceLoad<List<HomeRail>>> = _home.asStateFlow()
    private var homeByKind: Map<WorkKind, List<Work>> = emptyMap()
    private var homeOnDeck: List<PlayarrOnDeckEntry> = emptyList()
    private var serverRails: List<HomeRailDto> = emptyList()
    private var railLanguage = "en"
    private val _railPreferences = MutableStateFlow<List<RailPreferenceEntry>?>(null)
    val railPreferences: StateFlow<List<RailPreferenceEntry>?> = _railPreferences.asStateFlow()

    /** The rails the server computed for the current app language (empty on failure or an older server). */
    private suspend fun fetchServerRails(): List<HomeRailDto> =
        runCatching { api.homeRails(railLanguage).rails }.getOrDefault(emptyList())

    /** Re-titles the server rails when the app language changes. */
    fun setRailLanguage(code: String) {
        if (code == railLanguage) return
        railLanguage = code
        if (_home.value !is ExperienceLoad.Ready) return
        viewModelScope.launch {
            serverRails = fetchServerRails()
            _home.value = ExperienceLoad.Ready(buildPlayarrHomeRails(homeByKind, homeOnDeck, serverRails))
        }
    }

    fun loadRailPreferences() {
        viewModelScope.launch {
            _railPreferences.value = runCatching { api.railPreferences(railLanguage).rails }.getOrNull()
        }
    }

    /** Saves the customised order and hidden set, then refreshes Home. [rails] is the full list in order. */
    fun saveRailPreferences(rails: List<RailPreferenceEntry>) {
        viewModelScope.launch {
            val saved = runCatching {
                api.saveRailPreferences(
                    RailPreferencesRequest(
                        order = rails.map(RailPreferenceEntry::id),
                        hidden = rails.filter(RailPreferenceEntry::hidden).map(RailPreferenceEntry::id),
                    ),
                )
            }.getOrNull()
            if (saved != null) {
                _railPreferences.value = saved.rails
                refreshServerRails()
            }
        }
    }

    fun resetRailPreferences() {
        viewModelScope.launch {
            if (runCatching { api.resetRailPreferences() }.isSuccess) {
                _railPreferences.value = runCatching { api.railPreferences(railLanguage).rails }.getOrNull()
                refreshServerRails()
            }
        }
    }

    private suspend fun refreshServerRails() {
        serverRails = fetchServerRails()
        if (_home.value is ExperienceLoad.Ready) {
            _home.value = ExperienceLoad.Ready(buildPlayarrHomeRails(homeByKind, homeOnDeck, serverRails))
        }
    }

    private val libraryJobs = mutableMapOf<WorkKind, Job>()
    private var languageJob: Job? = null
    private var facetsJob: Job? = null

    private val _libraries = MutableStateFlow<Map<WorkKind, ExperienceLoad<List<Work>>>>(emptyMap())
    val libraries: StateFlow<Map<WorkKind, ExperienceLoad<List<Work>>>> = _libraries.asStateFlow()

    // Audio/subtitle language filters per library (task 183). The matching work
    // ids come from the server (`audio_lang`/`subtitle_lang`); the full library
    // list stays cached and is narrowed to these ids on screen.
    private val _languageSelections = MutableStateFlow<Map<WorkKind, LanguageSelection>>(emptyMap())
    val languageSelections: StateFlow<Map<WorkKind, LanguageSelection>> = _languageSelections.asStateFlow()
    private val _languageMatches = MutableStateFlow<Map<WorkKind, Set<String>>>(emptyMap())
    val languageMatches: StateFlow<Map<WorkKind, Set<String>>> = _languageMatches.asStateFlow()
    private val _languageFacets = MutableStateFlow<LanguageFacets?>(null)
    val languageFacets: StateFlow<LanguageFacets?> = _languageFacets.asStateFlow()

    fun setLanguageSelection(kind: WorkKind, selection: LanguageSelection) {
        _languageSelections.value = _languageSelections.value + (kind to selection)
        languageJob?.cancel()
        if (selection.isEmpty) {
            _languageMatches.value = _languageMatches.value - kind
        } else {
            languageJob = viewModelScope.launch {
                runCatching {
                    val ids = mutableSetOf<String>()
                    var offset = 0L
                    while (true) {
                        val page = api.browseCatalog(
                            kind = kind.wireName(),
                            availableOnly = true,
                            limit = LIBRARY_PAGE_SIZE.toLong(),
                            offset = offset,
                            audioLang = selection.audioParam,
                            subtitleLang = selection.subtitleParam,
                        )
                        ids += page.items.map { it.id }
                        offset += page.items.size
                        if (page.items.size < LIBRARY_PAGE_SIZE) break
                    }
                    ids
                }.onSuccess { _languageMatches.value = _languageMatches.value + (kind to it) }
            }
        }
        loadLanguageFacets(kind, selection)
    }

    /** Available languages for [kind] given the other active filters. */
    fun loadLanguageFacets(kind: WorkKind, selection: LanguageSelection) {
        facetsJob?.cancel()
        facetsJob = viewModelScope.launch {
            _languageFacets.value = runCatching {
                api.catalogLanguages(
                    kind = kind.wireName(),
                    availableOnly = true,
                    audioLang = selection.audioParam,
                    subtitleLang = selection.subtitleParam,
                )
            }.getOrNull()
        }
    }

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

    private val _hasFolders = MutableStateFlow(false)

    /** Whether at least one unsorted-folders root is browsable by this account (shows the Folders destination). */
    val hasFolders: StateFlow<Boolean> = _hasFolders.asStateFlow()

    private val _canDownload = MutableStateFlow<Boolean?>(null)
    val canDownload: StateFlow<Boolean?> = _canDownload.asStateFlow()

    private val _household = MutableStateFlow<io.playarr.shared.data.model.HouseholdStatus?>(null)

    /** The server's household state for the signed-in profile; `null` until known. */
    val household: StateFlow<io.playarr.shared.data.model.HouseholdStatus?> = _household.asStateFlow()

    /**
     * Re-reads the household state. A failed read keeps the last value: the
     * server enforces regardless, this only lets the app say "not right now"
     * before a request fails.
     */
    fun refreshHousehold() {
        viewModelScope.launch {
            runCatching { api.getHouseholdStatus() }.onSuccess { _household.value = it }
        }
    }

    fun clearHousehold() {
        _household.value = null
    }

    /** Asks a guardian for more time; `true` when the request was recorded. */
    suspend fun askGuardian(subject: String): Boolean = runCatching {
        api.createHouseholdApproval(
            io.playarr.shared.data.model.CreateHouseholdApprovalRequest(kind = "time", subject = subject),
        )
    }.isSuccess

    private val _progress = MutableStateFlow<List<WatchProgress>>(emptyList())
    val progress: StateFlow<List<WatchProgress>> = _progress.asStateFlow()

    private val _progressLoaded = MutableStateFlow(false)
    val progressLoaded: StateFlow<Boolean> = _progressLoaded.asStateFlow()

    /** Fetches watch progress once so library cards can show the unwatched dot without visiting Home first. */
    fun ensureProgressLoaded() {
        if (_progressLoaded.value) return
        refreshProgress()
    }

    /** Re-reads watch progress in place; a failed read keeps the rows already shown. */
    fun refreshProgress() {
        viewModelScope.launch {
            progressStamp.begin()
            runCatching { api.listWatchProgress() }.getOrNull()?.let {
                _progress.value = it
                _progressLoaded.value = true
            }
        }
    }

    val profileAvatar: StateFlow<ProfileAvatarPreference?> = tokenStore.currentProfileAvatar
        .map { it?.toPlayarrProfileAvatarPreference() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

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
        // Cheap, account-wide state refreshes in place whenever the server says it moved
        // (watched state from another device, household and capability edits).
        viewModelScope.launch {
            liveBus.refetchTriggers(setOf(LiveTarget(LiveArea.Progress))) { progressStamp.startedMs }
                .collect { if (_progressLoaded.value) refreshProgress() }
        }
        viewModelScope.launch {
            liveBus.refetchTriggers(setOf(LiveTarget(LiveArea.Household), LiveTarget(LiveArea.Account))) { 0L }
                .collect {
                    if (_household.value != null) refreshHousehold()
                    refreshCapabilities()
                }
        }
    }

    private fun loadAvailableKinds() {
        viewModelScope.launch {
            _hasFolders.value = runCatching { api.listFolderRoots().roots.isNotEmpty() }.getOrDefault(false)
        }
        viewModelScope.launch {
            _availableKinds.value = when (val result = listCatalogKinds()) {
                is PlayarrResult.Success -> result.value.toSet()
                is PlayarrResult.Failure -> emptySet()
            }
        }
    }

    fun loadHome() {
        launchHome(silent = false)
    }

    /** Live-event / fallback refresh: rebuilds the rails in place, keeping the current ones until the new arrive. */
    fun refreshHome() {
        homeRefreshJob?.cancel()
        homeRefreshJob = launchHome(silent = true)
    }

    private fun launchHome(silent: Boolean): Job {
        return viewModelScope.launch {
            homeStamp.begin()
            if (!silent) _home.value = ExperienceLoad.Loading
            val progressRequest = async { runCatching { api.listWatchProgress() }.getOrNull() }
            // Series with several ways to continue are shown as a stacked card (ask on Home).
            val plansRequest = async {
                runCatching { api.listResumePlans() }.getOrDefault(emptyList()).filter { it.isStacked }
            }
            val railsRequest = async { fetchServerRails() }
            val kinds = listOf(WorkKind.Movie, WorkKind.Series, WorkKind.Site)
            val results = kinds.map { kind ->
                async { kind to browseLibrary(kind = kind, availableOnly = true, sort = "recent", limit = 36) }
            }.awaitAll()
            val failure = results.firstNotNullOfOrNull { (_, result) ->
                (result as? PlayarrResult.Failure)?.error
            }
            if (silent && (results.any { it.second is PlayarrResult.Failure } || progressRequest.await() == null)) {
                return@launch
            }
            if (failure != null && results.all { it.second is PlayarrResult.Failure }) {
                _home.value = ExperienceLoad.Failed(
                    failure.userMessageForExperience(PlayarrString.ErrorSubjectHome),
                )
                return@launch
            }
            val byKind = results.associate { (kind, result) ->
                kind to ((result as? PlayarrResult.Success)?.value ?: emptyList())
            }
            val progressRows = progressRequest.await()
            val progress = progressRows ?: emptyList()
            val stackedPlans = plansRequest.await().associateBy(ResumePlan::seriesWorkId)
            val resumableRows = progress
                .asSequence()
                .filter { it.state == WatchState.PartWatched }
                .sortedByDescending { it.updatedAt.orEmpty() }
                .distinctBy(WatchProgress::workId)
                .take(10)
                .toList()
            val fromRows = resumableRows.map { row ->
                async {
                    runCatching { api.getWork(row.workId) }
                        .getOrNull()
                        ?.let { resolvePlayarrOnDeckEntry(it, row, stackedPlans[row.workId]) }
                }
            }
            // Series that need a choice but have no part-watched episode still belong here.
            val rowWorkIds = resumableRows.mapTo(mutableSetOf(), WatchProgress::workId)
            val fromPlans = stackedPlans.values
                .filter { it.seriesWorkId !in rowWorkIds }
                .take((10 - resumableRows.size).coerceAtLeast(0))
                .map { plan ->
                    async {
                        runCatching { api.getWork(plan.seriesWorkId) }
                            .getOrNull()
                            ?.let { resolvePlayarrOnDeckEntry(it, null, plan) }
                    }
                }
            val onDeck = (fromRows + fromPlans).awaitAll().filterNotNull()
            _progress.value = progress
            if (progressRows != null) _progressLoaded.value = true
            homeByKind = byKind
            homeOnDeck = onDeck
            serverRails = railsRequest.await()
            _home.value = ExperienceLoad.Ready(buildPlayarrHomeRails(byKind, onDeck, serverRails))
        }
    }

    fun reloadForProfile() {
        libraryJobs.values.forEach(Job::cancel)
        libraryJobs.clear()
        _availableKinds.value = null
        _canDownload.value = null
        _libraries.value = emptyMap()
        _languageSelections.value = emptyMap()
        _languageMatches.value = emptyMap()
        _languageFacets.value = null
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
        viewModelScope.launch {
            val preference = runCatching { api.getProfileAvatar().preference }.getOrNull() ?: return@launch
            val serverUrl = tokenStore.currentServerUrl.first() ?: return@launch
            val userId = tokenStore.currentUserId.first() ?: return@launch
            tokenStore.saveProfileAvatar(serverUrl, userId, preference.toSavedProfileAvatar())
        }
    }

    private suspend fun refreshCapabilities() {
        _canDownload.value = runCatching { api.getSelfCapabilities().canDownload }.getOrDefault(false)
    }

    /**
     * Re-pages [kind] in place and swaps the list in one step, so the visible
     * list (and its scroll position and focus) is untouched until the new data is complete.
     */
    fun refreshLibrary(kind: WorkKind) {
        if (_libraries.value[kind] !is ExperienceLoad.Ready) return loadLibrary(kind)
        libraryJobs.remove(kind)?.cancel()
        libraryJobs[kind] = viewModelScope.launch {
            libraryStamps.getOrPut(kind) { LiveFetchStamp() }.begin()
            var offset = 0L
            var loaded = emptyList<Work>()
            while (true) {
                val result = browseLibrary(
                    kind = kind,
                    availableOnly = true,
                    sort = "title",
                    limit = LIBRARY_PAGE_SIZE,
                    offset = offset,
                )
                if (result !is PlayarrResult.Success) return@launch
                loaded = mergeLibraryPage(loaded, result.value)
                offset += result.value.size
                if (result.value.size < LIBRARY_PAGE_SIZE) break
            }
            _libraries.value = _libraries.value + (kind to ExperienceLoad.Ready(loaded))
        }
    }

    fun loadLibrary(kind: WorkKind) {
        if (_libraries.value[kind] is ExperienceLoad.Ready) return
        libraryJobs.remove(kind)?.cancel()
        libraryStamps.getOrPut(kind) { LiveFetchStamp() }.begin()
        libraryJobs[kind] = viewModelScope.launch {
            _libraries.value = _libraries.value + (kind to ExperienceLoad.Loading)
            // Page through the whole catalogue as Playarr Web does (200 per
            // request): the first page is shown immediately and later pages
            // are appended while the viewer browses.
            var offset = 0L
            var loaded = emptyList<Work>()
            while (true) {
                val result = browseLibrary(
                    kind = kind,
                    availableOnly = true,
                    sort = "title",
                    limit = LIBRARY_PAGE_SIZE,
                    offset = offset,
                )
                when (result) {
                    is PlayarrResult.Success -> {
                        val page = result.value
                        loaded = mergeLibraryPage(loaded, page)
                        _libraries.value = _libraries.value + (kind to ExperienceLoad.Ready(loaded))
                        offset += page.size
                        if (page.size < LIBRARY_PAGE_SIZE) break
                    }
                    is PlayarrResult.Failure -> {
                        // Keep whatever has loaded; only a failed first page is an error.
                        if (loaded.isEmpty()) {
                            _libraries.value = _libraries.value + (
                                kind to ExperienceLoad.Failed(
                                    result.error.userMessageForExperience(kind.playarrPluralKey()),
                                )
                                )
                        }
                        break
                    }
                }
            }
        }
    }

    fun prepareSearch() {
        viewModelScope.launch {
            _searchViews.value = runCatching { api.listViews() }.getOrDefault(emptyList())
        }
        // Warm the availability index as soon as Search opens (Playarr Web does the
        // same) so the first query does not wait on a full catalogue crawl.
        viewModelScope.launch {
            try {
                loadAvailableSearchWorkIds()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Throwable) {
                // The query path retries and reports failures itself.
            }
        }
    }

    fun search(
        query: String,
        mediaType: PlayarrSearchMediaType = PlayarrSearchMediaType.All,
        libraryId: String? = null,
        debounce: Boolean = true,
    ) {
        searchJob?.cancel()
        searchRefreshJob?.cancel()
        val normalised = query.trim()
        lastSearch = SearchArgs(normalised, mediaType, libraryId).takeIf { normalised.isNotEmpty() }
        if (normalised.isEmpty()) {
            _search.value = ExperienceLoad.Ready(PlayarrSearchResults())
            return
        }
        searchJob = viewModelScope.launch {
            if (debounce) delay(SEARCH_DEBOUNCE_MS)
            searchStamp.begin()
            _search.value = ExperienceLoad.Loading
            try {
                _search.value = ExperienceLoad.Ready(computeSearch(normalised, mediaType, libraryId))
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

    /** Runs one search (catalogue, availability index, library view, playlists); throws on failure. */
    private suspend fun computeSearch(
        normalised: String,
        mediaType: PlayarrSearchMediaType,
        libraryId: String?,
    ): PlayarrSearchResults = kotlinx.coroutines.coroutineScope {
        val includesWorks = mediaType != PlayarrSearchMediaType.Playlist &&
            mediaType != PlayarrSearchMediaType.Game
        val worksRequest = async {
            if (!includesWorks) return@async emptyList()
            when (val result = searchCatalog(normalised, limit = SEARCH_LIMIT)) {
                is PlayarrResult.Success -> result.value
                is PlayarrResult.Failure -> throw PlayarrMessageException(
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
        PlayarrSearchResults(works, playlists)
    }

    /** Live-event / fallback refresh: re-runs the last query in place, keeping the shown results until the new arrive. */
    fun refreshSearch() {
        val last = lastSearch ?: return
        searchRefreshJob?.cancel()
        searchRefreshJob = viewModelScope.launch {
            searchStamp.begin()
            // Library events change which works are available; rebuild the index on the next query.
            searchAvailabilityMutex.withLock { availableSearchWorkIds = null }
            val results = try {
                computeSearch(last.query, last.mediaType, last.libraryId)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Throwable) {
                return@launch
            }
            if (lastSearch == last) _search.value = ExperienceLoad.Ready(results)
        }
    }

    private suspend fun loadAvailableSearchWorkIds(): Set<String> = searchAvailabilityMutex.withLock {
        availableSearchWorkIds?.let { return@withLock it }
        // Every catalogue call costs the server a roughly fixed few seconds whatever the page size
        // (measured on a 2.7k-title library: 3 s at limit=1, 4.5 s at limit=1000), so walking the
        // index page by page took 6+ sequential round trips. Ask for a big first page, then fetch
        // whatever is left concurrently using the page size the server actually honoured.
        val first = api.browseCatalog(availableOnly = true, limit = SEARCH_AVAILABILITY_PAGE_SIZE, offset = 0L)
        val ids = first.items.mapTo(mutableSetOf(), Work::id)
        val total = first.total
        if (first.items.isNotEmpty() && total != null && first.items.size < total) {
            val pageSize = first.items.size.toLong()
            val offsets = generateSequence(pageSize) { it + pageSize }.takeWhile { it < total }.toList()
            kotlinx.coroutines.coroutineScope {
                offsets.map { offset ->
                    async { api.browseCatalog(availableOnly = true, limit = pageSize, offset = offset) }
                }.awaitAll()
            }.forEach { page -> page.items.mapTo(ids, Work::id) }
        } else if (total == null && first.items.size.toLong() >= SEARCH_AVAILABILITY_PAGE_SIZE) {
            // No total reported: walk on sequentially until a short page.
            var offset = first.items.size.toLong()
            while (true) {
                val page = api.browseCatalog(availableOnly = true, limit = SEARCH_AVAILABILITY_PAGE_SIZE, offset = offset)
                page.items.mapTo(ids, Work::id)
                offset += page.items.size
                if (page.items.size < SEARCH_AVAILABILITY_PAGE_SIZE) break
            }
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

    /**
     * Home's stacked Continue Watching card: reports the pick (so declined
     * gaps and rewatch answers are remembered) and returns the series' watch
     * order, or null when the series cannot be loaded.
     */
    suspend fun resumeQueueFor(
        seriesWorkId: String,
        option: io.playarr.shared.data.model.ResumeOption,
    ): List<PlayarrPlaybackQueueItem>? {
        runCatching {
            api.recordResumeChoice(
                seriesWorkId,
                io.playarr.shared.data.model.ResumeChoiceRequest(option.kind, option.episodeId),
            )
        }
        return runCatching { api.getWork(seriesWorkId).playarrPlaybackQueueItems() }.getOrNull()
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

/** Lets a detail page report which top-level nav section it belongs to (null on leave). */
internal val LocalDetailSection = androidx.compose.runtime.staticCompositionLocalOf<(String?) -> Unit> { {} }

/** Top-level nav route that owns works of [kind]. */
internal fun navRouteForKind(kind: WorkKind): String? = when (kind) {
    WorkKind.Series -> "series"
    WorkKind.Movie -> "movies"
    WorkKind.Artist -> "music"
    WorkKind.Site -> "sites"
    else -> null
}

@Composable
internal fun ReportDetailSection(kind: WorkKind) {
    val report = LocalDetailSection.current
    DisposableEffect(kind) {
        report(navRouteForKind(kind))
        onDispose { report(null) }
    }
}

internal data class ExperienceDestination(
    val route: String,
    val label: PlayarrString,
    val icon: ImageVector,
    val kind: WorkKind? = null,
    /** Hidden until an administrator has enabled at least one folder this account may browse. */
    val requiresFolders: Boolean = false,
)

internal enum class LibraryViewMode { List, Screen, Cover, CoverFlow }
internal enum class LibraryArtworkSize { Small, Medium, Large }

internal val experienceDestinations = listOf(
    ExperienceDestination("downloads", PlayarrString.NavDownloads, Icons.Outlined.Download),
    ExperienceDestination("search", PlayarrString.NavSearch, Icons.Outlined.Search),
    ExperienceDestination("home", PlayarrString.NavHome, Icons.Outlined.Home),
    ExperienceDestination("series", PlayarrString.NavSeries, Icons.Outlined.Tv, WorkKind.Series),
    ExperienceDestination("movies", PlayarrString.NavMovies, Icons.Outlined.Movie, WorkKind.Movie),
    ExperienceDestination("sites", PlayarrString.NavSites, Icons.Outlined.Language, WorkKind.Site),
    ExperienceDestination("music", PlayarrString.NavMusic, Icons.Outlined.MusicNote, WorkKind.Artist),
    ExperienceDestination("folders", PlayarrString.NavFolders, Icons.Outlined.Folder, requiresFolders = true),
    ExperienceDestination("calendar", PlayarrString.NavCalendar, Icons.Outlined.CalendarMonth),
    ExperienceDestination("playlists", PlayarrString.NavPlaylists, Icons.AutoMirrored.Outlined.PlaylistPlay),
    ExperienceDestination("watchlist", PlayarrString.NavWatchlist, Icons.Outlined.Bookmark),
    ExperienceDestination("requests", PlayarrString.NavRequests, Icons.Outlined.Inbox),
)

internal fun visibleExperienceDestinations(
    availableKinds: Set<WorkKind>?,
    canDownload: Boolean?,
    hasFolders: Boolean = false,
): List<ExperienceDestination> = if (availableKinds == null) {
    emptyList()
} else {
    experienceDestinations.filter { destination ->
        (destination.kind == null || availableKinds.contains(destination.kind)) &&
            (destination.route != "downloads" || canDownload == true) &&
            (!destination.requiresFolders || hasFolders)
    }
}

internal fun televisionDestinationGroups(
    destinations: List<ExperienceDestination>,
): List<List<ExperienceDestination>> = listOf(
    destinations.filter { it.route in setOf("downloads", "search") },
    destinations.filter { it.route in setOf("home", "series", "movies", "sites", "music", "folders", "calendar") },
    destinations.filter { it.route == "playlists" || it.route == "watchlist" || it.route == "requests" },
).filter(List<ExperienceDestination>::isNotEmpty)

private const val PLAYBACK_STATS_TAG = "PlayarrPlaybackStats"
private const val CAPABILITIES_POLL_MS = 60_000L
private val HOME_LIVE_INTEREST = setOf(LiveTarget(LiveArea.Home), LiveTarget(LiveArea.Progress))
private val LIBRARY_LIVE_INTEREST = setOf(LiveTarget(LiveArea.Library))
private val SEARCH_LIVE_INTEREST = setOf(LiveTarget(LiveArea.Search))
private const val SEARCH_DEBOUNCE_MS = 320L
internal const val LIBRARY_PAGE_SIZE = 200L

/** Appends [page] to [loaded], dropping works already present (pages can overlap if the catalogue shifts mid-load). */
internal fun mergeLibraryPage(loaded: List<Work>, page: List<Work>): List<Work> {
    if (loaded.isEmpty()) return page
    val seen = loaded.mapTo(HashSet(loaded.size * 2), Work::id)
    return loaded + page.filter { seen.add(it.id) }
}
private const val SEARCH_LIMIT = 60L
private const val SEARCH_LIBRARY_LIMIT = 500L
private const val SEARCH_AVAILABILITY_PAGE_SIZE = 3000L
private val LocalPlayarrServerAccessResolver = staticCompositionLocalOf<PlayarrServerAccessResolver?> { null }

@Composable
internal fun rememberPlayarrWorkServerAccess(
    workId: String,
    fallbackServerUrl: String,
    fallbackAccessToken: String?,
): PlayarrServerAccess? = rememberPlayarrServerAccess(
    key = workId,
    fallbackServerUrl = fallbackServerUrl,
    fallbackAccessToken = fallbackAccessToken,
) { resolver -> resolver.forWork(workId) }

@Composable
internal fun rememberPlayarrMediaServerAccess(
    mediaFileId: String,
    fallbackServerUrl: String,
    fallbackAccessToken: String?,
): PlayarrServerAccess? = rememberPlayarrServerAccess(
    key = mediaFileId,
    fallbackServerUrl = fallbackServerUrl,
    fallbackAccessToken = fallbackAccessToken,
) { resolver -> resolver.forMedia(mediaFileId) }

@Composable
internal fun rememberPlayarrUrlServerAccess(
    serverUrl: String,
    fallbackAccessToken: String?,
): PlayarrServerAccess? = rememberPlayarrServerAccess(
    key = serverUrl,
    fallbackServerUrl = serverUrl,
    fallbackAccessToken = fallbackAccessToken,
) { resolver -> resolver.forServerUrl(serverUrl) }

@Composable
private fun rememberPlayarrServerAccess(
    key: String,
    fallbackServerUrl: String,
    fallbackAccessToken: String?,
    resolve: suspend (PlayarrServerAccessResolver) -> PlayarrServerAccess,
): PlayarrServerAccess? {
    val resolver = LocalPlayarrServerAccessResolver.current
    val fallback = remember(fallbackServerUrl, fallbackAccessToken) {
        PlayarrServerAccess(fallbackServerUrl, fallbackAccessToken)
    }
    val access by produceState<PlayarrServerAccess?>(
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
    initialRoute: String = "home",
    onAddProfile: () -> Unit = {},
    onRouteChanged: (String) -> Unit = {},
    viewModel: PlayarrExperienceViewModel = hiltViewModel(),
    playerViewModel: ExperiencePlayerViewModel = hiltViewModel(),
) {
    val navController = rememberNavController()
    val entry by navController.currentBackStackEntryAsState()
    val currentRoute = entry?.destination?.route.orEmpty().substringBefore('?')
    var detailSectionRoute by remember { mutableStateOf<String?>(null) }
    // Detail pages highlight the section they belong to (Series for a series, etc.), as the web rail does.
    val activeNavRoute = if (currentRoute.startsWith("experience-detail")) detailSectionRoute ?: currentRoute else currentRoute
    val token by viewModel.accessToken.collectAsState()
    val currentUserId by viewModel.currentUserId.collectAsState()
    val currentUserName by viewModel.currentUserName.collectAsState()
    val profileAvatar by viewModel.profileAvatar.collectAsState()
    val availableKinds by viewModel.availableKinds.collectAsState()
    val canDownload by viewModel.canDownload.collectAsState()
    val hasFolders by viewModel.hasFolders.collectAsState()
    val playbackQueue by viewModel.playbackQueue.collectAsState()
    val persistentPlayerState by playerViewModel.state.collectAsState()
    val playbackState by playerViewModel.player.state.collectAsState()
    val playerDefaults = LocalPlayarrDisplayPreferences.current.playerDefaults
    val activePlaybackItem = playbackQueue.currentItem
    val isPlayer = currentRoute.startsWith("experience-player")
    val isProfiles = currentRoute == "profiles"
    val online by rememberPlayarrOnlineStatus()
    var profileReturnRoute by remember { mutableStateOf(initialRoute) }
    val libraryHandle = entry?.savedStateHandle
    val libraryState = LibraryUrlState.of(
        libraryHandle?.get<String>(LibraryUrlState.VIEW),
        libraryHandle?.get<String>(LibraryUrlState.SIZE),
        libraryHandle?.get<String>(LibraryUrlState.SORT),
        libraryHandle?.get<String>(LibraryUrlState.ORDER),
        allowCoverFlow = currentRoute == "music",
    )
    val restorableRoute = restorableExperienceRoute(
        route = entry?.destination?.route,
        library = libraryState,
        workId = entry?.arguments?.getString("workId"),
        mediaFileId = entry?.arguments?.getString("mediaFileId"),
        playlistId = entry?.arguments?.getString("playlistId"),
    )

    LaunchedEffect(restorableRoute) {
        restorableRoute?.let {
            profileReturnRoute = it
            onRouteChanged(it)
        }
    }
    LaunchedEffect(currentUserId) {
        if (currentUserId != null) viewModel.reloadForProfile()
    }
    val household by viewModel.household.collectAsState()
    val householdBlock = householdBlockState(household)
    // Poll every 30 s, and on every route change, so a spent budget or a
    // closing schedule window is noticed promptly; the server enforces either way.
    LaunchedEffect(currentUserId) {
        viewModel.clearHousehold()
        if (currentUserId == null) return@LaunchedEffect
        while (true) {
            viewModel.refreshHousehold()
            kotlinx.coroutines.delay(30_000L)
        }
    }
    LaunchedEffect(currentRoute) { if (currentUserId != null) viewModel.refreshHousehold() }
    LaunchedEffect(currentRoute, currentUserId) {
        if (currentUserId != null) viewModel.refreshProfileAvatar()
    }
    LaunchedEffect(activePlaybackItem, playerDefaults) {
        activePlaybackItem?.let {
            playerViewModel.play(it.mediaFileId, playerDefaults, it.startPositionMs, it.launchSettings)
        }
    }
    // Phone remote and playback handoff (docs/architecture/remote-control.md).
    val remoteContext = LocalContext.current
    val remotePlayerControls = remember(viewModel, playerViewModel) {
        ExperienceRemotePlayerControls(
            queue = { viewModel.playbackQueue.value },
            playerViewModel = playerViewModel,
            experience = viewModel,
            onStopped = {
                // Leave the (now empty) player screen so a remote stop does not strand the TV on a dark frame.
                if (navController.currentBackStackEntry?.destination?.route?.startsWith("experience-player") == true) {
                    navController.popBackStack()
                }
            },
        )
    }
    PlayarrRemoteHostEffect(
        controller = viewModel.remoteController,
        playerActive = activePlaybackItem != null,
        signedIn = currentUserId != null,
        activity = { remoteContext as? android.app.Activity ?: (remoteContext as? android.content.ContextWrapper)?.baseContext as? android.app.Activity },
        navController = navController,
        startPlayback = { mediaFileId, positionMs ->
            viewModel.startPlayback(
                mediaFileId,
                listOf(PlayarrPlaybackQueueItem(mediaFileId, "", fallbackTitle = PlayarrString.PlayerNowPlaying)),
                positionMs,
            )
        },
        playerControls = { remotePlayerControls.takeIf { viewModel.playbackQueue.value.currentItem != null } },
    )
    LaunchedEffect(playbackState.hasEnded, activePlaybackItem?.mediaFileId, playbackQueue.canNext) {
        if (shouldAutoAdvancePlayarrMusic(playbackState.hasEnded, activePlaybackItem, playbackQueue.canNext)) {
            viewModel.movePlayback(1)
        }
    }
    // End of playback while minimised: no card is drawn here, but playback must not just stop.
    // Continue with the next video, or expand the player so the ended card (Replay, Back to
    // details, suggestions) appears. The expanded player raises its own card from the ended state.
    val castingMediaFileId by playerViewModel.castingMediaFileId.collectAsState()
    var minimisedEndArmedFor by remember { mutableStateOf<String?>(null) }
    val minimisedNextItem = playbackQueue.items.getOrNull(playbackQueue.currentIndex + 1)
        ?.takeIf { playbackQueue.canNext }
    LaunchedEffect(playbackState.hasEnded, activePlaybackItem?.mediaFileId, isPlayer, castingMediaFileId) {
        val item = activePlaybackItem
        if (!playbackState.hasEnded) {
            minimisedEndArmedFor = item?.mediaFileId
            return@LaunchedEffect
        }
        when (
            playarrMinimisedEndAction(
                hasEnded = true,
                armed = item != null && minimisedEndArmedFor == item.mediaFileId,
                isPlayerRoute = isPlayer,
                item = item,
                nextItem = minimisedNextItem,
                casting = castingMediaFileId != null,
                hasError = playbackState.error != null,
            )
        ) {
            PlayarrMinimisedEndAction.AdvanceToNext -> {
                minimisedEndArmedFor = null
                android.util.Log.i("PlayarrPlaybackStats", playarrEndScreenAutoplayLogLine(item?.mediaFileId))
                viewModel.movePlayback(1)
            }
            PlayarrMinimisedEndAction.ExpandPlayer -> {
                minimisedEndArmedFor = null
                navController.navigate("experience-player/${Uri.encode(item!!.mediaFileId)}")
            }
            PlayarrMinimisedEndAction.None -> Unit
        }
    }
    LaunchedEffect(persistentPlayerState, activePlaybackItem?.mediaFileId) {
        if (persistentPlayerState !is ExperienceLoad.Ready || activePlaybackItem == null) return@LaunchedEffect
        while (true) {
            delay(10_000)
            playerViewModel.checkpoint()
        }
    }

    val closePlayback: () -> Unit = {
        playerViewModel.stopPlayback()
        viewModel.clearPlayback()
        if (isPlayer) navController.popBackStack()
    }

    BackHandler(
        enabled = shouldHandlePlayarrMiniPlayerBack(isPlayer, activePlaybackItem != null),
        onBack = closePlayback,
    )

    val playbackFailed = persistentPlayerState is ExperienceLoad.Failed || playbackState.error != null
    // The mini player must read the same source timeline as the expanded player (engine position plus
    // HLS source offset, duration from the negotiated source), not the raw engine window.
    var miniTimeline by remember { mutableStateOf(PlayarrPlayerTimeline()) }
    val miniPlayerVisible = shouldShowPlayarrMiniPlayer(isPlayer, activePlaybackItem != null, persistentPlayerState is ExperienceLoad.Ready && !playbackFailed)
    LaunchedEffect(miniPlayerVisible, activePlaybackItem?.mediaFileId) {
        if (!miniPlayerVisible) return@LaunchedEffect
        while (true) {
            miniTimeline = playerViewModel.timelineSnapshot()
            kotlinx.coroutines.delay(500)
        }
    }
    LaunchedEffect(playbackFailed, isPlayer, activePlaybackItem?.mediaFileId) {
        if (shouldClearPlayarrFailedPlayback(playbackFailed, isPlayer, activePlaybackItem != null)) {
            closePlayback()
        }
    }

    // A schedule boundary or spent budget stops playback at once instead of
    // letting the player run into a refused segment request.
    LaunchedEffect(householdBlock != null) {
        if (householdBlock != null && activePlaybackItem != null) closePlayback()
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
        val glassBackdrop = rememberGlassBackdrop()
        CompositionLocalProvider(
            LocalGlassBackdrop provides glassBackdrop,
            LocalDetailSection provides { detailSectionRoute = it },
        ) {
        Box(modifier = Modifier.fillMaxSize().background(WebBackground)) {
            ExperienceNavHost(
                navController,
                serverUrl,
                token,
                isTelevision,
                canDownload,
                online,
                initialRoute,
                profileReturnRoute,
                onAddProfile,
                viewModel,
                playerViewModel,
            )

            val remainingMinutes = householdRemainingMinutes(household, java.time.Instant.now())
            if (remainingMinutes != null && !isPlayer && !isProfiles && householdBlock == null) {
                HouseholdRemainingBadge(
                    minutes = remainingMinutes,
                    modifier = Modifier.align(Alignment.TopCenter),
                )
            }
            if (householdBlock != null && !isProfiles) {
                HouseholdBlockedScreen(
                    block = householdBlock,
                    onAskGuardian = viewModel::askGuardian,
                    onSwitchProfile = { navController.openExperienceTopLevel("profiles") },
                )
            }

            if (!isPlayer && !isProfiles && householdBlock == null) {
                val visibleDestinations = visibleExperienceDestinations(availableKinds, canDownload, hasFolders)
                if (visibleDestinations.isNotEmpty()) {
                    ExperienceNavigation(
                        destinations = visibleDestinations,
                        currentRoute = activeNavRoute,
                        isTelevision = isTelevision,
                        onNavigate = { navController.openExperienceTopLevel(it) },
                        modifier = Modifier.align(if (isTelevision) Alignment.CenterStart else Alignment.BottomCenter),
                    )
                }
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
                        modifier = Modifier.align(Alignment.TopStart).padding(start = 59.dp, top = 60.dp),
                    )
                    ExperienceClock(Modifier.align(Alignment.TopStart).padding(start = 486.dp, top = 68.dp))
                }
            }

            if (shouldShowPlayarrMiniPlayer(isPlayer, activePlaybackItem != null, persistentPlayerState is ExperienceLoad.Ready && !playbackFailed)) {
                PlayarrMiniPlayer(
                    item = activePlaybackItem!!,
                    timeline = miniTimeline,
                    serverUrl = serverUrl,
                    accessToken = token,
                    isTelevision = isTelevision,
                    onMaximise = {
                        navController.navigate("experience-player/${Uri.encode(activePlaybackItem!!.mediaFileId)}")
                    },
                    modifier = Modifier.align(if (isTelevision) Alignment.BottomEnd else Alignment.BottomCenter),
                )
            }
        }
        }
    }
}

@Composable
private fun PlayarrMiniPlayer(
    item: PlayarrPlaybackQueueItem,
    timeline: PlayarrPlayerTimeline,
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
        color = Color.Transparent,
        contentColor = WebInk,
        shape = RoundedCornerShape(18.dp),
        modifier = modifier
            .then(if (isTelevision) Modifier.width(500.dp) else Modifier.fillMaxWidth())
            .padding(
                start = if (isTelevision) 0.dp else 10.dp,
                end = if (isTelevision) 48.dp else 10.dp,
                bottom = if (isTelevision) 42.dp else 78.dp,
            )
            .glass(RoundedCornerShape(18.dp), WebGlass.Panel)
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
                    "${formatPlayarrPlayerTime(timeline.positionMs)} / ${formatPlayarrPlayerTime(timeline.durationMs)}",
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
                            .fillMaxWidth(playarrPlaybackProgress(timeline.positionMs, timeline.durationMs))
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

internal fun NavHostController.openExperienceTopLevel(route: String) {
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
    val phoneNavShape = RoundedCornerShape(if (isTelevision) 28.dp else 20.dp)
    Surface(
        modifier = modifier
            .windowInsetsPadding(bottomInsets)
            .padding(horizontal = if (isTelevision) 0.dp else 10.dp, vertical = if (isTelevision) 26.dp else 8.dp)
            .glass(phoneNavShape, WebGlass.NavGroup),
        color = Color.Transparent,
        shape = phoneNavShape,
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
            val groupShape = RoundedCornerShape(22.dp)
            Surface(
                modifier = Modifier.glass(groupShape, WebGlass.NavGroup),
                color = Color.Transparent,
                shape = groupShape,
            ) {
                Column(Modifier.padding(horizontal = 6.dp, vertical = 7.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    group.forEach { destination ->
                        val selected = currentRoute == destination.route
                        val label = playarrString(destination.label)
                        var focused by remember { mutableStateOf(false) }
                        val navScale = rememberPlayarrFocusScale(
                            focused = focused,
                            focusedScale = FocusMotion.navFocusScale,
                            unfocusedScale = if (selected) FocusMotion.navSelectedScale else FocusMotion.restScale,
                            label = "tvNavFocus",
                        )
                        Surface(
                            onClick = { onNavigate(destination.route) },
                            color = if (selected || focused) WebInk.copy(alpha = if (focused) 0.14f else 0.09f) else Color.Transparent,
                            contentColor = if (selected || focused) WebInk else WebInkMuted,
                            shape = RoundedCornerShape(16.dp),
                            modifier = Modifier
                                .size(67.dp)
                                .scale(navScale)
                                .onFocusChanged { focused = it.isFocused },
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                                Icon(destination.icon, contentDescription = null, modifier = Modifier.size(20.dp))
                                Text(
                                    label,
                                    fontSize = 9.sp,
                                    fontWeight = if (selected) FontWeight.Bold else FontWeight(680),
                                    letterSpacing = 0.3.sp,
                                    modifier = Modifier.padding(top = 5.dp),
                                )
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
    val dateFormatter = remember(locale) { DateTimeFormatter.ofPattern("EEE d MMMM", locale) }
    LaunchedEffect(Unit) {
        while (true) {
            kotlinx.coroutines.delay(30_000)
            now = LocalDateTime.now()
        }
    }
    Row(modifier, verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(now.format(DateTimeFormatter.ofPattern("HH:mm")), color = WebInk, fontSize = 17.sp, fontWeight = FontWeight.ExtraBold)
        Text(
            now.format(dateFormatter).uppercase(locale),
            color = WebInkMuted,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.sp,
        )
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
    var focused by remember { mutableStateOf(false) }
    val focusScale = rememberPlayarrFocusScale(
        focused = focused,
        focusedScale = FocusMotion.navFocusScale,
        unfocusedScale = FocusMotion.restScale,
        label = "profileControlFocus",
    )
    Column(
        modifier = modifier
            .windowInsetsPadding(if (isTelevision) WindowInsets(0) else WindowInsets.safeDrawing)
            .then(
                if (isTelevision) Modifier.padding(start = 59.dp, bottom = 22.dp) else Modifier.padding(16.dp),
            ),
        horizontalAlignment = Alignment.Start,
    ) {
        Surface(
            onClick = onClick,
            modifier = (if (isTelevision) Modifier.height(46.dp) else Modifier.size(42.dp))
                .scale(focusScale)
                .glass(CircleShape, WebGlass.Identity)
                .onFocusChanged { focused = it.isFocused }
                .semantics { contentDescription = profileDescription },
            shape = CircleShape,
            color = Color.Transparent,
            contentColor = if (focused) WebInk else WebInkSoft,
            // A visible ring is the only focus cue the D-pad has on this control.
            border = if (focused) androidx.compose.foundation.BorderStroke(2.dp, WebPink) else null,
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
internal fun PlayarrLogo(modifier: Modifier = Modifier, iconSize: Dp = 42.dp) {
    Icon(
        painter = painterResource(R.drawable.playarr_mark),
        contentDescription = null,
        tint = Color.Unspecified,
        modifier = modifier.size(iconSize),
    )
}

@Composable
private fun ExperienceNavHost(
    navController: NavHostController,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    canDownload: Boolean?,
    isOnline: Boolean,
    initialRoute: String,
    profileReturnRoute: String,
    onAddProfile: () -> Unit,
    viewModel: PlayarrExperienceViewModel,
    playerViewModel: ExperiencePlayerViewModel,
) {
    val playbackQueue by viewModel.playbackQueue.collectAsState()
    NavHost(navController, startDestination = initialRoute, modifier = Modifier.fillMaxSize()) {
        composable("home") {
            ExperienceOnlineGate(isOnline, isTelevision, "home") {
                ExperienceHomeScreen(serverUrl, accessToken, isTelevision, canDownload == true, navController, viewModel)
            }
        }
        composable("search") {
            ExperienceOnlineGate(isOnline, isTelevision, "search") {
                ExperienceSearchScreen(serverUrl, accessToken, isTelevision, canDownload == true, navController, viewModel)
            }
        }
        listOf(
            "series" to WorkKind.Series,
            "movies" to WorkKind.Movie,
            "sites" to WorkKind.Site,
            "music" to WorkKind.Artist,
        ).forEach { (route, kind) ->
            // View, size and sort travel as the web query params (`series?view=cover&size=large&sort=date_added&order=desc`):
            // they seed the entry's SavedStateHandle, so deep links, rotation, process death and the saved back stack agree.
            composable(
                route = libraryRoutePattern(route),
                arguments = listOf(LibraryUrlState.VIEW, LibraryUrlState.SIZE, LibraryUrlState.SORT, LibraryUrlState.ORDER).map { name ->
                    navArgument(name) {
                        type = NavType.StringType
                        nullable = true
                        defaultValue = null
                    }
                },
                deepLinks = listOf(navDeepLink { uriPattern = "playarr://app/$route$LIBRARY_ROUTE_QUERY" }),
            ) { entry ->
                ExperienceOnlineGate(isOnline, isTelevision, route) {
                    ExperienceLibraryScreen(kind, serverUrl, accessToken, isTelevision, canDownload == true, navController, viewModel, entry.savedStateHandle)
                }
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
            ExperienceOnlineGate(isOnline, isTelevision, "experience-detail") {
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
                onOpenWork = { workId ->
                    playerViewModel.stopPlayback()
                    viewModel.clearPlayback()
                    navController.popBackStack()
                    navController.navigate("experience-detail/$workId")
                },
                viewModel = playerViewModel,
            )
        }
        // `calendar?query=view%3Dagenda%26date%3D2026-10-04` seeds the calendar's SavedStateHandle (the nav arg name is
        // the handle key), carrying the exact query string the web calendar puts in its URL.
        composable(
            route = "calendar?query={query}",
            arguments = listOf(
                navArgument("query") {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                },
            ),
            deepLinks = listOf(navDeepLink { uriPattern = "playarr://app/calendar?query={query}" }),
        ) {
            ExperienceOnlineGate(isOnline, isTelevision, "calendar") {
                ExperienceCalendarScreen(
                    isTelevision = isTelevision,
                    onBack = { navController.openExperienceTopLevel("home") },
                    onOpenWork = { navController.navigate("experience-detail/$it") },
                )
            }
        }
        // `folders?query=root%3D<id>%26path%3DSeason%2520A` seeds the folder view's SavedStateHandle with the exact
        // query string the web Folders page puts in its URL.
        composable(
            route = "folders?query={query}",
            arguments = listOf(
                navArgument("query") {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                },
            ),
            deepLinks = listOf(navDeepLink { uriPattern = "playarr://app/folders?query={query}" }),
        ) {
            ExperienceOnlineGate(isOnline, isTelevision, "folders") {
                ExperienceFoldersScreen(
                    serverUrl = serverUrl,
                    accessToken = accessToken,
                    isTelevision = isTelevision,
                    onBack = { navController.openExperienceTopLevel("home") },
                    onPlay = { entry, queue ->
                        val mediaFileId = entry.mediaFileId ?: return@ExperienceFoldersScreen
                        viewModel.startPlayback(mediaFileId, queue)
                        navController.navigate("experience-player/${Uri.encode(mediaFileId)}")
                    },
                )
            }
        }
        composable("watchlist") {
            ExperienceOnlineGate(isOnline, isTelevision, "watchlist") {
                ExperienceWatchlistScreen(
                    isTelevision = isTelevision,
                    onBack = { navController.openExperienceTopLevel("home") },
                    navController = navController,
                    onPlay = { mediaFileId, title ->
                        viewModel.startPlayback(
                            mediaFileId,
                            listOf(PlayarrPlaybackQueueItem(mediaFileId = mediaFileId, title = title)),
                        )
                        navController.navigate("experience-player/${Uri.encode(mediaFileId)}")
                    },
                )
            }
        }
        composable("requests") {
            ExperienceOnlineGate(isOnline, isTelevision, "requests") {
                ExperienceRequestsScreen(
                    isTelevision = isTelevision,
                    onBack = { navController.openExperienceTopLevel("home") },
                )
            }
        }
        composable("playlists") {
            ExperienceOnlineGate(isOnline, isTelevision, "playlists") {
                ExperiencePlaylistsScreen(serverUrl, accessToken, isTelevision, navController)
            }
        }
        composable("playlists/{playlistId}") { entry ->
            ExperienceOnlineGate(isOnline, isTelevision, "playlists/{playlistId}") {
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
        }
        composable("profiles") {
            val profileAvatar by viewModel.profileAvatar.collectAsState()
            val currentUserId by viewModel.currentUserId.collectAsState()
            ExperienceProfilesScreen(
                isTelevision = isTelevision,
                currentUserId = currentUserId.orEmpty(),
                currentAvatar = profileAvatar,
                onHome = { navController.openExperienceTopLevel(profileReturnRoute) },
                onSettings = { navController.openExperienceTopLevel("settings") },
                onAddProfile = onAddProfile,
            )
        }
        composable("settings") {
            ExperienceOnlineGate(isOnline, isTelevision, "settings") {
                ExperienceParitySettingsScreen(serverUrl, isTelevision, onBack = { navController.openExperienceTopLevel("home") })
            }
        }
        composable("downloads") {
            when (canDownload) {
                null -> ExperienceLoading(playarrString(PlayarrString.DownloadsLoading))
                false -> ExperienceNotFoundScreen()
                true -> ExperienceDownloadsScreen(
                    serverUrl = serverUrl,
                    accessToken = accessToken,
                    isTelevision = isTelevision,
                    isOnline = isOnline,
                    onBack = { navController.openExperienceTopLevel("home") },
                    onOpen = { download ->
                        navController.navigate(
                            "experience-detail/${download.workId}?mediaFileId=${Uri.encode(download.mediaFileId)}",
                        )
                    },
                )
            }
        }
    }
}

internal fun restorableExperienceRoute(
    route: String?,
    workId: String? = null,
    mediaFileId: String? = null,
    playlistId: String? = null,
    library: LibraryUrlState = LibraryUrlState(),
): String? {
    val base = route?.substringBefore('?')
    return when {
        base in libraryRoutes -> libraryRouteFor(base!!, library)
        base in setOf("home", "search", "calendar", "folders", "playlists", "watchlist", "requests", "settings", "downloads") -> base
        route == "experience-detail/{workId}?mediaFileId={mediaFileId}" -> workId?.takeIf(String::isNotBlank)?.let { id ->
            buildString {
                append("experience-detail/")
                append(id.asUrlPathSegment())
                mediaFileId?.takeIf(String::isNotBlank)?.let {
                    append("?mediaFileId=")
                    append(it.asUrlPathSegment())
                }
            }
        }
        route == "playlists/{playlistId}" -> playlistId?.takeIf(String::isNotBlank)?.let { "playlists/${it.asUrlPathSegment()}" }
        else -> null
    }
}

@Composable
private fun ExperienceOnlineGate(
    isOnline: Boolean,
    isTelevision: Boolean,
    route: String,
    content: @Composable () -> Unit,
) {
    if (shouldShowPlayarrOfflineState(isOnline, route)) {
        ExperienceOfflineScreen(isTelevision)
    } else {
        content()
    }
}

@Composable
private fun ExperienceOfflineScreen(isTelevision: Boolean) {
    BoxWithConstraints(
        modifier = Modifier.fillMaxSize().background(WebSurface),
        contentAlignment = Alignment.Center,
    ) {
        val wide = isTelevision || maxWidth >= 760.dp
        val artwork: @Composable () -> Unit = {
            Box(
                modifier = Modifier
                    .size(if (wide) 164.dp else 116.dp)
                    .clip(CircleShape)
                    .background(WebPink.copy(alpha = 0.12f))
                    .border(2.dp, WebInk.copy(alpha = 0.82f), CircleShape)
                    .padding(if (wide) 34.dp else 24.dp),
                contentAlignment = Alignment.Center,
            ) {
                Canvas(Modifier.fillMaxSize()) {
                    val stroke = Stroke(width = size.minDimension * 0.055f)
                    val panelTopLeft = Offset(size.width * 0.08f, size.height * 0.2f)
                    val panelSize = Size(size.width * 0.72f, size.height * 0.58f)
                    drawRoundRect(
                        color = WebInk,
                        topLeft = panelTopLeft,
                        size = panelSize,
                        cornerRadius = CornerRadius(size.minDimension * 0.08f),
                        style = stroke,
                    )
                    listOf(0.36f, 0.49f, 0.62f).forEachIndexed { index, y ->
                        drawLine(
                            color = WebInk,
                            start = Offset(size.width * 0.2f, size.height * y),
                            end = Offset(size.width * (if (index == 2) 0.55f else 0.67f), size.height * y),
                            strokeWidth = size.minDimension * 0.045f,
                        )
                    }
                    drawCircle(
                        color = WebPink,
                        radius = size.minDimension * 0.14f,
                        center = Offset(size.width * 0.79f, size.height * 0.24f),
                    )
                    drawCircle(
                        color = WebInk,
                        radius = size.minDimension * 0.14f,
                        center = Offset(size.width * 0.79f, size.height * 0.24f),
                        style = stroke,
                    )
                }
            }
        }
        val copy: @Composable () -> Unit = {
            Column(
                modifier = Modifier.widthIn(max = 480.dp),
                horizontalAlignment = if (wide) Alignment.Start else Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    playarrString(PlayarrString.OfflineTitle),
                    color = WebInk,
                    fontSize = if (wide) 28.sp else 22.sp,
                    fontWeight = FontWeight.ExtraBold,
                    textAlign = if (wide) androidx.compose.ui.text.style.TextAlign.Start else androidx.compose.ui.text.style.TextAlign.Center,
                )
                Text(
                    playarrString(PlayarrString.OfflineDescription),
                    color = WebInkMuted,
                    fontSize = if (wide) 14.sp else 12.sp,
                    lineHeight = if (wide) 21.sp else 18.sp,
                    textAlign = if (wide) androidx.compose.ui.text.style.TextAlign.Start else androidx.compose.ui.text.style.TextAlign.Center,
                )
            }
        }
        if (wide) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 176.dp, end = 96.dp, top = 96.dp, bottom = 120.dp),
                horizontalArrangement = Arrangement.spacedBy(42.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                artwork()
                copy()
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 32.dp, end = 32.dp, top = 86.dp, bottom = 116.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(28.dp, Alignment.CenterVertically),
            ) {
                artwork()
                copy()
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
    val railLanguageCode = LocalPlayarrLanguage.current.resolved.code
    LaunchedEffect(railLanguageCode) { viewModel.setRailLanguage(railLanguageCode) }
    var customising by remember { mutableStateOf(false) }
    val state by viewModel.home.collectAsState()
    val progress by viewModel.progress.collectAsState()
    val progressByWork = remember(progress) { progress.associateBy(WatchProgress::workId) }
    LiveRefreshEffect(viewModel.liveBus, HOME_LIVE_INTEREST, { viewModel.homeFetchStartedMs }, viewModel::refreshHome)
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
            var resumeChooser by remember { mutableStateOf<PlayarrOnDeckEntry?>(null) }
            val homeScope = rememberCoroutineScope()
            val selected = allWorks.firstOrNull { it.id == selectedId } ?: allWorks.first()
            resumeChooser?.let { entry ->
                val plan = entry.resumePlan
                if (plan != null) {
                    PlayarrResumeChooserDialog(
                        plan = plan,
                        seriesTitle = entry.work.title,
                        onDismiss = { resumeChooser = null },
                        onSelect = { option ->
                            resumeChooser = null
                            homeScope.launch {
                                val queue = viewModel.resumeQueueFor(entry.work.id, option)
                                if (queue == null) {
                                    navController.navigate("experience-detail/${Uri.encode(entry.work.id)}")
                                } else {
                                    viewModel.startPlayback(option.mediaFileId, queue)
                                    navController.navigate("experience-player/${Uri.encode(option.mediaFileId)}")
                                }
                            }
                        },
                    )
                }
            }
            ExperienceStage(
                selected = selected,
                serverUrl = serverUrl,
                accessToken = accessToken,
                isTelevision = isTelevision,
                feature = {
                    FeatureCopy(selected, true)
                },
                rails = {
                    val railsState = androidx.compose.foundation.lazy.rememberLazyListState()
                    var focusedRailKey by remember { mutableStateOf<String?>(null) }
                    // D-pad Up/Down glides the focused rail to the same anchor (the top
                    // of the content padding) instead of nudging by whatever bring-into-view
                    // needs. animateScrollToItem is cancelled and restarted by the next
                    // focused rail, so a held key coalesces to the latest target.
                    LaunchedEffect(focusedRailKey) {
                        val index = current.value.indexOfFirst { it.key == focusedRailKey }
                        if (isTelevision && index >= 0) railsState.animateScrollToItem(index)
                    }
                    LazyColumn(
                        state = railsState,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(
                            top = if (isTelevision) 480.dp else 68.dp,
                            bottom = if (isTelevision) 120.dp else 98.dp,
                        ),
                        verticalArrangement = Arrangement.spacedBy(if (isTelevision) 32.dp else 16.dp),
                    ) {
                        items(current.value, key = HomeRail::key) { rail ->
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
                                    if (onDeck?.resumePlan?.isStacked == true) {
                                        // Several ways to continue: ask here instead of opening the series.
                                        resumeChooser = onDeck
                                        return@ExperienceMediaRail
                                    }
                                    val mediaFileId = onDeck?.episode?.mediaFileId
                                        ?: onDeck?.progress?.mediaFileId
                                    val route = "experience-detail/${Uri.encode(work.id)}"
                                    navController.navigate(
                                        if (mediaFileId == null) route
                                        else "$route?mediaFileId=${Uri.encode(mediaFileId)}",
                                    )
                                },
                                onContext = { contextWork = it },
                                onRailFocused = { focusedRailKey = rail.key },
                            )
                        }
                        item(key = "customise-home") {
                            PlayarrButton(
                                variant = PlayarrButtonVariant.Secondary,
                                onClick = { viewModel.loadRailPreferences(); customising = true },
                                modifier = Modifier.padding(start = if (isTelevision) 46.dp else 16.dp),
                            ) {
                                Text(playarrString(PlayarrString.HomeCustomise))
                            }
                        }
                    }
                },
            )
            if (customising) {
                CustomiseHomeDialog(viewModel = viewModel, onDismiss = { customising = false })
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

/** Per-user Home customisation: show or hide each rail, move it up or down, or reset to the admin's order. */
@Composable
private fun CustomiseHomeDialog(viewModel: PlayarrExperienceViewModel, onDismiss: () -> Unit) {
    val saved by viewModel.railPreferences.collectAsState()
    val rails = saved
    PlayarrPanel(
        onDismissRequest = onDismiss,
        title = { Text(playarrString(PlayarrString.HomeCustomiseTitle)) },
        text = {
            if (rails == null) {
                CircularProgressIndicator()
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    item {
                        Text(playarrString(PlayarrString.HomeCustomiseDescription), color = WebInkMuted, fontSize = 12.sp)
                    }
                    items(rails.size, key = { rails[it].id }) { index ->
                        val rail = rails[index]
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                rail.title,
                                color = if (rail.hidden) WebInkMuted else WebInk,
                                modifier = Modifier.weight(1f),
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                            PlayarrButton(
                                variant = PlayarrButtonVariant.Ghost,
                                enabled = index > 0,
                                onClick = { viewModel.saveRailPreferences(moveRail(rails, index, -1)) },
                            ) { Text(playarrString(PlayarrString.HomeCustomiseUp)) }
                            PlayarrButton(
                                variant = PlayarrButtonVariant.Ghost,
                                enabled = index < rails.lastIndex,
                                onClick = { viewModel.saveRailPreferences(moveRail(rails, index, 1)) },
                            ) { Text(playarrString(PlayarrString.HomeCustomiseDown)) }
                            PlayarrButton(
                                variant = PlayarrButtonVariant.Secondary,
                                onClick = {
                                    viewModel.saveRailPreferences(
                                        rails.toMutableList().also { it[index] = rail.copy(hidden = !rail.hidden) },
                                    )
                                },
                            ) {
                                Text(playarrString(if (rail.hidden) PlayarrString.HomeCustomiseShow else PlayarrString.HomeCustomiseHide))
                            }
                        }
                    }
                }
            }
        },
        dismissButton = {
            PlayarrButton(onClick = viewModel::resetRailPreferences, variant = PlayarrButtonVariant.Ghost) { Text(playarrString(PlayarrString.HomeCustomiseReset)) }
        },
        confirmButton = { PlayarrButton(onClick = onDismiss, variant = PlayarrButtonVariant.Secondary) { Text(playarrString(PlayarrString.CommonClose)) } },
    )
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
        HeroBackdropStack {
        AuthenticatedArtwork(
            work = selected,
            kinds = listOf(ImageKind.Backdrop, ImageKind.Poster),
            serverUrl = serverUrl,
            accessToken = accessToken,
            contentScale = ContentScale.Crop,
            modifier = Modifier.heroBackdrop(isTelevision, 0.53f, 0.55f),
            heroStyle = true,
        )
        Box(
            Modifier.fillMaxSize().background(heroScrimBrush(isTelevision)),
        )
        }
        if (isTelevision) {
            Box(Modifier.fillMaxWidth(0.38f).fillMaxHeight().padding(start = 154.dp, top = 259.dp, end = 28.dp), contentAlignment = Alignment.TopStart) {
                feature()
            }
            Box(
                Modifier.fillMaxHeight().fillMaxWidth(0.62f).align(Alignment.CenterEnd).background(
                    webRailSurfaceBrush(),
                ),
            ) { rails() }
        } else {
            Box(Modifier.fillMaxSize()) { rails() }
        }
    }
}

/**
 * Web `.tv-detail-heading`: glass back button, large section title, hairline
 * divider and breadcrumb. Television only; phones keep the floating back button.
 */
@Composable
internal fun PlayarrPageHeader(
    title: String,
    subtitle: String?,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.padding(start = 154.dp, top = 56.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PlayarrIconButton(onClick = onBack, contentDescription = playarrString(PlayarrString.CommonBack), modifier = Modifier.size(50.dp).glass(CircleShape, WebGlass.Control)) {
            Icon(
                Icons.AutoMirrored.Outlined.ArrowBack,
                contentDescription = null,
                tint = WebInk,
                modifier = Modifier.size(20.dp))
        }
        Text(
            title,
            color = WebInk,
            fontSize = 34.sp,
            fontWeight = FontWeight(580),
            letterSpacing = (-1.5).sp,
            maxLines = 1,
            modifier = Modifier.padding(start = 23.dp),
        )
        if (!subtitle.isNullOrBlank()) {
            Box(Modifier.padding(horizontal = 22.dp).width(1.dp).height(16.dp).background(WebInkMuted.copy(alpha = 0.45f)))
            Text(
                subtitle,
                color = WebInkMuted,
                fontSize = 11.sp,
                fontWeight = FontWeight(680),
                letterSpacing = 0.5.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = 110.dp),
            )
        }
    }
}

/** Web `.tv-rail-surface` gradient (frost = surface-soft 44-48% into surface-strong) for the right-hand content column. */
@Composable
internal fun webRailSurfaceBrush(): Brush {
    val frost = androidx.compose.ui.graphics.lerp(WebSurfaceStrong, WebSurfaceSoft, if (webIsDark) 0.44f else 0.48f)
    val soft = if (webIsDark) floatArrayOf(0.72f, 0.90f, 0.97f) else floatArrayOf(0.68f, 0.88f, 0.96f)
    return Brush.horizontalGradient(
        0f to Color.Transparent,
        0.12f to frost.copy(alpha = soft[0]),
        0.34f to frost.copy(alpha = soft[1]),
        0.62f to frost.copy(alpha = soft[2]),
        1f to frost,
    )
}

@Composable
private fun FeatureCopy(work: Work, isTelevision: Boolean = false) {
    val language = LocalPlayarrLanguage.current
    val kind = work.kind.playarrSingularLabel()
    val genre = work.genres.firstOrNull() ?: playarrString(PlayarrString.HomeDefaultGenre)
    Column {
        Text(
            playarrString(PlayarrString.HomeKindGenre, "kind" to kind, "genre" to genre).uppercase(language.locale),
            color = WebKicker,
            fontSize = 12.sp,
            fontWeight = FontWeight(820),
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
            color = WebInkSoft,
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
    onRailFocused: () -> Unit = {},
) {
    val collection = playarrString(PlayarrString.LibraryCollectionTitles)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .onFocusChanged { if (it.hasFocus) onRailFocused() }
            .padding(start = if (isTelevision) 46.dp else 16.dp),
    ) {
        Text(rail.literalTitle ?: rail.title?.let { playarrString(it) }.orEmpty(), color = WebInk, fontSize = if (isTelevision) 18.sp else 16.sp, fontWeight = FontWeight.SemiBold)
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
                    stackCount = onDeck?.resumePlan?.takeIf { it.isStacked }?.options?.size ?: 0,
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
                    } ?: work.playarrKindYearLabel(),
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
    showUnwatched: Boolean = false,
    /** More than 1 draws the card as a stack with a "N ways to continue" badge. */
    stackCount: Int = 0,
) {
    val resolvedSubtitle = displaySubtitle ?: work.playarrKindYearLabel()
    var focused by remember { mutableStateOf(false) }
    val scale = rememberPlayarrFocusScale(
        focused = focused,
        focusedScale = FocusMotion.cardFocusScale,
        label = "playarrCardFocus",
    )
    val stackNear = WebInk.copy(alpha = 0.26f)
    val stackFar = WebInk.copy(alpha = 0.14f)
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
                .then(
                    if (stackCount > 1) {
                        // Two sheets peeking out above the card, inside the rail's top padding.
                        Modifier.drawBehind {
                            val radius = androidx.compose.ui.geometry.CornerRadius(10.dp.toPx())
                            listOf(3.dp to stackNear, 6.dp to stackFar).forEachIndexed { index, (rise, layer) ->
                                val inset = (index + 1) * 8.dp.toPx()
                                drawRoundRect(
                                    color = layer,
                                    topLeft = androidx.compose.ui.geometry.Offset(inset, -rise.toPx()),
                                    size = androidx.compose.ui.geometry.Size(size.width - inset * 2, size.height),
                                    cornerRadius = radius,
                                )
                            }
                        }
                    } else {
                        Modifier
                    },
                )
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
            if (showUnwatched && stackCount <= 1 && shouldShowPlayarrUnwatchedDot(progress, progressLoaded = true)) {
                PlayarrUnwatchedDot(Modifier.align(Alignment.TopEnd).padding(8.dp))
            }
            if (stackCount > 1) {
                Text(
                    playarrString(PlayarrString.HomeResumeOptions, "count" to stackCount),
                    color = Color.White,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(6.dp)
                        .background(Color.Black.copy(alpha = 0.7f), RoundedCornerShape(50))
                        .padding(horizontal = 8.dp, vertical = 3.dp),
                )
            }
        }
        Text(displayTitle, color = WebInk, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 7.dp))
        Text(resolvedSubtitle, color = WebInkMuted, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Web `WatchStateOverlay` crimson; the app's accent is neutral grey, so it cannot be reused here. */
private val UnwatchedDotColour = Color(0xFFCF3157)

@Composable
private fun PlayarrUnwatchedDot(modifier: Modifier = Modifier) {
    val label = playarrString(PlayarrString.WatchStateUnwatched)
    Box(
        modifier
            .size(12.dp)
            .background(UnwatchedDotColour, CircleShape)
            .border(2.dp, Color.White.copy(alpha = 0.94f), CircleShape)
            .semantics { contentDescription = label },
    )
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
    progressLoaded: Boolean,
    onSelected: (Work) -> Unit,
    onOpen: (Work) -> Unit,
    onContext: (Work) -> Unit,
) {
    val fixedColumns = playarrLibraryGridColumns(viewMode, artworkSize, isTelevision)
    val landscapeWidth = when (artworkSize) {
        LibraryArtworkSize.Small -> if (isTelevision) 150.dp else 132.dp
        LibraryArtworkSize.Medium -> if (isTelevision) 190.dp else 164.dp
        LibraryArtworkSize.Large -> if (isTelevision) 250.dp else 206.dp
    }
    val padding = PaddingValues(start = if (isTelevision) 32.dp else 16.dp, end = if (isTelevision) 82.dp else 16.dp, top = if (isTelevision) 18.dp else 28.dp, bottom = 104.dp)
    when (viewMode) {
        LibraryViewMode.Screen -> LazyVerticalGrid(
            columns = fixedColumns?.let { GridCells.Fixed(it) } ?: GridCells.Adaptive(landscapeWidth),
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
                    showUnwatched = progressLoaded,
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
            columns = fixedColumns?.let { GridCells.Fixed(it) } ?: GridCells.Adaptive(landscapeWidth * 0.72f),
            modifier = Modifier.fillMaxSize(),
            contentPadding = padding,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            items(works, key = Work::id) { work ->
                LibraryCoverCard(work, serverUrl, accessToken, landscapeWidth * 0.72f, work.id == selectedId, onSelected, onOpen, onContext, showUnwatched = progressLoaded && shouldShowPlayarrUnwatchedDot(progressByWork[work.id], true), fillWidth = fixedColumns != null)
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
                    LibraryCoverCard(work, serverUrl, accessToken, landscapeWidth * 0.84f, work.id == selectedId, onSelected, onOpen, onContext, showUnwatched = progressLoaded && shouldShowPlayarrUnwatchedDot(progressByWork[work.id], true))
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
    showUnwatched: Boolean = false,
    fillWidth: Boolean = false,
) {
    var focused by remember { mutableStateOf(false) }
    val libraryScale = rememberPlayarrFocusScale(
        focused = focused || selected,
        focusedScale = FocusMotion.tileFocusScale,
        label = "libraryCardFocus",
    )
    Column(
        (if (fillWidth) Modifier.fillMaxWidth() else Modifier.width(width)).scale(libraryScale)
            .onFocusChanged { focused = it.isFocused; if (it.isFocused) onSelected(work) }.focusable()
            .combinedClickable(onClick = { onSelected(work); onOpen(work) }, onLongClick = { onContext(work) }),
    ) {
        Box {
            AuthenticatedArtwork(
                work, listOf(ImageKind.Poster, ImageKind.Backdrop), serverUrl, accessToken, ContentScale.Crop,
                Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(RoundedCornerShape(12.dp))
                    .then(if (focused || selected) Modifier.border(1.dp, WebInkSoft, RoundedCornerShape(12.dp)) else Modifier),
            )
            if (showUnwatched) PlayarrUnwatchedDot(Modifier.align(Alignment.TopEnd).padding(8.dp))
        }
        Text(work.title, color = WebInk, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp))
    }
}

@Composable
private fun LibraryFiltersDialog(
    kind: WorkKind,
    viewMode: LibraryViewMode,
    artworkSize: LibraryArtworkSize,
    sortMode: String,
    descending: Boolean,
    languageSelection: LanguageSelection,
    languageFacets: LanguageFacets?,
    onLanguageSelection: (LanguageSelection) -> Unit,
    onViewMode: (LibraryViewMode) -> Unit,
    onArtworkSize: (LibraryArtworkSize) -> Unit,
    onSortMode: (String) -> Unit,
    onDescending: (Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    val availableViewModes = if (kind == WorkKind.Artist) {
        LibraryViewMode.entries
    } else {
        LibraryViewMode.entries.filter { it != LibraryViewMode.CoverFlow }
    }
    PlayarrFiltersSheet(
        title = playarrString(PlayarrString.LibraryFilters),
        kicker = null,
        closeLabel = playarrString(PlayarrString.LibraryCloseFilters),
        onClose = onDismiss,
    ) {
        run {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                LibraryFilterChoices(
                    playarrString(PlayarrString.LibraryView),
                    availableViewModes,
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
                LibraryLanguageChoices(
                    playarrString(PlayarrString.LibraryAudioLanguage),
                    languageFacets?.audio.orEmpty(),
                    languageSelection.audio,
                ) { onLanguageSelection(languageSelection.toggleAudio(it)) }
                LibraryLanguageChoices(
                    playarrString(PlayarrString.LibrarySubtitleLanguage),
                    languageFacets?.subtitle.orEmpty(),
                    languageSelection.subtitle,
                ) { onLanguageSelection(languageSelection.toggleSubtitle(it)) }
                if (!languageSelection.isEmpty) {
                    PlayarrChoice(playarrString(PlayarrString.LibraryClearLanguages), false) { onLanguageSelection(LanguageSelection()) }
                }
            }
        }
    }
}

/** Multi-select language chips: toggle any number, counts come from the server facets. */
@Composable
private fun LibraryLanguageChoices(
    title: String,
    facets: List<LanguageFacetEntry>,
    selected: Set<String>,
    onToggle: (String) -> Unit,
) {
    val language = LocalPlayarrLanguage.current
    // A selected language whose count dropped to zero must stay visible so it can be unticked.
    val entries = facets + selected.filter { code -> facets.none { it.code == code } }
        .map { LanguageFacetEntry(code = it, count = -1) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title.uppercase(language.locale), color = WebInkMuted, fontSize = 9.sp, fontWeight = FontWeight.Bold)
        if (entries.isEmpty()) {
            Text(playarrString(PlayarrString.LibraryNoLanguages), color = WebInkMuted, fontSize = 12.sp)
        } else {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                items(entries, key = { it.code }) { entry ->
                    val name = languageDisplayName(entry.code, language.locale, entry.name)
                    val active = entry.code in selected
                    val label = if (entry.count >= 0) "$name · ${entry.count}" else name
                    PlayarrChoice(label, active) { onToggle(entry.code) }
                }
            }
        }
    }
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
            items(values) { value -> PlayarrChoice(label(value), value == selected) { onSelected(value) } }
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
    savedState: androidx.lifecycle.SavedStateHandle,
) {
    val rawView by savedState.getStateFlow<String?>(LibraryUrlState.VIEW, null).collectAsState()
    val rawSize by savedState.getStateFlow<String?>(LibraryUrlState.SIZE, null).collectAsState()
    val rawSort by savedState.getStateFlow<String?>(LibraryUrlState.SORT, null).collectAsState()
    val rawOrder by savedState.getStateFlow<String?>(LibraryUrlState.ORDER, null).collectAsState()
    val library = LibraryUrlState.of(rawView, rawSize, rawSort, rawOrder, allowCoverFlow = kind == WorkKind.Artist)
    val updateLibrary: (LibraryUrlState) -> Unit = { next ->
        savedState[LibraryUrlState.VIEW] = next.view.wire
        savedState[LibraryUrlState.SIZE] = next.size.wire
        savedState[LibraryUrlState.SORT] = next.sort.wire
        savedState[LibraryUrlState.ORDER] = if (next.descending) "desc" else "asc"
    }
    val states by viewModel.libraries.collectAsState()
    val languageSelections by viewModel.languageSelections.collectAsState()
    val languageMatches by viewModel.languageMatches.collectAsState()
    val languageFacets by viewModel.languageFacets.collectAsState()
    val languageSelection = languageSelections[kind] ?: LanguageSelection()
    val matchingIds = if (languageSelection.isEmpty) null else languageMatches[kind]
    val progress by viewModel.progress.collectAsState()
    val progressLoaded by viewModel.progressLoaded.collectAsState()
    val progressByWork = remember(progress) { indexPlayarrProgressByWork(progress) }
    val language = LocalPlayarrLanguage.current
    val plural = kind.playarrPluralLabel()
    val collection = kind.playarrCollectionNoun()
    LaunchedEffect(kind) { viewModel.loadLibrary(kind) }
    LaunchedEffect(Unit) { viewModel.ensureProgressLoaded() }
    LiveRefreshEffect(
        viewModel.liveBus,
        LIBRARY_LIVE_INTEREST,
        { viewModel.libraryFetchStartedMs(kind) },
    ) { viewModel.refreshLibrary(kind) }
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
            var selectedId by remember(kind) { mutableStateOf(state.value.first().id) }
            var contextWork by remember { mutableStateOf<Work?>(null) }
            var activeLetter by remember(kind) { mutableStateOf("#") }
            var filtersOpen by remember { mutableStateOf(false) }
            val viewMode = library.view
            val artworkSize = library.size
            val sortMode = if (library.sort == LibrarySort.DateAdded) "recent" else "title"
            val descending = library.descending
            val filteredWorks = remember(state.value, activeLetter, sortMode, descending, matchingIds) {
                val matching = state.value.filter { work ->
                    (matchingIds == null || work.id in matchingIds) &&
                        (activeLetter == "#" || work.sortTitle.startsWith(activeLetter, ignoreCase = true))
                }
                val sorted = if (sortMode == "recent") matching.sortedBy(Work::addedAt) else matching.sortedBy(Work::sortTitle)
                if (descending) sorted.reversed() else sorted
            }
            val selected = filteredWorks.firstOrNull { it.id == selectedId } ?: filteredWorks.firstOrNull() ?: state.value.first()
            PlayarrPageScaffold(
                title = plural,
                subtitle = playarrString(
                    PlayarrString.LibraryCollectionCount,
                    "count" to java.text.NumberFormat.getIntegerInstance(language.locale).format(state.value.size),
                    "collection" to collection,
                ).uppercase(language.locale),
                onBack = { navController.openExperienceTopLevel("home") },
                isTelevision = isTelevision,
                padBody = false,
                filters = PlayarrFilterAction(
                    label = playarrString(PlayarrString.LibraryFilters),
                    active = filtersOpen,
                    badge = languageSelection.audio.size + languageSelection.subtitle.size,
                    onClick = { filtersOpen = true },
                ),
            ) {
            Box(modifier = Modifier.fillMaxSize().background(WebSurface)) {
        HeroBackdropStack {
                AuthenticatedArtwork(
                    work = selected,
                    kinds = listOf(ImageKind.Backdrop, ImageKind.Poster),
                    serverUrl = serverUrl,
                    accessToken = accessToken,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.heroBackdrop(isTelevision, 0.52f, 0.43f),
                    heroStyle = true,
                )
                Box(Modifier.fillMaxSize().background(heroScrimBrush(isTelevision)))
        }
                if (isTelevision) {
                    Box(Modifier.fillMaxWidth(0.35f).fillMaxHeight().padding(start = 154.dp, top = 259.dp, end = 26.dp), contentAlignment = Alignment.TopStart) { FeatureCopy(selected, true) }
                }
                Column(
                    modifier = Modifier
                        .then(if (isTelevision) Modifier.fillMaxWidth(0.65f).fillMaxHeight().align(Alignment.CenterEnd) else Modifier.fillMaxSize())
                        .background(if (isTelevision) webRailSurfaceBrush() else Brush.linearGradient(listOf(Color.Transparent, Color.Transparent)))
                        .windowInsetsPadding(if (isTelevision) WindowInsets(0) else WindowInsets.statusBars)
                        .padding(top = if (isTelevision) 76.dp else 18.dp),
                ) {
                    Spacer(Modifier.height(if (isTelevision) 64.dp else 54.dp))
if (filteredWorks.isEmpty() && matchingIds != null) {
                        Text(
                            playarrString(PlayarrString.LibraryNoMatches),
                            color = WebInkMuted,
                            fontSize = 14.sp,
                            modifier = Modifier.padding(24.dp),
                        )
                    } else {
                    LibraryResults(
                        works = filteredWorks,
                        viewMode = viewMode,
                        artworkSize = artworkSize,
                        serverUrl = serverUrl,
                        accessToken = accessToken,
                        isTelevision = isTelevision,
                        selectedId = selectedId,
                        progressByWork = progressByWork,
                        progressLoaded = progressLoaded,
                        onSelected = { selectedId = it.id },
                        onOpen = { navController.navigate("experience-detail/${it.id}") },
                        onContext = { contextWork = it },
                    )
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
            }
            // The facet list is only fetched on a selection change otherwise, so a first
            // open of the sheet showed "No languages indexed yet" and no filter was reachable.
            LaunchedEffect(kind, filtersOpen) {
                if (filtersOpen) viewModel.loadLanguageFacets(kind, languageSelection)
            }
            if (filtersOpen) {
                LibraryFiltersDialog(
                    kind = kind,
                    viewMode = viewMode,
                    artworkSize = artworkSize,
                    sortMode = sortMode,
                    descending = descending,
                    languageSelection = languageSelection,
                    languageFacets = languageFacets,
                    onLanguageSelection = { viewModel.setLanguageSelection(kind, it) },
                    onViewMode = { updateLibrary(library.copy(view = it)) },
                    onArtworkSize = { updateLibrary(library.copy(size = it)) },
                    onSortMode = {
                        updateLibrary(library.copy(sort = if (it == "title") LibrarySort.Title else LibrarySort.DateAdded))
                        if (it != "title") activeLetter = "#"
                    },
                    onDescending = { updateLibrary(library.copy(descending = it)) },
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
    val extrasEligible = libraryId == null && mediaFilter in setOf(
        PlayarrSearchMediaType.All,
        PlayarrSearchMediaType.Movie,
        PlayarrSearchMediaType.Series,
    )
    fun submitSearch(debounce: Boolean) {
        viewModel.search(query, mediaFilter, libraryId, debounce)
    }
    LaunchedEffect(Unit) { viewModel.prepareSearch() }
    LiveRefreshEffect(viewModel.liveBus, SEARCH_LIVE_INTEREST, { viewModel.searchFetchStartedMs }, viewModel::refreshSearch)
    LaunchedEffect(searchResults) {
        searchResults?.let { selectedResultKey = playarrSearchSelection(it, selectedResultKey) }
    }
    LaunchedEffect(availableKinds, mediaFilter) {
        if (mediaFilter.workKind != null && availableKinds?.contains(mediaFilter.workKind) == false) {
            mediaFilter = PlayarrSearchMediaType.All
            viewModel.search(query, mediaFilter, libraryId, debounce = false)
        }
    }
    val resultStatus = if (query.isBlank()) null else when (val current = state) {
        ExperienceLoad.Loading -> playarrString(PlayarrString.SearchSearching)
        is ExperienceLoad.Ready -> playarrString(
            if (current.value.count == 1) PlayarrString.SearchResultCountOne else PlayarrString.SearchResultCountOther,
            "count" to current.value.count,
        )
        is ExperienceLoad.Failed -> playarrString(PlayarrString.SearchZeroResults)
    }
    PlayarrPageScaffold(
        title = playarrString(PlayarrString.SearchTitle),
        subtitle = resultStatus,
        onBack = { navController.openExperienceTopLevel("home") },
        isTelevision = isTelevision,
    ) {
        OutlinedTextField(
            value = query,
            onValueChange = {
                query = it
                viewModel.search(it, mediaFilter, libraryId, debounce = true)
            },
            modifier = Modifier
                .fillMaxWidth(if (isTelevision) 0.58f else 1f)
                .padding(top = 18.dp)
                .playarrSingleLineArrowNavigation(),
            placeholder = { Text(playarrString(PlayarrString.SearchPlaceholder)) },
            leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
            trailingIcon = if (query.isNotEmpty()) {
                {
                    PlayarrButton(
                        onClick = {
                            query = ""
                            viewModel.search("", mediaFilter, libraryId, debounce = false)
                        },
                        variant = PlayarrButtonVariant.Ghost,
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
        PlayarrButton(
            onClick = { filtersOpen = !filtersOpen },
            modifier = Modifier.padding(top = 10.dp),
            variant = PlayarrButtonVariant.Secondary,
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
                    PlayarrButton(
                        onClick = {
                            mediaFilter = type
                            if (type == PlayarrSearchMediaType.Playlist) libraryId = null
                            submitSearch(debounce = false)
                        },
                        enabled = mediaFilter != type,
                        modifier = Modifier.height(36.dp),
                        contentPadding = PaddingValues(horizontal = 12.dp),
                        variant = PlayarrButtonVariant.Secondary,
                    ) { Text(playarrString(type.label), fontSize = 10.sp) }
                }
            }
            Text(playarrString(PlayarrString.SearchLibrary), color = WebInkMuted, fontSize = 10.sp, modifier = Modifier.padding(top = 8.dp))
            LazyRow(
                modifier = Modifier.fillMaxWidth().padding(top = 5.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                item {
                    PlayarrButton(
                        onClick = {
                            libraryId = null
                            submitSearch(debounce = false)
                        },
                        enabled = libraryId != null,
                        modifier = Modifier.height(36.dp),
                        contentPadding = PaddingValues(horizontal = 12.dp),
                        variant = PlayarrButtonVariant.Secondary,
                    ) { Text(playarrString(PlayarrString.SearchAll), fontSize = 10.sp) }
                }
                items(views, key = ViewSummary::id) { view ->
                    PlayarrButton(
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
                        variant = PlayarrButtonVariant.Secondary,
                    ) { Text(view.name, fontSize = 10.sp) }
                }
            }
        }
        if (query.isNotBlank() && (selectedWork != null || selectedPlaylist != null)) {
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
            } else if (mediaFilter == PlayarrSearchMediaType.Game) {
                DiscoveryExtrasSection(
                    query = query.trim(),
                    gamesOnly = true,
                    navController = navController,
                    modifier = Modifier.fillMaxSize().padding(top = 22.dp),
                )
            } else if (current.value.works.isEmpty() && current.value.playlists.isEmpty() && !extrasEligible) {
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
                    if (extrasEligible) {
                        item(span = { GridItemSpan(maxLineSpan) }, key = "discovery-extras") {
                            DiscoveryExtrasSection(
                                query = query.trim(),
                                gamesOnly = false,
                                navController = navController,
                            )
                        }
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
                is PlayarrResult.Success -> result.value.toDownloadCandidates(language)
                is PlayarrResult.Failure -> emptyList()
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
    PlayarrPanel(
        onDismissRequest = onDismiss,
        title = { Text(work.title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                PlayarrButton(onClick = onOpen, modifier = Modifier.fillMaxWidth()) {
                    Text(playarrString(PlayarrString.ContextOpen))
                }
                PlayarrButton(onClick = { addToPlaylist = true }, modifier = Modifier.fillMaxWidth(), variant = PlayarrButtonVariant.Secondary) {
                    Text(playarrString(PlayarrString.ContextAddToPlaylist))
                }
                if (canDownload) {
                    PlayarrButton(
                        onClick = {
                            resolvingDownload = true
                            viewModel.resolveDownloadCandidates(work, language) { candidates ->
                                resolvingDownload = false
                                downloadCandidates = candidates
                            }
                        },
                        enabled = !resolvingDownload,
                        modifier = Modifier.fillMaxWidth(),
                        variant = PlayarrButtonVariant.Secondary,
                    ) {
                        Text(
                            playarrString(
                                if (resolvingDownload) PlayarrString.ContextResolving else PlayarrString.ContextDownload,
                            ),
                        )
                    }
                }
                PlayarrButton(onClick = { onMark(true) }, modifier = Modifier.fillMaxWidth(), variant = PlayarrButtonVariant.Secondary) {
                    Text(playarrString(PlayarrString.ContextMarkWatched))
                }
                PlayarrButton(onClick = { onMark(false) }, modifier = Modifier.fillMaxWidth(), variant = PlayarrButtonVariant.Secondary) {
                    Text(playarrString(PlayarrString.ContextMarkUnwatched))
                }
            }
        },
        confirmButton = { PlayarrButton(onClick = onDismiss) { Text(playarrString(PlayarrString.CommonClose)) } },
    )
    if (addToPlaylist) {
        AddToPlaylistDialog(
            workId = work.id,
            trackId = null,
            mediaType = if (work.kind == WorkKind.Artist) io.playarr.shared.data.model.PlaylistMediaType.Audio else io.playarr.shared.data.model.PlaylistMediaType.Video,
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
    private val api: PlayarrApi,
    private val workSourceSelector: PlayarrWorkSourceSelector,
    val liveBus: LiveInvalidationBus,
) : ViewModel() {
    private val fetchStamp = LiveFetchStamp()
    private var currentWorkId: String? = null
    private var refreshJob: Job? = null

    /** Start of the latest fetch of the open title (`0` before the first). */
    val fetchStartedMs: Long get() = fetchStamp.startedMs

    private val _state = MutableStateFlow<ExperienceLoad<ExperienceDetailSnapshot>>(ExperienceLoad.Loading)
    val state = _state.asStateFlow()
    private val _message = MutableStateFlow<ExperienceDetailMessage?>(null)
    val message = _message.asStateFlow()
    private val _sourceChoices = MutableStateFlow<ExperienceLoad<List<PlayarrWorkSourceChoice>>>(ExperienceLoad.Loading)
    val sourceChoices = _sourceChoices.asStateFlow()
    private val _sourceSelection = MutableStateFlow<PlayarrSourceSelection>(PlayarrSourceSelection.Idle)
    val sourceSelection = _sourceSelection.asStateFlow()
    private var loadJob: Job? = null

    /**
     * Live-event / fallback refresh of the open title: detail (seasons, episodes, files),
     * watch progress and, for series, availability lag are swapped in place; the
     * current content stays on screen until the new arrives.
     */
    fun refresh() {
        val id = currentWorkId ?: return
        if (_state.value !is ExperienceLoad.Ready) return
        refreshJob?.cancel()
        refreshJob = viewModelScope.launch {
            fetchStamp.begin()
            val detail = (getWorkDetails(id) as? PlayarrResult.Success)?.value ?: return@launch
            val progress = runCatching { api.listWatchProgress() }.getOrNull()
            updateSnapshot(id) {
                copy(
                    detail = detail,
                    progressByMedia = progress?.associateBy(WatchProgress::mediaFileId) ?: progressByMedia,
                )
            }
            if (detail.children is WorkChildren.Series) {
                val lag = runCatching { api.getAvailabilityLag(id) }.getOrNull()
                if (lag != null) updateSnapshot(id) { copy(availabilityLag = lag) }
            }
        }
    }

    fun load(id: String) {
        loadJob?.cancel()
        refreshJob?.cancel()
        currentWorkId = id
        loadJob = viewModelScope.launch {
            fetchStamp.begin()
            _state.value = ExperienceLoad.Loading
            _sourceChoices.value = ExperienceLoad.Loading
            _sourceSelection.value = PlayarrSourceSelection.Idle
            when (val result = getWorkDetails(id)) {
                is PlayarrResult.Success -> {
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
                    if (detail.children is WorkChildren.Series) {
                        launch {
                            val lag = runCatching { api.getAvailabilityLag(detail.work.id) }.getOrNull()
                            updateSnapshot(detail.work.id) { copy(availabilityLag = lag) }
                        }
                        launch {
                            val plan = runCatching { api.getResumePlan(detail.work.id) }.getOrNull()
                            updateSnapshot(detail.work.id) { copy(resumePlan = plan) }
                        }
                    }
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
                is PlayarrResult.Failure -> {
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

    private suspend fun loadPlayarrSimilarWorks(work: Work): List<Work> = loadPlayarrSimilarWorks(api, work)

    /** Reports the option the viewer picked so declined gaps and rewatch answers are remembered. */
    fun recordResumeChoice(seriesWorkId: String, option: io.playarr.shared.data.model.ResumeOption) {
        viewModelScope.launch {
            val plan = runCatching {
                api.recordResumeChoice(
                    seriesWorkId,
                    io.playarr.shared.data.model.ResumeChoiceRequest(option.kind, option.episodeId),
                )
            }.getOrNull() ?: return@launch
            updateSnapshot(seriesWorkId) { copy(resumePlan = plan) }
        }
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

internal suspend fun loadPlayarrSimilarWorks(api: PlayarrApi, work: Work): List<Work> {
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
    /** Series only; null while loading or when the server cannot supply it. */
    val availabilityLag: io.playarr.shared.data.model.AvailabilityLag? = null,
    /** Series only; what Start/Resume should do. Null while loading or on an older server. */
    val resumePlan: io.playarr.shared.data.model.ResumePlan? = null,
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
    val liveInterest = remember(workId) { setOf(LiveTarget(LiveArea.Work, workId)) }
    LiveRefreshEffect(viewModel.liveBus, liveInterest, { viewModel.fetchStartedMs }, viewModel::refresh)
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
            PlayarrPageScaffold(
                title = detail.work.kind.playarrPluralLabel(),
                subtitle = detail.work.title,
                onBack = onBack,
                isTelevision = isTelevision,
                padBody = false,
            ) {
            Box(Modifier.fillMaxSize()) {
                val artistChildren = detail.children as? WorkChildren.Artist
                if (artistChildren != null) {
                    ExperienceMusicDetailContent(
                        detail = detail,
                        children = artistChildren,
                        progressByMedia = progressByMedia,
                        initialMediaFileId = initialMediaFileId,
                        serverUrl = serverUrl,
                        accessToken = accessToken,
                        isTelevision = isTelevision,
                        canDownload = canDownload,
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
                        availabilityLag = current.value.availabilityLag,
                        resumePlan = current.value.resumePlan,
                        onResumeChoice = { option -> viewModel.recordResumeChoice(detail.work.id, option) },
                        initialMediaFileId = initialMediaFileId,
                        serverUrl = serverUrl,
                        accessToken = accessToken,
                        isTelevision = isTelevision,
                        canDownload = canDownload,
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
        HeroBackdropStack {
                    AuthenticatedArtwork(
                        work = detail.work,
                        kinds = listOf(ImageKind.Backdrop, ImageKind.Poster),
                        serverUrl = serverUrl,
                        accessToken = accessToken,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.heroBackdrop(isTelevision, 0.55f, 0.48f),
                        heroStyle = true,
                    )
                    Box(Modifier.fillMaxSize().background(heroScrimBrush(isTelevision)))
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
            }
            if (addWorkToPlaylist) {
                AddToPlaylistDialog(
                    workId = detail.work.id,
                    trackId = pendingPlaylistTrackId,
                    mediaType = if (detail.work.kind == WorkKind.Artist) io.playarr.shared.data.model.PlaylistMediaType.Audio else io.playarr.shared.data.model.PlaylistMediaType.Video,
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
    PlayarrPanel(
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
                        PlayarrButton(onClick = onRetry, variant = PlayarrButtonVariant.Secondary) { Text(playarrString(PlayarrString.CommonTryAgain)) }
                    }
                    is ExperienceLoad.Ready -> {
                        Text(
                            playarrString(PlayarrString.ServerChoiceAvailable, "count" to choices.value.size),
                            color = WebPink,
                            fontSize = 11.sp,
                        )
                        Text(playarrString(PlayarrString.ServerChoiceChoose), color = WebInkMuted)
                        choices.value.forEachIndexed { index, choice ->
                            PlayarrButton(
                                onClick = { onSelect(choice) },
                                enabled = selection !is PlayarrSourceSelection.Selecting,
                                modifier = Modifier.fillMaxWidth().then(
                                    if (index == 0) Modifier.focusRequester(firstChoiceFocus) else Modifier,
                                ),
                                variant = PlayarrButtonVariant.Secondary,
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
        dismissButton = { PlayarrButton(onClick = onCancel, variant = PlayarrButtonVariant.Ghost) { Text(playarrString(PlayarrString.CommonCancel)) } },
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
    availabilityLag: io.playarr.shared.data.model.AvailabilityLag?,
    resumePlan: io.playarr.shared.data.model.ResumePlan?,
    onResumeChoice: (io.playarr.shared.data.model.ResumeOption) -> Unit,
    initialMediaFileId: String?,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    canDownload: Boolean,
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
        HeroBackdropStack {
        AuthenticatedArtwork(
            work = detail.work,
            kinds = listOf(ImageKind.Backdrop, ImageKind.Poster),
            serverUrl = serverUrl,
            accessToken = accessToken,
            contentScale = ContentScale.Crop,
            modifier = Modifier.heroBackdrop(isTelevision, 0.55f, 0.48f),
            heroStyle = true,
        )
        Box(
            Modifier.fillMaxSize().background(heroScrimBrush(isTelevision)),
        )
        }
        ReportDetailSection(detail.work.kind)

        if (isTelevision) {
            Column(
                Modifier
                    .width(455.dp + 154.dp + 28.dp)
                    .fillMaxHeight()
                    .padding(start = 154.dp, top = 259.dp, end = 28.dp, bottom = 64.dp),
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
                availabilityLag?.let { PlayarrAvailabilityLagLine(it) }
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
                    resumePlan = resumePlan,
                    onResumeChoice = onResumeChoice,
                    autoFocusPlay = true,
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
                        .fillMaxWidth(0.62f)
                        .fillMaxHeight()
                        .align(Alignment.CenterEnd),
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
                availabilityLag?.let { lag -> item { PlayarrAvailabilityLagLine(lag) } }
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
                        resumePlan = resumePlan,
                        onResumeChoice = onResumeChoice,
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
    val year = work.releaseDate?.atZone(java.time.ZoneOffset.UTC)?.year
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // Web `.tv-detail-kicker`: 12px / 820 / .08em, accent.
        Text(
            if (episodeNumber != null) {
                "S${seasonNumber.toString().padStart(2, '0')} · E${episodeNumber.toString().padStart(2, '0')}"
            } else {
                (work.genres.firstOrNull() ?: work.kind.playarrSingularLabel()).uppercase(language.locale)
            },
            color = WebKicker,
            fontSize = 12.sp,
            fontWeight = FontWeight(820),
            letterSpacing = 1.sp,
        )
        // Web detail h1: 69px, 0.9 line height, -0.072em tracking, weight 560.
        Text(
            work.title,
            color = WebInk,
            fontSize = if (isTelevision) 69.sp else 38.sp,
            lineHeight = if (isTelevision) 62.sp else 38.sp,
            fontWeight = FontWeight(560),
            letterSpacing = if (isTelevision) (-5).sp else (-1.5).sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        episode?.episode?.title?.let { title ->
            Text(
                title,
                color = WebInkSoft,
                fontSize = if (isTelevision) 21.sp else 18.sp,
                fontWeight = FontWeight(570),
                letterSpacing = (-0.7).sp,
            )
        }
        // Web `.tv-detail-meta`: first chip Ink Soft / 680, the rest muted, 0.85rem apart, no separators.
        val metaItems = buildList {
            if (episodeNumber != null) {
                add(playarrString(PlayarrString.DetailSeasonNumber, "number" to (seasonNumber ?: 0)))
                add("S${seasonNumber.toString().padStart(2, '0')} · E${episodeNumber.toString().padStart(2, '0')}")
            }
            episode?.episode?.runtimeMinutes?.let {
                add(playarrString(PlayarrString.DetailRuntimeMinutes, "minutes" to it))
            }
            if (episode == null && movieRuntimeMs != null && movieRuntimeMs > 0L) {
                add(formatPlayarrVideoRuntime(movieRuntimeMs, language))
            }
            year?.let { add(it.toString()) }
            episode?.episode?.airDate?.let {
                val date = java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy", language.locale)
                    .format(it)
                add(playarrString(PlayarrString.DetailAired, "date" to date))
            }
            if (episodeNumber != null) addAll(work.genres.take(1)) else add(work.genres.take(3).joinToString(" · "))
        }.filter(String::isNotBlank)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            metaItems.forEachIndexed { index, item ->
                Text(
                    item,
                    color = if (index == 0) WebInkSoft else WebInkMuted,
                    fontSize = 11.sp,
                    fontWeight = if (index == 0) FontWeight(680) else FontWeight.Normal,
                )
            }
        }
        Text(
            episode?.episode?.overview?.takeIf(String::isNotBlank)
                ?: work.overview?.takeIf(String::isNotBlank)
                ?: playarrString(
                    if (episode == null) PlayarrString.DetailNoSynopsis else PlayarrString.DetailNoEpisodeSynopsis,
                ),
            color = WebInkSoft,
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
    resumePlan: io.playarr.shared.data.model.ResumePlan? = null,
    onResumeChoice: (io.playarr.shared.data.model.ResumeOption) -> Unit = {},
    autoFocusPlay: Boolean = false,
) {
    if (mediaFileId == null) {
        Text(playarrString(PlayarrString.DetailNoPlayableMedia), color = WebInkMuted)
        return
    }
    // Television: start D-pad focus on Play (as Playarr Web does) instead of the
    // first focusable item in the navigation rail.
    val playFocus = remember { FocusRequester() }
    LaunchedEffect(mediaFileId, autoFocusPlay) {
        if (autoFocusPlay) runCatching { playFocus.requestFocus() }
    }
    val title = episode?.episode?.title
        ?: episode?.let {
            playarrString(PlayarrString.DetailEpisodeNumber, "number" to it.episode.episodeNumber)
        }
        ?: work.title
    // Series: the primary button is the server's smart Start/Resume.
    val smartPlan = resumePlan?.takeIf { work.kind == WorkKind.Series && it.target != null }
    var chooserOpen by remember(work.id) { mutableStateOf(false) }
    val smartDescription = smartPlan?.let { playarrString(it.buttonTitle(), "title" to work.title) }
    if (smartPlan != null && chooserOpen) {
        PlayarrResumeChooserDialog(
            plan = smartPlan,
            seriesTitle = work.title,
            onDismiss = { chooserOpen = false },
            onSelect = { option ->
                chooserOpen = false
                onResumeChoice(option)
                onPlay(option.mediaFileId, null, null)
            },
        )
    }
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        PlayarrButton(
            onClick = {
                val target = smartPlan?.target
                when {
                    smartPlan != null && smartPlan.isStacked -> chooserOpen = true
                    target != null -> onPlay(target.mediaFileId, null, null)
                    else -> onPlay(mediaFileId, null, launchSettings)
                }
            },
            modifier = Modifier.focusRequester(playFocus).then(
                if (smartDescription != null) {
                    Modifier.semantics { contentDescription = smartDescription }
                } else {
                    Modifier
                },
            ),
        ) {
            Icon(Icons.Outlined.PlayArrow, contentDescription = null)
            Text(
                if (smartPlan != null) {
                    playarrString(smartPlan.buttonLabel())
                } else if (progress?.state == WatchState.PartWatched) {
                    playarrString(
                        PlayarrString.DetailResumeFrom,
                        "position" to formatPlayarrPlayerTime(progress.positionMs),
                    )
                } else {
                    playarrString(PlayarrString.DetailPlay)
                },
            )
        }
        HeroOutlinedButton(onClick = { onAddToPlaylist(episode?.episode?.id) }) {
            Icon(Icons.Outlined.Add, contentDescription = null)
            Text(playarrString(PlayarrString.ContextAddToPlaylist))
        }
        WatchlistToggleButton(work)
        onPlaybackSettings?.let { openSettings ->
            HeroOutlinedButton(onClick = openSettings) { Text(playarrString(PlayarrString.DetailPlayback)) }
        }
        if (canDownload) {
            PlayarrIconButton(
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
                contentDescription = playarrString(PlayarrString.DetailDownloadTitle, "title" to title),
            ) {
                Icon(
                    Icons.Outlined.Download,
                    contentDescription = null,
                    tint = WebInk)
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
    PlayarrPanel(
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
            PlayarrButton(
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
        dismissButton = { PlayarrButton(onClick = onDismiss, variant = PlayarrButtonVariant.Ghost) { Text(playarrString(PlayarrString.CommonCancel)) } },
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
            PlayarrButton(
                onClick = { onSelected(id) },
                enabled = id != selected,
                modifier = Modifier.fillMaxWidth(),
                variant = PlayarrButtonVariant.Secondary,
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
    // TV: web layout, seasons sit directly on the rail gradient; phones keep the glass panel.
    Column(
        modifier = modifier
            .then(
                if (isTelevision) {
                    Modifier.background(webRailSurfaceBrush()).padding(start = 152.dp, top = 404.dp)
                } else {
                    Modifier.glass(RoundedCornerShape(16.dp), WebGlass.Panel).padding(14.dp)
                },
            ),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        if (!isTelevision) Text(
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
                subtitle = if (isTelevision) playarrString(PlayarrString.DetailEpisodeCount, "count" to season.episodes.size) else null,
                onDownloadAll = onDownload,
            )
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(if (isTelevision) 25.dp else 12.dp),
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
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(24.dp), contentPadding = PaddingValues(bottom = 80.dp)) {
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
    val episodeScale = rememberPlayarrFocusScale(
        focused = focused,
        focusedScale = FocusMotion.tileFocusScale,
        label = "episodeFocus",
    )
    Column(Modifier.width(if (isTelevision) 268.dp else 184.dp)) {
        Surface(
            onClick = onPlay,
            enabled = available,
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f)
                .scale(episodeScale)
                .onFocusChanged { state -> focused = state.isFocused; if (state.isFocused) onSelect() }
                .then(
                    when {
                        isTelevision && focused -> Modifier.border(2.dp, WebInk.copy(alpha = 0.92f), RoundedCornerShape(10.dp))
                        !isTelevision && selected -> Modifier.border(2.dp, WebPink, RoundedCornerShape(10.dp))
                        else -> Modifier
                    },
                ),
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
                // Layered bottom to top: series art, frame thumbnail, then the
                // episode's own still, so the still wins when the source has one
                // and each layer simply shows through if the one above fails.
                episode.mediaFileId?.let { mediaFileId ->
                    AuthenticatedMediaThumbnail(
                        mediaFileId = mediaFileId,
                        serverUrl = serverUrl,
                        accessToken = accessToken,
                        contentDescription = "",
                        modifier = Modifier.fillMaxSize(),
                    )
                    if (episode.episode.images.any { it.kind == ImageKind.Thumb }) {
                        AuthenticatedMediaThumbnail(
                            mediaFileId = mediaFileId,
                            serverUrl = serverUrl,
                            accessToken = accessToken,
                            contentDescription = "",
                            modifier = Modifier.fillMaxSize(),
                            artworkUrl = { base ->
                                resolveEpisodeArtworkUrl(base, work.id, episode.episode.id)
                            },
                        )
                    }
                }
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.72f)))))
                if (isTelevision) {
                    // Web `.tv-episode-number`: large index bottom-right.
                    Text(
                        episode.episode.episodeNumber.toString().padStart(2, '0'),
                        color = Color.White,
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.align(Alignment.BottomEnd).padding(end = 12.dp, bottom = 8.dp),
                    )
                } else {
                    Text(
                        "S${seasonNumber.toString().padStart(2, '0')} · E${episode.episode.episodeNumber.toString().padStart(2, '0')}",
                        color = Color.White,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.ExtraBold,
                        modifier = Modifier.align(Alignment.BottomStart).padding(10.dp),
                    )
                }
                progress?.takeIf { it.state != WatchState.Unseen }?.let {
                    Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(3.dp).background(Color.White.copy(alpha = 0.28f))) {
                        Box(Modifier.fillMaxWidth(it.fraction).fillMaxHeight().background(WebPink))
                    }
                }
                if (available && shouldShowPlayarrUnwatchedDot(progress, progressLoaded = true)) {
                    PlayarrUnwatchedDot(Modifier.align(Alignment.TopEnd).padding(8.dp))
                }
            }
        }
        val code = "S${seasonNumber.toString().padStart(2, '0')} · E${episode.episode.episodeNumber.toString().padStart(2, '0')}"
        val title = episode.episode.title ?: playarrString(
            PlayarrString.DetailEpisodeNumber,
            "number" to episode.episode.episodeNumber,
        )
        if (isTelevision) {
            // Web: muted code and bold title inline, no duration line.
            Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(code, color = WebInkMuted, fontSize = 9.sp, fontWeight = FontWeight(680), maxLines = 1)
                Text(
                    title,
                    color = if (available) WebInk else WebInkMuted,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
            if (!available) Text(playarrString(PlayarrString.DetailUnavailable), color = WebInkMuted, fontSize = 10.sp)
        } else {
            Text(
                title,
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
        .glass(RoundedCornerShape(16.dp), WebGlass.Panel)
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
                            modifier = Modifier.width(if (isTelevision) 260.dp else 188.dp),
                        ) {
                            Column {
                                Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).background(WebSurfaceSoft)) {
                                    AuthenticatedMediaThumbnail(
                                        mediaFileId = mediaFileId,
                                        serverUrl = serverUrl,
                                        accessToken = accessToken,
                                        contentDescription = "",
                                        positionMs = chapter.startMs,
                                        fallbackLabel = chapter.title ?: playarrString(
                                            PlayarrString.DetailChapterNumber,
                                            "number" to chapter.index + 1,
                                        ),
                                        modifier = Modifier.fillMaxSize(),
                                    )
                                    Text(
                                        (chapter.index + 1).toString().padStart(2, '0'),
                                        color = Color.White,
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.Bold,
                                        modifier = Modifier
                                            .align(Alignment.TopStart)
                                            .padding(8.dp)
                                            .background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(6.dp))
                                            .padding(horizontal = 7.dp, vertical = 2.dp),
                                    )
                                }
                                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(formatPlayarrPlayerTime(chapter.startMs), color = WebInkMuted, fontSize = 11.sp)
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
                                }
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
    progressByMedia: Map<String, WatchProgress>,
    initialMediaFileId: String?,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    canDownload: Boolean,
    onPlay: (mediaFileId: String, albumId: String) -> Unit,
    onAddToPlaylist: (trackId: String) -> Unit,
    onDownload: (List<DownloadCandidate>) -> Unit,
) {
    val language = LocalPlayarrLanguage.current
    ReportDetailSection(detail.work.kind)
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
        HeroBackdropStack {
        if (detail.work.images.any { it.kind == ImageKind.Backdrop }) {
            AuthenticatedArtwork(
                work = detail.work,
                kinds = listOf(ImageKind.Backdrop),
                serverUrl = serverUrl,
                accessToken = accessToken,
                contentScale = ContentScale.Crop,
                modifier = Modifier.heroBackdrop(isTelevision, 0.58f, 0.42f),
                heroStyle = true,
            )
        } else if (selectedAlbum != null) {
            AuthenticatedAlbumArtwork(
                artistWork = detail.work,
                albumId = selectedAlbum.album.id,
                serverUrl = serverUrl,
                accessToken = accessToken,
                modifier = Modifier.heroBackdrop(isTelevision, 0.58f, 0.42f),
                heroStyle = true,
            )
        }
        Box(
            Modifier.fillMaxSize().background(heroScrimBrush(isTelevision)),
        )
        }
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                start = if (isTelevision) 118.dp else 16.dp,
                end = if (isTelevision) 64.dp else 16.dp,
                top = if (isTelevision) 130.dp else 92.dp,
                bottom = if (isTelevision) 118.dp else 110.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(if (isTelevision) 24.dp else 16.dp),
        ) {
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
                                PlayarrIconButton(onClick = { onDownload(albumDownloads) }, contentDescription = playarrString(
                                            PlayarrString.DetailDownloadTitle,
                                            "title" to album.album.title,
                                        )) {
                                    Icon(
                                        Icons.Outlined.Download,
                                        contentDescription = null,
                                        tint = WebInk)
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
                            progress = track.mediaFileId?.let(progressByMedia::get),
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
    val albumScale = rememberPlayarrFocusScale(
        focused = focused,
        focusedScale = FocusMotion.navSelectedScale,
        label = "albumFocus",
    )
    Column(
        modifier = Modifier.width(if (isTelevision) 200.dp else 142.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Surface(
            onClick = onPlay,
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .scale(albumScale)
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
    progress: WatchProgress?,
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
            if (shouldShowPlayarrUnwatchedDot(progress, progressLoaded = true)) {
                PlayarrUnwatchedDot(Modifier.size(8.dp))
            }
            PlayarrIconButton(onClick = onAddToPlaylist, contentDescription = playarrString(
                        PlayarrString.MusicAddTrackToPlaylist,
                        "title" to track.track.title,
                    )) {
                Icon(
                    Icons.Outlined.Add,
                    contentDescription = null,
                    tint = WebInkMuted)
            }
            if (canDownload) {
                PlayarrIconButton(
                    onClick = {
                        onDownload(DownloadCandidate(mediaFileId, artistWorkId, track.track.title, artistTitle, posterUrl, "track"))
                    },
                    contentDescription = playarrString(
                            PlayarrString.DetailDownloadTitle,
                            "title" to track.track.title,
                        ),
                ) {
                    Icon(
                        Icons.Outlined.Download,
                        contentDescription = null,
                        tint = WebInkMuted)
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
private fun SectionHeaderRow(
    title: String,
    candidates: List<DownloadCandidate>,
    subtitle: String? = null,
    onDownloadAll: (List<DownloadCandidate>) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, color = WebInk, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
            if (subtitle != null) Text(subtitle, color = WebInkMuted, fontSize = 10.sp, modifier = Modifier.padding(top = 2.dp))
        }
        if (candidates.isNotEmpty()) {
            PlayarrIconButton(onClick = { onDownloadAll(candidates) }, contentDescription = playarrString(
                        PlayarrString.ContextDownloadCount,
                        "count" to candidates.size,
                    )) {
                Icon(
                    Icons.Outlined.Download,
                    contentDescription = null,
                    tint = WebInkMuted)
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
                PlayarrIconButton(onClick = add, contentDescription = playarrString(PlayarrString.ContextAddToPlaylist)) {
                    Icon(
                        Icons.Outlined.Add,
                        contentDescription = null,
                        tint = WebInkMuted)
                }
            }
            onDownload?.let { download ->
                PlayarrIconButton(onClick = download, contentDescription = playarrString(PlayarrString.ContextDownload)) {
                    Icon(
                        Icons.Outlined.Download,
                        contentDescription = null,
                        tint = WebInkMuted)
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

/** The sender only ever sends *intent* over Playarr Cast, never a raw negotiated URL -- the receiver does its own negotiation, so no local/on-demand session or transcode profile carries over. */
private fun PlayarrPlaybackQueueItem.playarrCastItemKind(): PlayarrCastItemKind = when {
    music -> PlayarrCastItemKind.Track
    seasonNumber != null && episodeNumber != null -> PlayarrCastItemKind.Episode
    artworkWork?.kind == WorkKind.Movie -> PlayarrCastItemKind.Movie
    else -> PlayarrCastItemKind.Other
}

private fun PlayarrPlaybackQueueItem.toPlayarrCastItem(language: PlayarrLanguageState): PlayarrCastItem = PlayarrCastItem(
    mediaFileId = mediaFileId,
    workId = artworkWork?.id,
    kind = playarrCastItemKind(),
    title = displayTitle(language),
    subtitle = subtitle,
    seasonNumber = seasonNumber,
    episodeNumber = episodeNumber,
    releaseDate = artworkWork?.releaseDate?.toString(),
)

private fun PlayarrPlaybackQueueItem.toPlayarrCastQueueEntry(language: PlayarrLanguageState): PlayarrCastQueueEntry = PlayarrCastQueueEntry(
    mediaFileId = mediaFileId,
    workId = artworkWork?.id,
    kind = playarrCastItemKind(),
    title = displayTitle(language),
    subtitle = subtitle,
    seasonNumber = seasonNumber,
    episodeNumber = episodeNumber,
)

@HiltViewModel
internal class ExperiencePlayerViewModel @Inject constructor(
    val player: PlayarrPlayer,
    private val getPlaybackInfo: GetPlaybackInfoUseCase,
    private val api: PlayarrApi,
    private val serverAccessResolver: PlayarrServerAccessResolver,
    private val downloadRepository: DownloadRepository,
    private val offlineProgressRepository: OfflineProgressRepository,
    private val castSession: PlayarrCastSession,
    private val delegatedDeviceAuth: PlayarrDelegatedDeviceAuth,
) : ViewModel() {
    private val _state = MutableStateFlow<ExperienceLoad<Unit>>(ExperienceLoad.Loading)
    val state = _state.asStateFlow()
    private val _controls = MutableStateFlow(PlayarrPlaybackControls())
    val controls = _controls.asStateFlow()
    private val _suggestions = MutableStateFlow<List<Work>>(emptyList())

    /** End-of-playback suggestions for [suggestionsWorkId]. */
    val suggestions = _suggestions.asStateFlow()
    private var suggestionsWorkId: String? = null
    val castAvailable: Boolean get() = castSession.isAvailable
    val castConnection: StateFlow<PlayarrCastConnectionState> = castSession.connectionState
    val castRoutes: StateFlow<List<PlayarrCastRoute>> = castSession.routes
    private val castReceiverState: StateFlow<PlayarrCastStateMessage?> = castSession.receiverState
    private val _castingMediaFileId = MutableStateFlow<String?>(null)
    val castingMediaFileId: StateFlow<String?> = _castingMediaFileId.asStateFlow()

    /** While casting a currently-loaded item, shows the RECEIVER's reported track/quality options instead of this device's own (never-negotiated, for this item) local ones -- see this file's Ground Truth notes on the receiver owning negotiation while a cast is active. */
    val effectiveControls: StateFlow<PlayarrPlaybackControls> = combine(
        _controls,
        _castingMediaFileId,
        castReceiverState,
    ) { local, castingId, receiverState ->
        if (castingId != null && receiverState != null && receiverState.mediaFileId == castingId) {
            PlayarrPlaybackControls(
                qualityOptions = receiverState.qualityOptions.map { option ->
                    io.playarr.shared.data.model.PlaybackQualityOption(
                        id = option.id,
                        label = option.label,
                        height = option.height,
                        videoBitrateBps = option.videoBitrateBps,
                    )
                },
                activeQualityId = receiverState.selectedQualityId,
                audioTracks = receiverState.audioTracks.map { track ->
                    io.playarr.shared.data.model.PlaybackAudioTrackOption(
                        id = track.id,
                        streamIndex = 0,
                        label = track.label,
                        language = track.language,
                        isDefault = track.isDefault,
                    )
                },
                selectedAudioTrackId = receiverState.selectedAudioTrackId,
                subtitleTracks = receiverState.subtitleTracks.map { track ->
                    io.playarr.shared.data.model.PlaybackSubtitleTrackOption(
                        id = track.id,
                        streamIndex = 0,
                        label = track.label,
                        language = track.language,
                        // Not used by the remote-controls dialog while
                        // casting (only .id/.label/.language/.isDefault are
                        // ever read there) -- codec/url are local-only
                        // concepts fed to player.prepare(...), which never
                        // runs while a Playarr Cast session is active.
                        codec = "",
                        url = "",
                        isDefault = track.isDefault,
                        forced = track.forced,
                    )
                },
                selectedSubtitleTrackId = receiverState.selectedSubtitleTrackId,
                switching = receiverState.negotiating,
            )
        } else {
            local
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PlayarrPlaybackControls())
    private var activeMediaFileId: String? = null
    private var activeRequest: PlayarrPlayRequest? = null
    private var activeServerUrl = ""
    private var activeDefaults = PlayarrPlayerDefaults()
    private var activeSessionId: String? = null
    private var activeSourceOffsetMs = 0L
    private var activeSourceDurationMs = 0L
    private var activeOnDemandHls = false
    private var activePlaybackUrl = ""
    private var automaticRecoveryUrl: String? = null
    private var activeDirectPlay = false
    private var decoderFallbackAttempted = false
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
                        } else if (shouldFallBackToTranscodeAfterDecodeFailure(
                                activeDirectPlay,
                                currentError.message,
                                decoderFallbackAttempted,
                            )
                        ) {
                            decoderFallbackAttempted = true
                            fallBackToTranscode(currentError.message)
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
        viewModelScope.launch {
            castSession.events.collect { message ->
                // Refresh tokens are rotate-on-use -- without persisting a
                // rotation the receiver reports mid-session, the next
                // obtainCredentials() call would redeem an already-consumed
                // token and be forced into a needless full re-mint.
                if (message is PlayarrCastAuthRotatedMessage) {
                    delegatedDeviceAuth.onCredentialsRotated(message.credentials)
                }
            }
        }
        viewModelScope.launch {
            castSession.connectionState.collect { connection ->
                if (connection !is PlayarrCastConnectionState.Connected && connection !is PlayarrCastConnectionState.Connecting) {
                    _castingMediaFileId.value = null
                }
            }
        }
    }

    /** Call once the owning screen enters composition. */
    fun startCastSession() = castSession.start()

    /** Call from the owning screen's teardown. */
    fun stopCastSession() = castSession.stop()

    fun startCastDiscovery(receiverAppId: String) = castSession.startDiscovery(receiverAppId)

    fun stopCastDiscovery() = castSession.stopDiscovery()

    fun selectCastRoute(routeId: String) = castSession.selectRoute(routeId)

    /**
     * Stops local playback (per the design's Ground Truth: the sender must
     * end its own session, reason `user_stopped`, BEFORE handing off, so
     * the receiver -- not this device -- is the only writer of
     * watch-progress/events from this point on) then sends a fully
     * self-negotiating load intent to the connected receiver. Never
     * resolves or sends a raw playback URL itself.
     */
    fun startCasting(
        item: PlayarrPlaybackQueueItem,
        queue: List<PlayarrPlaybackQueueItem>,
        sender: PlayarrCastSender,
        language: PlayarrLanguageState,
    ) {
        val mediaFileId = item.mediaFileId
        val startPositionMs = if (activeMediaFileId == mediaFileId) {
            currentSourcePositionMs()
        } else {
            item.startPositionMs ?: 0L
        }
        viewModelScope.launch {
            val serverUrlForItem = runCatching { serverAccessResolver.forMedia(mediaFileId).serverUrl }
                .getOrDefault(activeServerUrl)
            stopPlayback()
            val credentials = runCatching { delegatedDeviceAuth.obtainCredentials() }.getOrNull() ?: return@launch
            val loaded = castSession.loadMedia(
                PlayarrCastLoadRequest(
                    server = PlayarrCastServer(baseUrl = serverUrlForItem),
                    credentials = credentials,
                    item = item.toPlayarrCastItem(language),
                    playback = PlayarrCastPlaybackIntent(startPositionMs = startPositionMs, autoplay = true),
                    sender = sender,
                    queue = queue.map { queueItem -> queueItem.toPlayarrCastQueueEntry(language) },
                ),
            )
            _castingMediaFileId.value = if (loaded) mediaFileId else null
        }
    }

    /** Ends the cast session entirely (both the custom-protocol intent and the underlying Cast SDK session). */
    fun stopCasting() {
        castSession.send(PlayarrCastEndSessionMessage(reason = PlayarrCastStopReason.UserStopped))
        castSession.endSession(stopCasting = true)
        _castingMediaFileId.value = null
    }

    fun play(
        mediaFileId: String,
        defaults: PlayarrPlayerDefaults,
        requestedStartPositionMs: Long? = null,
        launchSettings: PlayarrPlaybackLaunchSettings? = null,
        force: Boolean = false,
    ) {
        val request = PlayarrPlayRequest(mediaFileId, requestedStartPositionMs, launchSettings)
        if (!shouldRestartPlayarrPlayback(
                activeRequest,
                request,
                hasEnded = player.state.value.hasEnded,
                hasFailed = _state.value is ExperienceLoad.Failed || player.state.value.error != null,
                force = force,
            )
        ) {
            Log.i(PLAYBACK_STATS_TAG, "event=reprepare_skipped reason=same_request media_file_id=$mediaFileId")
            return
        }
        activeRequest = request
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
            activeDirectPlay = false
            decoderFallbackAttempted = false
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
            val prewarmed = takePrewarm(mediaFileId, resumePosition, launchSettings)
            _state.value = when (val result = prewarmed ?: getPlaybackInfo(
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
                is PlayarrResult.Success -> {
                    prepareNegotiatedPlayback(
                        result.value,
                        resumePosition,
                        shouldPlay = true,
                        preferredSubtitleId = launchSettings?.subtitleTrackId,
                    )
                    ExperienceLoad.Ready(Unit)
                }
                is PlayarrResult.Failure -> ExperienceLoad.Failed(
                    result.error.userMessageForExperience(PlayarrString.ErrorSubjectMedia),
                )
            }
        }
    }

    private data class PlayarrPrewarmed(
        val resumePositionMs: Long,
        val result: PlayarrResult<PlaybackInfoResponse>?,
    )

    private class PlayarrPrewarm(val mediaFileId: String, val deferred: kotlinx.coroutines.Deferred<PlayarrPrewarmed>)

    private var prewarm: PlayarrPrewarm? = null

    /**
     * During the up-next countdown (never before STATE_ENDED, so it cannot
     * compete with the ending item for bandwidth) negotiates the next item's
     * playback info ahead of time. This is the normal playback-info call, so it
     * opens the new item's own fresh session; [play] consumes it, anything
     * else closes it ([discardPrewarm]). Local downloads need no negotiation.
     */
    fun prewarmNext(mediaFileId: String, defaults: PlayarrPlayerDefaults) {
        if (prewarm?.mediaFileId == mediaFileId) return
        if (castingMediaFileId.value != null) return
        discardPrewarm()
        val deferred = viewModelScope.async {
            val resume = runCatching { api.getWatchProgress(mediaFileId) }.getOrNull()
                ?.takeIf { it.state == WatchState.PartWatched }?.positionMs ?: 0L
            if (runCatching { downloadRepository.localFile(mediaFileId) }.getOrNull() != null) {
                return@async PlayarrPrewarmed(resume, null)
            }
            val quality = parsePlayarrQualityDefault(defaults.qualityId)
            PlayarrPrewarmed(
                resume,
                getPlaybackInfo(
                    mediaFileId = mediaFileId,
                    containers = playarrAndroidContainers,
                    videoCodecs = playarrAndroidVideoCodecs,
                    audioCodecs = playarrAndroidAudioCodecs,
                    profile = quality.takeUnless { it == "original" },
                    forceTranscode = quality != "original",
                    startPositionMs = resume,
                    audioStreamIndex = null,
                    ignoreSavedPreferences = quality == "original",
                ),
            )
        }
        prewarm = PlayarrPrewarm(mediaFileId, deferred)
    }

    /** Drops an unused prewarmed negotiation and closes the session it opened. */
    fun discardPrewarm() {
        val pending = prewarm ?: return
        prewarm = null
        viewModelScope.launch {
            val result = runCatching { pending.deferred.await() }.getOrNull()?.result
            (result as? PlayarrResult.Success)?.value?.sessionId?.let {
                recordEvent(it, PlaybackEventRequest.stop(PlaybackStopReason.UserStopped, 0L))
            }
        }
    }

    private suspend fun takePrewarm(
        mediaFileId: String,
        resumePositionMs: Long,
        launchSettings: PlayarrPlaybackLaunchSettings?,
    ): PlayarrResult<PlaybackInfoResponse>? {
        val pending = prewarm ?: return null
        prewarm = null
        val got = runCatching { pending.deferred.await() }.getOrNull()
        val result = got?.result
        if (got != null && result is PlayarrResult.Success &&
            playarrPrewarmUsable(pending.mediaFileId, got.resumePositionMs, mediaFileId, resumePositionMs, launchSettings != null)
        ) {
            Log.i(PLAYBACK_STATS_TAG, "event=prewarm_used media_file_id=$mediaFileId")
            return result
        }
        (result as? PlayarrResult.Success)?.value?.sessionId?.let {
            recordEvent(it, PlaybackEventRequest.stop(PlaybackStopReason.UserStopped, 0L))
        }
        return null
    }

    /** Loads (once per work) similar titles for the end card; falls back to genre/new rows. */
    fun loadSuggestions(work: Work) {
        if (suggestionsWorkId == work.id) return
        suggestionsWorkId = work.id
        _suggestions.value = emptyList()
        viewModelScope.launch {
            val loaded = runCatching { loadPlayarrSimilarWorks(api, work) }.getOrDefault(emptyList())
                .filterNot { it.id == work.id }.take(PLAYER_SUGGESTION_LIMIT)
            if (suggestionsWorkId == work.id) _suggestions.value = loaded
        }
    }

    /**
     * Replays the active item from 0 (end card Replay). Starts a fresh playback
     * session through the normal playback-info negotiation: the ended session was
     * already closed as completed, so seeking it back to 0 would report nothing.
     */
    fun replay() {
        val request = activeRequest ?: return
        play(
            request.mediaFileId,
            activeDefaults,
            requestedStartPositionMs = 0L,
            launchSettings = request.launchSettings,
            force = true,
        )
    }

    fun selectQuality(qualityId: String) {
        if (castingMediaFileId.value != null) {
            castSession.send(PlayarrCastSelectQualityMessage(qualityId = qualityId))
            return
        }
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
        if (castingMediaFileId.value != null) {
            castSession.send(PlayarrCastSelectTracksMessage(audioTrackId = trackId))
            return
        }
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
        if (castingMediaFileId.value != null) {
            castSession.send(PlayarrCastSelectTracksMessage(subtitleTrackId = trackId))
            return
        }
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
                is PlayarrResult.Success -> {
                    val preferredSubtitleId = _controls.value.selectedSubtitleTrackId
                    prepareNegotiatedPlayback(
                        result.value,
                        sourcePosition,
                        shouldPlay,
                        preferredSubtitleId,
                    )
                    _state.value = ExperienceLoad.Ready(Unit)
                }
                is PlayarrResult.Failure -> {
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
        activeOnDemandHls = playback.mode == io.playarr.shared.data.model.PlaybackMode.Hls &&
            isPlayarrOnDemandHls(playback.url)
        activePlaybackUrl = playback.url
        activeDirectPlay = playback.mode != io.playarr.shared.data.model.PlaybackMode.Hls
        val selectedSubtitleId = preferredSubtitleId
            ?.takeIf { selected -> playback.subtitleTracks.any { it.id == selected } }
            ?: playback.selectedSubtitleTrackId
            ?: selectPlayarrDefaultSubtitleTrackId(playback.subtitleTracks, activeDefaults)
        val selectedAudioLanguage = playback.audioTracks
            .firstOrNull { it.id == playback.selectedAudioTrackId }
            ?.language
        player.prepare(
            resolvePlayarrPlaybackUrl(activeServerUrl, playback.url),
            if (playback.mode == io.playarr.shared.data.model.PlaybackMode.Hls) StreamFormat.Hls else StreamFormat.Direct,
            playarrEnginePositionMs(sourcePositionMs, activeSourceOffsetMs),
            subtitles = playback.subtitleTracks.map { subtitle ->
                PlayarrSubtitleTrack(
                    id = subtitle.id,
                    url = resolvePlayarrPlaybackUrl(activeServerUrl, subtitle.url),
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
        discardPrewarm()
        prepareJob?.cancel()
        switchJob?.cancel()
        prepareJob = null
        switchJob = null
        persistProgress(ensureCompletion = true)
        closeActiveSession(PlaybackStopReason.UserStopped)
        player.pause()
        activeMediaFileId = null
        activeRequest = null
        activePlaybackUrl = ""
        automaticRecoveryUrl = null
    }

    fun togglePlayback() {
        if (castingMediaFileId.value != null) {
            // Standard Cast media-protocol transport control, handled
            // natively by the receiver's PlayerManager -- not reinvented on
            // the custom namespace; see PlayarrCastSession.togglePlayback.
            castSession.togglePlayback()
            return
        }
        if (player.state.value.playWhenReady) {
            player.pause()
        } else {
            player.play()
        }
    }

    fun seekBy(deltaMs: Long) {
        val currentPositionMs = if (castingMediaFileId.value != null) {
            castReceiverState.value?.positionMs ?: 0L
        } else {
            currentSourcePositionMs()
        }
        seekToSourcePosition(currentPositionMs + deltaMs)
    }

    fun seekToSourcePosition(positionMs: Long) {
        val castingId = castingMediaFileId.value
        if (castingId != null) {
            val receiverState = castReceiverState.value
            val duration = receiverState?.durationMs ?: 0L
            val coerced = if (duration > 0L) positionMs.coerceIn(0L, duration) else positionMs.coerceAtLeast(0L)
            castSession.seekTo(playarrEnginePositionMs(coerced, receiverState?.sourceOffsetMs ?: 0L))
            return
        }
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

    /**
     * The device's decoders (after the player's own decoder retries) cannot
     * decode the direct-played source, e.g. 4K HEVC Main 10 / Dolby Vision on
     * an emulator or a low-end box. Ask the server for a 1080p H.264 transcode
     * at the same position instead of surfacing "decoding failed".
     */
    private fun fallBackToTranscode(errorMessage: String) {
        switchNegotiatedPlayback(
            profile = DECODE_FALLBACK_PROFILE,
            forceTranscode = true,
            audioStreamIndex = selectedAudioStreamIndex(),
            ignoreSavedPreferences = false,
            requestedSourcePositionMs = currentSourcePositionMs(),
            stopReason = PlaybackStopReason.Error,
            errorMessage = errorMessage,
            shouldPlayOverride = true,
        )
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
        // While casting, position/duration must come from the receiver's
        // reported state, not this (paused, stopped) local player's raw
        // position -- per the design's Ground Truth. No second player
        // instance is introduced: this reads the same single `player`
        // binding's local timeline otherwise, below.
        val castingId = castingMediaFileId.value
        if (castingId != null) {
            castReceiverState.value?.takeIf { it.mediaFileId == castingId }?.let { state ->
                return PlayarrPlayerTimeline(state.positionMs, state.durationMs, state.positionMs)
            }
        }
        val durationMs = currentSourceDurationMs()
        val positionMs = currentSourcePositionMs()
        val bufferedPositionMs = playarrSourcePositionMs(
            enginePositionMs = player.rawPlayer.bufferedPosition,
            sourceOffsetMs = activeSourceOffsetMs,
            sourceDurationMs = durationMs,
        ).coerceAtLeast(positionMs)
        return PlayarrPlayerTimeline(positionMs, durationMs, bufferedPositionMs)
    }

    internal fun currentSourcePositionMs(): Long = playarrSourcePositionMs(
        enginePositionMs = player.rawPlayer.currentPosition,
        sourceOffsetMs = activeSourceOffsetMs,
        sourceDurationMs = currentSourceDurationMs(),
    )

    internal fun currentSourceDurationMs(): Long =
        playarrSourceDurationMs(activeSourceDurationMs, player.rawPlayer.duration, activeSourceOffsetMs)

    /** Throughput from the last connection test; folded into the next health report. */
    @Volatile
    private var lastConnectionTestBps: Long? = null

    /**
     * Playback health for the current session (`docs/architecture/playback-health.md`):
     * loads the server's explanation with what this player measured, and runs
     * the short bounded connection test. Both read the active session lazily,
     * so the dialog always reflects the item playing when it was opened.
     */
    fun playbackHealth(displayHdrFormats: List<String>): PlayarrPlayerHealth = PlayarrPlayerHealth(
        load = {
            val sessionId = activeSessionId
                ?: return@PlayarrPlayerHealth Result.failure(PlayarrHealthException(PlayarrHealthError.NoSession))
            runCatching {
                api.getPlaybackHealth(
                    sessionId,
                    playarrBuildHealthRequest(player.diagnostics(), displayHdrFormats, lastConnectionTestBps),
                )
            }
        },
        runConnectionTest = {
            runCatching {
                withContext(Dispatchers.IO) {
                    kotlinx.coroutines.withTimeout(PLAYARR_CONNECTION_TEST_TIMEOUT_MS) {
                        val started = android.os.SystemClock.elapsedRealtime()
                        val body = api.connectionTest(PLAYARR_CONNECTION_TEST_BYTES)
                        val headersAt = android.os.SystemClock.elapsedRealtime()
                        val bytes = body.use { it.source().readAll(okio.blackholeSink()) }
                        val finished = android.os.SystemClock.elapsedRealtime()
                        val seconds = ((finished - headersAt).coerceAtLeast(1L)) / 1000.0
                        PlayarrConnectionTestResult(
                            bytes = bytes,
                            latencyMs = headersAt - started,
                            throughputBps = (bytes * 8 / seconds).toLong(),
                        ).also { lastConnectionTestBps = it.throughputBps }
                    }
                }
            }
        },
    )

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

/** Placeholder shown in place of the (paused) local player surface while a Playarr Cast session is actively driving this item -- no second player instance is ever created for this. */
@Composable
private fun PlayarrCastingVisual(deviceName: String?, title: String) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            Icons.Outlined.CastConnected,
            contentDescription = null,
            tint = Color.White.copy(alpha = 0.85f),
            modifier = Modifier.size(64.dp),
        )
        Text(
            playarrString(
                PlayarrString.CastButtonConnectedLabel,
                "device" to (deviceName ?: playarrString(PlayarrString.CastButtonLabel)),
            ),
            color = Color.White,
            fontSize = 18.sp,
            fontWeight = FontWeight.Medium,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        if (title.isNotBlank()) {
            Text(title, color = WebInkMuted, fontSize = 13.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
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
    onOpenWork: (String) -> Unit,
    viewModel: ExperiencePlayerViewModel = hiltViewModel(),
) {
    val activeMediaFileId = playbackQueue.currentMediaFileId ?: mediaFileId
    val playerDefaults = LocalPlayarrDisplayPreferences.current.playerDefaults
    val state by viewModel.state.collectAsState()
    val controls by viewModel.effectiveControls.collectAsState()
    val playbackState by viewModel.player.state.collectAsState()
    val castConnection by viewModel.castConnection.collectAsState()
    val castRoutes by viewModel.castRoutes.collectAsState()
    var showPlayOnDevice by remember { mutableStateOf(false) }
    val castingMediaFileId by viewModel.castingMediaFileId.collectAsState()
    val language = LocalPlayarrLanguage.current
    val suggestions by viewModel.suggestions.collectAsState()
    var endCard by remember { mutableStateOf(PlayarrEndCardState()) }
    var endCardIdleExpired by remember { mutableStateOf(false) }
    LaunchedEffect(endCard.mode) {
        endCardIdleExpired = false
        if (endCard.mode == PlayarrEndCardMode.Standalone) {
            kotlinx.coroutines.delay(PLAYER_END_CARD_KEEP_AWAKE_MS)
            endCardIdleExpired = true
        }
    }
    var timeline by remember(activeMediaFileId) { mutableStateOf(PlayarrPlayerTimeline()) }
    DisposableEffect(Unit) {
        viewModel.startCastSession()
        onDispose { viewModel.stopCastSession() }
    }
    PlayarrKeepScreenOn(
        shouldKeepScreenOn(
            playWhenReady = playbackState.playWhenReady,
            hasEnded = playbackState.hasEnded,
            hasError = playbackState.error != null,
            showsLocalVideo = state is ExperienceLoad.Ready &&
                playbackQueue.currentItem?.music != true &&
                castingMediaFileId == null,
            endCardHeld = shouldHoldScreenForEndCard(endCard, endCardIdleExpired),
        ),
    )
    LaunchedEffect(state, activeMediaFileId) {
        if (state !is ExperienceLoad.Ready) return@LaunchedEffect
        while (true) {
            timeline = viewModel.timelineSnapshot()
            kotlinx.coroutines.delay(250)
        }
    }
    LaunchedEffect(castConnection, playbackQueue.currentItem) {
        if (castConnection !is PlayarrCastConnectionState.Connected) return@LaunchedEffect
        val item = playbackQueue.currentItem ?: return@LaunchedEffect
        if (castingMediaFileId == item.mediaFileId) return@LaunchedEffect
        viewModel.startCasting(
            item = item,
            queue = playbackQueue.items,
            sender = PlayarrCastSender(
                platform = PlayarrCastSenderPlatform.AndroidMobile,
                appVersion = BuildConfig.VERSION_NAME,
                deviceName = android.os.Build.MODEL ?: "Android",
                language = language.locale.toLanguageTag(),
            ),
            language = language,
        )
    }
    val endCardWork = playbackQueue.currentItem?.takeIf { !it.music }?.artworkWork
    val nearEnd = playbackState.hasEnded ||
        (timeline.durationMs > 0L && timeline.durationMs - timeline.positionMs <= PLAYER_SUGGESTION_PREFETCH_MS)
    LaunchedEffect(endCardWork?.id, nearEnd) {
        if (nearEnd && endCardWork != null) viewModel.loadSuggestions(endCardWork)
    }
    val healthContext = LocalContext.current
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
                onRetry = { viewModel.play(activeMediaFileId, playerDefaults, force = true) },
                onBack = onBack,
            )
            is ExperienceLoad.Ready -> {
                val item = playbackQueue.currentItem
                val castedDeviceName = (castConnection as? PlayarrCastConnectionState.Connected)?.deviceName
                if (item != null && castingMediaFileId == item.mediaFileId) {
                    PlayarrCastingVisual(
                        deviceName = castedDeviceName,
                        title = item.displayTitle(language),
                    )
                } else if (item?.music == true) {
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
        if (state is ExperienceLoad.Ready && !endCard.visible) {
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
                cast = PlayarrPlayerCastState(
                    visible = shouldOfferPlayarrCast(
                        isTelevision = isTelevision,
                        playServicesAvailable = viewModel.castAvailable,
                        receiverAppIdConfigured = BuildConfig.CAST_RECEIVER_APP_ID.isNotBlank(),
                        serverIsHttps = serverUrl.startsWith("https", ignoreCase = true),
                    ),
                    connectionState = castConnection,
                    routes = castRoutes,
                    onStartDiscovery = { viewModel.startCastDiscovery(BuildConfig.CAST_RECEIVER_APP_ID) },
                    onStopDiscovery = viewModel::stopCastDiscovery,
                    onSelectRoute = viewModel::selectCastRoute,
                    onStopCasting = viewModel::stopCasting,
                ),
                onPlayOnDevice = { showPlayOnDevice = true },
                health = remember(viewModel, healthContext) {
                    viewModel.playbackHealth(playarrDisplayHdrFormats(healthContext))
                },
            )
            if (showPlayOnDevice) PlayOnDeviceDialog(onDismiss = { showPlayOnDevice = false })
        } else {
            PlayarrIconButton(
                onClick = onBack,
                contentDescription = playarrString(PlayarrString.PlayerBackToDetails),
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .windowInsetsPadding(WindowInsets.safeDrawing)
                    .padding(16.dp)
                    .background(Color.Black.copy(alpha = 0.62f), CircleShape),
            ) {
                Icon(
                    Icons.AutoMirrored.Outlined.ArrowBack,
                    contentDescription = null,
                    tint = Color.White)
            }
        }
        if (state is ExperienceLoad.Ready) {
            PlayarrEndOfPlaybackHost(
                state = endCard,
                onStateChange = { endCard = it },
                playbackState = playbackState,
                item = playbackQueue.currentItem,
                nextItem = playbackQueue.items.getOrNull(playbackQueue.currentIndex + 1)
                    ?.takeIf { playbackQueue.canNext && !it.music },
                casting = castingMediaFileId != null,
                suggestions = suggestions,
                isTelevision = isTelevision,
                serverUrl = serverUrl,
                accessToken = accessToken,
                onPlayNext = { onMovePlayback(1) },
                onReplay = viewModel::replay,
                onPrewarmNext = { viewModel.prewarmNext(it, playerDefaults) },
                onDiscardPrewarm = viewModel::discardPrewarm,
                onExit = onBack,
                onOpenWork = onOpenWork,
            )
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
                    PlayarrButton(onClick = it) { Text(playarrString(PlayarrString.CommonTryAgain)) }
                }
                onBack?.let {
                    PlayarrButton(onClick = it, variant = PlayarrButtonVariant.Secondary) {
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
    heroStyle: Boolean = false,
) {
    val context = LocalContext.current
    val serverAccess = rememberPlayarrWorkServerAccess(artistWork.id, serverUrl, accessToken)
    val dark = webIsDark
    Box(
        if (heroStyle) {
            // Filter the poster + album stack as one image so the key-art look matches the other heroes.
            modifier.drawWithContent {
                drawIntoCanvas { canvas ->
                    val paint = Paint().apply {
                        colorFilter = heroArtFilter(dark)
                        alpha = heroArtOpacity(dark)
                    }
                    canvas.saveLayer(Rect(Offset.Zero, size), paint)
                    drawContent()
                    canvas.restore()
                }
            }
        } else {
            modifier
        },
    ) {
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

/** `GET /api/v1/artwork/episode/{series}/{episode}/thumb`: the server-cached episode still. */
internal fun resolveEpisodeArtworkUrl(serverUrl: String, seriesWorkId: String, episodeId: String): String =
    "${serverUrl.trimEnd('/')}/api/v1/artwork/episode/${seriesWorkId.asUrlPathSegment()}/${episodeId.asUrlPathSegment()}/thumb"

internal fun String.asUrlPathSegment(): String =
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

internal fun resolvePlayarrPlaybackUrl(serverUrl: String, playbackUrl: String): String =
    runCatching {
        val base = URI(if (serverUrl.endsWith('/')) serverUrl else "$serverUrl/")
        base.resolve(playbackUrl).toString()
    }.getOrDefault(playbackUrl)

private const val HERO_LUMA_SAMPLE_SIZE = 32

@Composable
internal fun AuthenticatedArtwork(
    work: Work,
    kinds: List<ImageKind>,
    serverUrl: String,
    accessToken: String?,
    contentScale: ContentScale,
    modifier: Modifier = Modifier,
    heroStyle: Boolean = false,
) {
    val context = LocalContext.current
    val serverAccess = rememberPlayarrWorkServerAccess(work.id, serverUrl, accessToken)
    // Per kind: the server artwork endpoint (cached, authenticated), then the provider URL; a
    // failed load moves on to the next candidate instead of leaving the hero/tile empty.
    val candidateGroups = remember(work.id, work.images, kinds, serverAccess?.serverUrl) {
        serverAccess?.let { access ->
            kinds.distinct().map { playarrArtworkCandidates(work.id, work.images, listOf(it), access.serverUrl) }
        }.orEmpty()
    }
    val candidates = remember(candidateGroups) { candidateGroups.flatten().distinct() }
    var failed by remember(candidates) { mutableStateOf(0) }
    val resolved = candidates.getOrNull(failed)
    // Near-black art (e.g. a dark film still) is sampled once from the decoded bitmap and lifted.
    var exposureGain by remember(resolved) { mutableStateOf(1f) }
    if (serverAccess == null || resolved == null) {
        Box(modifier.background(WebSurfaceSoft), contentAlignment = Alignment.Center) {
            Text(work.title, color = WebInkMuted, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(12.dp))
        }
        return
    }
    val requestToken = playarrAccessTokenForUrl(serverAccess, resolved)
    val request = remember(resolved, requestToken, heroStyle) {
        ImageRequest.Builder(context)
            .data(resolved)
            // Hero art is sampled for luminance once decoded; hardware bitmaps cannot be read back.
            .apply { if (heroStyle) allowHardware(false) }
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
        onError = { failed += 1 },
        onSuccess = if (heroStyle) {
            { state ->
                val gain = runCatching {
                    val bitmap = state.result.image.toBitmap(HERO_LUMA_SAMPLE_SIZE, HERO_LUMA_SAMPLE_SIZE)
                    val pixels = IntArray(HERO_LUMA_SAMPLE_SIZE * HERO_LUMA_SAMPLE_SIZE)
                    bitmap.getPixels(pixels, 0, HERO_LUMA_SAMPLE_SIZE, 0, 0, HERO_LUMA_SAMPLE_SIZE, HERO_LUMA_SAMPLE_SIZE)
                    heroArtExposureGain(heroArtMeanLuma(pixels))
                }.getOrDefault(1f)
                // Near-black art: prefer the next artwork kind (backdrop -> poster) when the work has one,
                // otherwise keep this art and lift its exposure.
                val next = if (gain > 1f) playarrDimArtFallbackIndex(candidateGroups.map { it.size }, failed) else null
                if (next != null) failed = next else exposureGain = gain
            }
        } else null,
        modifier = modifier,
        colorFilter = if (heroStyle) heroArtFilter(webIsDark, exposureGain) else null,
        alpha = if (heroStyle) heroArtOpacity(webIsDark) else 1f,
    )
}

@Composable
internal fun AuthenticatedMediaThumbnail(
    mediaFileId: String,
    serverUrl: String,
    accessToken: String?,
    contentDescription: String,
    modifier: Modifier = Modifier,
    positionMs: Long? = null,
    /** Overrides the frame-thumbnail URL (e.g. the episode still); receives the resolved server URL. */
    artworkUrl: ((String) -> String)? = null,
    /** Shown centred behind the image while it loads and when it fails, so a tile is never an empty box. */
    fallbackLabel: String? = null,
) {
    val context = LocalContext.current
    val serverAccess = rememberPlayarrMediaServerAccess(mediaFileId, serverUrl, accessToken)
    if (serverAccess == null) {
        Box(modifier.background(WebSurfaceSoft), contentAlignment = Alignment.Center) {
            fallbackLabel?.let { ThumbnailFallbackLabel(it) }
        }
        return
    }
    val url = remember(serverAccess.serverUrl, mediaFileId, positionMs) {
        artworkUrl?.invoke(serverAccess.serverUrl)
            ?: playarrMediaThumbnailUrl(serverAccess.serverUrl, mediaFileId, positionMs)
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
    if (fallbackLabel == null) {
        AsyncImage(
            model = request,
            contentDescription = contentDescription,
            contentScale = ContentScale.Crop,
            modifier = modifier,
        )
    } else {
        Box(modifier.background(WebSurfaceSoft), contentAlignment = Alignment.Center) {
            ThumbnailFallbackLabel(fallbackLabel)
            AsyncImage(
                model = request,
                contentDescription = contentDescription,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

@Composable
private fun ThumbnailFallbackLabel(label: String) {
    Text(
        label,
        color = Color.White.copy(alpha = 0.85f),
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        textAlign = TextAlign.Center,
        maxLines = 3,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.padding(12.dp),
    )
}

/** `GET /api/v1/media/{id}/thumbnail`, optionally at a chapter offset (`position_ms`), as the web client requests it. */
internal fun playarrMediaThumbnailUrl(serverUrl: String, mediaFileId: String, positionMs: Long? = null): String {
    val id = java.net.URLEncoder.encode(mediaFileId, "UTF-8").replace("+", "%20")
    val base = "${serverUrl.trimEnd('/')}/api/v1/media/$id/thumbnail"
    return if (positionMs == null) base else "$base?position_ms=${positionMs.coerceAtLeast(0L)}"
}

internal fun resolveArtworkUrl(serverUrl: String, artworkUrl: String): String = runCatching {
    val value = artworkUrl.trim()
    if (value.startsWith("http://") || value.startsWith("https://")) value
    else URI("${serverUrl.trimEnd('/')}/").resolve(value.trimStart('/')).toString()
}.getOrDefault(artworkUrl)

internal fun playarrAccessTokenForUrl(access: PlayarrServerAccess, requestUrl: String): String? {
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
            PlayarrButton(onClick = retry) { Text(playarrString(PlayarrString.CommonTryAgain)) }
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

/** "Movie · 2019" under card titles; just the kind when no release year is known (artists, authors). */
@Composable
private fun Work.playarrKindYearLabel(): String {
    val kindLabel = kind.playarrSingularLabel()
    return playarrKindYear(releaseDate)?.let { "$kindLabel · $it" } ?: kindLabel
}

internal fun playarrKindYear(releaseDate: java.time.Instant?): Int? =
    releaseDate?.atZone(java.time.ZoneOffset.UTC)?.year?.takeIf { it > 0 }

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

internal fun io.playarr.shared.domain.model.PlayarrError.userMessageForExperience(
    subject: PlayarrString,
): PlayarrMessage = when (this) {
    is io.playarr.shared.domain.model.PlayarrError.Network -> {
        PlayarrMessage.Localized(PlayarrString.ErrorServerUnreachable)
    }
    is io.playarr.shared.domain.model.PlayarrError.Http -> when (code) {
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
    is io.playarr.shared.domain.model.PlayarrError.Unknown -> PlayarrMessage.Localized(
        PlayarrString.ErrorSomethingWrongLoading,
        mapOf("subject" to subject),
    )
}
