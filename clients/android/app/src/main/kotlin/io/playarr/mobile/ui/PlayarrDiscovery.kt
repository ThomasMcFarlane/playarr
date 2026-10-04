package io.playarr.mobile.ui

import io.playarr.shared.designsystem.component.PlayarrButton
import io.playarr.shared.designsystem.component.PlayarrButtonVariant
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavHostController
import dagger.hilt.android.lifecycle.HiltViewModel
import io.playarr.shared.data.model.DiscoveryTitle
import io.playarr.shared.data.model.DiscoveryWire
import io.playarr.shared.data.model.DiscoverResponse
import io.playarr.shared.data.model.TitleAction
import io.playarr.shared.data.model.TitleSnapshot
import io.playarr.shared.data.model.WatchlistEntry
import io.playarr.shared.data.model.Work
import io.playarr.shared.data.remote.PlayarrApi
import javax.inject.Inject
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/*
 * Unified discovery and watchlist (docs/architecture/discovery-watchlist.md).
 * The server owns identity, source attribution and the action list; this file
 * only maps them onto routes, labels and a primary action so Android behaves
 * like Playarr Web.
 */

/** Highest priority first: resuming beats starting over, requesting beats recording. */
private val discoveryActionPriority = listOf(
    DiscoveryWire.ACTION_RESUME,
    DiscoveryWire.ACTION_PLAY,
    DiscoveryWire.ACTION_REQUEST,
    DiscoveryWire.ACTION_LAUNCH,
    DiscoveryWire.ACTION_RECORD,
)

internal fun primaryDiscoveryAction(actions: List<TitleAction>): TitleAction? =
    discoveryActionPriority.firstNotNullOfOrNull { kind ->
        actions.firstOrNull { it.action == kind && it.enabled }
    }

/** Disabled actions that carry a reason, in priority order. */
internal fun explainedDisabledActions(actions: List<TitleAction>): List<TitleAction> =
    discoveryActionPriority.flatMap { kind ->
        actions.filter { it.action == kind && !it.enabled && !it.reason.isNullOrBlank() }
    }

/** Library work id of a merged title, if the library is one of its sources. */
internal fun DiscoveryTitle.libraryWorkId(): String? =
    sources.firstOrNull { it.source == DiscoveryWire.SOURCE_LIBRARY && it.workId != null }?.workId

internal fun DiscoveryTitle.toSnapshot(): TitleSnapshot = TitleSnapshot(
    kind = kind,
    title = title,
    year = year,
    workId = libraryWorkId(),
    externalRefs = externalRefs,
    posterUrl = posterUrl,
)

internal fun Work.toSnapshot(): TitleSnapshot = TitleSnapshot(
    kind = kind.name.lowercase(),
    title = title,
    year = releaseDate?.atZone(java.time.ZoneOffset.UTC)?.year,
    workId = id,
    externalRefs = externalRefs,
    posterUrl = images.firstOrNull { it.kind == io.playarr.shared.data.model.ImageKind.Poster }?.url,
)

/**
 * Titles worth showing beyond the local library results: anything with a
 * non-library source, plus every game.
 */
internal fun extraDiscoveryTitles(titles: List<DiscoveryTitle>): List<DiscoveryTitle> = titles.filter { title ->
    title.kind == DiscoveryWire.KIND_GAME || title.sources.any { it.source != DiscoveryWire.SOURCE_LIBRARY }
}

internal fun DiscoveryTitle.isRequestable(): Boolean = sources.any {
    it.source == DiscoveryWire.SOURCE_REQUEST && it.availability == DiscoveryWire.AVAILABILITY_REQUESTABLE
}

private fun String.sourceLabel(): PlayarrString? = when (this) {
    DiscoveryWire.SOURCE_LIBRARY -> PlayarrString.DiscoverySourceLibrary
    DiscoveryWire.SOURCE_PEER -> PlayarrString.DiscoverySourcePeer
    DiscoveryWire.SOURCE_REQUEST -> PlayarrString.DiscoverySourceRequest
    DiscoveryWire.SOURCE_LIVE_TV -> PlayarrString.DiscoverySourceLiveTv
    DiscoveryWire.SOURCE_GAME -> PlayarrString.DiscoverySourceGame
    else -> null
}

internal fun String.actionLabel(): PlayarrString? = when (this) {
    DiscoveryWire.ACTION_PLAY -> PlayarrString.DiscoveryActionPlay
    DiscoveryWire.ACTION_RESUME -> PlayarrString.DiscoveryActionResume
    DiscoveryWire.ACTION_REQUEST -> PlayarrString.DiscoveryActionRequest
    DiscoveryWire.ACTION_RECORD -> PlayarrString.DiscoveryActionRecord
    DiscoveryWire.ACTION_LAUNCH -> PlayarrString.DiscoveryActionLaunch
    else -> null
}

