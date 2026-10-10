package io.playarr.mobile.ui

import io.playarr.shared.designsystem.page.mediaCardLift
import io.playarr.shared.designsystem.page.PlayarrPageBody
import io.playarr.shared.designsystem.page.PlayarrPageLayout
import io.playarr.shared.designsystem.page.PlayarrPageId
import io.playarr.shared.designsystem.page.playarrPageMetrics
import io.playarr.shared.data.model.RailPreferenceEntry
import io.playarr.shared.data.model.RailPreferencesRequest
import io.playarr.shared.designsystem.page.PlayarrPageState
import io.playarr.shared.designsystem.page.PlayarrEmptyState
import io.playarr.shared.designsystem.page.PlayarrErrorState
import io.playarr.shared.designsystem.page.PlayarrLoadingState
import io.playarr.shared.designsystem.page.PlayarrActionIcon
import io.playarr.shared.designsystem.page.PlayarrPageAction
import io.playarr.shared.designsystem.component.PlayarrButton
import io.playarr.shared.designsystem.component.PlayarrButtonVariant
import io.playarr.shared.designsystem.component.PlayarrIconButton
import io.playarr.shared.designsystem.theme.FocusMotion

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.PlaylistPlay
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.layout.layout
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import io.playarr.mobile.R
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavHostController
import dagger.hilt.android.lifecycle.HiltViewModel
import io.playarr.shared.data.events.LiveArea
import io.playarr.shared.data.events.LiveFetchStamp
import io.playarr.shared.data.events.LiveInvalidationBus
import io.playarr.shared.data.events.LiveTarget
import io.playarr.mobile.BuildConfig
import io.playarr.mobile.connected.PlayarrServerClientProvider
import io.playarr.mobile.di.PrimaryPlayarrApi
import io.playarr.mobile.update.AndroidUpdateEvent
import io.playarr.mobile.update.createAndroidSelfUpdateController
import io.playarr.shared.auth.ConnectedServerSessionManager
import io.playarr.shared.auth.ConnectedServerSessionStore
import io.playarr.shared.auth.KnownServerGroupStore
import io.playarr.shared.auth.PinRequiredException
import io.playarr.shared.auth.SavedProfile
import io.playarr.shared.auth.SessionRefresher
import io.playarr.shared.auth.TokenStore
import io.playarr.shared.auth.model.ClientPlatform
import io.playarr.shared.auth.model.LoginRequest
import io.playarr.shared.auth.model.toTokenResponse
import io.playarr.shared.auth.remote.LoginApi
import io.playarr.shared.data.config.ServerConfigStore
import io.playarr.shared.data.model.AddPlaylistItemRequest
import io.playarr.shared.data.model.AvailableProfile
import io.playarr.shared.data.model.CreatePlaylistRequest
import io.playarr.shared.data.model.CreateUserInviteRequest
import io.playarr.shared.data.model.InviteRequestStatus
import io.playarr.shared.data.model.PlayerPreferences
import io.playarr.shared.data.model.PeerAddressEntry
import io.playarr.shared.data.model.Playlist
import io.playarr.shared.data.model.PlaylistItem
import io.playarr.shared.data.model.PlaylistMediaType
import io.playarr.shared.data.model.ProfileAvatarPreference
import io.playarr.shared.data.model.ProfileAvatarSetting
import io.playarr.shared.data.model.ProfilePinSetting
import io.playarr.shared.data.remote.apiErrorCode
import io.playarr.shared.data.remote.pinLockSeconds
import io.playarr.shared.data.model.ReorderPlaylistItemsRequest
import io.playarr.shared.data.model.UpdatePlayerPreferencesRequest
import io.playarr.shared.data.model.UpdatePlaylistRequest
import io.playarr.shared.data.model.UpdateProfileAvatarRequest
import io.playarr.shared.data.model.UpdateProfilePinRequest
import io.playarr.shared.data.model.UserInviteRequest
import io.playarr.shared.data.model.VersionEnvelope
import io.playarr.shared.data.model.WorkChildren
import io.playarr.shared.data.model.WorkDetail
import io.playarr.shared.data.remote.PlayarrApi
import java.net.URI
import java.util.Locale
import javax.inject.Inject
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import retrofit2.HttpException

internal sealed interface ParityLoad<out T> {
    data object Loading : ParityLoad<Nothing>
    data class Ready<T>(val value: T) : ParityLoad<T>
    data class Failed(val message: PlayarrMessage) : ParityLoad<Nothing>
}

internal enum class PlayarrFailureSubject(val key: PlayarrString) {
    Playlists(PlayarrString.ErrorSubjectPlaylists),
    Playlist(PlayarrString.ErrorSubjectPlaylist),
    Profiles(PlayarrString.ErrorSubjectProfiles),
    Profile(PlayarrString.ErrorSubjectProfile),
    Settings(PlayarrString.ErrorSubjectSettings),
    ProfileLock(PlayarrString.ErrorSubjectProfileLock),
    Invitation(PlayarrString.ErrorSubjectInvitation),
    YourData(PlayarrString.ErrorSubjectYourData),
    ServerConnection(PlayarrString.ErrorSubjectServerConnection),
    ServerGroup(PlayarrString.ErrorSubjectServerGroup),
}

internal data class ResolvedPlaylistDirectory(
    val playlists: List<Playlist>,
    val itemsByPlaylist: Map<String, List<PlaylistItem>>,
    val details: Map<String, WorkDetail>,
)

internal enum class PlaylistVisibility { All, Personal, Shared }

internal enum class PlaylistOrder { Ascending, Descending }

private val PLAYLISTS_LIVE_INTEREST = setOf(LiveTarget(LiveArea.Playlist), LiveTarget(LiveArea.Work))

internal class PlaylistMediaTypeMismatchException : IllegalStateException()

@HiltViewModel
internal class PlaylistsViewModel @Inject constructor(
    private val api: PlayarrApi,
    val liveBus: LiveInvalidationBus,
) : ViewModel() {
    private val _playlists = MutableStateFlow<ParityLoad<ResolvedPlaylistDirectory>>(ParityLoad.Loading)
    val playlists = _playlists.asStateFlow()
    private val fetchStamp = LiveFetchStamp()
    val fetchStartedMs: Long get() = fetchStamp.startedMs

    init { load() }

    fun load() = fetchDirectory(silent = false)

    /** Live-event / fallback refresh: keeps the shown directory until the new one arrives. */
    fun refresh() = fetchDirectory(silent = true)

    private fun fetchDirectory(silent: Boolean) = viewModelScope.launch {
        fetchStamp.begin()
        if (!silent) _playlists.value = ParityLoad.Loading
        val result = runCatching {
            coroutineScope {
                val playlists = api.listPlaylists()
                val itemGroups = playlists.map { playlist ->
                    async { playlist.id to runCatching { api.listPlaylistItems(playlist.id) }.getOrDefault(emptyList()) }
                }.awaitAll().toMap()
                val details = itemGroups.values.flatten().distinctBy(PlaylistItem::workId).map { item ->
                    async { runCatching { api.getWork(item.workId) }.getOrNull() }
                }.awaitAll().filterNotNull().associateBy { it.work.id }
                ResolvedPlaylistDirectory(playlists, itemGroups, details)
            }
        }
        if (silent && result.isFailure) return@launch
        _playlists.value = result
            .fold({ ParityLoad.Ready(it) }, { ParityLoad.Failed(it.playarrMessage(PlayarrFailureSubject.Playlists)) })
    }

    fun create(
        name: String,
        mediaType: PlaylistMediaType,
        parentPlaylistId: String?,
        onCreated: (Playlist) -> Unit,
        onFailure: (Throwable) -> Unit,
    ) = viewModelScope.launch {
        runCatching {
            val created = api.createPlaylist(CreatePlaylistRequest(name.trim(), mediaType, parentPlaylistId))
            if (created.mediaType != mediaType) {
                runCatching { api.deletePlaylist(created.id) }
                throw PlaylistMediaTypeMismatchException()
            }
            created
        }.onSuccess {
            onCreated(it)
            load()
        }.onFailure(onFailure)
    }
}

internal fun visibleRootPlaylists(
    directory: ResolvedPlaylistDirectory,
    visibility: PlaylistVisibility,
    order: PlaylistOrder,
    locale: Locale,
): List<Playlist> {
    val ids = directory.playlists.mapTo(mutableSetOf(), Playlist::id)
    val roots = directory.playlists.filter { playlist ->
        (playlist.parentPlaylistId == null || playlist.parentPlaylistId !in ids) && when (visibility) {
            PlaylistVisibility.All -> true
            PlaylistVisibility.Personal -> !playlist.isSystem
            PlaylistVisibility.Shared -> playlist.isSystem
        }
    }
    return roots.sortedWith { left, right ->
        val comparison = comparePlaylistNames(left.name, right.name, locale)
        if (order == PlaylistOrder.Ascending) comparison else -comparison
    }
}

internal fun playlistChildCount(directory: ResolvedPlaylistDirectory, playlistId: String): Int =
    directory.playlists.count { it.parentPlaylistId == playlistId }

internal fun playlistCoverWorks(directory: ResolvedPlaylistDirectory, playlistId: String): List<io.playarr.shared.data.model.Work> {
    val childrenByParent = directory.playlists.groupBy { it.parentPlaylistId }
    val works = linkedMapOf<String, io.playarr.shared.data.model.Work>()
    val visited = mutableSetOf<String>()
    fun collect(id: String) {
        if (!visited.add(id) || works.size >= 3) return
        directory.itemsByPlaylist[id].orEmpty().forEach { item ->
            if (works.size >= 3) return@forEach
            directory.details[item.workId]?.work?.let { works.putIfAbsent(it.id, it) }
        }
        childrenByParent[id].orEmpty().forEach { child -> collect(child.id) }
    }
    collect(playlistId)
    return works.values.take(3)
}

private fun comparePlaylistNames(left: String, right: String, locale: Locale): Int {
    val token = Regex("\\d+|\\D+")
    val leftParts = token.findAll(left).map(MatchResult::value).toList()
    val rightParts = token.findAll(right).map(MatchResult::value).toList()
    val collator = java.text.Collator.getInstance(locale).apply { strength = java.text.Collator.PRIMARY }
    for (index in 0 until minOf(leftParts.size, rightParts.size)) {
        val leftPart = leftParts[index]
        val rightPart = rightParts[index]
        val comparison = if (leftPart.all(Char::isDigit) && rightPart.all(Char::isDigit)) {
            val leftNumber = leftPart.trimStart('0').ifEmpty { "0" }
            val rightNumber = rightPart.trimStart('0').ifEmpty { "0" }
            leftNumber.length.compareTo(rightNumber.length).takeIf { it != 0 }
                ?: leftNumber.compareTo(rightNumber).takeIf { it != 0 }
                ?: leftPart.length.compareTo(rightPart.length)
        } else {
            collator.compare(leftPart, rightPart)
        }
        if (comparison != 0) return comparison
    }
    return leftParts.size.compareTo(rightParts.size)
}

@HiltViewModel
internal class PlaylistActionsViewModel @Inject constructor(private val api: PlayarrApi) : ViewModel() {
    private val _playlists = MutableStateFlow<ParityLoad<List<Playlist>>>(ParityLoad.Loading)
    val playlists = _playlists.asStateFlow()
    private val _message = MutableStateFlow<PlayarrMessage?>(null)
    val message = _message.asStateFlow()

    fun load(mediaType: PlaylistMediaType) = viewModelScope.launch {
        _playlists.value = runCatching { api.listPlaylists().filter { !it.isSystem && it.mediaType == mediaType } }
            .fold({ ParityLoad.Ready(it) }, { ParityLoad.Failed(it.playarrMessage(PlayarrFailureSubject.Playlists)) })
    }

    fun add(playlistId: String, workId: String, trackId: String?, onAdded: () -> Unit) = viewModelScope.launch {
        runCatching { api.addPlaylistItem(playlistId, AddPlaylistItemRequest(workId, trackId)) }
            .onSuccess { onAdded() }
            .onFailure { _message.value = it.playarrMessage(PlayarrFailureSubject.Playlist) }
    }

    fun clearMessage() { _message.value = null }
}

