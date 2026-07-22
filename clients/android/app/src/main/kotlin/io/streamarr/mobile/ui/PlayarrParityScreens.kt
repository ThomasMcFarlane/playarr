package io.streamarr.mobile.ui

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavHostController
import dagger.hilt.android.lifecycle.HiltViewModel
import io.streamarr.mobile.BuildConfig
import io.streamarr.mobile.connected.PlayarrServerClientProvider
import io.streamarr.mobile.di.PrimaryStreamarrApi
import io.streamarr.mobile.update.AndroidSelfUpdater
import io.streamarr.mobile.update.AndroidUpdateEvent
import io.streamarr.shared.auth.ConnectedServerSessionManager
import io.streamarr.shared.auth.ConnectedServerSessionStore
import io.streamarr.shared.auth.KnownServerGroupStore
import io.streamarr.shared.auth.SavedProfile
import io.streamarr.shared.auth.TokenStore
import io.streamarr.shared.auth.model.ClientPlatform
import io.streamarr.shared.auth.model.LoginRequest
import io.streamarr.shared.auth.model.toTokenResponse
import io.streamarr.shared.auth.remote.LoginApi
import io.streamarr.shared.data.config.ServerConfigStore
import io.streamarr.shared.data.model.AddPlaylistItemRequest
import io.streamarr.shared.data.model.AvailableProfile
import io.streamarr.shared.data.model.CreatePlaylistRequest
import io.streamarr.shared.data.model.CreateUserInviteRequest
import io.streamarr.shared.data.model.InviteRequestStatus
import io.streamarr.shared.data.model.PlayerPreferences
import io.streamarr.shared.data.model.PeerAddressEntry
import io.streamarr.shared.data.model.Playlist
import io.streamarr.shared.data.model.PlaylistItem
import io.streamarr.shared.data.model.PlaylistMediaType
import io.streamarr.shared.data.model.ProfileAvatarPreference
import io.streamarr.shared.data.model.ProfileAvatarSetting
import io.streamarr.shared.data.model.ProfilePinSetting
import io.streamarr.shared.data.model.ReorderPlaylistItemsRequest
import io.streamarr.shared.data.model.UpdatePlayerPreferencesRequest
import io.streamarr.shared.data.model.UpdatePlaylistRequest
import io.streamarr.shared.data.model.UpdateProfileAvatarRequest
import io.streamarr.shared.data.model.UpdateProfilePinRequest
import io.streamarr.shared.data.model.UserInviteRequest
import io.streamarr.shared.data.model.VersionEnvelope
import io.streamarr.shared.data.model.WorkChildren
import io.streamarr.shared.data.model.WorkDetail
import io.streamarr.shared.data.remote.StreamarrApi
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

