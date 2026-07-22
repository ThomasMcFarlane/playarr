package io.streamarr.mobile.ui

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
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.PlaylistPlay
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavHostController
import dagger.hilt.android.lifecycle.HiltViewModel
import io.streamarr.mobile.BuildConfig
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
import io.streamarr.shared.data.model.Playlist
import io.streamarr.shared.data.model.PlaylistItem
import io.streamarr.shared.data.model.PlaylistMediaType
import io.streamarr.shared.data.model.ProfileAvatarKind
import io.streamarr.shared.data.model.ProfileAvatarPreference
import io.streamarr.shared.data.model.ProfileAvatarSetting
import io.streamarr.shared.data.model.ProfilePinSetting
import io.streamarr.shared.data.model.ReorderPlaylistItemsRequest
import io.streamarr.shared.data.model.UpdatePlayerPreferencesRequest
import io.streamarr.shared.data.model.UpdateProfileAvatarRequest
import io.streamarr.shared.data.model.UpdateProfilePinRequest
import io.streamarr.shared.data.model.UserInvite
import io.streamarr.shared.data.model.UserInviteRequest
import io.streamarr.shared.data.model.WorkChildren
import io.streamarr.shared.data.model.WorkDetail
import io.streamarr.shared.data.remote.StreamarrApi
import java.util.Locale
import javax.inject.Inject
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

internal sealed interface ParityLoad<out T> {
    data object Loading : ParityLoad<Nothing>
    data class Ready<T>(val value: T) : ParityLoad<T>
    data class Failed(val message: String) : ParityLoad<Nothing>
}

@HiltViewModel
internal class PlaylistsViewModel @Inject constructor(
    private val api: StreamarrApi,
) : ViewModel() {
    private val _playlists = MutableStateFlow<ParityLoad<List<Playlist>>>(ParityLoad.Loading)
    val playlists = _playlists.asStateFlow()

    init { load() }

    fun load() = viewModelScope.launch {
        _playlists.value = ParityLoad.Loading
        _playlists.value = runCatching { api.listPlaylists() }
            .fold({ ParityLoad.Ready(it) }, { ParityLoad.Failed(it.playarrMessage("playlists")) })
    }

    fun create(name: String, mediaType: PlaylistMediaType) = viewModelScope.launch {
        runCatching { api.createPlaylist(CreatePlaylistRequest(name.trim(), mediaType)) }
            .onSuccess { load() }
            .onFailure { _playlists.value = ParityLoad.Failed(it.playarrMessage("playlist")) }
    }
}

@HiltViewModel
internal class PlaylistActionsViewModel @Inject constructor(private val api: StreamarrApi) : ViewModel() {
    private val _playlists = MutableStateFlow<ParityLoad<List<Playlist>>>(ParityLoad.Loading)
    val playlists = _playlists.asStateFlow()
    private val _message = MutableStateFlow<String?>(null)
    val message = _message.asStateFlow()

    fun load(mediaType: PlaylistMediaType) = viewModelScope.launch {
        _playlists.value = runCatching { api.listPlaylists().filter { !it.isSystem && it.mediaType == mediaType } }
            .fold({ ParityLoad.Ready(it) }, { ParityLoad.Failed(it.playarrMessage("playlists")) })
    }