@Composable
internal fun AddToPlaylistDialog(
    workId: String,
    trackId: String?,
    mediaType: PlaylistMediaType,
    onDismiss: () -> Unit,
    viewModel: PlaylistActionsViewModel = hiltViewModel(),
) {
    val state by viewModel.playlists.collectAsState()
    val message by viewModel.message.collectAsState()
    LaunchedEffect(mediaType) { viewModel.load(mediaType) }
    PlayarrPanel(
        onDismissRequest = onDismiss,
        title = { Text(playarrString(PlayarrString.ContextAddToPlaylistHeading)) },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth().height(360.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                when (val current = state) {
                    ParityLoad.Loading -> CircularProgressIndicator(color = WebAccent)
                    is ParityLoad.Failed -> Text(playarrText(current.message), color = MaterialTheme.colorScheme.error)
                    is ParityLoad.Ready -> if (current.value.isEmpty()) {
                        Text(
                            playarrString(PlayarrString.ContextNoPersonalPlaylistsTitle),
                            color = WebInk,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(playarrString(PlayarrString.ContextNoPersonalPlaylistsDescription), color = WebInkMuted)
                    } else {
                        current.value.forEach { playlist ->
                            Surface(onClick = { viewModel.add(playlist.id, workId, trackId, onDismiss) }, color = WebSurfaceSoft, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                                Text(playlist.name, modifier = Modifier.padding(14.dp), color = WebInk)
                            }
                        }
                    }
                }
                message?.let { Text(playarrText(it), color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = { PlayarrButton(onClick = onDismiss) { Text(playarrString(PlayarrString.CommonClose)) } },
    )
}

@Composable
internal fun ExperiencePlaylistsScreen(
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    navController: NavHostController,
    viewModel: PlaylistsViewModel = hiltViewModel(),
) {
    val state by viewModel.playlists.collectAsState()
    LiveRefreshEffect(viewModel.liveBus, PLAYLISTS_LIVE_INTEREST, { viewModel.fetchStartedMs }, viewModel::refresh)
    var creating by remember { mutableStateOf(false) }
    var filtering by remember { mutableStateOf(false) }
    var visibility by remember { mutableStateOf(PlaylistVisibility.All) }
    var order by remember { mutableStateOf(PlaylistOrder.Ascending) }
    var name by remember { mutableStateOf("") }
    var mediaType by remember { mutableStateOf(PlaylistMediaType.Video) }
    var parentPlaylistId by remember { mutableStateOf<String?>(null) }
    var createError by remember { mutableStateOf<PlayarrMessage?>(null) }
    var createBusy by remember { mutableStateOf(false) }
    val language = LocalPlayarrLanguage.current
    Box(Modifier.fillMaxSize()) {
        PlayarrPageLayout(
            pageId = PlayarrPageId.Playlists,
            header = playarrPageHeader(title = playarrString(PlayarrString.PlaylistsTitle), onBack = { navController.openExperienceTopLevel("home") }, filters = PlayarrFilterAction(
                label = playarrString(PlayarrString.LibraryFilters),
                onClick = { filtering = true },
                active = filtering,
                badge = listOf(visibility != PlaylistVisibility.All, order != PlaylistOrder.Ascending).count { it },
            ), actions = listOf(
                PlayarrPageAction.Link("create-playlist", playarrString(PlayarrString.PlaylistsCreate), PlayarrActionIcon.Add) { creating = true },
            )),
        ) {
            when (val current = state) {
                ParityLoad.Loading -> PlayarrLoadingState(playarrString(PlayarrString.PlaylistsPreparing))
                is ParityLoad.Failed -> PlayarrErrorState(current.message, viewModel::load)
                is ParityLoad.Ready -> {
                    val visible = visibleRootPlaylists(current.value, visibility, order, language.locale)
                    Text(
                        playarrString(
                            if (visible.size == 1) PlayarrString.PlaylistsCountOne else PlayarrString.PlaylistsCountOther,
                            "count" to visible.size,
                        ),
                        color = WebInkMuted,
                        fontSize = 11.sp,
                    )
                    if (visible.isEmpty()) {
                        PlayarrEmptyState(
                            playarrString(
                                if (current.value.playlists.isEmpty()) {
                                    PlayarrString.PlaylistsNoneYetTitle
                                } else {
                                    PlayarrString.PlaylistsNoMatchingTitle
                                },
                            ),
                            playarrString(
                                if (current.value.playlists.isEmpty()) {
                                    PlayarrString.PlaylistsCreateCollectionDescription
                                } else {
                                    PlayarrString.PlaylistsNoMatchingDescription
                                },
                            ),
                        )
                    } else {
                    LazyVerticalGrid(
                        columns = GridCells.Adaptive(if (isTelevision) 230.dp else 160.dp),
                        modifier = Modifier.fillMaxSize().padding(top = 28.dp),
                        contentPadding = PaddingValues(bottom = 32.dp),
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                        verticalArrangement = Arrangement.spacedBy(18.dp),
                    ) {
                        items(visible, key = Playlist::id) { playlist ->
                            PlaylistCard(
                                playlist = playlist,
                                coverWorks = playlistCoverWorks(current.value, playlist.id),
                                itemCount = current.value.itemsByPlaylist[playlist.id].orEmpty().size,
                                childCount = playlistChildCount(current.value, playlist.id),
                                serverUrl = serverUrl,
                                accessToken = accessToken,
                                onClick = { navController.navigate("playlists/${playlist.id}") },
                            )
                        }
                    }
                    }
                }
            }
        }
    }
    if (creating) {
        val directory = (state as? ParityLoad.Ready)?.value
        val parents = directory?.let {
            visibleRootPlaylists(it, PlaylistVisibility.Personal, PlaylistOrder.Ascending, language.locale)
                .filter { playlist -> playlist.mediaType == mediaType }
        }.orEmpty()
        PlayarrPanel(
            onDismissRequest = { if (!createBusy) creating = false },
            title = { Text(playarrString(PlayarrString.PlaylistsCreateTitle)) },
            text = {
                Column(
                    modifier = Modifier.fillMaxWidth().heightIn(max = 440.dp).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it; createError = null },
                        label = { Text(playarrString(PlayarrString.PlaylistsName)) },
                        placeholder = { Text(playarrString(PlayarrString.PlaylistsNamePlaceholder)) },
                        singleLine = true,
                        enabled = !createBusy,
                        modifier = Modifier.fillMaxWidth().playarrSingleLineArrowNavigation(),
                    )
                    Text(playarrString(PlayarrString.PlaylistsMediaType), color = WebInkSoft, fontSize = 12.sp)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(
                            PlaylistMediaType.Video to playarrString(PlayarrString.PlaylistsMediaTypeVideo),
                            PlaylistMediaType.Audio to playarrString(PlayarrString.PlaylistsMediaTypeAudio),
                        ).forEach { (type, label) ->
                            PlayarrButton(
                                onClick = {
                                    mediaType = type
                                    parentPlaylistId = null
                                    createError = null
                                },
                                enabled = !createBusy && mediaType != type,
                                variant = PlayarrButtonVariant.Secondary,
                            ) { Text(label) }
                        }
                    }
                    Text(playarrString(PlayarrString.PlaylistsParent), color = WebInkSoft, fontSize = 12.sp)
                    PlaylistParentChoices(
                        parents = parents,
                        selectedId = parentPlaylistId,
                        enabled = !createBusy,
                        onSelected = { parentPlaylistId = it },
                    )
                    createError?.let {
                        Text(playarrText(it), color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
                    }
                }
            },
            confirmButton = {
                PlayarrButton(
                    enabled = name.isNotBlank() && !createBusy,
                    onClick = {
                        if (name.isBlank()) {
                            createError = PlayarrMessage.Localized(PlayarrString.PlaylistsNameRequired)
                            return@PlayarrButton
                        }
                        createBusy = true
                        viewModel.create(
                            name = name,
                            mediaType = mediaType,
                            parentPlaylistId = parentPlaylistId,
                            onCreated = {
                                name = ""
                                mediaType = PlaylistMediaType.Video
                                parentPlaylistId = null
                                createError = null
                                createBusy = false
                                creating = false
                            },
                            onFailure = { error ->
                                createBusy = false
                                createError = if (error is PlaylistMediaTypeMismatchException) {
                                    PlayarrMessage.Localized(PlayarrString.PlaylistsMediaTypeMismatch)
                                } else {
                                    error.playarrMessage(PlayarrFailureSubject.Playlist)
                                }
                            },
                        )
                    },
                ) { Text(playarrString(if (createBusy) PlayarrString.PlaylistsCreating else PlayarrString.PlaylistsCreate)) }
            },
            dismissButton = {
                PlayarrButton(onClick = { creating = false }, enabled = !createBusy, variant = PlayarrButtonVariant.Ghost) {
                    Text(playarrString(PlayarrString.CommonCancel))
                }
            },
        )
    }
    if (filtering) {
        PlayarrPanel(
            onDismissRequest = { filtering = false },
            title = { Text(playarrString(PlayarrString.PlaylistsFilters)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    SettingChoiceOptions(
                        label = playarrString(PlayarrString.PlaylistsShow),
                        choices = listOf(
                            PlaylistVisibility.All to playarrString(PlayarrString.PlaylistsVisibilityAll),
                            PlaylistVisibility.Personal to playarrString(PlayarrString.PlaylistsVisibilityMine),
                            PlaylistVisibility.Shared to playarrString(PlayarrString.PlaylistsVisibilityShared),
                        ),
                        selected = visibility,
                        onSelected = { visibility = it },
                    )
                    SettingChoiceOptions(
                        label = playarrString(PlayarrString.PlaylistsOrder),
                        choices = listOf(
                            PlaylistOrder.Ascending to playarrString(PlayarrString.PlaylistsOrderAscending),
                            PlaylistOrder.Descending to playarrString(PlayarrString.PlaylistsOrderDescending),
                        ),
                        selected = order,
                        onSelected = { order = it },
                    )
                }
            },
            confirmButton = {
                PlayarrButton(onClick = { filtering = false }) { Text(playarrString(PlayarrString.CommonDone)) }
            },
        )
    }
}

@Composable
private fun PlaylistParentChoices(
    parents: List<Playlist>,
    selectedId: String?,
    enabled: Boolean,
    labels: Map<String, String> = emptyMap(),
    onSelected: (String?) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        PlayarrButton(
            onClick = { onSelected(null) },
            enabled = enabled && selectedId != null,
            modifier = Modifier.fillMaxWidth(),
            variant = PlayarrButtonVariant.Secondary,
        ) { Text(playarrString(PlayarrString.PlaylistsNoParent)) }
        parents.forEach { parent ->
            PlayarrButton(
                onClick = { onSelected(parent.id) },
                enabled = enabled && selectedId != parent.id,
                modifier = Modifier.fillMaxWidth(),
                variant = PlayarrButtonVariant.Secondary,
            ) { Text(labels[parent.id] ?: parent.name, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
    }
}

@Composable
internal fun PlaylistCard(
    playlist: Playlist,
    coverWorks: List<io.playarr.shared.data.model.Work> = emptyList(),
    itemCount: Int? = null,
    childCount: Int = 0,
    serverUrl: String = "",
    accessToken: String? = null,
    selected: Boolean = false,
    onSelected: () -> Unit = {},
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val openLabel = playarrString(PlayarrString.PlaylistsOpenLabel, "name" to playlist.name)
    // A playlist tile is a media card: shadow and a draw-only lift on the content inside the focus target, no ring.
    Box(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(1.45f)
            .onFocusChanged {
                focused = it.isFocused
                if (it.isFocused) onSelected()
            }
            .semantics { contentDescription = openLabel }
            .clickable(onClick = onClick),
    ) {
    WebShadowedBox(
        shadows = if (focused) webCardFocusShadows else webCardRestShadows,
        shape = RoundedCornerShape(18.dp),
        focusGlow = focused,
        modifier = Modifier.fillMaxSize().mediaCardLift(focused),
        innerModifier = Modifier
            .background(WebSurfaceStrong)
            .border(1.dp, if (focused || selected) WebInkSoft else WebInkMuted.copy(alpha = 0.18f), RoundedCornerShape(18.dp)),
    ) {
        Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(WebAccent.copy(alpha = 0.22f), WebSurfaceStrong)))) {
            if (coverWorks.isEmpty() || serverUrl.isBlank()) {
                Icon(Icons.AutoMirrored.Outlined.PlaylistPlay, contentDescription = null, tint = WebAccent, modifier = Modifier.align(Alignment.TopEnd).padding(18.dp).size(38.dp))
            } else {
                coverWorks.take(3).asReversed().forEachIndexed { index, work ->
                    AuthenticatedArtwork(
                        work = work,
                        kinds = listOf(io.playarr.shared.data.model.ImageKind.Poster, io.playarr.shared.data.model.ImageKind.Backdrop),
                        serverUrl = serverUrl,
                        accessToken = accessToken,
                        contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                        modifier = Modifier.fillMaxSize()
                            .padding(start = (10 + index * 4).dp, top = (8 + index * 3).dp, end = (10 + index * 4).dp)
                            .offset(y = (index * 2).dp)
                            .rotate((index - 1) * 1.5f)
                            .clip(RoundedCornerShape(14.dp)),
                    )
                }
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, WebSurface.copy(alpha = 0.94f)))))
            }
            Column(Modifier.align(Alignment.BottomStart).padding(18.dp)) {
                Text(playlist.name, color = WebInk, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val metadata = buildList {
                    add(
                        playarrString(
                            if (playlist.mediaType == PlaylistMediaType.Audio) {
                                PlayarrString.PlaylistsMediaTypeAudio
                            } else {
                                PlayarrString.PlaylistsMediaTypeVideo
                            },
                        ),
                    )
                    add(playarrString(if (playlist.isSystem) PlayarrString.PlaylistsShared else PlayarrString.PlaylistsPersonal))
                    itemCount?.let { count ->
                        add(
                            playarrString(
                                if (count == 1) PlayarrString.PlaylistsItemCountOne else PlayarrString.PlaylistsItemCountOther,
                                "count" to count,
                            ),
                        )
                    }
                    if (childCount > 0) {
                        add(
                            playarrString(
                                if (childCount == 1) PlayarrString.PlaylistsFolderCountOne else PlayarrString.PlaylistsFolderCountOther,
                                "count" to childCount,
                            ),
                        )
                    }
                }
                Text(metadata.joinToString(" · "), color = WebInkMuted, fontSize = 9.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
    }
}

internal data class ResolvedPlaylistTrack(
    val playlist: Playlist,
    val items: List<PlaylistItem>,
)

internal data class ResolvedPlaylist(
    val root: Playlist,
    val tracks: List<ResolvedPlaylistTrack>,
    val details: Map<String, WorkDetail>,
    val allPlaylists: List<Playlist>,
)

@HiltViewModel
internal class PlaylistDetailViewModel @Inject constructor(
    private val api: PlayarrApi,
    val liveBus: LiveInvalidationBus,
) : ViewModel() {
    private val _state = MutableStateFlow<ParityLoad<ResolvedPlaylist>>(ParityLoad.Loading)
    val state = _state.asStateFlow()
    private var loadedId: String? = null
    private val fetchStamp = LiveFetchStamp()
    val fetchStartedMs: Long get() = fetchStamp.startedMs

    /** Live-event / fallback refresh of the open playlist, in place. */
    fun refreshInPlace() {
        val id = loadedId ?: return
        if (_state.value is ParityLoad.Ready) refresh(id, silent = true)
    }

    fun load(id: String) {
        if (loadedId == id && _state.value is ParityLoad.Ready) return
        loadedId = id
        refresh(id)
    }

    private fun refresh(id: String, silent: Boolean = false) = viewModelScope.launch {
        fetchStamp.begin()
        if (!silent) _state.value = ParityLoad.Loading
        val result = runCatching {
            coroutineScope {
                val listed = api.listPlaylists()
                val requested = listed.firstOrNull { it.id == id } ?: api.getPlaylist(id)
                val playlists = if (listed.any { it.id == requested.id }) listed else listed + requested
                val root = requested.rootPlaylist(playlists)
                val trackPlaylists = listOf(root) + root.descendantPlaylists(playlists)
                val itemGroups = trackPlaylists.map { playlist ->
                    async {
                        ResolvedPlaylistTrack(
                            playlist,
                            runCatching { api.listPlaylistItems(playlist.id) }.getOrDefault(emptyList())
                                .sortedBy(PlaylistItem::position),
                        )
                    }
                }.awaitAll()
                val details = itemGroups.flatMap(ResolvedPlaylistTrack::items).distinctBy(PlaylistItem::workId).map { item ->
                    async { runCatching { item.workId to api.getWork(item.workId) }.getOrNull() }
                }.awaitAll().filterNotNull().toMap()
                ResolvedPlaylist(root, itemGroups, details, playlists)
            }
        }
        if (silent && result.isFailure) return@launch
        _state.value = result.fold({ ParityLoad.Ready(it) }, { ParityLoad.Failed(it.playarrMessage(PlayarrFailureSubject.Playlist)) })
    }

    fun remove(playlistId: String, itemId: String) = mutate { current ->
        api.removePlaylistItem(playlistId, itemId)
        refresh(current.root.id)
    }

    fun move(playlistId: String, itemId: String, delta: Int) = mutate { current ->
        val order = current.tracks.firstOrNull { it.playlist.id == playlistId }
            ?.items?.map(PlaylistItem::id)?.toMutableList() ?: return@mutate
        val from = order.indexOf(itemId)
        if (from < 0) return@mutate
        val to = (from + delta).coerceIn(0, order.lastIndex)
        if (from != to) {
            order.add(to, order.removeAt(from))
            api.reorderPlaylistItems(playlistId, ReorderPlaylistItemsRequest(order))
            refresh(current.root.id)
        }
    }

    fun createChild(parent: Playlist, name: String, onCreated: () -> Unit, onFailure: (Throwable) -> Unit) =
        viewModelScope.launch {
            runCatching {
                val created = api.createPlaylist(CreatePlaylistRequest(name.trim(), parent.mediaType, parent.id))
                if (created.mediaType != parent.mediaType) {
                    runCatching { api.deletePlaylist(created.id) }
                    throw PlaylistMediaTypeMismatchException()
                }
                created
            }.onSuccess {
                onCreated()
                refresh((_state.value as? ParityLoad.Ready)?.value?.root?.id ?: parent.id)
            }.onFailure(onFailure)
        }

    fun update(
        playlistId: String,
        name: String,
        parentPlaylistId: String?,
        onUpdated: () -> Unit,
        onFailure: (Throwable) -> Unit,
    ) = viewModelScope.launch {
        runCatching { api.updatePlaylist(playlistId, UpdatePlaylistRequest(name.trim(), parentPlaylistId)) }
            .onSuccess { updated ->
                onUpdated()
                refresh(updated.rootPlaylist((_state.value as? ParityLoad.Ready)?.value?.allPlaylists.orEmpty()).id)
            }
            .onFailure(onFailure)
    }

    fun delete(playlistId: String, onDeleted: (Boolean) -> Unit, onFailure: (Throwable) -> Unit) = mutate(
        onFailure = onFailure,
    ) { current ->
        api.deletePlaylist(playlistId)
        val deletedRoot = playlistId == current.root.id
        onDeleted(deletedRoot)
        if (!deletedRoot) refresh(current.root.id)
    }

    private fun mutate(
        onFailure: (Throwable) -> Unit = { error ->
            _state.value = ParityLoad.Failed(error.playarrMessage(PlayarrFailureSubject.Playlist))
        },
        block: suspend (ResolvedPlaylist) -> Unit,
    ) = viewModelScope.launch {
        val current = (_state.value as? ParityLoad.Ready)?.value ?: return@launch
        runCatching { block(current) }
            .onFailure(onFailure)
    }
}

internal fun Playlist.rootPlaylist(playlists: List<Playlist>): Playlist {
    val byId = playlists.associateBy(Playlist::id)
    var current = this
    val visited = mutableSetOf(id)
    while (true) {
        val parentId = current.parentPlaylistId ?: break
        if (!visited.add(parentId)) break
        current = byId[parentId] ?: break
    }
    return current
}

internal fun Playlist.descendantPlaylists(playlists: List<Playlist>): List<Playlist> {
    val children = playlists.groupBy(Playlist::parentPlaylistId)
    val descendants = mutableListOf<Playlist>()
    val visited = mutableSetOf(id)
    fun visit(parentId: String) {
        children[parentId].orEmpty()
            .sortedWith { left, right -> comparePlaylistNames(left.name, right.name, Locale.getDefault()) }
            .forEach { child ->
                if (!visited.add(child.id)) return@forEach
                descendants += child
                visit(child.id)
            }
    }
    visit(id)
    return descendants
}

internal fun playlistParentOptions(active: Playlist, playlists: List<Playlist>): List<Playlist> {
    val excluded = active.descendantPlaylists(playlists).mapTo(mutableSetOf(active.id), Playlist::id)
    return playlists.filter { candidate ->
        !candidate.isSystem && candidate.mediaType == active.mediaType && candidate.id !in excluded
    }.sortedWith { left, right -> comparePlaylistNames(left.name, right.name, Locale.getDefault()) }
}

internal fun Playlist.playlistPath(playlists: List<Playlist>): String {
    val byId = playlists.associateBy(Playlist::id)
    val names = mutableListOf(name)
    val visited = mutableSetOf(id)
    var parentId = parentPlaylistId
    while (parentId != null && visited.add(parentId)) {
        val parent = byId[parentId] ?: break
        names.add(0, parent.name)
        parentId = parent.parentPlaylistId
    }
    return names.joinToString(" › ")
}

@Composable
internal fun ExperiencePlaylistDetailScreen(
    playlistId: String,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    onBack: () -> Unit,
    onOpenWork: (String) -> Unit,
    onPlay: (String, List<PlayarrPlaybackQueueItem>, Long?, PlayarrPlaybackLaunchSettings?) -> Unit,
    viewModel: PlaylistDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    var creatingUnder by remember { mutableStateOf<Playlist?>(null) }
    var editing by remember { mutableStateOf<Playlist?>(null) }
    var deleting by remember { mutableStateOf<Playlist?>(null) }
    LaunchedEffect(playlistId) { viewModel.load(playlistId) }
    val liveInterest = remember(playlistId) { setOf(LiveTarget(LiveArea.Playlist, playlistId), LiveTarget(LiveArea.Work)) }
    LiveRefreshEffect(viewModel.liveBus, liveInterest, { viewModel.fetchStartedMs }, viewModel::refreshInPlace)
    when (val current = state) {
        ParityLoad.Loading -> PlayarrPageLayout(
            pageId = PlayarrPageId.PlaylistDetail,
            header = playarrPageHeader(title = "", onBack = onBack),
            state = PlayarrPageState.Loading(playarrString(PlayarrString.PlaylistsLoading)),
        ) {}
        is ParityLoad.Failed -> PlayarrPageLayout(
            pageId = PlayarrPageId.PlaylistDetail,
            header = playarrPageHeader(title = "", onBack = onBack),
            state = playarrErrorState(current.message) { viewModel.load(playlistId) },
        ) {}
        is ParityLoad.Ready -> {
            val value = current.value
            PlayarrPageLayout(
                pageId = PlayarrPageId.PlaylistDetail,
                header = playarrPageHeader(title = value.root.name, onBack = onBack, subtitle = playarrString(
                    if (value.tracks.size == 1) PlayarrString.PlaylistsTrackCountOne else PlayarrString.PlaylistsTrackCountOther,
                    "count" to value.tracks.size,
                ).uppercase(LocalPlayarrLanguage.current.locale), actions = if (value.root.isSystem) {
                    emptyList()
                } else {
                    listOf(
                        PlayarrPageAction.Link("create-sub-playlist", playarrString(PlayarrString.PlaylistsCreateSubPlaylist), PlayarrActionIcon.Add) { creatingUnder = value.root },
                    )
                }),
            ) {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize().padding(top = 8.dp),
                        contentPadding = PaddingValues(bottom = 32.dp),
                        verticalArrangement = Arrangement.spacedBy(22.dp),
                    ) {
                        items(value.tracks, key = { "track:${it.playlist.id}" }) { track ->
                            val queue = track.items.mapNotNull { item ->
                                value.details[item.workId]?.playarrPlaybackQueueItem(item)
                            }
                            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text(track.playlist.name, color = WebInk, fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
                                        val count = track.items.size
                                        val mediaTypeLabel = playarrString(
                                            if (track.playlist.mediaType == PlaylistMediaType.Audio) {
                                                PlayarrString.PlaylistsMediaTypeAudio
                                            } else {
                                                PlayarrString.PlaylistsMediaTypeVideo
                                            },
                                        )
                                        val itemCountLabel =
                                            if (track.playlist.id == value.root.id) {
                                                playarrString(
                                                    if (count == 1) {
                                                        PlayarrString.PlaylistsDirectItemsOne
                                                    } else {
                                                        PlayarrString.PlaylistsDirectItemsOther
                                                    },
                                                    "count" to count,
                                                )
                                            } else {
                                                playarrString(
                                                    if (count == 1) {
                                                        PlayarrString.PlaylistsItemCountOne
                                                    } else {
                                                        PlayarrString.PlaylistsItemCountOther
                                                    },
                                                    "count" to count,
                                                )
                                            }
                                        Text(
                                            "$mediaTypeLabel · $itemCountLabel",
                                            color = WebInkMuted,
                                            fontSize = 10.sp,
                                        )
                                    }
                                    if (!track.playlist.isSystem) {
                                        PlayarrIconButton(onClick = { editing = track.playlist }, contentDescription = playarrString(PlayarrString.PlaylistActionsEdit)) {
                                            Icon(
                                                Icons.Outlined.Edit,
                                                contentDescription = null,
                                                tint = WebInkMuted)
                                        }
                                        PlayarrIconButton(onClick = { deleting = track.playlist }, contentDescription = playarrString(PlayarrString.PlaylistActionsDelete)) {
                                            Icon(
                                                Icons.Outlined.Delete,
                                                contentDescription = null,
                                                tint = MaterialTheme.colorScheme.error)
                                        }
                                    }
                                }
                                if (track.items.isEmpty()) {
                                    Surface(color = WebSurfaceStrong, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
                                        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                            Text(
                                                playarrString(PlayarrString.PlaylistsEmptyTrackTitle),
                                                color = WebInk,
                                                fontWeight = FontWeight.SemiBold,
                                            )
                                            Text(
                                                playarrString(PlayarrString.PlaylistsEmptyTrackDescription),
                                                color = WebInkMuted,
                                                fontSize = 11.sp,
                                            )
                                        }
                                    }
                                }
                                track.items.forEachIndexed { index, item ->
                                    PlaylistDetailItem(
                                        item = item,
                                        detail = value.details[item.workId],
                                        serverUrl = serverUrl,
                                        accessToken = accessToken,
                                        isTelevision = isTelevision,
                                        editable = !track.playlist.isSystem,
                                        canMoveUp = index > 0,
                                        canMoveDown = index < track.items.lastIndex,
                                        onOpen = { onOpenWork(item.workId) },
                                        onPlay = { mediaFileId -> onPlay(mediaFileId, queue, null, null) },
                                        onMoveUp = { viewModel.move(track.playlist.id, item.id, -1) },
                                        onMoveDown = { viewModel.move(track.playlist.id, item.id, 1) },
                                        onRemove = { viewModel.remove(track.playlist.id, item.id) },
                                    )
                                }
                            }
                        }
                    }
            }

            creatingUnder?.let { parent ->
                CreateSubPlaylistDialog(
                    parent = parent,
                    onDismiss = { creatingUnder = null },
                    onCreate = { name, onCreated, onFailure ->
                        viewModel.createChild(parent, name, onCreated, onFailure)
                    },
                )
            }
            editing?.let { playlist ->
                EditPlaylistDialog(
                    playlist = playlist,
                    parentOptions = playlistParentOptions(playlist, value.allPlaylists),
                    allPlaylists = value.allPlaylists,
                    onDismiss = { editing = null },
                    onSave = { name, parentId, onUpdated, onFailure ->
                        viewModel.update(playlist.id, name, parentId, onUpdated, onFailure)
                    },
                )
            }
            deleting?.let { playlist ->
                DeletePlaylistDialog(
                    playlist = playlist,
                    onDismiss = { deleting = null },
                    onDelete = { onDeleted, onFailure ->
                        viewModel.delete(
                            playlistId = playlist.id,
                            onDeleted = { deletedRoot ->
                                deleting = null
                                onDeleted()
                                if (deletedRoot) onBack()
                            },
                            onFailure = onFailure,
                        )
                    },
                )
            }
        }
    }
}

@Composable
private fun PlaylistDetailItem(
    item: PlaylistItem,
    detail: WorkDetail?,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    editable: Boolean,
    canMoveUp: Boolean,
    canMoveDown: Boolean,
    onOpen: () -> Unit,
    onPlay: (String) -> Unit,
    onMoveUp: () -> Unit,
    onMoveDown: () -> Unit,
    onRemove: () -> Unit,
) {
    val mediaFileId = detail?.mediaFileFor(item)
    val queueItem = detail?.playarrPlaybackQueueItem(item)
    Surface(
        onClick = onOpen,
        color = WebSurfaceStrong,
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (detail != null) {
                    AuthenticatedArtwork(
                        detail.work,
                        listOf(io.playarr.shared.data.model.ImageKind.Thumb, io.playarr.shared.data.model.ImageKind.Backdrop),
                        serverUrl,
                        accessToken,
                        androidx.compose.ui.layout.ContentScale.Crop,
                        Modifier.width(if (isTelevision) 150.dp else 100.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(9.dp)),
                    )
                }
                Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                    Text(
                        queueItem?.title ?: playarrString(PlayarrString.PlaylistsUnavailableTitle),
                        color = WebInk,
                        fontWeight = FontWeight.SemiBold,
                    )
                    queueItem?.subtitle?.let { Text(it, color = WebInkMuted, fontSize = 10.sp) }
                    Text(
                        playarrString(PlayarrString.PlaylistsItemPosition, "position" to item.position + 1),
                        color = WebInkMuted,
                        fontSize = 10.sp,
                    )
                }
                if (mediaFileId != null) {
                    PlayarrIconButton(onClick = { onPlay(mediaFileId) }, contentDescription = playarrString(PlayarrString.PlaylistItemPlay)) {
                        Icon(Icons.Outlined.PlayArrow, contentDescription = null, tint = WebAccent)
                    }
                }
            }
            if (editable) {
                Row(Modifier.align(Alignment.End)) {
                    PlayarrIconButton(onClick = onMoveUp, contentDescription = playarrString(PlayarrString.PlaylistItemMoveUp), enabled = canMoveUp) {
                        Icon(Icons.Outlined.ArrowUpward, contentDescription = null, tint = WebInkMuted)
                    }
                    PlayarrIconButton(onClick = onMoveDown, contentDescription = playarrString(PlayarrString.PlaylistItemMoveDown), enabled = canMoveDown) {
                        Icon(Icons.Outlined.ArrowDownward, contentDescription = null, tint = WebInkMuted)
                    }
                    PlayarrIconButton(onClick = onRemove, contentDescription = playarrString(PlayarrString.PlaylistItemRemove)) {
                        Icon(Icons.Outlined.Delete, contentDescription = null, tint = WebInkMuted)
                    }
                }
            }
        }
    }
}

@Composable
private fun CreateSubPlaylistDialog(
    parent: Playlist,
    onDismiss: () -> Unit,
    onCreate: (String, () -> Unit, (Throwable) -> Unit) -> Unit,
) {
    var name by remember(parent.id) { mutableStateOf("") }
    var busy by remember(parent.id) { mutableStateOf(false) }
    var error by remember(parent.id) { mutableStateOf<PlayarrMessage?>(null) }
    val typeLabel = playarrString(
        if (parent.mediaType == PlaylistMediaType.Audio) {
            PlayarrString.PlaylistsMediaTypeAudio
        } else {
            PlayarrString.PlaylistsMediaTypeVideo
        },
    )
    PlayarrPanel(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(playarrString(PlayarrString.PlaylistsCreateSubPlaylist)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(parent.name, color = WebInkMuted, fontSize = 11.sp)
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it; error = null },
                    label = { Text(playarrString(PlayarrString.PlaylistsName)) },
                    placeholder = { Text(playarrString(PlayarrString.PlaylistsNamePlaceholder)) },
                    singleLine = true,
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth().playarrSingleLineArrowNavigation(),
                )
                Text("${playarrString(PlayarrString.PlaylistsMediaType)} · $typeLabel", color = WebInkMuted, fontSize = 11.sp)
                error?.let { Text(playarrText(it), color = MaterialTheme.colorScheme.error, fontSize = 11.sp) }
            }
        },
        confirmButton = {
            PlayarrButton(
                enabled = name.isNotBlank() && !busy,
                onClick = {
                    busy = true
                    onCreate(
                        name,
                        { busy = false; onDismiss() },
                        { failure ->
                            busy = false
                            error = if (failure is PlaylistMediaTypeMismatchException) {
                                PlayarrMessage.Localized(PlayarrString.PlaylistsMediaTypeMismatch)
                            } else {
                                failure.playarrMessage(PlayarrFailureSubject.Playlist)
                            }
                        },
                    )
                },
            ) { Text(playarrString(if (busy) PlayarrString.PlaylistsCreating else PlayarrString.PlaylistsCreate)) }
        },
        dismissButton = {
            PlayarrButton(onClick = onDismiss, enabled = !busy, variant = PlayarrButtonVariant.Ghost) { Text(playarrString(PlayarrString.CommonCancel)) }
        },
    )
}

@Composable
private fun EditPlaylistDialog(
    playlist: Playlist,
    parentOptions: List<Playlist>,
    allPlaylists: List<Playlist>,
    onDismiss: () -> Unit,
    onSave: (String, String?, () -> Unit, (Throwable) -> Unit) -> Unit,
) {
    var name by remember(playlist.id) { mutableStateOf(playlist.name) }
    var parentId by remember(playlist.id) { mutableStateOf(playlist.parentPlaylistId) }
    var busy by remember(playlist.id) { mutableStateOf(false) }
    var error by remember(playlist.id) { mutableStateOf<PlayarrMessage?>(null) }
    PlayarrPanel(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(playarrString(PlayarrString.PlaylistActionsEdit)) },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth().heightIn(max = 440.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it; error = null },
                    label = { Text(playarrString(PlayarrString.PlaylistsName)) },
                    singleLine = true,
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth().playarrSingleLineArrowNavigation(),
                )
                Text(playarrString(PlayarrString.PlaylistsParent), color = WebInkSoft, fontSize = 12.sp)
                PlaylistParentChoices(
                    parents = parentOptions,
                    selectedId = parentId,
                    enabled = !busy,
                    labels = parentOptions.associate { it.id to it.playlistPath(allPlaylists) },
                    onSelected = { parentId = it },
                )
                error?.let { Text(playarrText(it), color = MaterialTheme.colorScheme.error, fontSize = 11.sp) }
            }
        },
        confirmButton = {
            PlayarrButton(
                enabled = name.isNotBlank() && !busy,
                onClick = {
                    busy = true
                    onSave(
                        name,
                        parentId,
                        { busy = false; onDismiss() },
                        { failure -> busy = false; error = failure.playarrMessage(PlayarrFailureSubject.Playlist) },
                    )
                },
            ) { Text(playarrString(if (busy) PlayarrString.PlaylistActionsSaving else PlayarrString.PlaylistActionsSave)) }
        },
        dismissButton = {
            PlayarrButton(onClick = onDismiss, enabled = !busy, variant = PlayarrButtonVariant.Ghost) { Text(playarrString(PlayarrString.CommonCancel)) }
        },
    )
}

@Composable
private fun DeletePlaylistDialog(
    playlist: Playlist,
    onDismiss: () -> Unit,
    onDelete: (() -> Unit, (Throwable) -> Unit) -> Unit,
) {
    var busy by remember(playlist.id) { mutableStateOf(false) }
    var error by remember(playlist.id) { mutableStateOf<PlayarrMessage?>(null) }
    PlayarrPanel(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(playarrString(PlayarrString.PlaylistActionsConfirmDelete)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(playarrString(PlayarrString.PlaylistActionsDeleteDescription, "name" to playlist.name))
                error?.let { Text(playarrText(it), color = MaterialTheme.colorScheme.error, fontSize = 11.sp) }
            }
        },
        confirmButton = {
            PlayarrButton(
                enabled = !busy,
                onClick = {
                    busy = true
                    onDelete(
                        { busy = false },
                        { failure -> busy = false; error = failure.playarrMessage(PlayarrFailureSubject.Playlist) },
                    )
                },
            ) {
                Text(
                    playarrString(
                        if (busy) PlayarrString.PlaylistActionsDeleting else PlayarrString.PlaylistActionsConfirmDelete,
                    ),
                    color = MaterialTheme.colorScheme.error,
                )
            }
        },
        dismissButton = {
            PlayarrButton(onClick = onDismiss, enabled = !busy, variant = PlayarrButtonVariant.Ghost) { Text(playarrString(PlayarrString.CommonCancel)) }
        },
    )
}