/**
 * A server that predates discovery answers these routes with its web app's HTML (decode failure)
 * or a 404/405; say that plainly instead of surfacing a parser error.
 */
internal fun discoveryUnsupportedByServer(error: Throwable): Boolean =
    error is kotlinx.serialization.SerializationException ||
        (error as? retrofit2.HttpException)?.code() in setOf(404, 405)

private fun failureMessage(error: Throwable): PlayarrMessage =
    if (discoveryUnsupportedByServer(error)) {
        PlayarrMessage.Localized(PlayarrString.DiscoveryServerUnsupported)
    } else error.message?.takeIf(String::isNotBlank)?.let(PlayarrMessage::Dynamic)
        ?: PlayarrMessage.Localized(PlayarrString.ErrorSubjectWatchlist)

internal sealed interface DiscoveryLoad {
    data object Loading : DiscoveryLoad
    data class Ready(val response: DiscoverResponse) : DiscoveryLoad
    data class Failed(val message: PlayarrMessage) : DiscoveryLoad
}

@HiltViewModel
internal class DiscoveryViewModel @Inject constructor(
    private val api: PlayarrApi,
) : ViewModel() {
    private val _discover = MutableStateFlow<DiscoveryLoad>(DiscoveryLoad.Loading)
    val discover: StateFlow<DiscoveryLoad> = _discover.asStateFlow()

    private val _watchlist = MutableStateFlow<ParityLoad<List<WatchlistEntry>>>(ParityLoad.Loading)
    val watchlist: StateFlow<ParityLoad<List<WatchlistEntry>>> = _watchlist.asStateFlow()

    /** Title keys the viewer has just requested, so the button reads "Requested". */
    private val _requested = MutableStateFlow<Set<String>>(emptySet())
    val requested: StateFlow<Set<String>> = _requested.asStateFlow()

    private val _message = MutableStateFlow<PlayarrMessage?>(null)
    val message: StateFlow<PlayarrMessage?> = _message.asStateFlow()

    fun clearMessage() {
        _message.value = null
    }

    fun search(query: String, gamesOnly: Boolean) {
        viewModelScope.launch {
            _discover.value = DiscoveryLoad.Loading
            _discover.value = try {
                DiscoveryLoad.Ready(
                    api.discover(
                        query,
                        scope = if (gamesOnly) DiscoveryWire.SCOPE_GAMES else DiscoveryWire.SCOPE_MEDIA,
                        limit = 25,
                    ),
                )
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Throwable) {
                DiscoveryLoad.Failed(failureMessage(error))
            }
        }
    }

    fun loadWatchlist() {
        viewModelScope.launch {
            _watchlist.value = ParityLoad.Loading
            _watchlist.value = try {
                ParityLoad.Ready(api.listWatchlist().items)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Throwable) {
                ParityLoad.Failed(failureMessage(error))
            }
        }
    }

    fun remove(entry: WatchlistEntry) {
        viewModelScope.launch {
            try {
                api.removeFromWatchlist(entry.title.titleKey)
                val current = _watchlist.value
                if (current is ParityLoad.Ready) {
                    _watchlist.value = ParityLoad.Ready(
                        current.value.filterNot { it.title.titleKey == entry.title.titleKey },
                    )
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Throwable) {
                _message.value = failureMessage(error)
            }
        }
    }

    fun request(title: DiscoveryTitle) {
        viewModelScope.launch {
            try {
                api.requestTitle(title.toSnapshot())
                _requested.value = _requested.value + title.titleKey
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Throwable) {
                _message.value = failureMessage(error)
            }
        }
    }

    /** Adds or removes [snapshot] and reports the new state through [onListed]. */
    fun toggleWatchlist(snapshot: TitleSnapshot, listed: Boolean, onListed: (Boolean) -> Unit) {
        viewModelScope.launch {
            try {
                if (listed) {
                    api.removeFromWatchlist(api.resolveTitle(snapshot).title.titleKey)
                    onListed(false)
                } else {
                    api.addToWatchlist(snapshot)
                    onListed(true)
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Throwable) {
                _message.value = failureMessage(error)
            }
        }
    }

    suspend fun isListed(snapshot: TitleSnapshot): Boolean? = try {
        api.resolveTitle(snapshot).inWatchlist
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Throwable) {
        null
    }
}

/** Add to / remove from watchlist on a title page. */
@Composable
internal fun WatchlistToggleButton(
    work: Work,
    viewModel: DiscoveryViewModel = hiltViewModel(),
) {
    val snapshot = remember(work.id) { work.toSnapshot() }
    var listed by remember(work.id) { mutableStateOf<Boolean?>(null) }
    LaunchedEffect(work.id) { listed = viewModel.isListed(snapshot) ?: false }
    PlayarrButton(
        onClick = { viewModel.toggleWatchlist(snapshot, listed == true) { listed = it } },
        enabled = listed != null,
        variant = PlayarrButtonVariant.Secondary,
    ) {
        Icon(if (listed == true) Icons.Outlined.Check else Icons.Outlined.Add, contentDescription = null)
        Text(
            playarrString(
                if (listed == true) PlayarrString.WatchlistRemove else PlayarrString.WatchlistAdd,
            ),
            modifier = Modifier.padding(start = 6.dp),
        )
    }
}

@Composable
private fun DiscoveryMessageText(viewModel: DiscoveryViewModel) {
    val message by viewModel.message.collectAsState()
    message?.let {
        Text(
            playarrText(it),
            color = androidx.compose.material3.MaterialTheme.colorScheme.error,
            fontSize = 12.sp,
            modifier = Modifier.padding(vertical = 6.dp),
        )
    }
}

/** "Other sources" and Games results shown under the library results in Search. */
@Composable
internal fun DiscoveryExtrasSection(
    query: String,
    gamesOnly: Boolean,
    navController: NavHostController,
    modifier: Modifier = Modifier,
    viewModel: DiscoveryViewModel = hiltViewModel(),
) {
    val state by viewModel.discover.collectAsState()
    val requested by viewModel.requested.collectAsState()
    LaunchedEffect(query, gamesOnly) { viewModel.search(query, gamesOnly) }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            playarrString(if (gamesOnly) PlayarrString.DiscoveryGames else PlayarrString.DiscoveryOtherSources),
            color = WebInkMuted,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
        )
        DiscoveryMessageText(viewModel)
        when (val current = state) {
            DiscoveryLoad.Loading -> Text(playarrString(PlayarrString.DiscoveryChecking), color = WebInkMuted, fontSize = 12.sp)
            is DiscoveryLoad.Failed -> Text(playarrText(current.message), color = WebInkMuted, fontSize = 12.sp)
            is DiscoveryLoad.Ready -> {
                val titles = extraDiscoveryTitles(current.response.titles)
                val notices = current.response.providers.filter {
                    gamesOnly && it.provider == DiscoveryWire.SOURCE_GAME && it.state != "ok" && !it.reason.isNullOrBlank()
                }
                notices.forEach { Text(it.reason.orEmpty(), color = WebInkMuted, fontSize = 12.sp) }
                if (titles.isEmpty() && notices.isEmpty()) {
                    Text(playarrString(PlayarrString.DiscoveryNone), color = WebInkMuted, fontSize = 12.sp)
                }
                titles.forEach { title ->
                    DiscoveryTitleRow(
                        title = title,
                        requested = title.titleKey in requested,
                        onOpen = title.libraryWorkId()?.let { id -> { navController.navigate("experience-detail/$id") } },
                        onRequest = { viewModel.request(title) },
                        viewModel = viewModel,
                    )
                }
            }
        }
    }
}