    fun add(playlistId: String, workId: String, trackId: String?, onAdded: () -> Unit) = viewModelScope.launch {
        runCatching { api.addPlaylistItem(playlistId, AddPlaylistItemRequest(workId, trackId)) }
            .onSuccess { _message.value = "Added to playlist"; onAdded() }
            .onFailure { _message.value = it.playarrMessage("playlist") }
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
        title = { Text("Add to playlist") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                when (val current = state) {
                    ParityLoad.Loading -> CircularProgressIndicator(color = WebPink)
                    is ParityLoad.Failed -> Text(current.message, color = MaterialTheme.colorScheme.error)
                    is ParityLoad.Ready -> if (current.value.isEmpty()) Text("Create a personal playlist first.") else current.value.forEach { playlist ->
                        Surface(onClick = { viewModel.add(playlist.id, workId, trackId, onDismiss) }, color = WebSurfaceSoft, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                            Text(playlist.name, modifier = Modifier.padding(14.dp), color = WebInk)
                        }
                    }
                }
                message?.let { Text(it, color = WebPink) }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } },
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
    var ownerFilter by remember { mutableStateOf("all") }
    var typeFilter by remember { mutableStateOf("all") }
    var name by remember { mutableStateOf("") }
    var mediaType by remember { mutableStateOf(PlaylistMediaType.Video) }
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
                Text("Playlists", color = WebInk, fontSize = if (isTelevision) 38.sp else 28.sp, fontWeight = FontWeight.Medium)
                Text("Personal and shared collections", color = WebInkMuted, fontSize = 11.sp)
            }
            when (val current = state) {
                ParityLoad.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = WebPink) }
                is ParityLoad.Failed -> ParityFailure(current.message, viewModel::load)
                is ParityLoad.Ready -> if (current.value.isEmpty()) {
                    ParityEmpty("Create your first playlist.")
                } else {
                    val visible = current.value.filter { playlist ->
                        (ownerFilter == "all" || (ownerFilter == "system") == playlist.isSystem) &&
                            (typeFilter == "all" || playlist.mediaType.name.equals(typeFilter, ignoreCase = true))
                    }
                    LazyVerticalGrid(
                        columns = GridCells.Adaptive(if (isTelevision) 230.dp else 160.dp),
                        modifier = Modifier.fillMaxSize().padding(top = 28.dp),
                        contentPadding = PaddingValues(bottom = 32.dp),
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                        verticalArrangement = Arrangement.spacedBy(18.dp),
                    ) {
                        items(visible, key = Playlist::id) { playlist ->
                            PlaylistCard(playlist) { navController.navigate("playlists/${playlist.id}") }
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
                Box(contentAlignment = Alignment.Center) { Icon(Icons.Outlined.Add, contentDescription = "Create playlist", tint = WebInk) }
            }
            Surface(onClick = { filtering = true }, color = WebSurfaceStrong, shape = RoundedCornerShape(14.dp), modifier = Modifier.size(44.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(Icons.Outlined.FilterList, contentDescription = "Filter playlists", tint = WebInk) }
            }
        }
    }
    if (creating) {
        AlertDialog(
            onDismissRequest = { creating = false },
            title = { Text("Create playlist") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(name, { name = it }, label = { Text("Name") }, singleLine = true)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(PlaylistMediaType.Video to "Video", PlaylistMediaType.Audio to "Music").forEach { (type, label) ->
                            OutlinedButton(onClick = { mediaType = type }, enabled = mediaType != type) { Text(label) }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = name.isNotBlank(),
                    onClick = { viewModel.create(name, mediaType); name = ""; creating = false },
                ) { Text("Create") }
            },
            dismissButton = { TextButton(onClick = { creating = false }) { Text("Cancel") } },
        )
    }
    if (filtering) {
        AlertDialog(
            onDismissRequest = { filtering = false },
            title = { Text("Playlist filters") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    SettingChoices("Visibility", listOf("all", "personal", "system"), ownerFilter) { ownerFilter = it }
                    SettingChoices("Media type", listOf("all", "video", "audio"), typeFilter) { typeFilter = it }
                }
            },
            confirmButton = { TextButton(onClick = { filtering = false }) { Text("Done") } },
        )
    }
}