private fun WorkDetail.mediaFileFor(item: PlaylistItem): String? = when (val tree = children) {
    WorkChildren.Movie -> mediaFileId
    is WorkChildren.Series -> tree.seasons.flatMap { it.episodes }.firstOrNull { it.episode.id == item.trackId || item.trackId == null }?.mediaFileId
    is WorkChildren.Artist -> tree.albums.flatMap { it.tracks }.firstOrNull { it.track.id == item.trackId }?.mediaFileId
    is WorkChildren.Author -> tree.books.firstOrNull { it.book.id == item.trackId || item.trackId == null }?.mediaFileId
}

internal data class ProfilesSnapshot(
    val profiles: List<AvailableProfile>,
    val savedProfileIds: Set<String>,
    val profileAvatars: Map<String, ProfileAvatarPreference> = emptyMap(),
    val loadWarning: PlayarrMessage? = null,
    /** userId -> owning server URL, for every listed account. */
    val profileServers: Map<String, String> = emptyMap(),
    /** userId -> short server label; empty unless accounts span several servers. */
    val serverLabels: Map<String, String> = emptyMap(),
)

internal fun selectAndroidDeviceProfiles(
    available: List<AvailableProfile>,
    savedProfileIds: Set<String>,
    currentUserId: String?,
): List<AvailableProfile> = available.filter { profile ->
    profile.id == currentUserId || profile.isCurrent || profile.id in savedProfileIds
}

internal fun savedAndroidProfiles(
    profiles: List<SavedProfile>,
    currentUserId: String?,
    currentServerUrl: String? = null,
): List<AvailableProfile> = profiles.map { profile ->
    AvailableProfile(
        id = profile.userId,
        username = profile.name.orEmpty(),
        displayName = profile.name.orEmpty(),
        isCurrent = profile.userId == currentUserId &&
            (currentServerUrl == null || profile.serverUrl == currentServerUrl),
        pinLocked = false,
    )
}

/**
 * Every remembered account, across all servers. The active server's own
 * profile list (when reachable) refines names and PIN state for accounts on
 * that server, but never hides an account that is saved locally: a second
 * login is a different account whose server-side household list does not
 * include the first one.
 */
internal fun mergeAccountProfiles(
    saved: List<SavedProfile>,
    currentServerUrl: String?,
    currentUserId: String?,
    serverProfiles: List<AvailableProfile>?,
): List<AvailableProfile> {
    val fromSaved = savedAndroidProfiles(saved, currentUserId, currentServerUrl)
    if (serverProfiles == null || currentServerUrl == null) return fromSaved
    val savedOnCurrent = saved.filter { it.serverUrl == currentServerUrl }.mapTo(mutableSetOf(), SavedProfile::userId)
    val live = selectAndroidDeviceProfiles(serverProfiles, savedOnCurrent, currentUserId).associateBy(AvailableProfile::id)
    return saved.zip(fromSaved).map { (record, fallback) ->
        val refined = if (record.serverUrl == currentServerUrl) live[record.userId] else null
        if (refined == null) fallback else refined.copy(isCurrent = fallback.isCurrent)
    }
}

internal fun accountServerLabels(saved: List<SavedProfile>): Map<String, String> {
    if (saved.map(SavedProfile::serverUrl).distinct().size < 2) return emptyMap()
    return saved.associate { it.userId to runCatching { URI(it.serverUrl).authority }.getOrNull().orEmpty().ifBlank { it.serverUrl } }
}

@HiltViewModel
internal class ProfilesViewModel @Inject constructor(
    private val api: PlayarrApi,
    private val loginApi: LoginApi,
    private val tokenStore: TokenStore,
    private val serverConfigStore: ServerConfigStore,
    private val sessionRefresher: SessionRefresher,
) : ViewModel() {
    /** Saved profiles the server asked a PIN for (`pin_required`); their next PIN goes to the unlock endpoint. */
    private val pinLeaseProfileIds = mutableSetOf<String>()
    private val _state = MutableStateFlow<ParityLoad<ProfilesSnapshot>>(ParityLoad.Loading)
    val state = _state.asStateFlow()
    private val _switchingProfileId = MutableStateFlow<String?>(null)
    val switchingProfileId = _switchingProfileId.asStateFlow()

    /** The web client list, `<server>/clients`, for the phone profile page's Clients link. */
    fun openClients(open: (String) -> Unit) {
        viewModelScope.launch {
            val base = serverConfigStore.baseUrl.first().trimEnd('/')
            if (base.isNotBlank()) open("$base/clients")
        }
    }

    fun load() = viewModelScope.launch {
        _state.value = ParityLoad.Loading
        adoptServerIdentityIfMissing(
            hasIdentity = tokenStore.currentUserId.first() != null,
            hasAccessToken = !tokenStore.accessToken.first().isNullOrBlank(),
            listProfiles = { api.listAvailableProfiles() },
            saveIdentity = { id, name ->
                tokenStore.saveIdentity(id, name, serverConfigStore.baseUrl.first().takeIf { it.isNotBlank() })
            },
        )
        val saved = tokenStore.savedProfiles.first()
        val currentServer = tokenStore.currentServerUrl.first()?.takeIf { it.isNotBlank() }
        val currentUserId = tokenStore.currentUserId.first()
        if (serverConfigStore.baseUrl.first().isBlank()) {
            saved.firstOrNull()?.serverUrl?.let { serverConfigStore.setBaseUrl(it) }
        }
        val savedIds = saved.mapTo(mutableSetOf(), SavedProfile::userId)
        val savedAvatars = saved.mapNotNull { profile ->
            profile.avatar?.toPlayarrProfileAvatarPreference()?.let { profile.userId to it }
        }.toMap()
        val servers = saved.associate { it.userId to it.serverUrl }
        val labels = accountServerLabels(saved)
        fun snapshot(profiles: List<AvailableProfile>, warning: PlayarrMessage? = null) = ProfilesSnapshot(
            profiles = profiles,
            savedProfileIds = savedIds,
            profileAvatars = savedAvatars,
            loadWarning = warning,
            profileServers = servers,
            serverLabels = labels,
        )
        if (currentUserId == null || currentServer == null) {
            _state.value = ParityLoad.Ready(snapshot(mergeAccountProfiles(saved, currentServer, currentUserId, null)))
            return@launch
        }
        _state.value = runCatching { api.listAvailableProfiles() }.fold(
            onSuccess = { ParityLoad.Ready(snapshot(mergeAccountProfiles(saved, currentServer, currentUserId, it))) },
            onFailure = { failure ->
                ParityLoad.Ready(
                    snapshot(
                        mergeAccountProfiles(saved, currentServer, currentUserId, null),
                        failure.playarrMessage(PlayarrFailureSubject.Profiles),
                    ),
                )
            },
        )
    }

    fun switch(
        profile: AvailableProfile,
        pin: String?,
        isTelevision: Boolean,
        onSuccess: () -> Unit,
        onFailure: (Throwable) -> Unit,
    ) = viewModelScope.launch {
        _switchingProfileId.value = profile.id
        runCatching {
            val allSaved = tokenStore.savedProfiles.first()
            val currentServer = tokenStore.currentServerUrl.first()
            val owning = allSaved.filter { it.userId == profile.id }
            val serverUrl = (owning.firstOrNull { it.serverUrl == currentServer } ?: owning.firstOrNull())?.serverUrl
                ?: currentServer
                ?: serverConfigStore.baseUrl.first()
            val saved = tokenStore.isProfileSaved(serverUrl, profile.id)
            if (saved && (pin == null || profile.id in pinLeaseProfileIds)) {
                val previousUserId = tokenStore.currentUserId.first()?.takeIf { it != profile.id }
                val previousServer = tokenStore.currentServerUrl.first()
                // Leaving a profile locks it (TASKS 115): a PIN-locked profile's saved
                // session then needs its PIN again. Best effort, never blocks the switch.
                if (previousUserId != null) runCatching { api.lockProfile() }
                // Swaps the active session (tokens, server, device id) without credentials.
                check(tokenStore.activateProfile(serverUrl, profile.id))
                try {
                    if (pin != null) {
                        sessionRefresher.unlockWithPin(pin)
                    } else {
                        // Check the unlock lease now rather than on the next 401; an offline
                        // or failing server must not stop switching to a saved profile.
                        runCatching { sessionRefresher.refreshNow() }.onFailure { failure ->
                            if (failure is PinRequiredException) throw failure
                        }
                    }
                    pinLeaseProfileIds.remove(profile.id)
                } catch (failure: Throwable) {
                    if (failure is PinRequiredException) pinLeaseProfileIds.add(profile.id)
                    if (previousUserId != null && previousServer != null) {
                        tokenStore.activateProfile(previousServer, previousUserId)
                    }
                    throw failure
                }
            } else {
                val deviceId = tokenStore.deviceIdForLogin(serverUrl, profile.displayName, profile.id)
                serverConfigStore.setBaseUrl(serverUrl)
                val response = loginApi.login(
                    LoginRequest(
                        deviceId = deviceId,
                        deviceName = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
                        clientPlatform = if (isTelevision) ClientPlatform.AndroidTv else ClientPlatform.AndroidMobile,
                        clientVersion = BuildConfig.VERSION_NAME,
                        pin = pin,
                        profileUserId = profile.id,
                    ),
                )
                tokenStore.signIn(response.toTokenResponse(), response.userId, profile.displayName, serverUrl, deviceId)
            }
        }.onSuccess { onSuccess() }
            .onFailure(onFailure)
        _switchingProfileId.value = null
    }

    /** Removes only this account (its tokens and avatar); every other saved account stays. */
    fun signOut(profileId: String) = viewModelScope.launch {
        val allSaved = tokenStore.savedProfiles.first()
        val currentServer = tokenStore.currentServerUrl.first()
        val owning = allSaved.filter { it.userId == profileId }
        val serverUrl = (owning.firstOrNull { it.serverUrl == currentServer } ?: owning.firstOrNull())?.serverUrl
            ?: currentServer
        if (!serverUrl.isNullOrBlank()) {
            tokenStore.logoutProfile(serverUrl, profileId)
        }
        load()
    }
}

internal enum class ProfileAction { Select, Settings }

internal sealed interface ProfileActionResolution {
    data class Navigate(val action: ProfileAction) : ProfileActionResolution
    data class PromptForPin(val action: ProfileAction) : ProfileActionResolution
    data class Switch(val action: ProfileAction) : ProfileActionResolution
}

internal fun resolveProfileAction(
    profile: AvailableProfile,
    action: ProfileAction,
): ProfileActionResolution = when {
    profile.isCurrent -> ProfileActionResolution.Navigate(action)
    profile.pinLocked -> ProfileActionResolution.PromptForPin(action)
    else -> ProfileActionResolution.Switch(action)
}

private data class ProfilesUpdateControl(
    val available: Boolean,
    val event: AndroidUpdateEvent?,
    val check: () -> Unit,
)

@Composable
private fun rememberProfilesUpdateControl(enabled: Boolean): ProfilesUpdateControl {
    var event by remember { mutableStateOf<AndroidUpdateEvent?>(null) }
    val activity = LocalContext.current.findActivity()
    val scope = rememberCoroutineScope()
    val updater = remember(activity, scope, enabled) {
        if (enabled && activity != null) {
            createAndroidSelfUpdateController(
                activity = activity,
                scope = scope,
                onEvent = { event = it },
            )
        } else {
            null
        }
    }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { updater?.resumePendingInstall() }
    return ProfilesUpdateControl(
        available = updater != null,
        event = event,
        check = { updater?.checkForUpdates() },
    )
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> if (baseContext === this) null else baseContext.findActivity()
    else -> null
}

private const val AddProfileId = "__add_profile__"

@Composable
internal fun ExperienceProfilesScreen(
    isTelevision: Boolean,
    currentUserId: String,
    currentAvatar: ProfileAvatarPreference?,
    onHome: () -> Unit,
    onSettings: () -> Unit,
    onAddProfile: () -> Unit,
    canApproveRequests: Boolean = false,
    onApproveRequests: () -> Unit = {},
    viewModel: ProfilesViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val uriHandler = androidx.compose.ui.platform.LocalUriHandler.current
    val switchingProfileId by viewModel.switchingProfileId.collectAsState()
    val updateControl = rememberProfilesUpdateControl(isTelevision)
    var selectedId by remember { mutableStateOf<String?>(null) }
    var clientsUrl by remember { mutableStateOf<String?>(null) }
    var pinProfile by remember { mutableStateOf<AvailableProfile?>(null) }
    var pinAction by remember { mutableStateOf(ProfileAction.Select) }
    var pin by remember { mutableStateOf("") }
    var pinError by remember { mutableStateOf<PlayarrMessage?>(null) }
    var actionError by remember { mutableStateOf<PlayarrMessage?>(null) }
    LaunchedEffect(currentUserId, currentAvatar) { viewModel.load() }
    val navigateForAction: (ProfileAction) -> Unit = { action ->
        when (action) {
            ProfileAction.Select -> onHome()
            ProfileAction.Settings -> onSettings()
        }
    }
    val switchProfile: (AvailableProfile, ProfileAction, String?, (Throwable) -> Unit) -> Unit =
        { profile, action, requestedPin, onFailure ->
            viewModel.switch(
                profile = profile,
                pin = requestedPin,
                isTelevision = isTelevision,
                onSuccess = {
                    pinProfile = null
                    pin = ""
                    pinError = null
                    actionError = null
                    navigateForAction(action)
                },
                onFailure = onFailure,
            )
        }
    val requestAction: (AvailableProfile, ProfileAction) -> Unit = requestAction@{ profile, action ->
        selectedId = profile.id
        actionError = null
        when (resolveProfileAction(profile, action)) {
            is ProfileActionResolution.Navigate -> navigateForAction(action)
            is ProfileActionResolution.PromptForPin -> {
                pinProfile = profile
                pinAction = action
                pin = ""
                pinError = null
            }
            is ProfileActionResolution.Switch -> switchProfile(profile, action, null) { failure ->
                if (failure is PinRequiredException) {
                    // The saved session is fine; the server wants this profile's PIN.
                    pinProfile = profile
                    pinAction = action
                    pin = ""
                    pinError = null
                } else {
                    actionError = failure.playarrMessage(PlayarrFailureSubject.Profile)
                }
            }
        }
    }
    // Web `.profiles-page` stage wash.
    Box(
        Modifier
            .fillMaxSize()
            .background(
                Brush.linearGradient(
                    colors = listOf(WebSurface, WebBackground),
                    start = Offset.Zero,
                    end = Offset.Infinite,
                ),
            )
            .drawBehind {
                // Web `radial-gradient(circle at 50% 48%, rose 13%, transparent 34%)`: 34 % of the farthest-corner radius.
                val centre = Offset(size.width * 0.5f, size.height * 0.48f)
                val farthest = kotlin.math.hypot(maxOf(centre.x, size.width - centre.x), maxOf(centre.y, size.height - centre.y))
                drawRect(
                    Brush.radialGradient(
                        colors = listOf(ProfilesBrandRose.copy(alpha = 0.13f), Color.Transparent),
                        center = centre,
                        radius = 0.34f * farthest,
                    ),
                )
            },
    ) {
        // Web `::before` edge fades.
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.horizontalGradient(
                        0f to WebBackground.copy(alpha = 0.94f),
                        0.25f to Color.Transparent,
                    ),
                )
                .background(
                    // `linear-gradient(0deg, bg 90%, transparent 26%)`: the fade is at the bottom edge.
                    Brush.verticalGradient(
                        0.74f to Color.Transparent,
                        1f to WebBackground.copy(alpha = 0.90f),
                    ),
                ),
        )
        when (val current = state) {
            ParityLoad.Loading -> PlayarrLoadingState(playarrString(PlayarrString.ProfilesLoading))
            is ParityLoad.Failed -> PlayarrErrorState(current.message, viewModel::load)
            is ParityLoad.Ready -> {
                val profiles = current.value.profiles.map { profile ->
                    if (profile.displayName.isBlank()) {
                        profile.copy(displayName = playarrString(PlayarrString.ProfileViewerFallback))
                    } else {
                        profile
                    }
                }
                LaunchedEffect(profiles) {
                    selectedId = profiles.firstOrNull { it.isCurrent }?.id
                        ?: profiles.firstOrNull()?.id
                        ?: AddProfileId
                }
                if (isTelevision) {
                    clientsUrl?.let { url ->
                        PlayarrPanel(
                            onDismissRequest = { clientsUrl = null },
                            title = { Text(playarrString(PlayarrString.ProfilesClients)) },
                            text = {
                                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                                    PlayarrQrCode(value = url, contentDescription = playarrString(PlayarrString.YourDataTransferQrLabel), modifier = Modifier.size(220.dp))
                                    Text(playarrString(PlayarrString.ProfilesClientsScanHint), color = WebInkMuted, fontSize = 12.sp, textAlign = TextAlign.Center)
                                    Text(url, color = WebInkSoft, fontSize = 12.sp, textAlign = TextAlign.Center)
                                }
                            },
                            confirmButton = { PlayarrButton(onClick = { clientsUrl = null }) { Text(playarrString(PlayarrString.CommonClose)) } },
                        )
                    }
                    TelevisionProfilesStage(
                        profiles = profiles,
                        selectedId = selectedId,
                        currentUserId = currentUserId,
                        currentAvatar = currentAvatar,
                        avatars = current.value.profileAvatars,
                        savedProfileIds = current.value.savedProfileIds,
                        serverLabels = current.value.serverLabels,
                        switchingProfileId = switchingProfileId,
                        updateControl = updateControl,
                        actionError = actionError,
                        loadWarning = current.value.loadWarning,
                        onSelectId = { selectedId = it },
                        onSelect = { requestAction(it, ProfileAction.Select) },
                        onSettings = { requestAction(it, ProfileAction.Settings) },
                        onSignOut = { viewModel.signOut(it) },
                        onAddProfile = onAddProfile,
                        onClients = { viewModel.openClients { clientsUrl = it } },
                    )
                } else {
                    MobileProfilesStage(
                        profiles = profiles,
                        selectedId = selectedId,
                        currentUserId = currentUserId,
                        currentAvatar = currentAvatar,
                        avatars = current.value.profileAvatars,
                        savedProfileIds = current.value.savedProfileIds,
                        serverLabels = current.value.serverLabels,
                        switchingProfileId = switchingProfileId,
                        actionError = actionError,
                        loadWarning = current.value.loadWarning,
                        onSelectId = { selectedId = it },
                        onSelect = { requestAction(it, ProfileAction.Select) },
                        onSettings = { requestAction(it, ProfileAction.Settings) },
                        onSignOut = { viewModel.signOut(it) },
                        onAddProfile = onAddProfile,
                        onClients = { viewModel.openClients { uriHandler.openUri(it) } },
                    )
                }
            }
        }
        if (canApproveRequests) {
            PlayarrButton(
                onClick = onApproveRequests,
                variant = PlayarrButtonVariant.Secondary,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .windowInsetsPadding(WindowInsets.navigationBars)
                    .padding(bottom = 24.dp),
            ) { Text(playarrString(PlayarrString.GuardianApprovalsEntry)) }
        }
        // Web `TvStageChrome` — logo left, theme + language right.
        if (isTelevision) {
            ProfilesStageChrome()
        } else {
            PhoneProfilesChrome()
        }
    }
    pinProfile?.let { profile ->
        val busy = switchingProfileId == profile.id
        PlayarrPanel(
            onDismissRequest = { if (!busy) { pinProfile = null; pin = ""; pinError = null } },
            title = { Text(playarrString(PlayarrString.ProfilesSwitchProfile)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    PlayarrProfileAvatar(
                        profile.id,
                        if (profile.id == currentUserId) {
                            currentAvatar ?: (state as? ParityLoad.Ready)?.value?.profileAvatars?.get(profile.id)
                        } else {
                            (state as? ParityLoad.Ready)?.value?.profileAvatars?.get(profile.id)
                        },
                        Modifier.align(Alignment.CenterHorizontally).size(88.dp),
                    )
                    Text(profile.displayName, color = WebInk, fontWeight = FontWeight.SemiBold, modifier = Modifier.align(Alignment.CenterHorizontally))
                    OutlinedTextField(
                        value = pin,
                        onValueChange = { value ->
                            if (value.length <= 4 && value.all(Char::isDigit)) { pin = value; pinError = null }
                        },
                        label = { Text(playarrString(PlayarrString.ProfilesEnterPin)) },
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        singleLine = true,
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth().playarrSingleLineArrowNavigation(),
                    )
                    pinError?.let {
                        Text(playarrText(it), color = MaterialTheme.colorScheme.error, fontSize = 11.sp)
                    }
                    PlayarrButton(onClick = onAddProfile, enabled = !busy, modifier = Modifier.align(Alignment.CenterHorizontally), variant = PlayarrButtonVariant.Ghost) {
                        Text(playarrString(PlayarrString.ProfilesUseAccountSignIn))
                    }
                }
            },
            confirmButton = {
                PlayarrButton(
                    enabled = pin.length == 4 && !busy,
                    onClick = {
                        switchProfile(profile, pinAction, pin) { failure ->
                            pinError = profilePinFailureMessage(failure)
                                ?: failure.playarrMessage(PlayarrFailureSubject.Profile)
                        }
                    },
                ) {
                    Text(playarrString(if (busy) PlayarrString.ProfilesChecking else PlayarrString.ProfilesContinue))
                }
            },
            dismissButton = {
                PlayarrButton(
                    onClick = { pinProfile = null; pin = ""; pinError = null },
                    enabled = !busy,
                    variant = PlayarrButtonVariant.Ghost,
                ) { Text(playarrString(PlayarrString.CommonCancel)) }
            },
        )
    }
}

/**
 * Web `/profiles` television stage: absolute heading, centred horizontal
 * profile track, glass update control. Matches `.profiles-page` metrics at
 * 1920×1080 (heading top ~120, row top ~300, avatar ~200).
 */