@Composable
private fun DiscoveryTitleRow(
    title: DiscoveryTitle,
    requested: Boolean,
    onOpen: (() -> Unit)?,
    onRequest: () -> Unit,
    viewModel: DiscoveryViewModel,
) {
    val snapshot = remember(title.titleKey) { title.toSnapshot() }
    var listed by remember(title.titleKey) { mutableStateOf(title.inWatchlist) }
    Surface(
        color = WebSurfaceStrong.copy(alpha = 0.6f),
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title.title, color = WebInk, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            val sources = title.sources.map { it.source }.distinct().mapNotNull { it.sourceLabel() }
                .map { playarrString(it) }.joinToString(" · ")
            Text(
                listOfNotNull(title.year?.toString(), sources.takeIf(String::isNotBlank)).joinToString(" · "),
                color = WebInkMuted,
                fontSize = 11.sp,
            )
            if (title.editions.isNotEmpty()) {
                Text(title.editions.joinToString(" · "), color = WebInkMuted, fontSize = 11.sp)
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                onOpen?.let { open ->
                    PlayarrButton(onClick = open, variant = PlayarrButtonVariant.Secondary) { Text(playarrString(PlayarrString.ContextOpen)) }
                }
                if (title.isRequestable()) {
                    PlayarrButton(onClick = onRequest, enabled = !requested) {
                        Text(playarrString(if (requested) PlayarrString.DiscoveryRequested else PlayarrString.DiscoveryActionRequest))
                    }
                }
                PlayarrButton(onClick = { viewModel.toggleWatchlist(snapshot, listed) { listed = it } }, variant = PlayarrButtonVariant.Secondary) {
                    Icon(if (listed) Icons.Outlined.Check else Icons.Outlined.Add, contentDescription = null)
                    Text(
                        playarrString(if (listed) PlayarrString.WatchlistRemove else PlayarrString.WatchlistAdd),
                        modifier = Modifier.padding(start = 6.dp),
                    )
                }
            }
        }
    }
}