@Composable
internal fun PlaylistCard(playlist: Playlist, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().aspectRatio(1.45f).scale(if (focused) 1.04f else 1f).onFocusChanged { focused = it.isFocused },
        color = WebSurfaceStrong,
        shape = RoundedCornerShape(18.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, if (focused) WebInkSoft else WebInkMuted.copy(alpha = 0.18f)),
    ) {
        Box(Modifier.background(Brush.linearGradient(listOf(WebPink.copy(alpha = 0.22f), WebSurfaceStrong)))) {
            Icon(Icons.Outlined.PlaylistPlay, contentDescription = null, tint = WebPink, modifier = Modifier.align(Alignment.TopEnd).padding(18.dp).size(38.dp))
            Column(Modifier.align(Alignment.BottomStart).padding(18.dp)) {
                Text(playlist.name, color = WebInk, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(if (playlist.isSystem) "SYSTEM" else playlist.mediaType.name.uppercase(), color = WebInkMuted, fontSize = 9.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

internal data class ResolvedPlaylist(
    val playlist: Playlist,
    val items: List<PlaylistItem>,
    val details: Map<String, WorkDetail>,
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
                val playlist = async { api.getPlaylist(id) }
                val items = api.listPlaylistItems(id)
                val details = items.distinctBy(PlaylistItem::workId).map { item ->
                    async { item.workId to api.getWork(item.workId) }
                }.awaitAll().toMap()
                ResolvedPlaylist(playlist.await(), items, details)
            }
        }.fold({ ParityLoad.Ready(it) }, { ParityLoad.Failed(it.playarrMessage("playlist")) })
    }

    fun remove(itemId: String) = mutate { current ->
        api.removePlaylistItem(current.playlist.id, itemId)
        refresh(current.playlist.id)
    }

    fun move(itemId: String, delta: Int) = mutate { current ->
        val order = current.items.map(PlaylistItem::id).toMutableList()
        val from = order.indexOf(itemId)
        val to = (from + delta).coerceIn(0, order.lastIndex)
        if (from >= 0 && from != to) {
            order.add(to, order.removeAt(from))
            api.reorderPlaylistItems(current.playlist.id, ReorderPlaylistItemsRequest(order))
            refresh(current.playlist.id)
        }
    }

    fun delete(onDeleted: () -> Unit) = mutate { current ->
        api.deletePlaylist(current.playlist.id)
        onDeleted()
    }

    private fun mutate(block: suspend (ResolvedPlaylist) -> Unit) = viewModelScope.launch {
        val current = (_state.value as? ParityLoad.Ready)?.value ?: return@launch
        runCatching { block(current) }
            .onFailure { _state.value = ParityLoad.Failed(it.playarrMessage("playlist")) }
    }
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
    LaunchedEffect(playlistId) { viewModel.load(playlistId) }
    when (val current = state) {
        ParityLoad.Loading -> ParityLoading("Loading playlist")
        is ParityLoad.Failed -> ParityFailure(current.message) { viewModel.load(playlistId) }
        is ParityLoad.Ready -> {
            val value = current.value
            val orderedItems = remember(value) {
                value.items.mapNotNull { item -> value.details[item.workId]?.playarrPlaybackQueueItem(item) }
            }
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
                        IconButton(onClick = onBack) { Icon(Icons.Outlined.ArrowBack, "Back", tint = WebInk) }
                        Column(Modifier.weight(1f).padding(start = 8.dp)) {
                            Text(value.playlist.name, color = WebInk, fontSize = if (isTelevision) 34.sp else 25.sp, fontWeight = FontWeight.Medium)
                            Text("${value.items.size} items", color = WebInkMuted, fontSize = 10.sp)
                        }
                        if (!value.playlist.isSystem) {
                            IconButton(onClick = { viewModel.delete(onBack) }) { Icon(Icons.Outlined.Delete, "Delete playlist", tint = MaterialTheme.colorScheme.error) }
                        }
                    }
                    if (value.items.isEmpty()) {
                        ParityEmpty("This playlist is empty.")
                    } else {
                        LazyColumn(Modifier.fillMaxSize().padding(top = 22.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            items(value.items, key = PlaylistItem::id) { item ->
                                val detail = value.details[item.workId]
                                val mediaFileId = detail?.mediaFileFor(item)
                                Surface(
                                    onClick = { onOpenWork(item.workId) },
                                    color = WebSurfaceStrong,
                                    shape = RoundedCornerShape(14.dp),
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
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
                                            Text(detail?.work?.title ?: "Unavailable title", color = WebInk, fontWeight = FontWeight.SemiBold)
                                            Text("Item ${item.position + 1}", color = WebInkMuted, fontSize = 10.sp)
                                        }
                                        if (mediaFileId != null) {
                                            IconButton(onClick = { onPlay(mediaFileId, orderedItems, null, null) }) {
                                                Icon(Icons.Outlined.PlayArrow, "Play", tint = WebPink)
                                            }
                                        }
                                        if (!value.playlist.isSystem) {
                                            IconButton(onClick = { viewModel.move(item.id, -1) }) { Icon(Icons.Outlined.ArrowUpward, "Move up", tint = WebInkMuted) }
                                            IconButton(onClick = { viewModel.move(item.id, 1) }) { Icon(Icons.Outlined.ArrowDownward, "Move down", tint = WebInkMuted) }
                                            IconButton(onClick = { viewModel.remove(item.id) }) { Icon(Icons.Outlined.Delete, "Remove", tint = WebInkMuted) }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun WorkDetail.mediaFileFor(item: PlaylistItem): String? = when (val tree = children) {
    WorkChildren.Movie -> mediaFileId
    is WorkChildren.Series -> tree.seasons.flatMap { it.episodes }.firstOrNull { it.episode.id == item.trackId || item.trackId == null }?.mediaFileId
    is WorkChildren.Artist -> tree.albums.flatMap { it.tracks }.firstOrNull { it.track.id == item.trackId }?.mediaFileId
    is WorkChildren.Author -> tree.books.firstOrNull { it.book.id == item.trackId || item.trackId == null }?.mediaFileId
}

@HiltViewModel
internal class ProfilesViewModel @Inject constructor(
    private val api: StreamarrApi,
    private val loginApi: LoginApi,
    private val tokenStore: TokenStore,
) : ViewModel() {
    private val _state = MutableStateFlow<ParityLoad<List<AvailableProfile>>>(ParityLoad.Loading)
    val state = _state.asStateFlow()
    private val _switching = MutableStateFlow(false)
    val switching = _switching.asStateFlow()

    init { load() }

    fun load() = viewModelScope.launch {
        _state.value = runCatching { api.listAvailableProfiles() }
            .fold({ ParityLoad.Ready(it) }, { ParityLoad.Failed(it.playarrMessage("profiles")) })
    }

    fun switch(profile: AvailableProfile, pin: String?, isTelevision: Boolean, onSuccess: () -> Unit) = viewModelScope.launch {
        _switching.value = true
        runCatching {
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
            tokenStore.save(response.toTokenResponse())
            tokenStore.saveIdentity(response.userId, profile.displayName)
        }.onSuccess { onSuccess() }
            .onFailure { _state.value = ParityLoad.Failed(it.playarrMessage("profile")) }
        _switching.value = false
    }

    fun signOut() = viewModelScope.launch { tokenStore.clear() }
}

@Composable
internal fun ExperienceProfilesScreen(
    isTelevision: Boolean,
    currentUserId: String,
    currentAvatar: ProfileAvatarPreference?,
    onHome: () -> Unit,
    onSettings: () -> Unit,
    viewModel: ProfilesViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val switching by viewModel.switching.collectAsState()
    var selectedId by remember { mutableStateOf<String?>(null) }
    var pinProfile by remember { mutableStateOf<AvailableProfile?>(null) }
    var pin by remember { mutableStateOf("") }
    Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(WebSurface, WebBackground)))) {
        when (val current = state) {
            ParityLoad.Loading -> ParityLoading("Loading profiles")
            is ParityLoad.Failed -> ParityFailure(current.message, viewModel::load)
            is ParityLoad.Ready -> {
                LaunchedEffect(current.value) { selectedId = current.value.firstOrNull { it.isCurrent }?.id ?: current.value.firstOrNull()?.id }
                Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("PROFILES", color = WebPink, fontSize = 10.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.4.sp, modifier = Modifier.padding(top = if (isTelevision) 90.dp else 110.dp))
                    Text("Who’s watching?", color = WebInk, fontSize = if (isTelevision) 54.sp else 38.sp, fontWeight = FontWeight.Medium, letterSpacing = (-2).sp)
                    LazyRow(
                        modifier = Modifier.fillMaxWidth().padding(top = if (isTelevision) 80.dp else 50.dp),
                        horizontalArrangement = Arrangement.spacedBy(if (isTelevision) 38.dp else 22.dp),
                        contentPadding = PaddingValues(horizontal = if (isTelevision) 120.dp else 34.dp),
                    ) {
                        items(current.value, key = AvailableProfile::id) { profile ->
                            ProfileChoice(
                                profile = profile,
                                avatar = if (profile.id == currentUserId) currentAvatar else null,
                                selected = selectedId == profile.id,
                                isTelevision = isTelevision,
                                switching = switching,
                                onFocus = { selectedId = profile.id },
                                onClick = {
                                    selectedId = profile.id
                                    when {
                                        profile.isCurrent -> onHome()
                                        profile.pinLocked -> pinProfile = profile
                                        else -> viewModel.switch(profile, null, isTelevision, onHome)
                                    }
                                },
                                onSettings = onSettings,
                                onSignOut = viewModel::signOut,
                            )
                        }
                    }
                }
            }
        }
    }
    pinProfile?.let { profile ->
        AlertDialog(
            onDismissRequest = { pinProfile = null; pin = "" },
            title = { Text("Enter profile PIN") },
            text = { OutlinedTextField(pin, { if (it.length <= 4 && it.all(Char::isDigit)) pin = it }, label = { Text("4-digit PIN") }, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), singleLine = true) },
            confirmButton = { TextButton(enabled = pin.length == 4, onClick = { viewModel.switch(profile, pin, isTelevision, onHome); pinProfile = null; pin = "" }) { Text("Continue") } },
            dismissButton = { TextButton(onClick = { pinProfile = null; pin = "" }) { Text("Cancel") } },
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
    onFocus: () -> Unit,
    onClick: () -> Unit,
    onSettings: () -> Unit,
    onSignOut: () -> Unit,
) {
    val size = if (isTelevision) 176.dp else 132.dp
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(size + 28.dp).onFocusChanged { if (it.isFocused) onFocus() }.focusable()) {
        Surface(
            onClick = onClick,
            enabled = !switching,
            modifier = Modifier
                .size(size)
                .scale(if (selected) 1.035f else 1f)
                .then(if (selected) Modifier.border(4.dp, WebPink.copy(alpha = 0.42f), CircleShape) else Modifier)
                .semantics { contentDescription = profile.displayName },
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
                if (profile.pinLocked) Icon(Icons.Outlined.Lock, contentDescription = "PIN required", tint = Color.White, modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp).size(22.dp))
            }
        }
        Text(profile.displayName, color = WebInk, fontSize = if (isTelevision) 16.sp else 14.sp, fontWeight = FontWeight.Bold, maxLines = 1, modifier = Modifier.padding(top = 13.dp))
        Text(if (profile.isCurrent) "CURRENT PROFILE" else if (profile.pinLocked) "PIN REQUIRED" else "READY", color = WebInkMuted, fontSize = 8.sp, fontWeight = FontWeight.Bold)
        if (selected) Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IconButton(onClick = onSettings, modifier = Modifier.background(WebSurfaceStrong, CircleShape)) { Icon(Icons.Outlined.Settings, "Settings", tint = WebPink) }
            OutlinedButton(onClick = onSignOut) { Text("Sign out") }
        }
    }
}

internal data class SettingsSnapshot(
    val player: PlayerPreferences,
    val pin: ProfilePinSetting,
    val avatar: ProfileAvatarSetting,
    val inviteRequest: UserInviteRequest?,
)

@HiltViewModel
internal class ParitySettingsViewModel @Inject constructor(
    private val api: StreamarrApi,
    private val tokenStore: TokenStore,
    private val serverConfigStore: ServerConfigStore,
) : ViewModel() {
    private val _state = MutableStateFlow<ParityLoad<SettingsSnapshot>>(ParityLoad.Loading)
    val state = _state.asStateFlow()
    private val _message = MutableStateFlow<String?>(null)
    val message = _message.asStateFlow()
    private val _invite = MutableStateFlow<UserInvite?>(null)
    val invite = _invite.asStateFlow()

    init { load() }

    fun load() = viewModelScope.launch {
        _state.value = runCatching {
            coroutineScope {
                SettingsSnapshot(
                    async { api.getPlayerPreferences() }.await(),
                    async { api.getProfilePinSetting() }.await(),
                    async { api.getProfileAvatar() }.await(),
                    async { api.getMyUserInviteRequest().value }.await(),
                )
            }
        }.fold({ ParityLoad.Ready(it) }, { ParityLoad.Failed(it.playarrMessage("settings")) })
    }

    fun savePlayerLanguage(language: String) = update("Player settings saved") { api.updatePlayerPreferences(UpdatePlayerPreferencesRequest(language)) }
    fun savePin(pin: String?) = update("Profile lock saved") { api.updateProfilePinSetting(UpdateProfilePinRequest(pin)) }
    fun saveAvatar(preset: String) = update("Profile avatar saved") { api.updateProfileAvatar(UpdateProfileAvatarRequest(ProfileAvatarPreference(ProfileAvatarKind.Preset, preset))) }
    fun requestInvite(message: String) = update("Invitation request sent") { api.createUserInviteRequest(CreateUserInviteRequest(message.ifBlank { null })) }
    fun generateInvite() = viewModelScope.launch {
        runCatching { api.generateApprovedUserInvite() }.onSuccess { _invite.value = it; _message.value = "Invitation generated" }.onFailure { _message.value = it.playarrMessage("invitation") }
    }
    fun changeServer(value: String) = viewModelScope.launch {
        runCatching { normaliseServerUrl(value) }.onSuccess { serverConfigStore.setBaseUrl(it); tokenStore.clear() }.onFailure { _message.value = "Enter a valid HTTP or HTTPS server URL." }
    }
    fun signOut() = viewModelScope.launch { tokenStore.clear() }
    fun clearMessage() { _message.value = null }

    private fun update(success: String, block: suspend () -> Any) = viewModelScope.launch {
        runCatching { block() }.onSuccess { _message.value = success; load() }.onFailure { _message.value = it.playarrMessage("settings") }
    }
}

private enum class SettingsSection(val label: String) {
    Appearance("Appearance"), Avatar("Profile avatar"), Language("Language"), Player("Player"), Server("Server"), Lock("Profile lock"), Invite("Invite a friend"),
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
    var section by remember { mutableStateOf(SettingsSection.Appearance) }
    BoxWithConstraints(Modifier.fillMaxSize().background(WebSurface)) {
        val wide = isTelevision || maxWidth >= 760.dp
        Row(Modifier.fillMaxSize()) {
            if (wide) {
                Column(Modifier.width(310.dp).fillMaxHeight().padding(start = 112.dp, top = 90.dp, bottom = 70.dp)) {
                    Text("Profile", color = WebInk, fontSize = 32.sp, fontWeight = FontWeight.Medium)
                    SettingsSection.entries.forEachIndexed { index, candidate ->
                        Text(
                            "0${index + 1}  ${candidate.label}",
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
                    item { Text("Profile", color = WebInk, fontSize = 28.sp, fontWeight = FontWeight.Medium) }
                    item {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(SettingsSection.entries) { candidate ->
                                OutlinedButton(onClick = { section = candidate }, enabled = candidate != section) { Text(candidate.label) }
                            }
                        }
                    }
                }
                item {
                    when (val current = state) {
                        ParityLoad.Loading -> Box(Modifier.fillMaxWidth().height(220.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = WebPink) }
                        is ParityLoad.Failed -> ParityFailure(current.message, viewModel::load)
                        is ParityLoad.Ready -> SettingsSectionContent(section, current.value, serverUrl, invite, viewModel)
                    }
                }
                message?.let { item { Text(it, color = if (it.contains("saved") || it.contains("sent") || it.contains("generated")) WebPink else MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold, modifier = Modifier.clickable { viewModel.clearMessage() }) } }
                item { OutlinedButton(onClick = viewModel::signOut, modifier = Modifier.fillMaxWidth()) { Text("Sign out", color = MaterialTheme.colorScheme.error) } }
            }
        }
    }
}

@Composable
private fun SettingsSectionContent(
    section: SettingsSection,
    snapshot: SettingsSnapshot,
    serverUrl: String,
    invite: UserInvite?,
    viewModel: ParitySettingsViewModel,
) {
    val display = LocalPlayarrDisplayPreferences.current
    SettingsCard(section.label) {
        when (section) {
            SettingsSection.Appearance -> {
                SettingChoices(
                    "Colour theme",
                    PlayarrThemePreference.entries.map(PlayarrThemePreference::name),
                    display.theme.name,
                ) { display.setTheme(PlayarrThemePreference.valueOf(it)) }
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Home screen artwork", color = WebInkSoft, fontSize = 12.sp)
                    Text(
                        "Show portrait covers instead of wide media thumbnails on the home screen.",
                        color = WebInkMuted,
                        fontSize = 11.sp,
                    )
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(listOf("Thumbnails", "Covers")) { choice ->
                            val selected = if (display.homeView == PlayarrHomeViewPreference.Cover) {
                                choice == "Covers"
                            } else {
                                choice == "Thumbnails"
                            }
                            OutlinedButton(
                                onClick = {
                                    display.setHomeView(
                                        if (choice == "Covers") {
                                            PlayarrHomeViewPreference.Cover
                                        } else {
                                            PlayarrHomeViewPreference.Thumbnail
                                        },
                                    )
                                },
                                enabled = !selected,
                            ) { Text(choice) }
                        }
                    }
                }
            }
            SettingsSection.Avatar -> {
                Text("Choose an avatar", color = WebInkSoft, fontSize = 12.sp)
                LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(playarrProfileAvatarPresetIds) { preset ->
                        val selected = snapshot.avatar.preference?.let {
                            it.kind == ProfileAvatarKind.Preset && it.value == preset
                        } == true
                        Surface(
                            onClick = { viewModel.saveAvatar(preset) },
                            modifier = Modifier
                                .size(76.dp)
                                .then(if (selected) Modifier.border(3.dp, WebPink, CircleShape) else Modifier)
                                .semantics { contentDescription = "$preset avatar" },
                            shape = CircleShape,
                            color = Color.Transparent,
                        ) {
                            PlayarrProfileAvatar(
                                userId = preset,
                                preference = ProfileAvatarPreference(ProfileAvatarKind.Preset, preset),
                                modifier = Modifier.fillMaxSize(),
                                glyphSize = 31.sp,
                            )
                        }
                    }
                }
            }
            SettingsSection.Language -> SettingChoices(
                "App language",
                listOf("System", "English", "ไทย", "日本語"),
                mapOf("system" to "System", "en" to "English", "th" to "ไทย", "ja" to "日本語")[display.language],
            ) { selected ->
                display.setLanguage(mapOf("System" to "system", "English" to "en", "ไทย" to "th", "日本語" to "ja").getValue(selected))
            }
            SettingsSection.Player -> {
                PlayerDefaultHeading(
                    "Default quality",
                    "Start playback at this quality when the server can provide it.",
                )
                OutlinedButton(
                    onClick = { display.setPlayerQuality("original") },
                    enabled = display.playerDefaults.qualityId != "original",
                ) { Text("Original · Best available source") }
                playarrQualityTiers.forEach { tier ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.width(62.dp)) {
                            Text(tier.label, color = WebInk, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            Text(tier.resolution, color = WebInkMuted, fontSize = 9.sp)
                        }
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            items(tier.options) { option ->
                                OutlinedButton(
                                    onClick = { display.setPlayerQuality(option.id) },
                                    enabled = display.playerDefaults.qualityId != option.id,
                                ) { Text("${option.bitrateMbps} Mbps\n${option.level}", fontSize = 9.sp) }
                            }
                        }
                    }
                }
                PlayerDefaultHeading(
                    "Default subtitles",
                    "Keep subtitles off, show forced dialogue only, or turn them on automatically.",
                )
                SettingChoices(
                    "Mode",
                    listOf("Off", "Forced only", "Always on"),
                    when (display.playerDefaults.subtitleMode) {
                        PlayarrSubtitleDefault.Off -> "Off"
                        PlayarrSubtitleDefault.Forced -> "Forced only"
                        PlayarrSubtitleDefault.Always -> "Always on"
                    },
                ) { choice ->
                    display.setSubtitleMode(
                        when (choice) {
                            "Forced only" -> PlayarrSubtitleDefault.Forced
                            "Always on" -> PlayarrSubtitleDefault.Always
                            else -> PlayarrSubtitleDefault.Off
                        },
                    )
                }
                if (display.playerDefaults.subtitleMode != PlayarrSubtitleDefault.Off) {
                    PlayerLanguageChoices(
                        "Default subtitle language",
                        display.playerDefaults.subtitleLanguage,
                        display.setSubtitleLanguage,
                    )
                }
                PlayerDefaultHeading(
                    "Default audio track",
                    "Prefer this audio language whenever a matching track is available.",
                )
                PlayerLanguageChoices(
                    "Default audio track language",
                    snapshot.player.preferredAudioLanguage.takeIf { saved ->
                        playarrLanguageOptions.any { option -> option.code == saved }
                    } ?: "en",
                    viewModel::savePlayerLanguage,
                )
                Text(
                    "Quality and subtitle defaults are saved on this device. Audio language follows your profile.",
                    color = WebInkMuted,
                    fontSize = 10.sp,
                )
            }
            SettingsSection.Server -> {
                var value by remember(serverUrl) { mutableStateOf(serverUrl) }
                OutlinedTextField(value, { value = it }, label = { Text("Server URL") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Button(onClick = { viewModel.changeServer(value) }) { Text("Save server") }
                Text("Changing server returns you to sign-in. This device always connects directly to the selected Streamarr server.", color = WebInkMuted, fontSize = 11.sp)
            }
            SettingsSection.Lock -> {
                var pin by remember { mutableStateOf("") }
                Text(if (snapshot.pin.pinLocked) "This profile is protected." else "No profile PIN is set.", color = WebInkSoft)
                OutlinedTextField(pin, { if (it.length <= 4 && it.all(Char::isDigit)) pin = it }, label = { Text("New 4-digit PIN") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), singleLine = true)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(enabled = pin.length == 4, onClick = { viewModel.savePin(pin) }) { Text("Set PIN") }
                    OutlinedButton(enabled = snapshot.pin.pinLocked, onClick = { viewModel.savePin(null) }) { Text("Remove PIN") }
                }
            }
            SettingsSection.Invite -> {
                var requestMessage by remember { mutableStateOf("") }
                val request = snapshot.inviteRequest
                Text(request?.status?.name?.replace('_', ' ')?.uppercase(Locale.getDefault()) ?: "NO REQUEST", color = WebPink, fontWeight = FontWeight.Bold)
                when (request?.status) {
                    InviteRequestStatus.Approved -> Button(onClick = viewModel::generateInvite) { Text("Generate invitation") }
                    InviteRequestStatus.Pending -> Text("Your request is waiting for approval.", color = WebInkSoft)
                    else -> {
                        OutlinedTextField(requestMessage, { requestMessage = it }, label = { Text("Optional message") }, modifier = Modifier.fillMaxWidth())
                        Button(onClick = { viewModel.requestInvite(requestMessage) }) { Text("Request invitation") }
                    }
                }
                invite?.let { Text("https://playarr.app/signup?invite=${it.inviteToken}&server=${serverUrl}", color = WebInk, fontSize = 11.sp) }
            }
        }
    }
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
private fun SettingsCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Surface(color = WebSurfaceStrong, shape = RoundedCornerShape(18.dp), border = androidx.compose.foundation.BorderStroke(1.dp, WebInkMuted.copy(alpha = 0.2f)), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(title, color = WebInk, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
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
private fun ParityLoading(label: String) {
    Box(Modifier.fillMaxSize().background(WebSurface), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            CircularProgressIndicator(color = WebPink)
            Text(label, color = WebInkMuted)
        }
    }
}

@Composable
private fun ParityFailure(message: String, retry: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text(message, color = MaterialTheme.colorScheme.error)
        Button(onClick = retry, modifier = Modifier.padding(top = 14.dp)) { Text("Try again") }
    }
}

@Composable
private fun ParityEmpty(message: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(message, color = WebInkMuted) }
}

private fun Throwable.playarrMessage(subject: String): String = when (this) {
    is retrofit2.HttpException -> when (code()) {
        401 -> "Your session has expired. Sign in again."
        403 -> "This profile cannot access $subject."
        404 -> "That $subject could not be found."
        else -> "The server returned error ${code()}."
    }
    else -> message ?: "Couldn’t load $subject."
}