@Composable
private fun TelevisionProfilesStage(
    profiles: List<AvailableProfile>,
    selectedId: String?,
    currentUserId: String,
    currentAvatar: ProfileAvatarPreference?,
    avatars: Map<String, ProfileAvatarPreference>,
    savedProfileIds: Set<String>,
    serverLabels: Map<String, String>,
    switchingProfileId: String?,
    updateControl: ProfilesUpdateControl,
    actionError: PlayarrMessage?,
    loadWarning: PlayarrMessage?,
    onSelectId: (String) -> Unit,
    onSelect: (AvailableProfile) -> Unit,
    onSettings: (AvailableProfile) -> Unit,
    onSignOut: (String) -> Unit,
    onAddProfile: () -> Unit,
    onClients: () -> Unit,
) {
    val language = LocalPlayarrLanguage.current
    Box(Modifier.fillMaxSize()) {
        // Web keeps the Playarr mark at the top left of the profile picker, where the shell draws it.
        PlayarrLogo(Modifier.align(Alignment.TopStart).padding(start = 59.dp, top = 60.dp))
        // `.profile-clients-link`: the glass pill bottom right (web shows it on every TV client).
        ProfilesGlassPill(onClick = onClients, modifier = Modifier.align(Alignment.BottomEnd).padding(end = 50.dp, bottom = 34.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(playarrString(PlayarrString.ProfilesClients), color = WebInkSoft, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                Text("\u2192", color = WebInkSoft, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            }
        }
        // `.profiles-heading`
        Column(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .padding(top = 162.dp)
                .fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Web `.profiles-heading`: 10.368 px kicker at y 162, 80.64 px h1 at y 184.8.
            Text(
                playarrString(PlayarrString.ProfilesTitle).uppercase(language.locale),
                color = ProfilesBrandRose,
                fontSize = 10.368.sp,
                fontWeight = FontWeight(820),
                letterSpacing = 1.348.sp,
                lineHeight = 15.6.sp,
            )
            Text(
                playarrString(PlayarrString.ProfilesHeading),
                color = WebInk,
                fontSize = 80.64.sp,
                fontWeight = FontWeight.Medium,
                letterSpacing = (-5.806).sp,
                lineHeight = 76.6.sp,
                modifier = Modifier.padding(top = 7.2.dp).offset(y = (-16).dp),
            )
        }

        // `.profiles-row` / `.profiles-track` — centred when few profiles (web
        // `justify-content: center`), horizontally scrollable when many.
        Box(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .padding(top = 382.4.dp)
                .height(420.dp),
            contentAlignment = Alignment.TopCenter,
        ) {
            // Web: the profile button holds the focus on entry (the selected profile, else the first).
            val avatarFocus = remember { androidx.compose.ui.focus.FocusRequester() }
            val focusId = profiles.firstOrNull { it.id == selectedId }?.id ?: profiles.firstOrNull()?.id
            LaunchedEffect(focusId) {
                if (focusId == null) return@LaunchedEffect
                // After the first frame, so the requester is attached; it wins over the first focusable Android picks.
                androidx.compose.runtime.withFrameNanos { }
                runCatching { avatarFocus.requestFocus() }
            }
            val track: @Composable () -> Unit = {
                profiles.forEach { profile ->
                    ProfileChoice(
                        avatarFocus = if (profile.id == focusId) avatarFocus else null,
                        profile = profile,
                        serverLabel = serverLabels[profile.id],
                        avatar = if (profile.id == currentUserId) {
                            currentAvatar ?: avatars[profile.id]
                        } else {
                            avatars[profile.id]
                        },
                        selected = selectedId == profile.id,
                        isTelevision = true,
                        switching = switchingProfileId == profile.id,
                        enabled = switchingProfileId == null,
                        onFocus = { onSelectId(profile.id) },
                        onClick = { onSelect(profile) },
                        onSettings = { onSettings(profile) },
                        onSignOut = if (profile.id in savedProfileIds || profile.isCurrent) {
                            ({ onSignOut(profile.id) })
                        } else {
                            null
                        },
                    )
                }
                AddProfileChoice(
                    selected = selectedId == AddProfileId,
                    isTelevision = true,
                    enabled = switchingProfileId == null,
                    onFocus = { onSelectId(AddProfileId) },
                    onClick = onAddProfile,
                )
            }
            // Prefer centred Row for the common household-size list; fall back
            // to LazyRow when the track would overflow a 1920 stage.
            if (profiles.size <= 5) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 140.dp),
                    horizontalArrangement = Arrangement.spacedBy(42.2.dp, Alignment.CenterHorizontally),
                    verticalAlignment = Alignment.Top,
                ) { track() }
            } else {
                LazyRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(38.dp),
                    contentPadding = PaddingValues(horizontal = 140.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    items(profiles, key = AvailableProfile::id) { profile ->
                        ProfileChoice(
                            profile = profile,
                            serverLabel = serverLabels[profile.id],
                            avatar = if (profile.id == currentUserId) {
                                currentAvatar ?: avatars[profile.id]
                            } else {
                                avatars[profile.id]
                            },
                            selected = selectedId == profile.id,
                            isTelevision = true,
                            switching = switchingProfileId == profile.id,
                            enabled = switchingProfileId == null,
                            onFocus = { onSelectId(profile.id) },
                            onClick = { onSelect(profile) },
                            onSettings = { onSettings(profile) },
                            onSignOut = if (profile.id in savedProfileIds || profile.isCurrent) {
                                ({ onSignOut(profile.id) })
                            } else {
                                null
                            },
                        )
                    }
                    item(AddProfileId) {
                        AddProfileChoice(
                            selected = selectedId == AddProfileId,
                            isTelevision = true,
                            enabled = switchingProfileId == null,
                            onFocus = { onSelectId(AddProfileId) },
                            onClick = onAddProfile,
                        )
                    }
                }
            }
        }

        // `.profile-update-control` bottom-left
        val event = updateControl.event
        val busy = event is AndroidUpdateEvent.Checking ||
            event is AndroidUpdateEvent.Downloading ||
            event is AndroidUpdateEvent.Installing
        val label = when (event) {
            AndroidUpdateEvent.Checking -> playarrString(PlayarrString.ProfilesUpdateChecking)
            is AndroidUpdateEvent.UpToDate -> playarrString(PlayarrString.ProfilesUpdateCurrent)
            is AndroidUpdateEvent.Downloading -> event.progress?.let { progress ->
                playarrString(PlayarrString.ProfilesUpdateDownloadingProgress, "progress" to progress)
            } ?: playarrString(PlayarrString.ProfilesUpdateDownloading)
            is AndroidUpdateEvent.PermissionRequired -> playarrString(PlayarrString.ProfilesUpdateAllowInstall)
            is AndroidUpdateEvent.Installing -> playarrString(PlayarrString.ProfilesUpdateInstalling)
            is AndroidUpdateEvent.Error -> playarrString(PlayarrString.ProfilesUpdateRetry)
            null -> playarrString(PlayarrString.ProfilesCheckForUpdates)
        }
        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(start = 40.dp, bottom = 36.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (updateControl.available) {
                ProfilesGlassPill(
                    onClick = updateControl.check,
                    enabled = !busy,
                ) {
                    Text(
                        label,
                        color = WebInkSoft,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
                if (event is AndroidUpdateEvent.Error) {
                    Text(event.message, color = MaterialTheme.colorScheme.error, fontSize = 10.sp)
                }
            }
            actionError?.let {
                Text(playarrText(it), color = MaterialTheme.colorScheme.error, fontSize = 11.sp)
            }
            loadWarning?.let {
                Text(
                    playarrString(
                        PlayarrString.ProfilesErrorShowingSaved,
                        "message" to playarrText(it),
                    ),
                    color = WebInkMuted,
                    fontSize = 11.sp,
                )
            }
        }
    }
}

@Composable
private fun MobileProfilesStage(
    profiles: List<AvailableProfile>,
    selectedId: String?,
    currentUserId: String,
    currentAvatar: ProfileAvatarPreference?,
    avatars: Map<String, ProfileAvatarPreference>,
    savedProfileIds: Set<String>,
    serverLabels: Map<String, String>,
    switchingProfileId: String?,
    actionError: PlayarrMessage?,
    loadWarning: PlayarrMessage?,
    onSelectId: (String) -> Unit,
    onSelect: (AvailableProfile) -> Unit,
    onSettings: (AvailableProfile) -> Unit,
    onSignOut: (String) -> Unit,
    onAddProfile: () -> Unit,
    onClients: () -> Unit,
) {
    val topInset = webPhoneInsets().asPaddingValues().calculateTopPadding()
    Box(Modifier.fillMaxSize()) {
        PhoneProfilesHeading(playarrString(PlayarrString.ProfilesTitle), playarrString(PlayarrString.ProfilesHeading))
        // `.profiles-row`: from inset + 150 px down, scrolls sideways and clips what grows past its top edge.
        Box(Modifier.fillMaxSize().padding(top = topInset + 150.dp).clipToBounds()) {
            Row(
                Modifier.horizontalScroll(rememberScrollState()).padding(start = 28.dp, end = 28.dp, top = 18.dp),
                horizontalArrangement = Arrangement.spacedBy(22.dp),
                verticalAlignment = Alignment.Top,
            ) {
                profiles.forEach { profile ->
                    PhoneProfileChoice(
                        profile = profile,
                        serverLabel = serverLabels[profile.id],
                        avatar = if (profile.id == currentUserId) currentAvatar ?: avatars[profile.id] else avatars[profile.id],
                        selected = selectedId == profile.id,
                        switching = switchingProfileId == profile.id,
                        enabled = switchingProfileId == null,
                        onFocus = { onSelectId(profile.id) },
                        onClick = { onSelect(profile) },
                        onSettings = { onSettings(profile) },
                        onSignOut = if (profile.id in savedProfileIds || profile.isCurrent) ({ onSignOut(profile.id) }) else null,
                    )
                }
                PhoneAddProfileChoice(
                    selected = selectedId == AddProfileId,
                    enabled = switchingProfileId == null,
                    onFocus = { onSelectId(AddProfileId) },
                    onClick = onAddProfile,
                )
            }
        }
        Column(Modifier.align(Alignment.BottomStart).padding(start = 18.dp, bottom = 96.dp)) {
            actionError?.let { error -> Text(playarrText(error), color = MaterialTheme.colorScheme.error) }
            loadWarning?.let { warning ->
                Text(
                    playarrString(PlayarrString.ProfilesErrorShowingSaved, "message" to playarrText(warning)),
                    color = WebInkMuted,
                    fontSize = 11.sp,
                )
            }
        }
        PhoneProfilesClientsLink(onClients)
    }
}

/** Web `TvStageChrome` on profiles (logo + theme + language, no back). */
@Composable
private fun BoxScope.ProfilesStageChrome() {
    val display = LocalPlayarrDisplayPreferences.current
    Icon(
        painter = painterResource(R.drawable.playarr_mark),
        contentDescription = "Playarr",
        tint = Color.Unspecified,
        modifier = Modifier
            .align(Alignment.TopStart)
            .padding(start = 60.6.dp, top = 60.2.dp)
            .size(42.dp)
            .zIndex(3f),
    )
    Row(
        modifier = Modifier
            .align(Alignment.TopEnd)
            .padding(end = 42.dp, top = 50.dp)
            .zIndex(3f),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ProfilesChromeThemeDropdown(display)
        ProfilesChromeLanguageDropdown(display)
    }
}

@Composable
internal fun ProfilesChromeThemeDropdown(display: PlayarrDisplayPreferences, webPhone: Boolean = false) {
    var expanded by remember { mutableStateOf(false) }
    val label = when (display.theme) {
        PlayarrThemePreference.System -> playarrString(PlayarrString.SettingsThemeSystem)
        PlayarrThemePreference.Light -> playarrString(PlayarrString.SettingsThemeLight)
        PlayarrThemePreference.Dark -> playarrString(PlayarrString.SettingsThemeDark)
    }
    Box {
        ProfilesChromeTrigger(
            label = label,
            expanded = expanded,
            minWidth = 144.dp,
            leading = { ProfilesThemeIcon(WebInkMuted) },
            onClick = { expanded = !expanded },
            webPhone = webPhone,
        )
        androidx.compose.material3.DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            PlayarrThemePreference.entries.forEach { option ->
                val optionLabel = when (option) {
                    PlayarrThemePreference.System -> playarrString(PlayarrString.SettingsThemeSystem)
                    PlayarrThemePreference.Light -> playarrString(PlayarrString.SettingsThemeLight)
                    PlayarrThemePreference.Dark -> playarrString(PlayarrString.SettingsThemeDark)
                }
                androidx.compose.material3.DropdownMenuItem(
                    text = {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(optionLabel)
                            if (option == display.theme) Text("✓", color = ProfilesBrandRose)
                        }
                    },
                    onClick = {
                        display.setTheme(option)
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
internal fun ProfilesChromeLanguageDropdown(display: PlayarrDisplayPreferences, webPhone: Boolean = false) {
    var expanded by remember { mutableStateOf(false) }
    val selected = playarrUiLanguageOptions.firstOrNull { it.preference == display.language }
        ?: playarrUiLanguageOptions.first()
    Box {
        ProfilesChromeTrigger(
            label = selected.label(),
            expanded = expanded,
            minWidth = 168.dp,
            leading = { ProfilesGlobeIcon(WebInkMuted) },
            onClick = { expanded = !expanded },
            webPhone = webPhone,
        )
        androidx.compose.material3.DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            playarrUiLanguageOptions.forEach { option ->
                androidx.compose.material3.DropdownMenuItem(
                    text = {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(option.label())
                            if (option.preference == display.language) Text("✓", color = ProfilesBrandRose)
                        }
                    },
                    onClick = {
                        display.setLanguage(option.preference)
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun ProfilesChromeTrigger(
    label: String,
    expanded: Boolean,
    minWidth: Dp,
    leading: @Composable () -> Unit,
    onClick: () -> Unit,
    webPhone: Boolean = false,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(0.dp),
        color = if (expanded) WebSurfaceStrong else WebBackground,
        border = BorderStroke(1.dp, if (expanded) WebInkSoft else WebInkMuted.copy(alpha = 0.45f)),
        modifier = Modifier
            // A fixed width on TV: the label row fills the trigger, so a min width alone let the first select take the whole row.
            .then(if (webPhone) Modifier else Modifier.width(minWidth))
            .height(48.dp)
            .scale(if (expanded) 1.02f else 1f),
    ) {
        Row(
            (if (webPhone) Modifier else Modifier.fillMaxWidth()).padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            leading()
            Text(
                label,
                color = WebInk,
                fontSize = if (webPhone) 11.52.sp else 11.5.sp,
                lineHeight = if (webPhone) 17.28.sp else androidx.compose.ui.unit.TextUnit.Unspecified,
                fontWeight = if (webPhone) FontWeight(720) else FontWeight.Bold,
                style = if (webPhone) WebTextStyle else androidx.compose.ui.text.TextStyle.Default,
                maxLines = 1,
                modifier = Modifier.weight(1f, fill = !webPhone),
            )
            Canvas(Modifier.size(12.dp).rotate(if (expanded) 180f else 0f)) {
                val stroke = Stroke(width = 1.8.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
                val s = size.width / 24f
                val path = Path().apply {
                    moveTo(6f * s, 9f * s)
                    lineTo(12f * s, 15f * s)
                    lineTo(18f * s, 9f * s)
                }
                drawPath(path, color = WebInkMuted, style = stroke)
            }
        }
    }
}

@Composable
private fun ProfilesThemeIcon(color: Color) {
    Canvas(Modifier.size(16.dp)) {
        val stroke = Stroke(width = 1.8.dp.toPx(), cap = StrokeCap.Round)
        val s = size.width / 24f
        drawCircle(color = color, radius = 4f * s, center = Offset(12f * s, 12f * s), style = stroke)
        listOf(
            Offset(12f, 3f) to Offset(12f, 5f),
            Offset(12f, 19f) to Offset(12f, 21f),
            Offset(3f, 12f) to Offset(5f, 12f),
            Offset(19f, 12f) to Offset(21f, 12f),
            Offset(5.64f, 5.64f) to Offset(7.06f, 7.06f),
            Offset(16.94f, 16.94f) to Offset(18.36f, 18.36f),
            Offset(18.36f, 5.64f) to Offset(16.94f, 7.06f),
            Offset(7.06f, 16.94f) to Offset(5.64f, 18.36f),
        ).forEach { (a, b) ->
            drawLine(color, Offset(a.x * s, a.y * s), Offset(b.x * s, b.y * s), stroke.width, StrokeCap.Round)
        }
    }
}

@Composable
private fun ProfilesGlobeIcon(color: Color) {
    Canvas(Modifier.size(16.dp)) {
        val stroke = Stroke(width = 1.8.dp.toPx(), cap = StrokeCap.Round)
        val s = size.width / 24f
        drawCircle(color, radius = 8.5f * s, center = Offset(12f * s, 12f * s), style = stroke)
        drawLine(color, Offset(3.5f * s, 12f * s), Offset(20.5f * s, 12f * s), stroke.width, StrokeCap.Round)
        val left = Path().apply {
            moveTo(12f * s, 3.5f * s)
            cubicTo(9.8f * s, 5.8f * s, 8.7f * s, 8.6f * s, 8.7f * s, 12f * s)
            cubicTo(8.7f * s, 15.4f * s, 9.8f * s, 18.2f * s, 12f * s, 20.5f * s)
        }
        val right = Path().apply {
            moveTo(12f * s, 3.5f * s)
            cubicTo(14.2f * s, 5.8f * s, 15.3f * s, 8.6f * s, 15.3f * s, 12f * s)
            cubicTo(15.3f * s, 15.4f * s, 14.2f * s, 18.2f * s, 12f * s, 20.5f * s)
        }
        drawPath(left, color, style = stroke)
        drawPath(right, color, style = stroke)
    }
}

/** Web `.profile-update-button` / action glass pill. */
@Composable
private fun ProfilesGlassPill(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable () -> Unit,
) {
    // Web `.profile-update-button` / `.profile-clients-link`: `box-shadow: 0 14px 38px rgba(31, 14, 20, .09)`.
    WebShadowedBox(
        shadows = listOf(WebShadow(14.dp, 38.dp, Color(0xFF1F0E14).copy(alpha = 0.09f))),
        shape = CircleShape,
        modifier = modifier.heightIn(min = 44.dp),
        innerFill = false,
    ) {
        Surface(
            onClick = onClick,
            enabled = enabled,
            shape = CircleShape,
            color = WebSurfaceStrong.copy(alpha = 0.72f),
            border = BorderStroke(1.dp, WebInkMuted.copy(alpha = 0.35f)),
            modifier = Modifier.heightIn(min = 44.dp),
        ) {
            Box(
                Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                contentAlignment = Alignment.Center,
            ) { content() }
        }
    }
}

@Composable
private fun ProfileChoice(
    profile: AvailableProfile,
    serverLabel: String?,
    avatar: ProfileAvatarPreference?,
    selected: Boolean,
    isTelevision: Boolean,
    switching: Boolean,
    enabled: Boolean,
    onFocus: () -> Unit,
    onClick: () -> Unit,
    onSettings: () -> Unit,
    onSignOut: (() -> Unit)?,
    avatarFocus: androidx.compose.ui.focus.FocusRequester? = null,
) {
    // Web `.profile-choice` flex-basis clamp(160px, 13vw, 244px): 13vw is 249.6 at 1920, so 244.
    val cardWidth = if (isTelevision) 244.dp else 148.dp
    val avatarSize = if (isTelevision) 244.dp else 132.dp
    val avatarDescription = playarrString(
        if (profile.isCurrent) PlayarrString.ProfilesAvatarLabelCurrent else PlayarrString.ProfilesAvatarLabel,
        "name" to profile.displayName,
    )
    // Draw-only lift: an offset would change the bounds focus search measures.
    val lift = if (selected) Modifier.graphicsLayer { translationY = -8.dp.toPx(); scaleX = 1.045f; scaleY = 1.045f } else Modifier
    // Web `.circle-focus-host`: the focused profile shows the card glow (brand ring and glow) on the circle itself.
    val avatarSource = remember { MutableInteractionSource() }
    val avatarFocused by avatarSource.collectIsFocusedAsState()
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .width(cardWidth)
            .then(lift)
            .onFocusChanged { if (it.isFocused) onFocus() },
    ) {
        Surface(
            onClick = onClick,
            interactionSource = avatarSource,
            enabled = enabled,
            shape = CircleShape,
            color = Color.Transparent,
            modifier = Modifier
                .then(if (avatarFocus != null) Modifier.focusRequester(avatarFocus) else Modifier)
                .size(avatarSize)
                .semantics { contentDescription = avatarDescription }
                // Order matters: the scale and the ring come before the shadow, which clips everything after it.
                .scale(if (selected) 1.035f else 1f)
                .then(
                    if (selected) {
                        // Web `box-shadow: 0 0 0 4px rose 42%`: the ring sits outside the avatar, over the page.
                        Modifier.drawBehind {
                            drawCircle(
                                ProfilesBrandRose.copy(alpha = 0.42f), radius = size.minDimension / 2f + 2.dp.toPx(),
                                style = androidx.compose.ui.graphics.drawscope.Stroke(width = 4.dp.toPx()),
                            )
                        }
                    } else {
                        Modifier
                    },
                )
                // Over the selected rose ring: the focus glow wins while the avatar holds focus.
                .circleCardGlow(isTelevision && avatarFocused)
                .then(
                    if (selected) {
                        Modifier.shadow(
                            elevation = 22.dp,
                            shape = CircleShape,
                            ambientColor = Color(0x2E1F0E14),
                            spotColor = Color(0x2E1F0E14),
                        )
                    } else {
                        Modifier.border(1.dp, WebInkMuted.copy(alpha = 0.35f), CircleShape)
                    },
                ),
        ) {
            Box(contentAlignment = Alignment.Center) {
                PlayarrProfileAvatar(
                    userId = profile.id,
                    preference = avatar,
                    modifier = Modifier.fillMaxSize(),
                )
                if (profile.pinLocked) {
                    Icon(
                        Icons.Outlined.Lock,
                        contentDescription = playarrString(PlayarrString.ProfilesStatusPinRequired),
                        tint = Color.White,
                        modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp).size(22.dp),
                    )
                }
            }
        }
        Text(
            profile.displayName,
            color = if (selected) WebInk else WebInkSoft,
            fontSize = if (isTelevision) 17.28.sp else 14.sp,
            fontWeight = if (isTelevision) FontWeight(680) else FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .padding(top = if (isTelevision) 8.8.dp else 12.dp)
                .fillMaxWidth(),
        )
        if (!serverLabel.isNullOrBlank()) {
            Text(
                serverLabel,
                color = WebInkMuted,
                fontSize = if (isTelevision) 12.sp else 10.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 2.dp).fillMaxWidth(),
            )
        }
        Text(
            playarrString(
                when {
                    switching -> PlayarrString.ProfilesStatusSwitching
                    profile.isCurrent -> PlayarrString.ProfilesStatusCurrent
                    profile.pinLocked -> PlayarrString.ProfilesStatusPinRequired
                    else -> PlayarrString.ProfilesStatusReady
                },
            ).uppercase(LocalPlayarrLanguage.current.locale),
            color = WebInkMuted,
            fontSize = if (isTelevision) 9.408.sp else 8.sp,
            fontWeight = if (isTelevision) FontWeight(690) else FontWeight.Bold,
            letterSpacing = if (isTelevision) 0.423.sp else 0.6.sp,
            modifier = Modifier.padding(top = if (isTelevision) 8.8.dp else 4.dp),
        )
        if (selected) {
            // Web `.profile-actions`
            Row(
                modifier = Modifier.padding(top = if (isTelevision) 11.2.dp else 18.dp),
                horizontalArrangement = Arrangement.spacedBy(if (isTelevision) 8.8.dp else 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // `.profile-settings-button` 44×44
                Surface(
                    onClick = onSettings,
                    enabled = enabled,
                    shape = CircleShape,
                    color = WebSurfaceStrong.copy(alpha = 0.64f),
                    border = BorderStroke(1.dp, WebInkMuted.copy(alpha = 0.35f)),
                    modifier = Modifier.size(44.dp),
                ) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        ProfilesSettingsIcon(ProfilesBrandRose)
                    }
                }
                onSignOut?.let { action ->
                    // `.profile-sign-out-button`
                    Surface(
                        onClick = action,
                        enabled = enabled,
                        shape = CircleShape,
                        color = WebSurfaceStrong.copy(alpha = 0.64f),
                        border = BorderStroke(1.dp, WebInkMuted.copy(alpha = 0.35f)),
                        modifier = Modifier.heightIn(min = 44.dp),
                    ) {
                        Row(
                            Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            ProfilesSignOutIcon(WebInkSoft)
                            Text(
                                playarrString(PlayarrString.ProfilesSignOut),
                                color = WebInkSoft,
                                fontSize = if (isTelevision) 10.752.sp else 11.sp,
                                fontWeight = if (isTelevision) FontWeight(720) else FontWeight.Bold,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AddProfileChoice(
    selected: Boolean,
    isTelevision: Boolean,
    enabled: Boolean,
    onFocus: () -> Unit,
    onClick: () -> Unit,
) {
    val cardWidth = if (isTelevision) 244.dp else 148.dp
    val avatarSize = if (isTelevision) 244.dp else 132.dp
    // Draw-only lift: an offset would change the bounds focus search measures.
    val lift = if (selected) Modifier.graphicsLayer { translationY = -8.dp.toPx(); scaleX = 1.045f; scaleY = 1.045f } else Modifier
    var addFocused by remember { mutableStateOf(false) }
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .width(cardWidth)
            .then(lift)
            .onFocusChanged { addFocused = it.hasFocus; if (it.hasFocus) onFocus() },
    ) {
        // Web `.profile-add .profile-avatar` dashed plate.
        Box(
            modifier = Modifier
                .size(avatarSize)
                .circleCardGlow(isTelevision && addFocused)
                .clip(CircleShape)
                .drawBehind {
                    // Web `.profile-avatar` plate: 145deg from surface-strong mixed 16% to #cf3157 towards #a82655,
                    // plus a soft highlight at 34% 26%.
                    val side = size.width
                    val rad = Math.toRadians(145.0)
                    val dx = Math.sin(rad).toFloat()
                    val dy = (-Math.cos(rad)).toFloat()
                    val half = side * (kotlin.math.abs(dx) + kotlin.math.abs(dy)) / 2f
                    val mid = Offset(side / 2f, side / 2f)
                    drawRect(
                        Brush.linearGradient(
                            listOf(lerp(WebSurfaceStrong, Color(0xFFCF3157), 0.16f), Color(0xFFA82655)),
                            start = Offset(mid.x - dx * half, mid.y - dy * half),
                            end = Offset(mid.x + dx * half, mid.y + dy * half),
                        ),
                    )
                    drawRect(
                        Brush.radialGradient(
                            listOf(Color.White.copy(alpha = 0.28f), Color.Transparent),
                            center = Offset(side * 0.34f, side * 0.26f),
                            radius = side * 0.2677f,
                        ),
                    )
                    drawCircle(
                        color = WebInkMuted.copy(alpha = 0.45f),
                        style = Stroke(
                            width = 1.5.dp.toPx(),
                            pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 8f)),
                        ),
                    )
                    if (selected) {
                        drawCircle(
                            color = ProfilesBrandRose.copy(alpha = 0.42f),
                            style = Stroke(width = 4.dp.toPx()),
                        )
                    }
                }
                .clickable(enabled = enabled, onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "+",
                color = WebInkSoft,
                fontSize = if (isTelevision) 76.8.sp else 52.sp,
                fontWeight = FontWeight.Light,
            )
        }
        Text(
            playarrString(PlayarrString.ProfilesSignIn),
            color = if (selected) WebInk else WebInkSoft,
            fontSize = if (isTelevision) 17.28.sp else 14.sp,
            fontWeight = if (isTelevision) FontWeight(680) else FontWeight.SemiBold,
            modifier = Modifier.padding(top = if (isTelevision) 8.8.dp else 12.dp),
        )
        Text(
            playarrString(PlayarrString.ProfilesAddAnother).uppercase(LocalPlayarrLanguage.current.locale),
            color = WebInkMuted,
            fontSize = if (isTelevision) 9.408.sp else 8.sp,
            fontWeight = if (isTelevision) FontWeight(690) else FontWeight.Bold,
            letterSpacing = if (isTelevision) 0.423.sp else 0.6.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = if (isTelevision) 8.8.dp else 4.dp),
        )
    }
}

/** Web `SettingsIcon` stroke gear. */
@Composable
internal fun ProfilesSettingsIcon(color: Color) {
    Canvas(Modifier.size(18.dp)) {
        val stroke = Stroke(width = 1.7.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
        val s = size.width / 24f
        drawCircle(color, radius = 3f * s, center = Offset(12f * s, 12f * s), style = stroke)
        val path = Path().apply {
            // Simplified gear ring from web SettingsIcon path.
            moveTo(19.4f * s, 13.5f * s)
            lineTo(21.4f * s, 12f * s)
            lineTo(19.4f * s, 8.6f * s)
            lineTo(17.1f * s, 9.5f * s)
            lineTo(14.5f * s, 8f * s)
            lineTo(14f * s, 5.5f * s)
            lineTo(10f * s, 5.5f * s)
            lineTo(9.5f * s, 8f * s)
            lineTo(6.9f * s, 9.5f * s)
            lineTo(4.6f * s, 8.6f * s)
            lineTo(2.6f * s, 12f * s)
            lineTo(4.6f * s, 13.5f * s)
            lineTo(4.6f * s, 16.5f * s)
            lineTo(2.6f * s, 18f * s)
            lineTo(4.6f * s, 21.4f * s)
            lineTo(6.9f * s, 20.5f * s)
            lineTo(9.5f * s, 22f * s)
            lineTo(10f * s, 24.5f * s)
            lineTo(14f * s, 24.5f * s)
            lineTo(14.5f * s, 22f * s)
            lineTo(17.1f * s, 20.5f * s)
            lineTo(19.4f * s, 21.4f * s)
            lineTo(21.4f * s, 18f * s)
            lineTo(19.4f * s, 16.5f * s)
            close()
        }
        // Use a simpler hex-ish gear via concentric stroke circle + ticks.
        drawCircle(color, radius = 7.5f * s, center = Offset(12f * s, 12f * s), style = stroke)
        for (i in 0 until 8) {
            val angle = Math.toRadians(i * 45.0)
            val inner = 8.2f * s
            val outer = 10.5f * s
            val cx = 12f * s
            val cy = 12f * s
            drawLine(
                color,
                Offset(cx + (inner * kotlin.math.cos(angle)).toFloat(), cy + (inner * kotlin.math.sin(angle)).toFloat()),
                Offset(cx + (outer * kotlin.math.cos(angle)).toFloat(), cy + (outer * kotlin.math.sin(angle)).toFloat()),
                stroke.width,
                StrokeCap.Round,
            )
        }
    }
}

/** Web `SignOutIcon` door + arrow. */
@Composable
internal fun ProfilesSignOutIcon(color: Color) {
    Canvas(Modifier.size(18.dp)) {
        val stroke = Stroke(width = 1.7.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
        val s = size.width / 24f
        // Door frame: M10 5H5v14h5
        drawLine(color, Offset(10f * s, 5f * s), Offset(5f * s, 5f * s), stroke.width, StrokeCap.Round)
        drawLine(color, Offset(5f * s, 5f * s), Offset(5f * s, 19f * s), stroke.width, StrokeCap.Round)
        drawLine(color, Offset(5f * s, 19f * s), Offset(10f * s, 19f * s), stroke.width, StrokeCap.Round)
        // Arrow: M13 8l4 4-4 4  and M8 12h9
        drawLine(color, Offset(8f * s, 12f * s), Offset(17f * s, 12f * s), stroke.width, StrokeCap.Round)
        drawLine(color, Offset(13f * s, 8f * s), Offset(17f * s, 12f * s), stroke.width, StrokeCap.Round)
        drawLine(color, Offset(17f * s, 12f * s), Offset(13f * s, 16f * s), stroke.width, StrokeCap.Round)
    }
}

internal data class SettingsSnapshot(
    val userId: String,
    val userName: String,
    val player: PlayerPreferences,
    val pin: ProfilePinSetting,
    val avatar: ProfileAvatarSetting,
    val inviteRequest: UserInviteRequest?,
)

internal data class SettingsServerEntry(
    val serverUrl: String,
    val label: String,
    val username: String,
    val primary: Boolean,
)

internal sealed interface SettingsConnectionTest {
    data object Idle : SettingsConnectionTest
    data object Testing : SettingsConnectionTest
    data class Success(val version: VersionEnvelope) : SettingsConnectionTest
    data class Failed(val message: PlayarrMessage) : SettingsConnectionTest
}

internal sealed interface SettingsServerOperation {
    data object Connecting : SettingsServerOperation
    data class Disconnecting(val serverUrl: String) : SettingsServerOperation
    data object Forgetting : SettingsServerOperation
}

private enum class SettingsServerInputFailure {
    InvalidUrl,
    AlreadyPrimary,
    SignInRequired,
}

private class SettingsServerInputException(
    val failure: SettingsServerInputFailure,
) : IllegalArgumentException()

internal data class SettingsNotice(
    val message: PlayarrMessage,
    val success: Boolean,
)

private data class SettingsServerObservation(
    val profileUserId: String?,
    val hasKnownServerGroup: Boolean,
)

@HiltViewModel
internal class ParitySettingsViewModel @Inject constructor(
    private val api: PlayarrApi,
    @param:PrimaryPlayarrApi private val primaryApi: PlayarrApi,
    private val tokenStore: TokenStore,
    private val serverConfigStore: ServerConfigStore,
    private val connectedServerSessionManager: ConnectedServerSessionManager,
    private val connectedServerSessionStore: ConnectedServerSessionStore,
    private val knownServerGroupStore: KnownServerGroupStore,
    private val serverClientProvider: PlayarrServerClientProvider,
) : ViewModel() {
    private val _state = MutableStateFlow<ParityLoad<SettingsSnapshot>>(ParityLoad.Loading)
    val state = _state.asStateFlow()
    private val _isAdmin = MutableStateFlow(false)
    /** Web `useIsAdmin` (self capabilities): admin-only sections are hidden from everyone else. */
    val isAdmin = _isAdmin.asStateFlow()
    private val _message = MutableStateFlow<SettingsNotice?>(null)
    private val _homeRails = MutableStateFlow<List<RailPreferenceEntry>?>(null)
    /** The signed-in user's Home rails in order, with hidden flags (null until loaded). */
    val homeRails = _homeRails.asStateFlow()

    fun loadHomeRails(language: String) {
        viewModelScope.launch { _homeRails.value = runCatching { api.railPreferences(language).rails }.getOrNull() }
    }

    /** Saves the full order and hidden set; Home picks it up the next time it loads. */
    fun saveHomeRails(rails: List<RailPreferenceEntry>) {
        viewModelScope.launch {
            val saved = runCatching {
                api.saveRailPreferences(
                    RailPreferencesRequest(
                        order = rails.map(RailPreferenceEntry::id),
                        hidden = rails.filter(RailPreferenceEntry::hidden).map(RailPreferenceEntry::id),
                    ),
                )
            }.getOrNull()
            if (saved != null) _homeRails.value = saved.rails
        }
    }

    fun resetHomeRails(language: String) {
        viewModelScope.launch {
            if (runCatching { api.resetRailPreferences() }.isSuccess) {
                _homeRails.value = runCatching { api.railPreferences(language).rails }.getOrNull()
            }
        }
    }
    val message = _message.asStateFlow()
    private val _invite = MutableStateFlow<PlayarrGeneratedInvite?>(null)
    val invite = _invite.asStateFlow()
    private val _inviteBusy = MutableStateFlow(false)
    val inviteBusy = _inviteBusy.asStateFlow()
    private val _pinBusy = MutableStateFlow(false)
    val pinBusy = _pinBusy.asStateFlow()
    private val _servers = MutableStateFlow<List<SettingsServerEntry>>(emptyList())
    val servers = _servers.asStateFlow()
    private val _hasKnownServerGroup = MutableStateFlow(false)
    val hasKnownServerGroup = _hasKnownServerGroup.asStateFlow()
    private val _serverOperation = MutableStateFlow<SettingsServerOperation?>(null)
    val serverOperation = _serverOperation.asStateFlow()
    private val _connectionTest = MutableStateFlow<SettingsConnectionTest>(SettingsConnectionTest.Idle)
    val connectionTest = _connectionTest.asStateFlow()

    init {
        load()
        observeConnectedServers()
        viewModelScope.launch { _isAdmin.value = runCatching { api.getSelfCapabilities().isAdmin }.getOrDefault(false) }
    }

    fun load() = viewModelScope.launch {
        _state.value = runCatching {
            coroutineScope {
                SettingsSnapshot(
                    tokenStore.currentUserId.first().orEmpty(),
                    tokenStore.currentUserName.first().orEmpty(),
                    async { api.getPlayerPreferences() }.await(),
                    async { api.getProfilePinSetting() }.await(),
                    async { api.getProfileAvatar() }.await(),
                    async { api.getMyUserInviteRequest().value }.await(),
                )
            }
        }.fold({ ParityLoad.Ready(it) }, { ParityLoad.Failed(it.playarrMessage(PlayarrFailureSubject.Settings)) })
    }

    fun savePlayerLanguage(language: String) = update(PlayarrString.SettingsPlayerSaved) {
        api.updatePlayerPreferences(UpdatePlayerPreferencesRequest(language))
    }
    fun savePin(pin: String?, onSuccess: () -> Unit = {}) = viewModelScope.launch {
        if (_pinBusy.value) return@launch
        val success = when {
            pin == null -> PlayarrString.SettingsProfilePinRemoved
            ((_state.value as? ParityLoad.Ready)?.value?.pin?.pinLocked == true) -> {
                PlayarrString.SettingsProfilePinReplaced
            }
            else -> PlayarrString.SettingsProfilePinSet
        }
        _pinBusy.value = true
        runCatching { api.updateProfilePinSetting(UpdateProfilePinRequest(pin)) }
            .onSuccess { setting ->
                updatePinSetting(setting)
                _message.value = SettingsNotice(PlayarrMessage.Localized(success), success = true)
                onSuccess()
            }
            .onFailure {
                _message.value = SettingsNotice(it.playarrMessage(PlayarrFailureSubject.ProfileLock), success = false)
            }
        _pinBusy.value = false
    }
    fun saveAvatar(preference: ProfileAvatarPreference) = update(PlayarrString.SettingsAvatarSaved) {
        val saved = api.updateProfileAvatar(UpdateProfileAvatarRequest(preference))
        val cached = saved.preference ?: preference
        val serverUrl = tokenStore.currentServerUrl.first()
        val userId = tokenStore.currentUserId.first()
        if (serverUrl != null && userId != null) {
            tokenStore.saveProfileAvatar(serverUrl, userId, cached.toSavedProfileAvatar())
        }
        saved
    }
    fun requestInvite(message: String) = viewModelScope.launch {
        if (_inviteBusy.value) return@launch
        _inviteBusy.value = true
        runCatching { api.createUserInviteRequest(CreateUserInviteRequest(message.ifBlank { null })) }
            .onSuccess {
                updateInviteRequest(it)
                _message.value = SettingsNotice(
                    PlayarrMessage.Localized(PlayarrString.SettingsInviteRequestSent),
                    success = true,
                )
            }
            .onFailure {
                _message.value = SettingsNotice(it.playarrMessage(PlayarrFailureSubject.Invitation), success = false)
            }
        _inviteBusy.value = false
    }
    fun generateInvite(serverUrl: String) = viewModelScope.launch {
        if (_inviteBusy.value) return@launch
        _inviteBusy.value = true
        runCatching {
            coroutineScope {
                val invite = async { api.generateApprovedUserInvite() }
                val addresses = async { resolveInviteAddresses(serverUrl) }
                val generated = invite.await()
                PlayarrGeneratedInvite(
                    link = buildPlayarrInviteUrl(addresses.await(), generated.inviteToken),
                    expiresAt = generated.expiresAt,
                )
            }
        }.onSuccess {
            _invite.value = it
            runCatching { refreshInviteRequestNow() }
            _message.value = SettingsNotice(
                PlayarrMessage.Localized(PlayarrString.SettingsInviteGenerated),
                success = true,
            )
        }.onFailure {
            _message.value = SettingsNotice(it.playarrMessage(PlayarrFailureSubject.Invitation), success = false)
        }
        _inviteBusy.value = false
    }
    fun dismissInvite() { _invite.value = null }
    fun refreshInviteRequest() = viewModelScope.launch { runCatching { refreshInviteRequestNow() } }
    fun connectServer(
        serverUrl: String,
        username: String,
        password: String,
        isTelevision: Boolean,
        onSuccess: () -> Unit,
    ) = viewModelScope.launch {
        if (_serverOperation.value != null) return@launch
        _serverOperation.value = SettingsServerOperation.Connecting
        runCatching {
            val profileUserId = tokenStore.currentUserId.first()
                ?: throw SettingsServerInputException(SettingsServerInputFailure.SignInRequired)
            val targetUrl = runCatching { normaliseServerUrl(serverUrl) }
                .getOrElse { throw SettingsServerInputException(SettingsServerInputFailure.InvalidUrl) }
            val primaryUrl = normaliseServerUrl(serverConfigStore.baseUrl.first())
            if (targetUrl == primaryUrl) {
                throw SettingsServerInputException(SettingsServerInputFailure.AlreadyPrimary)
            }
            connectedServerSessionManager.connect(
                profileUserId = profileUserId,
                serverUrl = targetUrl,
                username = username.trim(),
                password = password,
                clientPlatform = if (isTelevision) ClientPlatform.AndroidTv else ClientPlatform.AndroidMobile,
                clientVersion = BuildConfig.VERSION_NAME,
                deviceName = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
            )
        }.onSuccess {
            _message.value = SettingsNotice(
                PlayarrMessage.Localized(PlayarrString.SettingsServerConnected),
                success = true,
            )
            onSuccess()
        }.onFailure {
            _message.value = (it as? SettingsServerInputException)?.failure?.let { failure ->
                SettingsNotice(
                    message = PlayarrMessage.Localized(when (failure) {
                        SettingsServerInputFailure.InvalidUrl -> PlayarrString.SettingsServerInvalidUrl
                        SettingsServerInputFailure.AlreadyPrimary -> PlayarrString.SettingsServerAlreadyPrimary
                        SettingsServerInputFailure.SignInRequired -> PlayarrString.SettingsServerSignInRequired
                    }),
                    success = false,
                )
            } ?: SettingsNotice(it.playarrServerConnectionMessage(), success = false)
        }
        _serverOperation.value = null
    }
    fun disconnectServer(serverUrl: String) = viewModelScope.launch {
        if (_serverOperation.value != null) return@launch
        val profileUserId = tokenStore.currentUserId.first() ?: return@launch
        _serverOperation.value = SettingsServerOperation.Disconnecting(serverUrl)
        runCatching { connectedServerSessionManager.disconnect(profileUserId, serverUrl) }
            .onSuccess {
                _message.value = SettingsNotice(
                    PlayarrMessage.Localized(PlayarrString.SettingsServerDisconnected),
                    success = true,
                )
            }
            .onFailure {
                _message.value = SettingsNotice(
                    it.playarrMessage(PlayarrFailureSubject.ServerConnection),
                    success = false,
                )
            }
        _serverOperation.value = null
    }
    fun forgetKnownServerGroup() = viewModelScope.launch {
        if (_serverOperation.value != null) return@launch
        _serverOperation.value = SettingsServerOperation.Forgetting
        runCatching { knownServerGroupStore.forgetGroup() }
            .onSuccess {
                _message.value = SettingsNotice(
                    PlayarrMessage.Localized(PlayarrString.SettingsServerGroupForgotten),
                    success = true,
                )
            }
            .onFailure {
                _message.value = SettingsNotice(
                    it.playarrMessage(PlayarrFailureSubject.ServerGroup),
                    success = false,
                )
            }
        _serverOperation.value = null
    }
    fun testPrimaryConnection() = viewModelScope.launch {
        if (_connectionTest.value == SettingsConnectionTest.Testing) return@launch
        _connectionTest.value = SettingsConnectionTest.Testing
        _connectionTest.value = runCatching { primaryApi.getVersion() }
            .fold(SettingsConnectionTest::Success) {
                SettingsConnectionTest.Failed(it.playarrMessage(PlayarrFailureSubject.ServerConnection))
            }
    }
    fun changeServer(value: String) = viewModelScope.launch {
        runCatching { normaliseServerUrl(value) }
            .onSuccess { serverConfigStore.setBaseUrl(it); tokenStore.clearCurrent() }
            .onFailure {
                _message.value = SettingsNotice(
                    message = PlayarrMessage.Localized(PlayarrString.SettingsServerInvalidUrl),
                    success = false,
                )
            }
    }
    fun signOut() = viewModelScope.launch { tokenStore.clear() }
    fun clearMessage() { _message.value = null }

    private fun observeConnectedServers() = viewModelScope.launch {
        combine(
            tokenStore.currentUserId,
            connectedServerSessionStore.sessions,
            knownServerGroupStore.group,
        ) { profileUserId, _, knownServerGroup ->
            SettingsServerObservation(profileUserId, knownServerGroup != null)
        }.collectLatest { observation ->
            _hasKnownServerGroup.value = observation.hasKnownServerGroup
            if (observation.profileUserId == null) {
                _servers.value = emptyList()
                return@collectLatest
            }
            val clients = serverClientProvider.clients()
            _servers.value = clients.map { client ->
                SettingsServerEntry(
                    serverUrl = client.url,
                    label = playarrServerFallbackLabel(client.url),
                    username = client.username,
                    primary = client.primary,
                )
            }
            _servers.value = coroutineScope {
                clients.map { client ->
                    async {
                        val instanceName = runCatching { client.api.getVersion().instanceName }
                            .getOrNull()
                            ?.takeIf(String::isNotBlank)
                        SettingsServerEntry(
                            serverUrl = client.url,
                            label = instanceName ?: playarrServerFallbackLabel(client.url),
                            username = client.username,
                            primary = client.primary,
                        )
                    }
                }.awaitAll()
            }
        }
    }

    private suspend fun resolveInviteAddresses(serverUrl: String): List<PeerAddressEntry> {
        val bundle = try {
            api.getPeerAddressBundle()
        } catch (error: HttpException) {
            if (error.code() == 403) return playarrInviteAddresses(emptyList(), serverUrl)
            throw error
        }
        return playarrInviteAddresses(bundle.addresses, serverUrl)
    }

    private suspend fun refreshInviteRequestNow() {
        updateInviteRequest(api.getMyUserInviteRequest().value)
    }

    private fun updateInviteRequest(request: UserInviteRequest?) {
        val current = (_state.value as? ParityLoad.Ready)?.value ?: return
        _state.value = ParityLoad.Ready(current.copy(inviteRequest = request))
    }

    private fun updatePinSetting(setting: ProfilePinSetting) {
        val current = (_state.value as? ParityLoad.Ready)?.value ?: return
        _state.value = ParityLoad.Ready(current.copy(pin = setting))
    }

    private fun update(success: PlayarrString, block: suspend () -> Any) = viewModelScope.launch {
        runCatching { block() }
            .onSuccess {
                _message.value = SettingsNotice(PlayarrMessage.Localized(success), success = true)
                load()
            }
            .onFailure {
                _message.value = SettingsNotice(it.playarrMessage(PlayarrFailureSubject.Settings), success = false)
            }
    }
}

private enum class SettingsSection(val label: PlayarrString) {
    Appearance(PlayarrString.SettingsAppearance),
    Avatar(PlayarrString.SettingsAvatar),
    Language(PlayarrString.SettingsLanguage),
    Player(PlayarrString.SettingsPlayer),
    Server(PlayarrString.SettingsServer),
    Lock(PlayarrString.SettingsProfileLock),
    Invite(PlayarrString.SettingsInvite),
    Remote(PlayarrString.SettingsRemote),
    YourData(PlayarrString.SettingsYourData),
    Legal(PlayarrString.SettingsLegal),
    /** Customise Home moved here from Home (owner ruling 8 October): the same rail controls, saved on every change. */
    Home(PlayarrString.HomeCustomise),
    /** Web lists it for everyone; the phone has no latency view, so it points to Playarr Web. */
    RequestLatency(PlayarrString.SettingsRequestLatency),
}

/** The web mobile settings index, in order (number, section, one-line description). */
private val phoneSettingsIndex = listOf(
    SettingsSection.Appearance to PlayarrString.SettingsAppearanceDescription,
    SettingsSection.Avatar to PlayarrString.SettingsIndexAvatarDescription,
    SettingsSection.Language to PlayarrString.SettingsIndexLanguageDescription,
    SettingsSection.Player to PlayarrString.SettingsIndexPlayerDescription,
    SettingsSection.Server to PlayarrString.SettingsIndexServerDescription,
    SettingsSection.Lock to PlayarrString.SettingsIndexProfileLockDescription,
    SettingsSection.Invite to PlayarrString.SettingsIndexInviteDescription,
    SettingsSection.RequestLatency to PlayarrString.SettingsIndexRequestLatencyDescription,
    SettingsSection.Remote to PlayarrString.SettingsIndexRemoteDescription,
    SettingsSection.YourData to PlayarrString.SettingsYourDataDescription,
    SettingsSection.Home to PlayarrString.HomeCustomiseDescription,
)

/** Two-digit section number as web `PRODUCT_SETTINGS_SECTIONS` prints it (01 ... 09, 10). */
internal fun settingsSectionNumber(index: Int): String = (index + 1).toString().padStart(2, '0')

@Composable
internal fun ExperienceParitySettingsScreen(
    serverUrl: String,
    isTelevision: Boolean,
    onBack: () -> Unit,
    viewModel: ParitySettingsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val message by viewModel.message.collectAsState()
    val invite by viewModel.invite.collectAsState()
    val inviteBusy by viewModel.inviteBusy.collectAsState()
    val pinBusy by viewModel.pinBusy.collectAsState()
    val servers by viewModel.servers.collectAsState()
    val hasKnownServerGroup by viewModel.hasKnownServerGroup.collectAsState()
    val serverOperation by viewModel.serverOperation.collectAsState()
    val connectionTest by viewModel.connectionTest.collectAsState()
    val wideScreen = isTelevision || androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp >= 760
    // Phones open on the web's numbered index; wide screens keep the side list with Appearance selected.
    var picked by remember { mutableStateOf<SettingsSection?>(null) }
    val section = picked ?: SettingsSection.Appearance
    val showIndex = !wideScreen && picked == null
    LaunchedEffect(section) {
        if (section != SettingsSection.Invite) return@LaunchedEffect
        while (true) {
            delay(30_000)
            viewModel.refreshInviteRequest()
        }
    }
    if (isTelevision) {
        PlayarrPageLayout(
            pageId = PlayarrPageId.Settings,
            header = playarrPageHeader(title = playarrString(PlayarrString.SettingsTitle), onBack = onBack, backActive = true),
            body = PlayarrPageBody.Bleed,
        ) {
            TvSettingsBody(
                section = section,
                onPick = { picked = it },
                state = state,
                serverUrl = serverUrl,
                inviteBusy = inviteBusy,
                pinBusy = pinBusy,
                servers = servers,
                hasKnownServerGroup = hasKnownServerGroup,
                serverOperation = serverOperation,
                connectionTest = connectionTest,
                viewModel = viewModel,
            )
        }
        invite?.let { PlayarrInviteDialog(it, viewModel::dismissInvite) }
        return
    }
    PlayarrPageLayout(
        pageId = PlayarrPageId.Settings,
        header = playarrPageHeader(title = playarrString(PlayarrString.SettingsTitle), onBack = { if (!wideScreen && picked != null) picked = null else onBack() }, subtitle = if (showIndex) null else playarrString(section.label).uppercase(LocalPlayarrLanguage.current.locale), largeTitle = showIndex, backActive = showIndex),
        body = if (!showIndex) PlayarrPageBody.Panel else PlayarrPageBody.Bleed,
    ) {
    if (showIndex) {
        PhoneSettingsIndex(onOpen = { picked = it })
        return@PlayarrPageLayout
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = isTelevision || maxWidth >= 760.dp
        Row(Modifier.fillMaxSize()) {
            if (wide) {
                Column(Modifier.width(260.dp).fillMaxHeight()) {
                    SettingsSection.entries.filter { it != SettingsSection.RequestLatency }.forEachIndexed { index, candidate ->
                        Text(
                            "${settingsSectionNumber(index)}  ${playarrString(candidate.label)}",
                            color = if (candidate == section) WebInk else WebInkMuted,
                            fontWeight = if (candidate == section) FontWeight.Bold else FontWeight.Normal,
                            modifier = Modifier.fillMaxWidth().clickable { picked = candidate }.padding(vertical = 12.dp),
                        )
                    }
                }
            }
            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxHeight().background(Brush.horizontalGradient(listOf(Color.Transparent, WebSurfaceStrong.copy(alpha = 0.88f), WebSurface))),
                contentPadding = PaddingValues(start = if (wide) 48.dp else 0.dp, end = 0.dp, top = 8.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                if (!wide) {
                    item {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(phoneSettingsIndex.map { it.first }) { candidate ->
                                PlayarrButton(onClick = { picked = candidate }, enabled = candidate != section, variant = PlayarrButtonVariant.Secondary) { Text(playarrString(candidate.label)) }
                            }
                        }
                    }
                }
                item {
                    when (val current = state) {
                        ParityLoad.Loading -> Box(Modifier.fillMaxWidth().height(220.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = WebAccent) }
                        is ParityLoad.Failed -> PlayarrErrorState(current.message, viewModel::load)
                        is ParityLoad.Ready -> SettingsSectionContent(
                            section = section,
                            snapshot = current.value,
                            serverUrl = serverUrl,
                            isTelevision = isTelevision,
                            inviteBusy = inviteBusy,
                            pinBusy = pinBusy,
                            servers = servers,
                            hasKnownServerGroup = hasKnownServerGroup,
                            serverOperation = serverOperation,
                            connectionTest = connectionTest,
                            viewModel = viewModel,
                        )
                    }
                }
                message?.let { notice ->
                    item {
                        Text(
                            playarrText(notice.message),
                            color = if (notice.success) WebAccent else MaterialTheme.colorScheme.error,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.clickable { viewModel.clearMessage() },
                        )
                    }
                }
                item {
                    PlayarrButton(onClick = viewModel::signOut, modifier = Modifier.fillMaxWidth(), variant = PlayarrButtonVariant.Secondary) {
                        Text(playarrString(PlayarrString.ProfilesSignOut), color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
    }
    }
    invite?.let { PlayarrInviteDialog(it, viewModel::dismissInvite) }
}

internal fun playarrServerFallbackLabel(serverUrl: String): String = runCatching {
    URI(serverUrl).host?.takeIf(String::isNotBlank)
}.getOrNull() ?: serverUrl

@Composable
private fun SettingsSectionContent(
    section: SettingsSection,
    snapshot: SettingsSnapshot,
    serverUrl: String,
    isTelevision: Boolean,
    inviteBusy: Boolean,
    pinBusy: Boolean,
    servers: List<SettingsServerEntry>,
    hasKnownServerGroup: Boolean,
    serverOperation: SettingsServerOperation?,
    connectionTest: SettingsConnectionTest,
    viewModel: ParitySettingsViewModel,
) {
    val display = LocalPlayarrDisplayPreferences.current
    val uriHandler = LocalUriHandler.current
    var localNotice by remember(section) { mutableStateOf<PlayarrString?>(null) }
    val displayName = snapshot.userName.ifBlank { playarrString(PlayarrString.ProfileViewerFallback) }
    val description = when (section) {
        SettingsSection.Appearance -> playarrString(PlayarrString.SettingsAppearanceDescription)
        SettingsSection.Language -> playarrString(PlayarrString.SettingsLanguageDescription)
        SettingsSection.Player -> playarrString(PlayarrString.SettingsPlayerDescription)
        SettingsSection.Server -> playarrString(PlayarrString.SettingsServerDescription)
        SettingsSection.Lock -> playarrString(
            PlayarrString.SettingsProfileLockDescription,
            "name" to displayName,
        )
        SettingsSection.Invite -> playarrString(PlayarrString.SettingsInviteDescription)
        SettingsSection.Remote -> playarrString(PlayarrString.RemoteDescription)
        SettingsSection.YourData -> playarrString(PlayarrString.SettingsYourDataDescription)
        SettingsSection.Legal -> playarrString(PlayarrString.SettingsLegalDescription)
        SettingsSection.Home -> playarrString(PlayarrString.HomeCustomiseDescription)
        else -> null
    }
    if (isTelevision && section == SettingsSection.Appearance) {
        TvAppearancePanel(display)
        return
    }
    SettingsCard(playarrString(section.label), description) {
        when (section) {
            SettingsSection.Appearance -> {
                SettingChoiceOptions(
                    label = playarrString(PlayarrString.SettingsColourTheme),
                    choices = listOf(
                        PlayarrThemePreference.System to playarrString(PlayarrString.SettingsThemeSystem),
                        PlayarrThemePreference.Light to playarrString(PlayarrString.SettingsThemeLight),
                        PlayarrThemePreference.Dark to playarrString(PlayarrString.SettingsThemeDark),
                    ),
                    selected = display.theme,
                ) { choice ->
                    display.setTheme(choice)
                    localNotice = PlayarrString.SettingsThemeSaved
                }
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(playarrString(PlayarrString.SettingsHomeViewTitle), color = WebInkSoft, fontSize = 12.sp)
                    Text(
                        playarrString(PlayarrString.SettingsHomeViewDescription),
                        color = WebInkMuted,
                        fontSize = 11.sp,
                    )
                    SettingChoiceOptions(
                        label = "",
                        choices = listOf(
                            PlayarrHomeViewPreference.Thumbnail to playarrString(PlayarrString.SettingsHomeViewThumbnail),
                            PlayarrHomeViewPreference.Cover to playarrString(PlayarrString.SettingsHomeViewCover),
                        ),
                        selected = display.homeView,
                    ) { choice ->
                        display.setHomeView(choice)
                        localNotice = PlayarrString.SettingsHomeViewSaved
                    }
                }
            }
            SettingsSection.Avatar -> {
                PlayarrAvatarSettings(
                    userId = snapshot.userId,
                    preference = snapshot.avatar.preference,
                    isTelevision = isTelevision,
                    onSaveAvatar = viewModel::saveAvatar,
                )
            }
            SettingsSection.Language -> {
                val options = playarrUiLanguageOptions.map { it to it.label() }
                if (LocalSettingsPlainPanel.current) {
                    TvSelect(options.map { it.first to it.second }, options.firstOrNull { it.first.preference == display.language }?.first ?: options.first().first) {
                        display.setLanguage(it.preference)
                        localNotice = PlayarrString.SettingsLanguageSaved
                    }
                    Text(playarrString(PlayarrString.SettingsLanguageDescription), color = WebInkMuted, fontSize = 12.sp)
                    return@SettingsCard
                }
                SettingChoices(
                    playarrString(PlayarrString.LanguageAppLabel),
                    options.map { it.second },
                    options.firstOrNull { it.first.preference == display.language }?.second,
                ) { selected ->
                    options.firstOrNull { it.second == selected }?.let {
                        display.setLanguage(it.first.preference)
                        localNotice = PlayarrString.SettingsLanguageSaved
                    }
                }
            }
            SettingsSection.Player -> TvShiftUp(2) {
                PlayerDefaultHeading(
                    playarrString(PlayarrString.SettingsPlayerQualityTitle),
                    playarrString(PlayarrString.SettingsPlayerQualityDescription),
                )
                if (LocalSettingsPlainPanel.current) {
                    Spacer(Modifier.height(18.4.dp))
                    val qualityShape = RoundedCornerShape(10.dp)
                    TvChoiceCell(
                        selected = display.playerDefaults.qualityId == "original",
                        onClick = { display.setPlayerQuality("original"); localNotice = PlayarrString.SettingsPlayerDefaultsSaved },
                        modifier = Modifier.fillMaxWidth().height(60.dp),
                        trailing = if (display.playerDefaults.qualityId == "original") "\u2713" else null,
                        shape = qualityShape, bar = 4f, startPad = 10.92f, endPad = 13.95f,
                    ) {
                        Text(playarrString(PlayarrString.SettingsQualityOriginal), color = if (display.playerDefaults.qualityId == "original") WebInk else WebInkSoft, fontSize = 12.48.sp, lineHeight = 18.72.sp, fontWeight = FontWeight.Bold, style = cssLine())
                        Spacer(Modifier.height(1.92.dp))
                        Text(playarrString(PlayarrString.SettingsQualityOriginalDetail), color = WebInkMuted, fontSize = 9.28.sp, lineHeight = 13.92.sp, style = cssLine())
                    }
                    Spacer(Modifier.height(7.dp))
                    // Web grid: a 189.2 px heading column and three 262.6 px columns, 6 px gaps; the heading row is 27.5 px.
                    Row(Modifier.fillMaxWidth().height(27.5.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Spacer(Modifier.width(189.2.dp))
                        listOf(PlayarrString.SettingsQualityLow, PlayarrString.SettingsQualityMedium, PlayarrString.SettingsQualityHigh).forEach { level ->
                            Box(Modifier.width(262.6.dp).fillMaxHeight(), contentAlignment = Alignment.Center) {
                                Text(playarrString(level).uppercase(LocalPlayarrLanguage.current.locale), color = WebInkMuted, fontSize = 10.24.sp, lineHeight = 15.36.sp, fontWeight = FontWeight(760), letterSpacing = 0.8192.sp, style = cssLine())
                            }
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) { playarrQualityTiers.forEach { tier ->
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Column(Modifier.width(189.2.dp).padding(start = 4.dp), verticalArrangement = Arrangement.spacedBy(1.92.dp)) {
                                Text(tier.label, color = WebInk, fontSize = 12.16.sp, lineHeight = 18.24.sp, fontWeight = FontWeight(760), style = cssLine())
                                Text(tier.resolution, color = WebInkMuted, fontSize = 9.28.sp, lineHeight = 13.92.sp, style = cssLine())
                            }
                            tier.options.forEach { option ->
                                val optionSelected = display.playerDefaults.qualityId == option.id
                                TvChoiceCell(
                                    selected = optionSelected,
                                    onClick = { display.setPlayerQuality(option.id); localNotice = PlayarrString.SettingsPlayerDefaultsSaved },
                                    modifier = Modifier.width(262.6.dp).height(60.dp),
                                    trailing = if (optionSelected) "\u2713" else null,
                                    shape = qualityShape, bar = 4f, startPad = 10.92f, endPad = 13.95f,
                                ) {
                                    Text(playarrString(PlayarrString.SettingsQualityBitrate, "value" to option.bitrateMbps), color = if (optionSelected) WebInk else WebInkSoft, fontSize = 12.48.sp, lineHeight = 18.72.sp, fontWeight = FontWeight.Bold, style = cssLine())
                                    Spacer(Modifier.height(1.92.dp))
                                    Text(playarrString(option.playarrQualityLevelKey()), color = WebInkMuted, fontSize = 9.28.sp, lineHeight = 13.92.sp, style = cssLine())
                                }
                            }
                        }
                    } }
                } else PlayarrButton(
                    onClick = {
                        display.setPlayerQuality("original")
                        localNotice = PlayarrString.SettingsPlayerDefaultsSaved
                    },
                    enabled = display.playerDefaults.qualityId != "original",
                    variant = PlayarrButtonVariant.Secondary,
                ) {
                    Text(
                        "${playarrString(PlayarrString.SettingsQualityOriginal)} · " +
                            playarrString(PlayarrString.SettingsQualityOriginalDetail),
                    )
                }
                if (!LocalSettingsPlainPanel.current) playarrQualityTiers.forEach { tier ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.width(62.dp)) {
                            Text(tier.label, color = WebInk, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            Text(tier.resolution, color = WebInkMuted, fontSize = 9.sp)
                        }
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            items(tier.options) { option ->
                                PlayarrButton(
                                    onClick = {
                                        display.setPlayerQuality(option.id)
                                        localNotice = PlayarrString.SettingsPlayerDefaultsSaved
                                    },
                                    enabled = display.playerDefaults.qualityId != option.id,
                                    variant = PlayarrButtonVariant.Secondary,
                                ) {
                                    Text(
                                        playarrString(
                                            PlayarrString.SettingsQualityBitrate,
                                            "value" to option.bitrateMbps,
                                        ) + "\n" + playarrString(option.playarrQualityLevelKey()),
                                        fontSize = 9.sp,
                                    )
                                }
                            }
                        }
                    }
                }
                PlayerDefaultHeading(
                    playarrString(PlayarrString.SettingsPlayerSubtitlesTitle),
                    playarrString(PlayarrString.SettingsPlayerSubtitlesDescription),
                    divider = true,
                )
                SettingChoiceOptions(
                    label = playarrString(PlayarrString.SettingsPlayerSubtitlesMode),
                    choices = listOf(
                        PlayarrSubtitleDefault.Off to playarrString(PlayarrString.SettingsPlayerSubtitlesOff),
                        PlayarrSubtitleDefault.Forced to playarrString(PlayarrString.SettingsPlayerSubtitlesForced),
                        PlayarrSubtitleDefault.Always to playarrString(PlayarrString.SettingsPlayerSubtitlesAlways),
                    ),
                    selected = display.playerDefaults.subtitleMode,
                    cells = true,
                ) { choice ->
                    display.setSubtitleMode(choice)
                    localNotice = PlayarrString.SettingsPlayerDefaultsSaved
                }
                if (display.playerDefaults.subtitleMode != PlayarrSubtitleDefault.Off) {
                    PlayerLanguageChoices(
                        playarrString(PlayarrString.SettingsPlayerSubtitleLanguage),
                        display.playerDefaults.subtitleLanguage,
                    ) { language ->
                        display.setSubtitleLanguage(language)
                        localNotice = PlayarrString.SettingsPlayerDefaultsSaved
                    }
                }
                PlayerDefaultHeading(
                    playarrString(PlayarrString.SettingsPlayerAudioTitle),
                    playarrString(PlayarrString.SettingsPlayerAudioDescription),
                    divider = true,
                    dividerGap = -1,
                )
                val selectedAudio = snapshot.player.preferredAudioLanguage.takeIf { saved ->
                    playarrLanguageOptions.any { option -> option.code == saved }
                } ?: "en"
                PlayerLanguageChoices(
                    playarrString(PlayarrString.SettingsPlayerAudioLanguage),
                    selectedAudio,
                    viewModel::savePlayerLanguage,
                )
                val selectedAudioLabel = playarrLanguageOptions.firstOrNull { it.code == selectedAudio }?.label ?: "English"
                Text(
                    playarrString(PlayarrString.SettingsPlayerStatusReady, "language" to selectedAudioLabel),
                    color = WebInkSoft,
                    fontSize = 10.sp,
                )
                Text(
                    playarrString(PlayarrString.SettingsPlayerDeviceNote),
                    color = WebInkMuted,
                    fontSize = 10.sp,
                )
            }
            SettingsSection.Server -> {
                SettingsServerSection(
                    primaryServerUrl = serverUrl,
                    defaultUsername = snapshot.userName,
                    isTelevision = isTelevision,
                    servers = servers,
                    hasKnownServerGroup = hasKnownServerGroup,
                    serverOperation = serverOperation,
                    connectionTest = connectionTest,
                    viewModel = viewModel,
                )
            }
            SettingsSection.Lock -> {
                var pin by remember { mutableStateOf("") }
                if (LocalSettingsPlainPanel.current) {
                    TvShiftUp(2) {
                        Text(
                            playarrString(if (snapshot.pin.pinLocked) PlayarrString.SettingsProfileLockReplacePin else PlayarrString.SettingsProfileLockNewPin).uppercase(LocalPlayarrLanguage.current.locale),
                            color = WebInkMuted, fontSize = 11.2.sp, lineHeight = 16.8.sp, fontWeight = FontWeight(720), letterSpacing = 0.896.sp, style = cssLine(),
                            modifier = Modifier.padding(bottom = 7.6.dp),
                        )
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Row(Modifier.width(420.dp).background(TvSettingsPalette.joinedFill), horizontalArrangement = Arrangement.spacedBy(1.dp)) {
                                TvField(pin, { if (it.length <= 4 && it.all(Char::isDigit)) pin = it }, "\u2022 \u2022 \u2022 \u2022", Modifier.width(325.5.dp), enabled = !pinBusy, password = true, joined = true)
                                TvPrimaryPill(
                                    playarrString(when { pinBusy -> PlayarrString.SettingsProfileLockSaving; snapshot.pin.pinLocked -> PlayarrString.SettingsProfileLockReplace; else -> PlayarrString.SettingsProfileLockSetPin }),
                                    onClick = { viewModel.savePin(pin) { pin = "" } }, enabled = pin.length == 4 && !pinBusy, height = 62,
                                    modifier = Modifier.widthIn(min = 93.5.dp),
                                )
                            }
                            if (snapshot.pin.pinLocked) {
                                Spacer(Modifier.width(10.dp))
                                TvOutlinedPill(playarrString(PlayarrString.SettingsProfileLockRemovePin), { viewModel.savePin(null) { pin = "" } }, height = 50)
                            }
                        }
                        Text(
                            playarrString(when { pinBusy -> PlayarrString.SettingsProfileLockUpdating; snapshot.pin.pinLocked -> PlayarrString.SettingsProfileLockOn; else -> PlayarrString.SettingsProfileLockOff }),
                            color = WebInkMuted, fontSize = 19.2.sp, lineHeight = 28.8.sp, style = cssLine(), modifier = Modifier.padding(top = 33.dp),
                        )
                    }
                    return@SettingsCard
                }
                OutlinedTextField(
                    value = pin,
                    onValueChange = { if (it.length <= 4 && it.all(Char::isDigit)) pin = it },
                    enabled = !pinBusy,
                    label = {
                        Text(
                            playarrString(
                                if (snapshot.pin.pinLocked) {
                                    PlayarrString.SettingsProfileLockReplacePin
                                } else {
                                    PlayarrString.SettingsProfileLockNewPin
                                },
                            ),
                        )
                    },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().playarrSingleLineArrowNavigation(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PlayarrButton(
                        enabled = pin.length == 4 && !pinBusy,
                        onClick = { viewModel.savePin(pin) { pin = "" } },
                    ) {
                        Text(
                            playarrString(
                                when {
                                    pinBusy -> PlayarrString.SettingsProfileLockSaving
                                    snapshot.pin.pinLocked -> PlayarrString.SettingsProfileLockReplace
                                    else -> PlayarrString.SettingsProfileLockSetPin
                                },
                            ),
                        )
                    }
                    if (snapshot.pin.pinLocked) {
                        PlayarrButton(
                            enabled = !pinBusy,
                            onClick = { viewModel.savePin(null) { pin = "" } },
                            variant = PlayarrButtonVariant.Secondary,
                        ) { Text(playarrString(PlayarrString.SettingsProfileLockRemovePin)) }
                    }
                }
                Text(
                    playarrString(
                        when {
                            pinBusy -> PlayarrString.SettingsProfileLockUpdating
                            snapshot.pin.pinLocked -> PlayarrString.SettingsProfileLockOn
                            else -> PlayarrString.SettingsProfileLockOff
                        },
                    ),
                    color = WebInkSoft,
                )
            }
            SettingsSection.Invite -> {
                var requestMessage by remember { mutableStateOf("") }
                val request = snapshot.inviteRequest
                LaunchedEffect(request?.status) {
                    if (request?.status == InviteRequestStatus.Pending) requestMessage = ""
                }
                if (LocalSettingsPlainPanel.current) {
                    // Web TV `.settings-invite`: absolute rhythm read off the reference (status, label, field, pill, notifications).
                    Box(Modifier.fillMaxWidth().height(330.dp)) {
                        Text(playarrString(request?.status.playarrInviteStatusKey()), color = WebInkMuted, fontSize = 19.3.sp, modifier = Modifier.offset(y = (-1).dp))
                        when (request?.status) {
                            InviteRequestStatus.Approved -> TvPrimaryPill(
                                playarrString(if (inviteBusy) PlayarrString.SettingsInviteWorking else PlayarrString.SettingsInviteGenerateQr),
                                onClick = { viewModel.generateInvite(serverUrl) }, enabled = !inviteBusy, modifier = Modifier.fillMaxWidth().offset(y = 179.dp), height = 58,
                            )
                            InviteRequestStatus.Pending -> TvPrimaryPill(playarrString(PlayarrString.SettingsInviteRequestPending), onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth().offset(y = 179.dp), height = 58)
                            else -> {
                                Box(Modifier.offset(y = 57.dp)) { TvFieldLabel(playarrString(PlayarrString.SettingsInviteMessageLabel)) }
                                TvField(requestMessage, { if (it.length <= 500) requestMessage = it }, playarrString(PlayarrString.SettingsInviteMessagePlaceholder), Modifier.fillMaxWidth().offset(y = 74.dp), enabled = !inviteBusy, singleLine = false)
                                TvPrimaryPill(
                                    playarrString(if (inviteBusy) PlayarrString.SettingsInviteWorking else PlayarrString.SettingsInviteRequestQr),
                                    onClick = { viewModel.requestInvite(requestMessage) }, enabled = !inviteBusy, modifier = Modifier.fillMaxWidth().offset(y = 179.dp), height = 58,
                                )
                            }
                        }
                        Box(Modifier.offset(y = 267.dp)) { PlayarrApprovalNotifications() }
                    }
                    return@SettingsCard
                }
                Text(
                    playarrString(request?.status.playarrInviteStatusKey()),
                    color = WebInkSoft,
                )
                when (request?.status) {
                    InviteRequestStatus.Approved -> PlayarrButton(
                        onClick = { viewModel.generateInvite(serverUrl) },
                        enabled = !inviteBusy,
                    ) {
                        Text(
                            playarrString(
                                if (inviteBusy) PlayarrString.SettingsInviteWorking
                                else PlayarrString.SettingsInviteGenerateQr,
                            ),
                        )
                    }
                    InviteRequestStatus.Pending -> PlayarrButton(onClick = {}, enabled = false) {
                        Text(playarrString(PlayarrString.SettingsInviteRequestPending))
                    }
                    else -> {
                        OutlinedTextField(
                            requestMessage,
                            { if (it.length <= 500) requestMessage = it },
                            label = { Text(playarrString(PlayarrString.SettingsInviteMessageLabel)) },
                            placeholder = { Text(playarrString(PlayarrString.SettingsInviteMessagePlaceholder)) },
                            minLines = 4,
                            maxLines = 4,
                            enabled = !inviteBusy,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        PlayarrButton(
                            onClick = { viewModel.requestInvite(requestMessage) },
                            enabled = !inviteBusy,
                        ) {
                            Text(
                                playarrString(
                                    if (inviteBusy) PlayarrString.SettingsInviteWorking
                                    else PlayarrString.SettingsInviteRequestQr,
                                ),
                            )
                        }
                    }
                }
                PlayarrApprovalNotifications()
            }
            SettingsSection.RequestLatency -> if (LocalSettingsPlainPanel.current) {
                Row(Modifier.offset(x = 126.dp, y = 0.dp), horizontalArrangement = Arrangement.spacedBy(47.dp), verticalAlignment = Alignment.Top) {
                    Box(Modifier.size(160.dp).border(1.dp, TvSettingsPalette.segmentBorder, CircleShape).background(TvSettingsPalette.segment, CircleShape), contentAlignment = Alignment.Center) {
                        Text("\u25A4", color = WebKicker, fontSize = 38.sp)
                    }
                    Column(Modifier.padding(top = 36.dp).width(260.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(playarrString(PlayarrString.SettingsRequestLatencyAdminsOnly), color = WebInk, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        Text(playarrString(PlayarrString.SettingsRequestLatencyAdminsOnlyDescription), color = WebInkMuted, fontSize = 12.sp)
                    }
                }
            } else Text(playarrString(PlayarrString.SettingsRequestLatencyOnWeb), color = WebInkMuted)
            SettingsSection.Remote -> RemoteSettingsPanel()
            SettingsSection.YourData -> PlayarrYourDataSection(isTelevision)
            SettingsSection.Home -> PlayarrCustomiseHomePanel(viewModel, isTelevision)
            SettingsSection.Legal -> {
                PlayarrButton(
                    onClick = { uriHandler.openUri(PLAYARR_PRIVACY_URL) },
                    modifier = Modifier.fillMaxWidth(),
                    variant = PlayarrButtonVariant.Secondary,
                ) {
                    Text(playarrString(PlayarrString.SettingsPrivacyNotice))
                }
                PlayarrButton(
                    onClick = { uriHandler.openUri(PLAYARR_ACCOUNT_DELETION_URL) },
                    modifier = Modifier.fillMaxWidth(),
                    variant = PlayarrButtonVariant.Secondary,
                ) {
                    Text(playarrString(PlayarrString.SettingsAccountDeletion))
                }
            }
        }
        localNotice?.let { notice ->
            Text(
                playarrString(notice),
                color = WebAccent,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clickable { localNotice = null },
            )
        }
    }
}

internal fun PlayarrQualityOption.playarrQualityLevelKey(): PlayarrString = when (level.lowercase(Locale.ROOT)) {
    "low" -> PlayarrString.SettingsQualityLow
    "medium" -> PlayarrString.SettingsQualityMedium
    else -> PlayarrString.SettingsQualityHigh
}

@Composable
private fun SettingsServerSection(
    primaryServerUrl: String,
    defaultUsername: String,
    isTelevision: Boolean,
    servers: List<SettingsServerEntry>,
    hasKnownServerGroup: Boolean,
    serverOperation: SettingsServerOperation?,
    connectionTest: SettingsConnectionTest,
    viewModel: ParitySettingsViewModel,
) {
    var serverUrl by remember { mutableStateOf("") }
    var username by remember(defaultUsername) { mutableStateOf(defaultUsername) }
    var password by remember { mutableStateOf("") }
    var primaryValue by remember(primaryServerUrl) { mutableStateOf(primaryServerUrl) }
    var connectionAdded by remember { mutableStateOf(false) }
    val serverBusy = serverOperation != null
    val connecting = serverOperation == SettingsServerOperation.Connecting

    if (LocalSettingsPlainPanel.current) {
        // Web TV: the connected-server list, the joined inputs with the Connect pill, Test connection, the hint, the disclosure.
        // Blocks sit 30.24 px apart (the settings card gap at 1080 px), text in the web's line boxes.
        val line = TvSettingsPalette.joinedFill
        Column(Modifier.offset(y = (-2).dp), verticalArrangement = Arrangement.spacedBy(30.24.dp)) {
            Column(Modifier.width(900.dp).background(line).padding(1.dp), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                servers.forEach { server ->
                    Row(
                        Modifier.fillMaxWidth().background(TvSettingsPalette.listBackground).padding(horizontal = 18.4.dp, vertical = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.2.dp)) {
                            Text(server.label, color = WebInk, fontSize = 19.2.sp, lineHeight = 28.8.sp, fontWeight = FontWeight.Bold, style = cssLine())
                            Text(server.username, color = WebInkMuted, fontSize = 10.56.sp, lineHeight = 15.84.sp, style = cssLine())
                            Text(server.serverUrl, color = WebInkMuted, fontSize = 10.56.sp, lineHeight = 15.84.sp, style = cssLine())
                        }
                        if (server.primary) {
                            Text(
                                playarrString(PlayarrString.SettingsServerPrimaryBadge).uppercase(LocalPlayarrLanguage.current.locale),
                                color = WebInkMuted, fontSize = 10.56.sp, lineHeight = 15.84.sp, fontFamily = webMonoFamily,
                                style = cssLine(),
                                modifier = Modifier.border(1.dp, TvSettingsPalette.joinedBorder).padding(horizontal = 10.4.dp, vertical = 6.72.dp),
                            )
                        } else {
                            TvOutlinedPill(playarrString(PlayarrString.SettingsServerDisconnect), { viewModel.disconnectServer(server.serverUrl) })
                        }
                    }
                }
            }
            Column {
                Text(
                    playarrString(PlayarrString.SettingsServerAddAnother).uppercase(LocalPlayarrLanguage.current.locale),
                    color = WebInkMuted, fontSize = 11.2.sp, lineHeight = 16.8.sp, fontWeight = FontWeight(720), letterSpacing = 0.896.sp,
                    style = cssLine(),
                    modifier = Modifier.padding(bottom = 7.2.dp),
                )
                Row(Modifier.width(900.dp).background(TvSettingsPalette.joinedFill), horizontalArrangement = Arrangement.spacedBy(1.dp)) {
                    TvField(serverUrl, { serverUrl = it; connectionAdded = false }, playarrString(PlayarrString.SettingsServerAddress), Modifier.width(398.1.dp), enabled = !serverBusy, joined = true)
                    TvField(username, { username = it }, playarrString(PlayarrString.SettingsServerUsername), Modifier.width(199.dp), enabled = !serverBusy, joined = true)
                    TvField(password, { password = it }, playarrString(PlayarrString.SettingsServerPassword), Modifier.width(199.dp), enabled = !serverBusy, secret = true, joined = true)
                    TvPrimaryPill(
                        playarrString(if (connecting) PlayarrString.SettingsServerConnecting else PlayarrString.SettingsServerConnect),
                        onClick = { viewModel.connectServer(serverUrl, username, password, isTelevision) { serverUrl = ""; password = ""; connectionAdded = true } },
                        enabled = serverUrl.isNotBlank() && !serverBusy, height = 62,
                    )
                }
                Text(
                    playarrString(if (connectionAdded) PlayarrString.SettingsServerConnectedHint else PlayarrString.SettingsServerCredentialsHint),
                    color = WebInkMuted, fontSize = 12.48.sp, lineHeight = 18.72.sp,
                    style = cssLine(),
                    modifier = Modifier.padding(top = 0.dp),
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TvOutlinedPill(
                    playarrString(if (connectionTest == SettingsConnectionTest.Testing) PlayarrString.SettingsServerTesting else PlayarrString.SettingsServerTestConnection),
                    viewModel::testPrimaryConnection,
                )
                when (connectionTest) {
                    SettingsConnectionTest.Idle, SettingsConnectionTest.Testing -> Unit
                    is SettingsConnectionTest.Success -> Text(
                        playarrString(PlayarrString.SettingsServerConnectedSuccess, "serverVersion" to connectionTest.version.serverVersion, "apiVersion" to connectionTest.version.apiVersion),
                        color = WebInkSoft, fontSize = 12.48.sp,
                    )
                    is SettingsConnectionTest.Failed -> Text(
                        playarrString(PlayarrString.SettingsServerConnectError, "message" to playarrText(connectionTest.message)),
                        color = MaterialTheme.colorScheme.error, fontSize = 12.48.sp,
                    )
                }
            }
            Column {
                Text(
                    playarrString(PlayarrString.SettingsServerPrimaryHint, "apiBaseUrl" to primaryServerUrl),
                    color = WebInkMuted, fontSize = 12.48.sp, lineHeight = 18.72.sp,
                    style = cssLine(),
                )
                if (hasKnownServerGroup) Text(playarrString(PlayarrString.SettingsServerForgetHint), color = WebInkMuted, fontSize = 12.48.sp, lineHeight = 18.72.sp)
            }
            var detailsOpen by remember { mutableStateOf(false) }
            Column(Modifier.width(900.dp)) {
                Box(Modifier.fillMaxWidth().height(1.dp).background(TvSettingsPalette.divider))
                Text(
                    (if (detailsOpen) "\u25BE " else "\u25B8 ") + playarrString(PlayarrString.SettingsServerTvDetailsSummary),
                    color = WebInkSoft, fontSize = 11.52.sp, lineHeight = 17.28.sp, fontWeight = FontWeight(720),
                    style = cssLine(),
                    modifier = Modifier.clickable { detailsOpen = !detailsOpen }.padding(top = 16.dp, bottom = 8.dp),
                )
                if (detailsOpen) {
                    TvField(primaryValue, { primaryValue = it }, playarrString(PlayarrString.LoginServerUrl), Modifier.width(520.dp))
                    TvPrimaryPill(playarrString(PlayarrString.SettingsServerChangeAppHost), { viewModel.changeServer(primaryValue) }, enabled = primaryValue.isNotBlank())
                    Text(playarrString(PlayarrString.SettingsServerChangeAppHostHint), color = WebInkMuted, fontSize = 12.48.sp)
                }
            }
        }
        return
    }

    Text(
        playarrString(PlayarrString.SettingsServerConnectedServers),
        color = WebInkSoft,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
    )
    if (servers.isEmpty()) {
        Text(playarrString(PlayarrString.SettingsServerLoadingConnections), color = WebInkMuted, fontSize = 11.sp)
    }
    servers.forEach { server ->
        Surface(
            color = WebSurfaceSoft,
            shape = RoundedCornerShape(14.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, WebInkMuted.copy(alpha = 0.2f)),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(server.label, color = WebInk, fontWeight = FontWeight.SemiBold)
                    Text(server.username, color = WebInkSoft, fontSize = 11.sp)
                    Text(server.serverUrl, color = WebInkMuted, fontSize = 10.sp)
                }
                if (server.primary) {
                    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(7.dp)) {
                        Text(
                            playarrString(PlayarrString.SettingsServerPrimaryBadge).uppercase(
                                LocalPlayarrLanguage.current.locale,
                            ),
                            color = WebAccent,
                            fontSize = 9.sp,
                            fontWeight = FontWeight.ExtraBold,
                        )
                        if (hasKnownServerGroup) {
                            PlayarrButton(
                                onClick = viewModel::forgetKnownServerGroup,
                                enabled = !serverBusy,
                                variant = PlayarrButtonVariant.Secondary,
                            ) {
                                Text(playarrString(PlayarrString.SettingsServerForget), fontSize = 10.sp)
                            }
                        }
                    }
                } else {
                    PlayarrButton(
                        onClick = { viewModel.disconnectServer(server.serverUrl) },
                        enabled = !serverBusy,
                        variant = PlayarrButtonVariant.Secondary,
                    ) { Text(playarrString(PlayarrString.SettingsServerDisconnect), fontSize = 10.sp) }
                }
            }
        }
    }

    Text(
        playarrString(PlayarrString.SettingsServerAddAnother),
        color = WebInk,
        fontSize = 15.sp,
        fontWeight = FontWeight.SemiBold,
    )
    OutlinedTextField(
        value = serverUrl,
        onValueChange = { serverUrl = it; connectionAdded = false },
        enabled = !serverBusy,
        label = { Text(playarrString(PlayarrString.SettingsServerAddress)) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth().playarrSingleLineArrowNavigation(),
    )
    OutlinedTextField(
        value = username,
        onValueChange = { username = it },
        enabled = !serverBusy,
        label = { Text(playarrString(PlayarrString.SettingsServerUsername)) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth().playarrSingleLineArrowNavigation(),
    )
    OutlinedTextField(
        value = password,
        onValueChange = { password = it },
        enabled = !serverBusy,
        label = { Text(playarrString(PlayarrString.SettingsServerPassword)) },
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        singleLine = true,
        modifier = Modifier.fillMaxWidth().playarrSingleLineArrowNavigation(),
    )
    PlayarrButton(
        onClick = {
            viewModel.connectServer(serverUrl, username, password, isTelevision) {
                serverUrl = ""
                password = ""
                connectionAdded = true
            }
        },
        enabled = serverUrl.isNotBlank() && !serverBusy,
    ) {
        Text(
            playarrString(
                if (connecting) PlayarrString.SettingsServerConnecting else PlayarrString.SettingsServerConnect,
            ),
        )
    }
    Text(
        playarrString(
            if (connectionAdded) PlayarrString.SettingsServerConnectedHint
            else PlayarrString.SettingsServerCredentialsHint,
        ),
        color = WebInkMuted,
        fontSize = 11.sp,
    )

    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        PlayarrButton(
            onClick = viewModel::testPrimaryConnection,
            enabled = connectionTest != SettingsConnectionTest.Testing,
            variant = PlayarrButtonVariant.Secondary,
        ) {
            Text(
                playarrString(
                    if (connectionTest == SettingsConnectionTest.Testing) {
                        PlayarrString.SettingsServerTesting
                    } else {
                        PlayarrString.SettingsServerTestConnection
                    },
                ),
            )
        }
        when (connectionTest) {
            SettingsConnectionTest.Idle, SettingsConnectionTest.Testing -> Unit
            is SettingsConnectionTest.Success -> Text(
                playarrString(
                    PlayarrString.SettingsServerConnectedSuccess,
                    "serverVersion" to connectionTest.version.serverVersion,
                    "apiVersion" to connectionTest.version.apiVersion,
                ),
                color = WebAccent,
                fontSize = 10.sp,
            )
            is SettingsConnectionTest.Failed -> Text(
                playarrString(
                    PlayarrString.SettingsServerConnectError,
                    "message" to playarrText(connectionTest.message),
                ),
                color = MaterialTheme.colorScheme.error,
                fontSize = 10.sp,
            )
        }
    }

    Text(
        playarrString(PlayarrString.SettingsServerPrimaryHint, "apiBaseUrl" to primaryServerUrl),
        color = WebInkMuted,
        fontSize = 11.sp,
    )
    if (hasKnownServerGroup) {
        Text(playarrString(PlayarrString.SettingsServerForgetHint), color = WebInkMuted, fontSize = 11.sp)
    }
    Text(
        playarrString(PlayarrString.SettingsServerChangeAppHost),
        color = WebInk,
        fontSize = 15.sp,
        fontWeight = FontWeight.SemiBold,
    )
    OutlinedTextField(
        value = primaryValue,
        onValueChange = { primaryValue = it },
        label = { Text(playarrString(PlayarrString.LoginServerUrl)) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth().playarrSingleLineArrowNavigation(),
    )
    PlayarrButton(
        onClick = { viewModel.changeServer(primaryValue) },
        enabled = primaryValue.isNotBlank(),
    ) { Text(playarrString(PlayarrString.SettingsServerChangeAppHost)) }
    Text(
        playarrString(PlayarrString.SettingsServerChangeAppHostHint),
        color = WebInkMuted,
        fontSize = 11.sp,
    )
}

@Composable
private fun PlayerDefaultHeading(title: String, description: String, divider: Boolean = false, dividerGap: Int = 0) {
    if (LocalSettingsPlainPanel.current) {
        Column {
            // Web: a group after the first has the panel gap (30.24) above its 1 px top border and the same as padding below.
            if (divider) {
                Spacer(Modifier.height((30.24f + dividerGap).dp))
                Box(Modifier.fillMaxWidth().height(1.dp).background(TvSettingsPalette.divider))
                Spacer(Modifier.height(30.24.dp))
            }
            Text(title, color = WebInk, fontSize = 26.4.sp, lineHeight = 39.2.sp, fontWeight = FontWeight(560), letterSpacing = (-0.924).sp, style = cssLine())
            Text(description, color = WebInkMuted, fontSize = 13.12.sp, lineHeight = 20.34.sp, style = cssLine(), modifier = Modifier.padding(top = 5.6.dp))
        }
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, color = WebInk, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        Text(description, color = WebInkMuted, fontSize = 11.sp)
    }
}

@Composable
private fun PlayerLanguageChoices(
    label: String,
    selected: String,
    onSelected: (String) -> Unit,
) {
    if (LocalSettingsPlainPanel.current) {
        Spacer(Modifier.height(19.44.dp))
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            playarrLanguageOptions.chunked(2).forEach { pair ->
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    pair.forEach { option ->
                        TvChoiceCell(
                            selected = option.code == selected, onClick = { onSelected(option.code) },
                            modifier = Modifier.width(491.5.dp).height(62.dp), trailing = option.code, startPad = 17f, endPad = 17f, trailingMono = true, trailingSize = 9.28f,
                        ) { Text(option.label, color = if (option.code == selected) WebInk else WebInkSoft, fontSize = 14.72.sp, fontWeight = FontWeight(680), style = cssLine()) }
                    }
                }
            }
        }
        return
    }
    Text(label, color = WebInkSoft, fontSize = 12.sp)
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(playarrLanguageOptions) { option ->
            PlayarrButton(onClick = { onSelected(option.code) }, enabled = option.code != selected, variant = PlayarrButtonVariant.Secondary) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(option.label, fontSize = 10.sp)
                    Text(option.code, color = WebInkMuted, fontSize = 8.sp)
                }
            }
        }
    }
}

internal val LocalSettingsPlainPanel = androidx.compose.runtime.compositionLocalOf { false }

/** Web TV `.tv-settings`: palette values read off the committed references (dark and light). */
internal object TvSettingsPalette {
    val listBackground get() = if (webIsDark) Color(0xFF1B181B) else Color(0xFFFBFAF9)
    val selectedRow get() = if (webIsDark) Color(0xFF312A30) else Color(0xFFDFDCDD)
    val segment get() = if (webIsDark) Color(0xFF151315) else Color(0xFFF5F3F2)
    val segmentBorder get() = if (webIsDark) Color(0xFF474347) else Color(0xFFC3BCBC)
    val divider get() = if (webIsDark) Color(0xFF393538) else Color(0xFFD7D3D3)
    val headerLine get() = if (webIsDark) Color(0xFF484547) else Color(0xFFC5BFBC)
    /** `--line` over the panel: the fill of inputs inside a joined group and the 1 px gaps between them. */
    val joinedFill get() = if (webIsDark) Color(0xFF3A3639) else Color(0xFFD7D3D3)
    val joinedBorder get() = if (webIsDark) Color(0xFF5F5B5E) else Color(0xFFACA4A2)
    /** A choice cell: `--surface` fill, `--line` border (drawn over the fill), the selected one 12% crimson. */
    val cellBorder get() = if (webIsDark) Color(0xFF312E30) else Color(0xFFE0DCDB)
    val cellSelectedFill get() = if (webIsDark) Color(0xFF311B22) else Color(0xFFF6E2E6)
    /** `--line-strong` over the panel: the border of a standalone input. */
    val inputBorder get() = if (webIsDark) Color(0xFF4D494C) else Color(0xFFC1BBB9)
}

/** On television the panel content starts at the web's y 210, two pixels above where the other sections were tuned. */
@Composable
private fun TvShiftUp(px: Int, content: @Composable () -> Unit) {
    if (!LocalSettingsPlainPanel.current) { content(); return }
    Column(Modifier.layout { measurable, constraints ->
        val placeable = measurable.measure(constraints)
        layout(placeable.width, placeable.height) { placeable.place(0, -px) }
    }) { content() }
}

@Composable
internal fun cssLine(): androidx.compose.ui.text.TextStyle =
    androidx.compose.material3.LocalTextStyle.current.merge(androidx.compose.ui.text.TextStyle(lineHeightStyle = CssLine))

/** CSS half-leading: the glyphs centred in a line box of the given height, as the web lays text out. */
private val CssLine = androidx.compose.ui.text.style.LineHeightStyle(
    androidx.compose.ui.text.style.LineHeightStyle.Alignment.Center,
    androidx.compose.ui.text.style.LineHeightStyle.Trim.None,
)

@Composable
private fun TvSettingsBody(
    section: SettingsSection,
    onPick: (SettingsSection) -> Unit,
    state: ParityLoad<SettingsSnapshot>,
    serverUrl: String,
    inviteBusy: Boolean,
    pinBusy: Boolean,
    servers: List<SettingsServerEntry>,
    hasKnownServerGroup: Boolean,
    serverOperation: SettingsServerOperation?,
    connectionTest: SettingsConnectionTest,
    viewModel: ParitySettingsViewModel,
) {
    val locale = LocalPlayarrLanguage.current.locale
    val entries = phoneSettingsIndex
    // Web default focus: the section list, on the first (selected) section; LEFT/RIGHT then cross to the panel.
    val firstRow = remember { androidx.compose.ui.focus.FocusRequester() }
    TvDefaultFocusEffect(Unit) { runCatching { firstRow.requestFocus() } }
    // The page is darker (lighter in the light theme) behind the section list and fades to the panel tone from x 680 to 1150.
    val start = if (webIsDark) Color(0xFF1B181B) else Color(0xFFFBFAF9)
    val mid = if (webIsDark) Color(0xFF252125) else Color(0xFFF3F1F2)
    val end = if (webIsDark) Color(0xFF272227) else Color(0xFFF0EEEF)
    Box(
        Modifier.fillMaxSize().background(
            Brush.horizontalGradient(
                0.354f to start, 0.43f to mid, 0.47f to Color.Unspecified.let { mid }, 0.6f to end, 1f to end,
            ),
        ),
    ) {
        // Web: the section is the page header subtitle (`.page-subtitle`, owner rule 2026-10-10), with no rule or caption line.
        Text(
            playarrString(section.label).uppercase(locale),
            color = io.playarr.shared.designsystem.theme.PlayarrWebTheme.palette.brandInk,
            fontSize = 12.288.sp, fontWeight = FontWeight(820), letterSpacing = 0.983.sp, lineHeight = 18.432.sp, style = cssLine(),
            modifier = Modifier.offset(x = 226.6.dp, y = 111.8.dp),
        )
        val isAdmin by viewModel.isAdmin.collectAsState()
        LazyColumn(
            // Padding, not offset: the list must end at the screen edge so rows past it (11 sections) scroll into view.
            Modifier.padding(start = playarrPageMetrics(true).start, top = 162.dp).width(480.dp).fillMaxHeight(),
        ) {
            // Web lists the admin-only sections (request latency) only for administrators and keeps every section's number.
            val rows = entries.mapIndexed { number, row -> number to row.first }
                .filter { (_, candidate) -> isAdmin || candidate != SettingsSection.RequestLatency }
            itemsIndexed(rows) { index, (number, candidate) ->
                var focused by remember { mutableStateOf(false) }
                val selected = candidate == section
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(92.dp)
                        .then(if (index == 0) Modifier.focusRequester(firstRow) else Modifier)
                        .background(if (selected && !focused) TvSettingsPalette.selectedRow else TvSettingsPalette.listBackground)
                        .webFocusRing(focused, radius = 0.dp, offset = (-3).dp)
                        .onFocusChanged { focused = it.isFocused; if (it.isFocused) onPick(candidate) }
                        .clickable { onPick(candidate) },
                ) {
                    Text(
                        settingsSectionNumber(number),
                        color = WebInkMuted, fontSize = 9.92.sp, fontWeight = FontWeight(760), lineHeight = 11.sp, style = cssLine(),
                        modifier = Modifier.offset(x = 32.dp, y = 27.dp),
                    )
                    Text(
                        playarrString(candidate.label),
                        color = WebInk, fontSize = 29.6.sp, fontWeight = FontWeight(480), lineHeight = 33.sp, letterSpacing = (-0.9).sp, style = cssLine(),
                        modifier = Modifier.align(Alignment.CenterStart).padding(start = 92.dp).offset(y = (-1).dp),
                    )
                    Text(
                        "\u2192",
                        color = if (selected) WebInk else WebInkMuted, fontSize = 20.8.sp, lineHeight = 23.sp, style = cssLine(),
                        modifier = Modifier.align(Alignment.CenterEnd).padding(end = if (selected) 27.dp else 32.dp).offset(y = (-2).dp),
                    )
                }
            }
        }
        // Web TV settings draw their primary buttons as a light pill (dark ink in the light theme), not the brand pink.
        // MaterialTheme re-provides the body text style (the platform font); keep the web font the page already set.
        val outerTextStyle = androidx.compose.material3.LocalTextStyle.current
        MaterialTheme(
            typography = MaterialTheme.typography,
            colorScheme = MaterialTheme.colorScheme.copy(
                primary = if (webIsDark) Color(0xFFDFDCDD) else Color(0xFF675961),
                onPrimary = if (webIsDark) Color(0xFF151315) else Color.White,
                surfaceVariant = WebSurface,
                outline = WebInkMuted,
            ),
        ) {
        androidx.compose.material3.ProvideTextStyle(outerTextStyle) {
        Column(
            Modifier.offset(x = 774.dp, y = 212.dp).width(995.dp),
        ) {
            when (val current = state) {
                ParityLoad.Loading -> CircularProgressIndicator(color = WebAccent)
                is ParityLoad.Failed -> PlayarrErrorState(current.message, viewModel::load)
                is ParityLoad.Ready -> androidx.compose.runtime.CompositionLocalProvider(LocalSettingsPlainPanel provides true) {
                    SettingsSectionContent(
                        section = section,
                        snapshot = current.value,
                        serverUrl = serverUrl,
                        isTelevision = true,
                        inviteBusy = inviteBusy,
                        pinBusy = pinBusy,
                        servers = servers,
                        hasKnownServerGroup = hasKnownServerGroup,
                        serverOperation = serverOperation,
                        connectionTest = connectionTest,
                        viewModel = viewModel,
                    )
                }
            }
        }
        }
        }
    }
}

/** Web TV text field: a bordered dark box, the label small and uppercase above it. */
@Composable
private fun TvField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    height: Int = 62,
    singleLine: Boolean = true,
    password: Boolean = false,
    enabled: Boolean = true,
    secret: Boolean = false,
    textSize: Float = 19.2f,
    joined: Boolean = false,
) {
    androidx.compose.foundation.text.BasicTextField(
        value = value,
        onValueChange = onValueChange,
        enabled = enabled,
        singleLine = singleLine,
        textStyle = androidx.compose.ui.text.TextStyle(color = WebInk, fontSize = textSize.sp),
        cursorBrush = androidx.compose.ui.graphics.SolidColor(WebInk),
        visualTransformation = if (password || secret) androidx.compose.ui.text.input.PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = if (password) KeyboardOptions(keyboardType = KeyboardType.NumberPassword) else if (secret) KeyboardOptions(keyboardType = KeyboardType.Password) else KeyboardOptions.Default,
        modifier = modifier.height(height.dp)
            .then(if (joined) Modifier.background(TvSettingsPalette.joinedFill) else Modifier)
            .border(1.dp, if (joined) TvSettingsPalette.joinedBorder else TvSettingsPalette.inputBorder)
            .playarrSingleLineArrowNavigation(),
        decorationBox = { inner ->
            Box(Modifier.padding(horizontal = 17.dp, vertical = 12.dp), contentAlignment = if (singleLine) Alignment.CenterStart else Alignment.TopStart) {
                if (value.isEmpty()) Text(placeholder, color = WebInkMuted, fontSize = textSize.sp)
                inner()
            }
        },
    )
}

@Composable
private fun TvFieldLabel(text: String) {
    Text(text.uppercase(), color = WebInkMuted, fontSize = 11.sp, letterSpacing = 1.1.sp, lineHeight = 16.sp)
}

/** Web TV primary pill: light in the dark theme, dark ink in the light theme. */
@Composable
internal fun TvPrimaryPill(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, height: Int = 50) {
    val fill = if (webIsDark) Color(0xFFDFDCDD) else Color(0xFF675961)
    val ink = if (webIsDark) Color(0xFF151315) else Color.White
    androidx.compose.material3.Surface(
        onClick = onClick, enabled = enabled, shape = CircleShape,
        color = if (enabled) fill else fill.copy(alpha = 0.4f), contentColor = ink,
        modifier = modifier.height(height.dp),
    ) { Box(Modifier.padding(horizontal = 21.dp), contentAlignment = Alignment.Center) { Text(label, fontSize = 14.72.sp, fontWeight = FontWeight(720), maxLines = 1) } }
}

/** Chrome's native checkbox (13 px, `accent-color` auto) as the references draw it: the dark theme's pale blue, the light theme's blue. */
@Composable
internal fun TvNativeCheckbox(checked: Boolean, onToggle: () -> Unit, modifier: Modifier = Modifier) {
    val dark = webIsDark
    val fill = when { checked && dark -> Color(0xFF99C8FF); checked -> Color(0xFF0075FF); dark -> Color(0xFF3B3B3B); else -> Color.White }
    val border = if (checked) null else androidx.compose.foundation.BorderStroke(1.dp, if (dark) Color(0xFF858585) else Color(0xFF767676))
    val tick = if (dark) Color(0xFF3B3B3B) else Color.White
    Box(
        modifier.size(13.dp).clip(RoundedCornerShape(2.dp)).background(fill).then(if (border != null) Modifier.border(border, RoundedCornerShape(2.dp)) else Modifier)
            .clickable(onClick = onToggle),
    ) {
        if (checked) androidx.compose.foundation.Canvas(Modifier.fillMaxSize()) {
            val w = 1.9.dp.toPx()
            val path = androidx.compose.ui.graphics.Path().apply {
                moveTo(3.1.dp.toPx(), 6.6.dp.toPx()); lineTo(5.4.dp.toPx(), 9.0.dp.toPx()); lineTo(9.9.dp.toPx(), 3.9.dp.toPx())
            }
            drawPath(path, tick, style = androidx.compose.ui.graphics.drawscope.Stroke(w, cap = androidx.compose.ui.graphics.StrokeCap.Round, join = androidx.compose.ui.graphics.StrokeJoin.Round))
        }
    }
}

/** Web `.btn-secondary` at the 58 px size: a surface pill with a line border and 14.72 px text. */
@Composable
internal fun TvSecondaryPill(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, height: Int = 58) {
    androidx.compose.material3.Surface(
        onClick = onClick, enabled = enabled, shape = CircleShape, color = TvSettingsPalette.listBackground,
        contentColor = if (enabled) WebInkSoft else WebInkMuted.copy(alpha = 0.6f),
        border = androidx.compose.foundation.BorderStroke(1.dp, if (enabled) WebPillBorder else TvSettingsPalette.cellBorder), modifier = modifier.height(height.dp),
    ) { Box(Modifier.padding(horizontal = 21.dp), contentAlignment = Alignment.Center) { Text(label, fontSize = 14.72.sp, fontWeight = FontWeight(720), maxLines = 1, style = cssLine()) } }
}

/** Web `select.input`: a 62 px bordered box with 11.2 px bold text and the browser's down chevron at the right. */
@Composable
internal fun <T> TvSelectField(choices: List<Pair<T, String>>, selected: T, onSelected: (T) -> Unit, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        Box(
            Modifier.fillMaxWidth().height(62.dp).border(1.dp, TvSettingsPalette.inputBorder).clickable { open = true }.padding(horizontal = 17.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            Text(choices.firstOrNull { it.first == selected }?.second.orEmpty(), color = WebInk, fontSize = 11.2.sp, fontWeight = FontWeight.Bold, style = cssLine())
            androidx.compose.foundation.Canvas(Modifier.align(Alignment.CenterEnd).size(width = 9.dp, height = 6.dp)) {
                val stroke = androidx.compose.ui.graphics.drawscope.Stroke(1.6.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round)
                drawLine(WebInk, androidx.compose.ui.geometry.Offset(0.5.dp.toPx(), 0.8.dp.toPx()), androidx.compose.ui.geometry.Offset(size.width / 2, size.height - 0.8.dp.toPx()), stroke.width, stroke.cap)
                drawLine(WebInk, androidx.compose.ui.geometry.Offset(size.width / 2, size.height - 0.8.dp.toPx()), androidx.compose.ui.geometry.Offset(size.width - 0.5.dp.toPx(), 0.8.dp.toPx()), stroke.width, stroke.cap)
            }
        }
        androidx.compose.material3.DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            choices.forEach { (value, label) -> androidx.compose.material3.DropdownMenuItem(text = { Text(label) }, onClick = { open = false; onSelected(value) }) }
        }
    }
}

@Composable
private fun TvOutlinedPill(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, height: Int = 38) {
    androidx.compose.material3.Surface(
        onClick = onClick, shape = CircleShape, color = WebSurface, contentColor = WebInkSoft,
        border = androidx.compose.foundation.BorderStroke(1.dp, WebPillBorder), modifier = modifier.height(height.dp),
    ) { Box(Modifier.padding(horizontal = 14.4.dp), contentAlignment = Alignment.Center) { Text(label, fontSize = 11.52.sp, fontWeight = FontWeight(720), maxLines = 1) } }
}

/** Web TV select: a 168 x 48 outlined box showing the current value and a caret; the choices open in a menu. */
@Composable
private fun <T> TvSelect(choices: List<Pair<T, String>>, selected: T, onSelected: (T) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        androidx.compose.material3.Surface(
            onClick = { open = true }, color = TvSettingsPalette.segment, contentColor = WebInkSoft,
            border = androidx.compose.foundation.BorderStroke(1.dp, TvSettingsPalette.segmentBorder),
            modifier = Modifier.width(168.dp).height(48.dp),
        ) {
            Row(Modifier.padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("\u25CC", fontSize = 11.sp)
                Text(choices.firstOrNull { it.first == selected }?.second.orEmpty(), fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f), maxLines = 1)
                Text("\u2304", fontSize = 12.sp)
            }
        }
        androidx.compose.material3.DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            choices.forEach { (value, label) ->
                androidx.compose.material3.DropdownMenuItem(text = { Text(label) }, onClick = { open = false; onSelected(value) })
            }
        }
    }
}

/** Web TV choice cell: a `--surface` rectangle with a `--line` border; the selected one gets a crimson border, an inset crimson bar and a 12% crimson fill. */
@Composable
private fun TvChoiceCell(
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    trailing: String? = null,
    shape: androidx.compose.ui.graphics.Shape = androidx.compose.ui.graphics.RectangleShape,
    bar: Float = 5f,
    startPad: Float = 15.4f,
    endPad: Float = 15.4f,
    trailingMono: Boolean = false,
    trailingSize: Float = 11.84f,
    content: @Composable ColumnScope.() -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val accent = WebKicker
    androidx.compose.material3.Surface(
        onClick = onClick,
        shape = shape,
        color = if (selected) TvSettingsPalette.cellSelectedFill else TvSettingsPalette.listBackground,
        contentColor = WebInk,
        border = androidx.compose.foundation.BorderStroke(1.dp, if (selected) accent.copy(alpha = 0.76f) else TvSettingsPalette.cellBorder),
        modifier = modifier.webFocusRing(focused, radius = 0.dp, offset = (-3).dp).onFocusChanged { focused = it.isFocused },
    ) {
        Box(Modifier.fillMaxSize().then(if (selected) Modifier.drawBehind { drawRect(accent, size = androidx.compose.ui.geometry.Size(bar.dp.toPx(), size.height)) } else Modifier)) {
            Column(Modifier.align(Alignment.CenterStart).padding(start = (startPad - 1f).dp), verticalArrangement = Arrangement.Center, content = content)
            trailing?.let {
                Text(
                    if (trailingMono) it.uppercase() else it,
                    color = if (trailingMono && selected) accent else if (trailingMono) WebInkMuted else if (selected) accent else WebInkMuted,
                    fontSize = trailingSize.sp,
                    style = cssLine(),
                    fontFamily = if (trailingMono) webMonoFamily else null,
                    fontWeight = if (trailingMono) FontWeight(720) else null,
                    letterSpacing = if (trailingMono) 0.7424.sp else androidx.compose.ui.unit.TextUnit.Unspecified,
                    modifier = Modifier.align(Alignment.CenterEnd).padding(end = (endPad - 1f).dp),
                )
            }
        }
    }
}

/** Web TV segmented control: square cells in one bordered strip, the selected cell inverted. */
@Composable
private fun <T> TvSegmented(choices: List<Pair<T, String>>, selected: T, onSelected: (T) -> Unit) {
    // Web `.tv-segmented` (the shared filter choice grid): equal 56 dp segments across the panel, 8 dp apart.
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        choices.forEach { (value, label) ->
            PlayarrChoice(label, value == selected, Modifier.weight(1f)) { onSelected(value) }
        }
    }
}

@Composable
private fun TvAppearancePanel(display: PlayarrDisplayPreferences) {
    Text(playarrString(PlayarrString.SettingsColourTheme), color = WebInk, fontSize = 26.4.sp, fontWeight = FontWeight(560), lineHeight = 34.sp, letterSpacing = (-0.5).sp)
    Spacer(Modifier.height(20.dp))
    TvSegmented(
        choices = listOf(
            PlayarrThemePreference.System to playarrString(PlayarrString.SettingsThemeSystem),
            PlayarrThemePreference.Light to playarrString(PlayarrString.SettingsThemeLight),
            PlayarrThemePreference.Dark to playarrString(PlayarrString.SettingsThemeDark),
        ),
        selected = display.theme,
    ) { display.setTheme(it) }
    Spacer(Modifier.height(30.dp))
    Box(Modifier.fillMaxWidth().height(1.dp).background(TvSettingsPalette.divider))
    Spacer(Modifier.height(32.dp))
    Text(playarrString(PlayarrString.SettingsHomeViewTitle), color = WebInk, fontSize = 26.4.sp, fontWeight = FontWeight(560), lineHeight = 34.sp, letterSpacing = (-0.5).sp)
    Spacer(Modifier.height(9.dp))
    Text(playarrString(PlayarrString.SettingsHomeViewDescription), color = WebInkMuted, fontSize = 13.sp, lineHeight = 20.sp)
    Spacer(Modifier.height(17.dp))
    TvSegmented(
        choices = listOf(
            PlayarrHomeViewPreference.Thumbnail to playarrString(PlayarrString.SettingsHomeViewThumbnail),
            PlayarrHomeViewPreference.Cover to playarrString(PlayarrString.SettingsHomeViewCover),
        ),
        selected = display.homeView,
    ) { display.setHomeView(it) }
    Spacer(Modifier.height(30.dp))
    Box(Modifier.fillMaxWidth().height(1.dp).background(TvSettingsPalette.divider))
    Spacer(Modifier.height(32.dp))
    Text(playarrString(PlayarrString.LibraryArtworkSize), color = WebInk, fontSize = 26.4.sp, fontWeight = FontWeight(560), lineHeight = 34.sp, letterSpacing = (-0.5).sp)
    Spacer(Modifier.height(9.dp))
    Text(playarrString(PlayarrString.SettingsArtworkSizeDescription), color = WebInkMuted, fontSize = 13.sp, lineHeight = 20.sp)
    Spacer(Modifier.height(17.dp))
    TvSegmented(
        choices = listOf(
            LibraryArtworkSize.Small to playarrString(PlayarrString.LibrarySizeSmall).replaceFirstChar { it.titlecase() },
            LibraryArtworkSize.Medium to playarrString(PlayarrString.LibrarySizeMedium).replaceFirstChar { it.titlecase() },
            LibraryArtworkSize.Large to playarrString(PlayarrString.LibrarySizeLarge).replaceFirstChar { it.titlecase() },
        ),
        selected = display.artworkSize,
    ) { display.setArtworkSize(it) }
}

@Composable
private fun SettingsCard(
    title: String,
    description: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    if (LocalSettingsPlainPanel.current) {
        // Web TV: the section content carries its own headings; the panel has no title or description of its own.
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) { content() }
        return
    }
    Surface(color = WebSurfaceStrong, shape = RoundedCornerShape(18.dp), border = androidx.compose.foundation.BorderStroke(1.dp, WebInkMuted.copy(alpha = 0.2f)), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(title, color = WebInk, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            description?.let { Text(it, color = WebInkMuted, fontSize = 11.sp) }
            content()
        }
    }
}

@Composable
private fun SettingChoices(label: String, choices: List<String>, selected: String? = null, onSelected: (String) -> Unit) {
    if (LocalSettingsPlainPanel.current) {
        TvSegmented(choices.map { it to it }, selected ?: "", onSelected)
        return
    }
    Text(label, color = WebInkSoft, fontSize = 12.sp)
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(choices) { choice -> PlayarrButton(onClick = { onSelected(choice) }, enabled = choice != selected, variant = PlayarrButtonVariant.Secondary) { Text(choice) } }
    }
}

@Composable
private fun <T> SettingChoiceOptions(
    label: String,
    choices: List<Pair<T, String>>,
    selected: T,
    cells: Boolean = false,
    onSelected: (T) -> Unit,
) {
    if (LocalSettingsPlainPanel.current) {
        if (cells) {
            Spacer(Modifier.height(19.44.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                choices.forEach { (value, choiceLabel) ->
                    TvChoiceCell(selected = value == selected, onClick = { onSelected(value) }, modifier = Modifier.width(239.7.dp).height(68.dp)) {
                        Text(choiceLabel, color = if (value == selected) WebInk else WebInkSoft, fontSize = 14.08.sp, fontWeight = FontWeight.Bold, style = cssLine())
                    }
                }
            }
        } else TvSegmented(choices, selected, onSelected)
        return
    }
    if (label.isNotBlank()) Text(label, color = WebInkSoft, fontSize = 12.sp)
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(choices, key = { it.first.toString() }) { (value, choiceLabel) ->
            PlayarrButton(onClick = { onSelected(value) }, enabled = value != selected, variant = PlayarrButtonVariant.Secondary) { Text(choiceLabel) }
        }
    }
}




/**
 * The message for a failed profile PIN check, or `null` to fall back to the
 * generic one: wrong PIN, a brute-force lockout with its wait, or a
 * restricted profile switching up into a profile that has no PIN.
 */
internal fun profilePinFailureMessage(failure: Throwable): PlayarrMessage? {
    if (failure !is HttpException) return null
    failure.pinLockSeconds()?.let { seconds ->
        val minutes = ((seconds + 59) / 60).coerceAtLeast(1)
        return PlayarrMessage.Localized(PlayarrString.ProfilesPinLocked, mapOf("minutes" to minutes))
    }
    return when {
        failure.code() == 401 -> PlayarrMessage.Localized(PlayarrString.ProfilesPinNotAccepted)
        failure.code() == 403 && failure.apiErrorCode() == "guardian_pin_required" ->
            PlayarrMessage.Localized(PlayarrString.ProfilesGuardianPinRequired)
        else -> null
    }
}

internal fun Throwable.playarrMessage(subject: PlayarrFailureSubject): PlayarrMessage = when (this) {
    is retrofit2.HttpException -> when (code()) {
        401 -> PlayarrMessage.Localized(PlayarrString.ErrorSessionExpired)
        403 -> PlayarrMessage.Localized(
            PlayarrString.ErrorProfileCannotAccess,
            mapOf("subject" to subject.key),
        )
        404 -> PlayarrMessage.Localized(
            PlayarrString.ErrorSubjectNotFound,
            mapOf("subject" to subject.key),
        )
        else -> PlayarrMessage.Localized(
            PlayarrString.ErrorServerStatus,
            mapOf("code" to code()),
        )
    }
    else -> message?.let(PlayarrMessage::Dynamic) ?: PlayarrMessage.Localized(
        PlayarrString.ErrorCouldNotLoad,
        mapOf("subject" to subject.key),
    )
}

private fun Throwable.playarrServerConnectionMessage(): PlayarrMessage = when (this) {
    is HttpException -> when (code()) {
        401 -> PlayarrMessage.Localized(PlayarrString.ErrorServerCredentialsRejected)
        404 -> PlayarrMessage.Localized(PlayarrString.ErrorServerNotFound)
        else -> PlayarrMessage.Localized(
            PlayarrString.ErrorServerStatus,
            mapOf("code" to code()),
        )
    }
    else -> message?.let(PlayarrMessage::Dynamic)
        ?: PlayarrMessage.Localized(PlayarrString.ErrorCouldNotConnectServer)
}

/** Web mobile `.settings-options-list`: numbered rows 88 px tall, the first one drawn selected. */
@Composable
private fun PhoneSettingsIndex(onOpen: (SettingsSection) -> Unit) {
    Box(Modifier.fillMaxSize().background(WebSurface)) {
        androidx.compose.foundation.lazy.LazyColumn(
            modifier = Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 60.dp, bottom = 116.dp),
        ) {
            itemsIndexed(phoneSettingsIndex, key = { _, row -> row.first.name }) { index, (candidate, description) ->
                val active = index == 0
                Row(
                    Modifier.fillMaxWidth().height(88.dp)
                        .then(if (active) Modifier.background(WebSurfaceSoft) else Modifier)
                        .clickable { onOpen(candidate) }
                        .padding(horizontal = 12.dp, vertical = 16.dp),
                ) {
                    Text(
                        (index + 1).toString().padStart(2, '0'), color = WebInkMuted, fontSize = 8.96.sp, lineHeight = 13.44.sp,
                        fontWeight = FontWeight(760), style = WebTextStyle, modifier = Modifier.width(44.dp),
                    )
                    Column(Modifier.weight(1f).fillMaxHeight().padding(bottom = 1.4.dp), verticalArrangement = Arrangement.Center) {
                        Text(
                            playarrString(candidate.label), color = WebInk, fontSize = 16.sp, lineHeight = 18.4.sp,
                            fontWeight = FontWeight(480), letterSpacing = (-0.56).sp, style = WebTextStyle, maxLines = 1,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                        )
                        Spacer(Modifier.height(2.1.dp))
                        Text(
                            playarrString(description), color = WebInkMuted, fontSize = 10.88.sp, lineHeight = 15.776.sp,
                            style = WebTextStyle, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                            modifier = Modifier.offset(y = (-1).dp),
                        )
                    }
                    Spacer(Modifier.width(12.dp))
                    Box(Modifier.width(20.8.dp).fillMaxHeight(), contentAlignment = Alignment.Center) {
                        Text(
                            "→", color = if (active) WebInk else WebInkMuted, fontSize = 20.8.sp, lineHeight = 31.2.sp, style = WebTextStyle,
                            modifier = Modifier.offset(x = if (active) 5.dp else 0.dp),
                        )
                    }
                }
            }
        }
    }
}