private enum class PlayarrFailureSubject(val key: PlayarrString) {
    Playlists(PlayarrString.ErrorSubjectPlaylists),
    Playlist(PlayarrString.ErrorSubjectPlaylist),
    Profiles(PlayarrString.ErrorSubjectProfiles),
    Profile(PlayarrString.ErrorSubjectProfile),
    Settings(PlayarrString.ErrorSubjectSettings),
    ProfileLock(PlayarrString.ErrorSubjectProfileLock),
    Invitation(PlayarrString.ErrorSubjectInvitation),
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

internal class PlaylistMediaTypeMismatchException : IllegalStateException()

@HiltViewModel
internal class PlaylistsViewModel @Inject constructor(
    private val api: StreamarrApi,
) : ViewModel() {
    private val _playlists = MutableStateFlow<ParityLoad<ResolvedPlaylistDirectory>>(ParityLoad.Loading)
    val playlists = _playlists.asStateFlow()

    init { load() }

    fun load() = viewModelScope.launch {
        _playlists.value = ParityLoad.Loading
        _playlists.value = runCatching {
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

internal fun playlistCoverWorks(directory: ResolvedPlaylistDirectory, playlistId: String): List<io.streamarr.shared.data.model.Work> {
    val childrenByParent = directory.playlists.groupBy { it.parentPlaylistId }
    val works = linkedMapOf<String, io.streamarr.shared.data.model.Work>()
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
internal class PlaylistActionsViewModel @Inject constructor(private val api: StreamarrApi) : ViewModel() {
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
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(playarrString(PlayarrString.ContextAddToPlaylistHeading)) },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth().height(360.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                when (val current = state) {
                    ParityLoad.Loading -> CircularProgressIndicator(color = WebPink)
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
        confirmButton = { TextButton(onClick = onDismiss) { Text(playarrString(PlayarrString.CommonClose)) } },
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
    Box(Modifier.fillMaxSize().background(WebSurface)) {
        Column(
            Modifier.fillMaxSize().padding(
                start = if (isTelevision) 118.dp else 16.dp,
                end = if (isTelevision) 64.dp else 16.dp,
                top = if (isTelevision) 82.dp else 72.dp,
                bottom = 96.dp,
            ),
        ) {
            Column {
                Text(
                    playarrString(PlayarrString.PlaylistsTitle),
                    color = WebInk,
                    fontSize = if (isTelevision) 38.sp else 28.sp,
                    fontWeight = FontWeight.Medium,
                )
            }
            when (val current = state) {
                ParityLoad.Loading -> ParityLoading(playarrString(PlayarrString.PlaylistsPreparing))
                is ParityLoad.Failed -> ParityFailure(current.message, viewModel::load)
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
                        ExperienceEmpty(
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
        Row(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .windowInsetsPadding(if (isTelevision) WindowInsets(0) else WindowInsets.statusBars)
                .padding(top = if (isTelevision) 116.dp else 14.dp, end = if (isTelevision) 14.dp else 66.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Surface(onClick = { creating = true }, color = WebSurfaceStrong, shape = RoundedCornerShape(14.dp), modifier = Modifier.size(44.dp)) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.Add, contentDescription = playarrString(PlayarrString.PlaylistsCreateLabel), tint = WebInk)
                }
            }
            Surface(onClick = { filtering = true }, color = WebSurfaceStrong, shape = RoundedCornerShape(14.dp), modifier = Modifier.size(44.dp)) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.FilterList, contentDescription = playarrString(PlayarrString.PlaylistsFilterLabel), tint = WebInk)
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
        AlertDialog(
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
                            OutlinedButton(
                                onClick = {
                                    mediaType = type
                                    parentPlaylistId = null
                                    createError = null
                                },
                                enabled = !createBusy && mediaType != type,
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
                TextButton(
                    enabled = name.isNotBlank() && !createBusy,
                    onClick = {
                        if (name.isBlank()) {
                            createError = PlayarrMessage.Localized(PlayarrString.PlaylistsNameRequired)
                            return@TextButton
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
                TextButton(onClick = { creating = false }, enabled = !createBusy) {
                    Text(playarrString(PlayarrString.CommonCancel))
                }
            },
        )
    }
    if (filtering) {
        AlertDialog(
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
                TextButton(onClick = { filtering = false }) { Text(playarrString(PlayarrString.CommonDone)) }
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
        OutlinedButton(
            onClick = { onSelected(null) },
            enabled = enabled && selectedId != null,
            modifier = Modifier.fillMaxWidth(),
        ) { Text(playarrString(PlayarrString.PlaylistsNoParent)) }
        parents.forEach { parent ->
            OutlinedButton(
                onClick = { onSelected(parent.id) },
                enabled = enabled && selectedId != parent.id,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(labels[parent.id] ?: parent.name, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
    }
}

@Composable
internal fun PlaylistCard(
    playlist: Playlist,
    coverWorks: List<io.streamarr.shared.data.model.Work> = emptyList(),
    itemCount: Int? = null,
    childCount: Int = 0,
    serverUrl: String = "",
    accessToken: String? = null,
    selected: Boolean = false,
    onSelected: () -> Unit = {},
    onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val openLabel = playarrString(PlayarrString.PlaylistsOpenLabel, "name" to playlist.name)
    Surface(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1.45f)
            .scale(if (focused) 1.04f else 1f)
            .onFocusChanged {
                focused = it.isFocused
                if (it.isFocused) onSelected()
            }
            .semantics { contentDescription = openLabel },
        color = WebSurfaceStrong,
        shape = RoundedCornerShape(18.dp),
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            if (focused || selected) WebInkSoft else WebInkMuted.copy(alpha = 0.18f),
        ),
    ) {
        Box(Modifier.background(Brush.linearGradient(listOf(WebPink.copy(alpha = 0.22f), WebSurfaceStrong)))) {
            if (coverWorks.isEmpty() || serverUrl.isBlank()) {
                Icon(Icons.AutoMirrored.Outlined.PlaylistPlay, contentDescription = null, tint = WebPink, modifier = Modifier.align(Alignment.TopEnd).padding(18.dp).size(38.dp))
            } else {
                coverWorks.take(3).asReversed().forEachIndexed { index, work ->
                    AuthenticatedArtwork(
                        work = work,
                        kinds = listOf(io.streamarr.shared.data.model.ImageKind.Poster, io.streamarr.shared.data.model.ImageKind.Backdrop),
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
internal class PlaylistDetailViewModel @Inject constructor(private val api: StreamarrApi) : ViewModel() {
    private val _state = MutableStateFlow<ParityLoad<ResolvedPlaylist>>(ParityLoad.Loading)
    val state = _state.asStateFlow()
    private var loadedId: String? = null

    fun load(id: String) {
        if (loadedId == id && _state.value is ParityLoad.Ready) return
        loadedId = id
        refresh(id)
    }

    private fun refresh(id: String) = viewModelScope.launch {
        _state.value = ParityLoad.Loading
        _state.value = runCatching {
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
        }.fold({ ParityLoad.Ready(it) }, { ParityLoad.Failed(it.playarrMessage(PlayarrFailureSubject.Playlist)) })
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
    when (val current = state) {
        ParityLoad.Loading -> ParityLoading(playarrString(PlayarrString.PlaylistsLoading))
        is ParityLoad.Failed -> ParityFailure(current.message) { viewModel.load(playlistId) }
        is ParityLoad.Ready -> {
            val value = current.value
            Box(Modifier.fillMaxSize().background(WebSurface)) {
                Column(
                    Modifier.fillMaxSize().padding(
                        start = if (isTelevision) 118.dp else 16.dp,
                        end = if (isTelevision) 58.dp else 16.dp,
                        top = if (isTelevision) 72.dp else 64.dp,
                        bottom = 98.dp,
                    ),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = onBack) {
                            Icon(
                                Icons.AutoMirrored.Outlined.ArrowBack,
                                playarrString(PlayarrString.PlaylistsBack),
                                tint = WebInk,
                            )
                        }
                        Column(Modifier.weight(1f).padding(start = 8.dp)) {
                            Text(
                                value.root.name,
                                color = WebInk,
                                fontSize = if (isTelevision) 34.sp else 25.sp,
                                fontWeight = FontWeight.Medium,
                            )
                            Text(
                                playarrString(
                                    if (value.tracks.size == 1) {
                                        PlayarrString.PlaylistsTrackCountOne
                                    } else {
                                        PlayarrString.PlaylistsTrackCountOther
                                    },
                                    "count" to value.tracks.size,
                                ),
                                color = WebInkMuted,
                                fontSize = 10.sp,
                            )
                        }
                        if (!value.root.isSystem) {
                            IconButton(onClick = { creatingUnder = value.root }) {
                                Icon(
                                    Icons.Outlined.Add,
                                    playarrString(PlayarrString.PlaylistsCreateSubPlaylist),
                                    tint = WebInk,
                                )
                            }
                        }
                    }
                    LazyColumn(
                        modifier = Modifier.fillMaxSize().padding(top = 22.dp),
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
                                        IconButton(onClick = { editing = track.playlist }) {
                                            Icon(
                                                Icons.Outlined.Edit,
                                                playarrString(PlayarrString.PlaylistActionsEdit),
                                                tint = WebInkMuted,
                                            )
                                        }
                                        IconButton(onClick = { deleting = track.playlist }) {
                                            Icon(
                                                Icons.Outlined.Delete,
                                                playarrString(PlayarrString.PlaylistActionsDelete),
                                                tint = MaterialTheme.colorScheme.error,
                                            )
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
                        listOf(io.streamarr.shared.data.model.ImageKind.Thumb, io.streamarr.shared.data.model.ImageKind.Backdrop),
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
                    IconButton(onClick = { onPlay(mediaFileId) }) {
                        Icon(Icons.Outlined.PlayArrow, playarrString(PlayarrString.PlaylistItemPlay), tint = WebPink)
                    }
                }
            }
            if (editable) {
                Row(Modifier.align(Alignment.End)) {
                    IconButton(onClick = onMoveUp, enabled = canMoveUp) {
                        Icon(Icons.Outlined.ArrowUpward, playarrString(PlayarrString.PlaylistItemMoveUp), tint = WebInkMuted)
                    }
                    IconButton(onClick = onMoveDown, enabled = canMoveDown) {
                        Icon(Icons.Outlined.ArrowDownward, playarrString(PlayarrString.PlaylistItemMoveDown), tint = WebInkMuted)
                    }
                    IconButton(onClick = onRemove) {
                        Icon(Icons.Outlined.Delete, playarrString(PlayarrString.PlaylistItemRemove), tint = WebInkMuted)
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
    AlertDialog(
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
            TextButton(
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
            TextButton(onClick = onDismiss, enabled = !busy) { Text(playarrString(PlayarrString.CommonCancel)) }
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
    AlertDialog(
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
            TextButton(
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
            TextButton(onClick = onDismiss, enabled = !busy) { Text(playarrString(PlayarrString.CommonCancel)) }
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
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(playarrString(PlayarrString.PlaylistActionsConfirmDelete)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(playarrString(PlayarrString.PlaylistActionsDeleteDescription, "name" to playlist.name))
                error?.let { Text(playarrText(it), color = MaterialTheme.colorScheme.error, fontSize = 11.sp) }
            }
        },
        confirmButton = {
            TextButton(
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
            TextButton(onClick = onDismiss, enabled = !busy) { Text(playarrString(PlayarrString.CommonCancel)) }
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
): List<AvailableProfile> = profiles.map { profile ->
    AvailableProfile(
        id = profile.userId,
        username = profile.name.orEmpty(),
        displayName = profile.name.orEmpty(),
        isCurrent = profile.userId == currentUserId,
        pinLocked = false,
    )
}

@HiltViewModel
internal class ProfilesViewModel @Inject constructor(
    private val api: StreamarrApi,
    private val loginApi: LoginApi,
    private val tokenStore: TokenStore,
    private val serverConfigStore: ServerConfigStore,
) : ViewModel() {
    private val _state = MutableStateFlow<ParityLoad<ProfilesSnapshot>>(ParityLoad.Loading)
    val state = _state.asStateFlow()
    private val _switchingProfileId = MutableStateFlow<String?>(null)
    val switchingProfileId = _switchingProfileId.asStateFlow()

    fun load() = viewModelScope.launch {
        _state.value = ParityLoad.Loading
        val serverUrl = serverConfigStore.baseUrl.first()
        val saved = tokenStore.savedProfilesForServer(serverUrl).first()
        val savedIds = saved.mapTo(mutableSetOf(), SavedProfile::userId)
        val savedAvatars = saved.mapNotNull { profile ->
            profile.avatar?.toPlayarrProfileAvatarPreference()?.let { profile.userId to it }
        }.toMap()
        val currentUserId = tokenStore.currentUserId.first()
        val fallback = savedAndroidProfiles(saved, currentUserId)
        if (currentUserId == null) {
            _state.value = ParityLoad.Ready(ProfilesSnapshot(fallback, savedIds, savedAvatars))
            return@launch
        }
        _state.value = runCatching { api.listAvailableProfiles() }.fold(
            onSuccess = {
                ParityLoad.Ready(
                    ProfilesSnapshot(
                        selectAndroidDeviceProfiles(it, savedIds, currentUserId),
                        savedIds,
                        savedAvatars,
                    ),
                )
            },
            onFailure = { failure ->
                ParityLoad.Ready(
                    ProfilesSnapshot(
                        profiles = fallback,
                        savedProfileIds = savedIds,
                        profileAvatars = savedAvatars,
                        loadWarning = failure.playarrMessage(PlayarrFailureSubject.Profiles),
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
            val serverUrl = serverConfigStore.baseUrl.first()
            if (pin == null && tokenStore.isProfileSaved(serverUrl, profile.id)) {
                check(tokenStore.activateProfile(serverUrl, profile.id))
            } else {
                val response = loginApi.login(
                    LoginRequest(
                        deviceId = tokenStore.getOrCreateDeviceId(),
                        deviceName = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
                        clientPlatform = if (isTelevision) ClientPlatform.AndroidTv else ClientPlatform.AndroidMobile,
                        clientVersion = BuildConfig.VERSION_NAME,
                        pin = pin,
                        profileUserId = profile.id,
                    ),
                )
                tokenStore.clearCurrent()
                tokenStore.save(response.toTokenResponse())
                tokenStore.saveIdentity(response.userId, profile.displayName, serverUrl)
            }
        }.onSuccess { onSuccess() }
            .onFailure(onFailure)
        _switchingProfileId.value = null
    }

    fun signOut(profileId: String) = viewModelScope.launch {
        tokenStore.logoutProfile(serverConfigStore.baseUrl.first(), profileId)
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
            AndroidSelfUpdater(activity = activity, scope = scope, onEvent = { event = it })
        } else {
            null
        }
    }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { updater?.resumePendingInstall() }
    return ProfilesUpdateControl(event) { updater?.checkForUpdates() }
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
    viewModel: ProfilesViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val switchingProfileId by viewModel.switchingProfileId.collectAsState()
    val updateControl = rememberProfilesUpdateControl(isTelevision)
    var selectedId by remember { mutableStateOf<String?>(null) }
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
                actionError = failure.playarrMessage(PlayarrFailureSubject.Profile)
            }
        }
    }
    Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(WebSurface, WebBackground)))) {
        when (val current = state) {
            ParityLoad.Loading -> ParityLoading(playarrString(PlayarrString.ProfilesLoading))
            is ParityLoad.Failed -> ParityFailure(current.message, viewModel::load)
            is ParityLoad.Ready -> {
                val profiles = current.value.profiles.map { profile ->
                    if (profile.displayName.isBlank()) {
                        profile.copy(displayName = playarrString(PlayarrString.ProfileViewerFallback))
                    } else {
                        profile
                    }
                }
                LaunchedEffect(profiles) {
                    selectedId = profiles.firstOrNull { it.isCurrent }?.id ?: profiles.firstOrNull()?.id
                }
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    contentPadding = PaddingValues(bottom = 36.dp),
                ) {
                    item {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                playarrString(PlayarrString.ProfilesTitle).uppercase(LocalPlayarrLanguage.current.locale),
                                color = WebPink,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.ExtraBold,
                                letterSpacing = 1.4.sp,
                                modifier = Modifier.padding(top = if (isTelevision) 90.dp else 78.dp),
                            )
                            Text(
                                playarrString(PlayarrString.ProfilesHeading),
                                color = WebInk,
                                fontSize = if (isTelevision) 54.sp else 38.sp,
                                fontWeight = FontWeight.Medium,
                                letterSpacing = (-2).sp,
                            )
                        }
                    }
                    item {
                        LazyRow(
                            modifier = Modifier.fillMaxWidth().padding(top = if (isTelevision) 72.dp else 42.dp),
                            horizontalArrangement = Arrangement.spacedBy(if (isTelevision) 38.dp else 22.dp),
                            contentPadding = PaddingValues(horizontal = if (isTelevision) 120.dp else 34.dp),
                        ) {
                            items(profiles, key = AvailableProfile::id) { profile ->
                                ProfileChoice(
                                    profile = profile,
                                    avatar = if (profile.id == currentUserId) {
                                        currentAvatar ?: current.value.profileAvatars[profile.id]
                                    } else {
                                        current.value.profileAvatars[profile.id]
                                    },
                                    selected = selectedId == profile.id,
                                    isTelevision = isTelevision,
                                    switching = switchingProfileId == profile.id,
                                    enabled = switchingProfileId == null,
                                    onFocus = { selectedId = profile.id },
                                    onClick = { requestAction(profile, ProfileAction.Select) },
                                    onSettings = { requestAction(profile, ProfileAction.Settings) },
                                    onSignOut = if (profile.id in current.value.savedProfileIds || profile.isCurrent) {
                                        ({ viewModel.signOut(profile.id) })
                                    } else {
                                        null
                                    },
                                )
                            }
                            item(AddProfileId) {
                                AddProfileChoice(
                                    selected = selectedId == AddProfileId,
                                    isTelevision = isTelevision,
                                    enabled = switchingProfileId == null,
                                    onFocus = { selectedId = AddProfileId },
                                    onClick = onAddProfile,
                                )
                            }
                        }
                    }
                    actionError?.let { error ->
                        item {
                            Text(
                                playarrText(error),
                                color = MaterialTheme.colorScheme.error,
                                modifier = Modifier.padding(18.dp),
                            )
                        }
                    }
                    current.value.loadWarning?.let { warning ->
                        item {
                            Text(
                                playarrString(
                                    PlayarrString.ProfilesErrorShowingSaved,
                                    "message" to playarrText(warning),
                                ),
                                color = WebInkMuted,
                                fontSize = 11.sp,
                                modifier = Modifier.padding(18.dp),
                            )
                        }
                    }
                    if (isTelevision) {
                        item {
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
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                OutlinedButton(
                                    onClick = updateControl.check,
                                    enabled = !busy,
                                    modifier = Modifier.padding(top = 28.dp),
                                ) { Text(label) }
                                if (event is AndroidUpdateEvent.Error) {
                                    Text(event.message, color = MaterialTheme.colorScheme.error, fontSize = 11.sp)
                                }
                            }
                        }
                    }
                }
            }
        }
        PlayarrLogo(
            modifier = Modifier.align(Alignment.TopStart).padding(
                start = if (isTelevision) 59.dp else 18.dp,
                top = if (isTelevision) 34.dp else 14.dp,
            ),
            iconSize = if (isTelevision) 42.dp else 30.dp,
        )
        PlayarrLanguageDropdown(
            modifier = Modifier.align(Alignment.TopEnd).padding(
                end = if (isTelevision) 44.dp else 14.dp,
                top = if (isTelevision) 26.dp else 6.dp,
            ),
        )
    }
    pinProfile?.let { profile ->
        val busy = switchingProfileId == profile.id
        AlertDialog(
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
                    TextButton(onClick = onAddProfile, enabled = !busy, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                        Text(playarrString(PlayarrString.ProfilesUseAccountSignIn))
                    }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = pin.length == 4 && !busy,
                    onClick = {
                        switchProfile(profile, pinAction, pin) { failure ->
                            pinError = if (failure is HttpException && failure.code() == 401) {
                                PlayarrMessage.Localized(PlayarrString.ProfilesPinNotAccepted)
                            } else {
                                failure.playarrMessage(PlayarrFailureSubject.Profile)
                            }
                        }
                    },
                ) {
                    Text(playarrString(if (busy) PlayarrString.ProfilesChecking else PlayarrString.ProfilesContinue))
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { pinProfile = null; pin = ""; pinError = null },
                    enabled = !busy,
                ) { Text(playarrString(PlayarrString.CommonCancel)) }
            },
        )
    }
}

@Composable
private fun ProfileChoice(
    profile: AvailableProfile,
    avatar: ProfileAvatarPreference?,
    selected: Boolean,
    isTelevision: Boolean,
    switching: Boolean,
    enabled: Boolean,
    onFocus: () -> Unit,
    onClick: () -> Unit,
    onSettings: () -> Unit,
    onSignOut: (() -> Unit)?,
) {
    val size = if (isTelevision) 176.dp else 132.dp
    val avatarDescription = playarrString(
        if (profile.isCurrent) PlayarrString.ProfilesAvatarLabelCurrent else PlayarrString.ProfilesAvatarLabel,
        "name" to profile.displayName,
    )
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(size + 28.dp)) {
        Surface(
            onClick = onClick,
            enabled = enabled,
            modifier = Modifier
                .size(size)
                .scale(if (selected) 1.035f else 1f)
                .then(if (selected) Modifier.border(4.dp, WebPink.copy(alpha = 0.42f), CircleShape) else Modifier)
                .onFocusChanged { if (it.isFocused) onFocus() }
                .semantics { contentDescription = avatarDescription },
            shape = CircleShape,
            color = WebPink,
        ) {
            Box(contentAlignment = Alignment.Center) {
                PlayarrProfileAvatar(
                    userId = profile.id,
                    preference = avatar,
                    modifier = Modifier.fillMaxSize(),
                    glyphSize = if (isTelevision) 68.sp else 50.sp,
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
        Text(profile.displayName, color = WebInk, fontSize = if (isTelevision) 16.sp else 14.sp, fontWeight = FontWeight.Bold, maxLines = 1, modifier = Modifier.padding(top = 13.dp))
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
            fontSize = 8.sp,
            fontWeight = FontWeight.Bold,
        )
        if (selected) Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IconButton(onClick = onSettings, enabled = enabled, modifier = Modifier.background(WebSurfaceStrong, CircleShape)) {
                Icon(
                    Icons.Outlined.Settings,
                    playarrString(PlayarrString.ProfilesSettingsFor, "name" to profile.displayName),
                    tint = WebPink,
                )
            }
            onSignOut?.let { action ->
                OutlinedButton(onClick = action, enabled = enabled) { Text(playarrString(PlayarrString.ProfilesSignOut)) }
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
    val size = if (isTelevision) 176.dp else 132.dp
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(size + 28.dp)) {
        Surface(
            onClick = onClick,
            enabled = enabled,
            modifier = Modifier
                .size(size)
                .scale(if (selected) 1.035f else 1f)
                .then(if (selected) Modifier.border(4.dp, WebPink.copy(alpha = 0.42f), CircleShape) else Modifier)
                .onFocusChanged { if (it.isFocused) onFocus() },
            shape = CircleShape,
            color = WebSurfaceStrong,
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text("+", color = WebPink, fontSize = if (isTelevision) 68.sp else 52.sp, fontWeight = FontWeight.Light)
            }
        }
        Text(
            playarrString(PlayarrString.ProfilesSignIn),
            color = WebInk,
            fontSize = if (isTelevision) 16.sp else 14.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(top = 13.dp),
        )
        Text(
            playarrString(PlayarrString.ProfilesAddAnother).uppercase(LocalPlayarrLanguage.current.locale),
            color = WebInkMuted,
            fontSize = 8.sp,
            fontWeight = FontWeight.Bold,
        )
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
    private val api: StreamarrApi,
    @param:PrimaryStreamarrApi private val primaryApi: StreamarrApi,
    private val tokenStore: TokenStore,
    private val serverConfigStore: ServerConfigStore,
    private val connectedServerSessionManager: ConnectedServerSessionManager,
    private val connectedServerSessionStore: ConnectedServerSessionStore,
    private val knownServerGroupStore: KnownServerGroupStore,
    private val serverClientProvider: PlayarrServerClientProvider,
) : ViewModel() {
    private val _state = MutableStateFlow<ParityLoad<SettingsSnapshot>>(ParityLoad.Loading)
    val state = _state.asStateFlow()
    private val _message = MutableStateFlow<SettingsNotice?>(null)
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
            .onSuccess { serverConfigStore.setBaseUrl(it); tokenStore.clear() }
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
}

@Composable
internal fun ExperienceParitySettingsScreen(
    serverUrl: String,
    isTelevision: Boolean,
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
    var section by remember { mutableStateOf(SettingsSection.Appearance) }
    LaunchedEffect(section) {
        if (section != SettingsSection.Invite) return@LaunchedEffect
        while (true) {
            delay(30_000)
            viewModel.refreshInviteRequest()
        }
    }
    BoxWithConstraints(Modifier.fillMaxSize().background(WebSurface)) {
        val wide = isTelevision || maxWidth >= 760.dp
        Row(Modifier.fillMaxSize()) {
            if (wide) {
                Column(Modifier.width(310.dp).fillMaxHeight().padding(start = 112.dp, top = 90.dp, bottom = 70.dp)) {
                    Text(playarrString(PlayarrString.SettingsTitle), color = WebInk, fontSize = 32.sp, fontWeight = FontWeight.Medium)
                    SettingsSection.entries.forEachIndexed { index, candidate ->
                        Text(
                            "0${index + 1}  ${playarrString(candidate.label)}",
                            color = if (candidate == section) WebInk else WebInkMuted,
                            fontWeight = if (candidate == section) FontWeight.Bold else FontWeight.Normal,
                            modifier = Modifier.fillMaxWidth().clickable { section = candidate }.padding(vertical = 12.dp),
                        )
                    }
                }
            }
            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxHeight().background(Brush.horizontalGradient(listOf(Color.Transparent, WebSurfaceStrong.copy(alpha = 0.88f), WebSurface))),
                contentPadding = PaddingValues(start = if (wide) 48.dp else 16.dp, end = if (wide) 72.dp else 16.dp, top = if (wide) 88.dp else 72.dp, bottom = 110.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                if (!wide) {
                    item { Text(playarrString(PlayarrString.SettingsTitle), color = WebInk, fontSize = 28.sp, fontWeight = FontWeight.Medium) }
                    item {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(SettingsSection.entries) { candidate ->
                                OutlinedButton(onClick = { section = candidate }, enabled = candidate != section) { Text(playarrString(candidate.label)) }
                            }
                        }
                    }
                }
                item {
                    when (val current = state) {
                        ParityLoad.Loading -> Box(Modifier.fillMaxWidth().height(220.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = WebPink) }
                        is ParityLoad.Failed -> ParityFailure(current.message, viewModel::load)
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
                            color = if (notice.success) WebPink else MaterialTheme.colorScheme.error,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.clickable { viewModel.clearMessage() },
                        )
                    }
                }
                item {
                    OutlinedButton(onClick = viewModel::signOut, modifier = Modifier.fillMaxWidth()) {
                        Text(playarrString(PlayarrString.ProfilesSignOut), color = MaterialTheme.colorScheme.error)
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
        else -> null
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
            SettingsSection.Player -> {
                PlayerDefaultHeading(
                    playarrString(PlayarrString.SettingsPlayerQualityTitle),
                    playarrString(PlayarrString.SettingsPlayerQualityDescription),
                )
                OutlinedButton(
                    onClick = {
                        display.setPlayerQuality("original")
                        localNotice = PlayarrString.SettingsPlayerDefaultsSaved
                    },
                    enabled = display.playerDefaults.qualityId != "original",
                ) {
                    Text(
                        "${playarrString(PlayarrString.SettingsQualityOriginal)} · " +
                            playarrString(PlayarrString.SettingsQualityOriginalDetail),
                    )
                }
                playarrQualityTiers.forEach { tier ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.width(62.dp)) {
                            Text(tier.label, color = WebInk, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            Text(tier.resolution, color = WebInkMuted, fontSize = 9.sp)
                        }
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            items(tier.options) { option ->
                                OutlinedButton(
                                    onClick = {
                                        display.setPlayerQuality(option.id)
                                        localNotice = PlayarrString.SettingsPlayerDefaultsSaved
                                    },
                                    enabled = display.playerDefaults.qualityId != option.id,
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
                )
                SettingChoiceOptions(
                    label = playarrString(PlayarrString.SettingsPlayerSubtitlesMode),
                    choices = listOf(
                        PlayarrSubtitleDefault.Off to playarrString(PlayarrString.SettingsPlayerSubtitlesOff),
                        PlayarrSubtitleDefault.Forced to playarrString(PlayarrString.SettingsPlayerSubtitlesForced),
                        PlayarrSubtitleDefault.Always to playarrString(PlayarrString.SettingsPlayerSubtitlesAlways),
                    ),
                    selected = display.playerDefaults.subtitleMode,
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
                    Button(
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
                        OutlinedButton(
                            enabled = !pinBusy,
                            onClick = { viewModel.savePin(null) { pin = "" } },
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
                Text(
                    playarrString(request?.status.playarrInviteStatusKey()),
                    color = WebInkSoft,
                )
                when (request?.status) {
                    InviteRequestStatus.Approved -> Button(
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
                    InviteRequestStatus.Pending -> Button(onClick = {}, enabled = false) {
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
                        Button(
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
        }
        localNotice?.let { notice ->
            Text(
                playarrString(notice),
                color = WebPink,
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
                            color = WebPink,
                            fontSize = 9.sp,
                            fontWeight = FontWeight.ExtraBold,
                        )
                        if (hasKnownServerGroup) {
                            OutlinedButton(
                                onClick = viewModel::forgetKnownServerGroup,
                                enabled = !serverBusy,
                            ) {
                                Text(playarrString(PlayarrString.SettingsServerForget), fontSize = 10.sp)
                            }
                        }
                    }
                } else {
                    OutlinedButton(
                        onClick = { viewModel.disconnectServer(server.serverUrl) },
                        enabled = !serverBusy,
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
    Button(
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
        OutlinedButton(
            onClick = viewModel::testPrimaryConnection,
            enabled = connectionTest != SettingsConnectionTest.Testing,
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
                color = WebPink,
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
    Button(
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
private fun PlayerDefaultHeading(title: String, description: String) {
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
    Text(label, color = WebInkSoft, fontSize = 12.sp)
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(playarrLanguageOptions) { option ->
            OutlinedButton(onClick = { onSelected(option.code) }, enabled = option.code != selected) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(option.label, fontSize = 10.sp)
                    Text(option.code, color = WebInkMuted, fontSize = 8.sp)
                }
            }
        }
    }
}

@Composable
private fun SettingsCard(
    title: String,
    description: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
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
    Text(label, color = WebInkSoft, fontSize = 12.sp)
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(choices) { choice -> OutlinedButton(onClick = { onSelected(choice) }, enabled = choice != selected) { Text(choice) } }
    }
}

@Composable
private fun <T> SettingChoiceOptions(
    label: String,
    choices: List<Pair<T, String>>,
    selected: T,
    onSelected: (T) -> Unit,
) {
    if (label.isNotBlank()) Text(label, color = WebInkSoft, fontSize = 12.sp)
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(choices, key = { it.first.toString() }) { (value, choiceLabel) ->
            OutlinedButton(onClick = { onSelected(value) }, enabled = value != selected) { Text(choiceLabel) }
        }
    }
}

@Composable
private fun ParityLoading(label: String) {
    Box(Modifier.fillMaxSize().background(WebSurface), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            CircularProgressIndicator(color = WebPink)
            Text(label, color = WebInkMuted)
        }
    }
}

@Composable
private fun ParityFailure(message: PlayarrMessage, retry: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text(playarrText(message), color = MaterialTheme.colorScheme.error)
        Button(onClick = retry, modifier = Modifier.padding(top = 14.dp)) {
            Text(playarrString(PlayarrString.CommonTryAgain))
        }
    }
}

@Composable
private fun ParityEmpty(message: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(message, color = WebInkMuted) }
}

private fun Throwable.playarrMessage(subject: PlayarrFailureSubject): PlayarrMessage = when (this) {
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