@Composable
internal fun ExperienceWatchlistScreen(
    isTelevision: Boolean,
    onBack: () -> Unit,
    navController: NavHostController,
    onPlay: (mediaFileId: String, title: String) -> Unit,
    viewModel: DiscoveryViewModel = hiltViewModel(),
) {
    val state by viewModel.watchlist.collectAsState()
    val requested by viewModel.requested.collectAsState()
    LaunchedEffect(Unit) { viewModel.loadWatchlist() }
    PlayarrPageScaffold(
        title = playarrString(PlayarrString.WatchlistTitle),
        onBack = onBack,
        isTelevision = isTelevision,
    ) {
        DiscoveryMessageText(viewModel)
        when (val current = state) {
            ParityLoad.Loading -> ParityLoading(playarrString(PlayarrString.WatchlistLoading))
            is ParityLoad.Failed -> ParityFailure(current.message, viewModel::loadWatchlist)
            is ParityLoad.Ready -> if (current.value.isEmpty()) {
                ExperienceEmpty(
                    playarrString(PlayarrString.WatchlistEmptyTitle),
                    playarrString(PlayarrString.WatchlistEmptyDescription),
                )
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize().padding(top = 18.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 104.dp),
                ) {
                    items(current.value, key = { it.title.titleKey }) { entry ->
                        WatchlistRow(
                            entry = entry,
                            requested = entry.title.titleKey in requested,
                            onOpen = entry.title.libraryWorkId()?.let { id -> { navController.navigate("experience-detail/$id") } },
                            onPlay = onPlay,
                            onRequest = { viewModel.request(entry.title) },
                            onRemove = { viewModel.remove(entry) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun WatchlistRow(
    entry: WatchlistEntry,
    requested: Boolean,
    onOpen: (() -> Unit)?,
    onPlay: (String, String) -> Unit,
    onRequest: () -> Unit,
    onRemove: () -> Unit,
) {
    val title = entry.title
    val primary = primaryDiscoveryAction(entry.actions)
    Surface(
        color = WebSurfaceStrong.copy(alpha = 0.6f),
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title.title, color = WebInk, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            val sources = title.sources.map { it.source }.distinct().mapNotNull { it.sourceLabel() }
                .map { playarrString(it) }.joinToString(" · ")
            Text(
                listOfNotNull(title.year?.toString(), sources.takeIf(String::isNotBlank)).joinToString(" · "),
                color = WebInkMuted,
                fontSize = 11.sp,
            )
            explainedDisabledActions(entry.actions).forEach { action ->
                val label = action.action.actionLabel()?.let { playarrString(it) } ?: action.action
                Text("$label: ${action.reason}", color = WebInkMuted, fontSize = 11.sp)
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                when {
                    primary != null && primary.mediaFileId != null &&
                        (primary.action == DiscoveryWire.ACTION_PLAY || primary.action == DiscoveryWire.ACTION_RESUME) ->
                        PlayarrButton(onClick = { onPlay(primary.mediaFileId!!, title.title) }) {
                            Icon(Icons.Outlined.PlayArrow, contentDescription = null)
                            Text(
                                playarrString(primary.action.actionLabel() ?: PlayarrString.DiscoveryActionPlay),
                                modifier = Modifier.padding(start = 6.dp),
                            )
                        }
                    primary?.action == DiscoveryWire.ACTION_REQUEST ->
                        PlayarrButton(onClick = onRequest, enabled = !requested) {
                            Text(playarrString(if (requested) PlayarrString.DiscoveryRequested else PlayarrString.DiscoveryActionRequest))
                        }
                }
                onOpen?.let { open ->
                    PlayarrButton(onClick = open, variant = PlayarrButtonVariant.Secondary) { Text(playarrString(PlayarrString.ContextOpen)) }
                }
                PlayarrButton(onClick = onRemove, variant = PlayarrButtonVariant.Secondary) { Text(playarrString(PlayarrString.WatchlistRemove)) }
            }
        }
    }
}