/** Per-user Home customisation as a Settings panel: show or hide each rail, move it up or down, or reset to the admin's order. */
@Composable
private fun PlayarrCustomiseHomePanel(viewModel: ParitySettingsViewModel, isTelevision: Boolean) {
    val language = LocalPlayarrLanguage.current.resolved.code
    LaunchedEffect(language) { viewModel.loadHomeRails(language) }
    val rails by viewModel.homeRails.collectAsState()
    val list = rails
    if (list == null) {
        CircularProgressIndicator()
        return
    }
    // On television the panel is a fixed canvas (not inside a scrolling list): bound it to the screen and scroll it, so the
    // rails past the bottom edge and Reset stay reachable with the D-pad (focus scrolls into view).
    Column(
        (if (isTelevision) Modifier.heightIn(max = 820.dp).verticalScroll(rememberScrollState()) else Modifier),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        list.forEachIndexed { index, rail ->
            // The title takes the full width (rail names are long); the controls sit on their own line.
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    rail.title,
                    color = if (rail.hidden) WebInkMuted else WebInk,
                    modifier = Modifier.fillMaxWidth(),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    PlayarrButton(
                        variant = PlayarrButtonVariant.Ghost,
                        enabled = index > 0,
                        onClick = { viewModel.saveHomeRails(moveRail(list, index, -1)) },
                    ) { Text(playarrString(PlayarrString.HomeCustomiseUp)) }
                    PlayarrButton(
                        variant = PlayarrButtonVariant.Ghost,
                        enabled = index < list.lastIndex,
                        onClick = { viewModel.saveHomeRails(moveRail(list, index, 1)) },
                    ) { Text(playarrString(PlayarrString.HomeCustomiseDown)) }
                    PlayarrButton(
                        variant = PlayarrButtonVariant.Secondary,
                        onClick = { viewModel.saveHomeRails(list.toMutableList().also { it[index] = rail.copy(hidden = !rail.hidden) }) },
                    ) {
                        Text(playarrString(if (rail.hidden) PlayarrString.HomeCustomiseShow else PlayarrString.HomeCustomiseHide))
                    }
                }
            }
        }
        PlayarrButton(onClick = { viewModel.resetHomeRails(language) }, variant = PlayarrButtonVariant.Ghost) {
            Text(playarrString(PlayarrString.HomeCustomiseReset))
        }
    }
}

/** Web `--card-glow` on a circle: the 3 dp brand-ink ring outside the edge and a soft brand glow around it (no fill). */
private fun Modifier.circleCardGlow(focused: Boolean): Modifier = if (!focused) this else drawBehind {
    val brand = io.playarr.shared.designsystem.theme.PlayarrWebTheme.palette.brandInk
    val r = size.minDimension / 2f
    val glow = 24.dp.toPx()
    drawCircle(
        Brush.radialGradient(
            0f to Color.Transparent, (r - 2.dp.toPx()) / (r + glow) to brand.copy(alpha = 0.45f), 1f to Color.Transparent,
            center = center, radius = r + glow,
        ),
        radius = r + glow,
    )
    drawCircle(brand, radius = r + 1.5.dp.toPx(), style = androidx.compose.ui.graphics.drawscope.Stroke(width = 3.dp.toPx()))
}
