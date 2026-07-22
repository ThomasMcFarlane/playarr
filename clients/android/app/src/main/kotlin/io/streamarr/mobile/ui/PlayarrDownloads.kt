package io.streamarr.mobile.ui

import android.os.StatFs
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.DownloadDone
import androidx.compose.material.icons.outlined.Downloading
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Error
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import coil3.compose.AsyncImage
import coil3.network.NetworkHeaders
import coil3.network.httpHeaders
import coil3.request.ImageRequest
import dagger.hilt.android.lifecycle.HiltViewModel
import io.streamarr.shared.data.model.DownloadQualityOption
import io.streamarr.shared.download.DownloadCandidate
import io.streamarr.shared.download.DownloadEntity
import io.streamarr.shared.download.DownloadRepository
import io.streamarr.shared.download.DownloadState
import io.streamarr.shared.download.KeepUntilSelection
import io.streamarr.shared.download.KeepUntilUnit
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.inject.Inject
import kotlin.math.roundToInt
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

// ---- Downloads screen ------------------------------------------------------

@HiltViewModel
internal class DownloadsViewModel @Inject constructor(
    private val downloadRepository: DownloadRepository,
) : ViewModel() {
    val downloads: StateFlow<List<DownloadEntity>> = downloadRepository.observeDownloads()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun togglePauseOrRetry(entry: DownloadEntity) {
        if (entry.state == DownloadState.Downloading || entry.state == DownloadState.Queued) {
            downloadRepository.pause(entry.mediaFileId)
        } else {
            downloadRepository.resume(entry.mediaFileId)
        }
    }

    fun cancel(mediaFileId: String) = downloadRepository.cancel(mediaFileId)

    fun setKeepUntil(mediaFileId: String, keepUntil: KeepUntilSelection) {
        viewModelScope.launch { downloadRepository.setKeepUntil(mediaFileId, keepUntil) }
    }
}

internal enum class PlayarrDownloadGroup(val title: PlayarrString) {
    Active(PlayarrString.DownloadsActiveHeading),
    NeedsAttention(PlayarrString.DownloadsNeedsAttentionHeading),
    Completed(PlayarrString.DownloadsCompletedHeading),
}

internal data class DownloadStorageUsage(
    val usedBytes: Long,
    val quotaBytes: Long,
    val percent: Int,
)

internal fun calculateDownloadStorageUsage(
    downloads: List<DownloadEntity>,
    availableBytes: Long,
): DownloadStorageUsage {
    val usedBytes = downloads.sumOf { it.bytesDownloaded.coerceAtLeast(0L) }
    val quotaBytes = usedBytes + availableBytes.coerceAtLeast(0L)
    val percent = if (quotaBytes > 0L) {
        ((usedBytes.toDouble() / quotaBytes.toDouble()) * 100.0).roundToInt().coerceIn(0, 100)
    } else {
        0
    }
    return DownloadStorageUsage(usedBytes, quotaBytes, percent)
}

internal fun DownloadState.playarrDownloadGroup(): PlayarrDownloadGroup = when (this) {
    DownloadState.Failed -> PlayarrDownloadGroup.NeedsAttention
    DownloadState.Completed -> PlayarrDownloadGroup.Completed
    else -> PlayarrDownloadGroup.Active
}

internal fun DownloadEntity.playarrPlaybackQueueItem(): PlayarrPlaybackQueueItem = PlayarrPlaybackQueueItem(
    mediaFileId = mediaFileId,
    title = title,
    subtitle = workTitle.takeUnless { it == title },
    music = kind == "track",
)

@Composable
internal fun ExperienceDownloadsScreen(
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    isOnline: Boolean,
    onPlay: (DownloadEntity) -> Unit,
    viewModel: DownloadsViewModel = hiltViewModel(),
) {
    val downloads by viewModel.downloads.collectAsState()
    val context = LocalContext.current
    val storageUsage = remember(downloads, context.filesDir) {
        calculateDownloadStorageUsage(
            downloads,
            runCatching { StatFs(context.filesDir.absolutePath).availableBytes }.getOrDefault(0L),
        )
    }
    var keepUntilTarget by remember { mutableStateOf<DownloadEntity?>(null) }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(WebSurface)
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(
                start = if (isTelevision) 72.dp else 16.dp,
                end = if (isTelevision) 72.dp else 16.dp,
                top = if (isTelevision) 40.dp else 24.dp,
            ),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                playarrString(PlayarrString.DownloadsTitle),
                color = WebInk,
                fontSize = if (isTelevision) 44.sp else 30.sp,
                fontWeight = FontWeight.Medium,
                letterSpacing = (-1).sp,
            )
            if (!isOnline) {
                Surface(color = WebPink.copy(alpha = 0.16f), shape = RoundedCornerShape(20.dp)) {
                    Text(
                        playarrString(PlayarrString.DownloadsOffline).uppercase(LocalPlayarrLanguage.current.locale),
                        color = WebPink,
                        fontSize = 9.sp,
                        fontWeight = FontWeight.ExtraBold,
                        letterSpacing = 1.sp,
                        modifier = Modifier.padding(horizontal = 9.dp, vertical = 4.dp),
                    )
                }
            }
        }
        Text(
            playarrString(
                PlayarrString.DownloadsStorageUsed,
                "used" to formatDownloadSize(storageUsage.usedBytes, isEstimate = false),
                "quota" to formatDownloadSize(storageUsage.quotaBytes, isEstimate = false),
            ),
            color = WebInkMuted,
            fontSize = 11.sp,
            modifier = Modifier.padding(top = 6.dp),
        )
        LinearProgressIndicator(
            progress = { storageUsage.percent / 100f },
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp).height(4.dp),
            color = WebPink,
            trackColor = WebSurfaceSoft,
        )
        if (downloads.isEmpty()) {
            ExperienceEmpty(
                playarrString(PlayarrString.DownloadsEmptyTitle),
                playarrString(PlayarrString.DownloadsEmptyDescription),
            )
        } else {
            val grouped = remember(downloads) { downloads.groupBy { it.state.playarrDownloadGroup() } }
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(top = 20.dp),
                contentPadding = PaddingValues(bottom = 104.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                PlayarrDownloadGroup.entries.forEach { group ->
                    val entries = grouped[group].orEmpty()
                    if (entries.isNotEmpty() || group == PlayarrDownloadGroup.Completed) {
                        item(key = "heading-${group.name}") {
                            Text(
                                playarrString(group.title),
                                color = WebInk,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.padding(top = 8.dp),
                            )
                        }
                        if (entries.isEmpty()) {
                            item(key = "empty-${group.name}") {
                                Text(
                                    playarrString(PlayarrString.DownloadsNoCompletedYet),
                                    color = WebInkMuted,
                                    fontSize = 11.sp,
                                )
                            }
                        } else {
                            items(entries, key = DownloadEntity::mediaFileId) { entry ->
                                DownloadListItem(
                                    entry = entry,
                                    serverUrl = serverUrl,
                                    accessToken = accessToken,
                                    onPlay = { onPlay(entry) },
                                    onTogglePauseOrRetry = { viewModel.togglePauseOrRetry(entry) },
                                    onCancel = { viewModel.cancel(entry.mediaFileId) },
                                    onEditKeepUntil = { keepUntilTarget = entry },
                                )
                            }
                        }
                    }
                }
            }
        }
    }
    keepUntilTarget?.let { entry ->
        KeepUntilEditDialog(
            entry = entry,
            onDismiss = { keepUntilTarget = null },
            onConfirm = { selection ->
                viewModel.setKeepUntil(entry.mediaFileId, selection)
                keepUntilTarget = null
            },
        )
    }
}

@Composable
private fun DownloadListItem(
    entry: DownloadEntity,
    serverUrl: String,
    accessToken: String?,
    onPlay: () -> Unit,
    onTogglePauseOrRetry: () -> Unit,
    onCancel: () -> Unit,
    onEditKeepUntil: () -> Unit,
) {
    val language = LocalPlayarrLanguage.current
    val playable = entry.state == DownloadState.Completed
    Surface(
        onClick = onPlay,
        enabled = playable,
        color = WebSurfaceSoft.copy(alpha = 0.72f),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        BoxWithConstraints {
            val compact = maxWidth < 600.dp
            if (compact) {
                Column(Modifier.padding(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        DownloadListArtwork(entry, serverUrl, accessToken)
                        DownloadListCopy(entry, language.locale, Modifier.weight(1f).padding(start = 12.dp))
                    }
                    DownloadListActions(
                        entry,
                        onEditKeepUntil,
                        onTogglePauseOrRetry,
                        onCancel,
                        Modifier.align(Alignment.End),
                    )
                }
            } else {
                Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    DownloadListArtwork(entry, serverUrl, accessToken)
                    DownloadListCopy(entry, language.locale, Modifier.weight(1f).padding(horizontal = 12.dp))
                    DownloadListActions(entry, onEditKeepUntil, onTogglePauseOrRetry, onCancel)
                }
            }
        }
    }
}

@Composable
private fun DownloadListArtwork(entry: DownloadEntity, serverUrl: String, accessToken: String?) {
    DownloadThumbnail(
        posterUrl = entry.posterUrl,
        serverUrl = entry.serverUrl.ifBlank { serverUrl },
        accessToken = accessToken,
        modifier = Modifier.width(58.dp).aspectRatio(2f / 3f).clip(RoundedCornerShape(8.dp)),
    )
}

@Composable
private fun DownloadListCopy(entry: DownloadEntity, locale: Locale, modifier: Modifier = Modifier) {
    Column(modifier) {
        Text(entry.title, color = WebInk, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (entry.workTitle != entry.title) {
            Text(entry.workTitle, color = WebInkMuted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.height(6.dp))
        Text(
            listOfNotNull(downloadTypeLabel(entry.kind), entry.qualityLabel.takeIf(String::isNotBlank)).joinToString(" · "),
            color = WebInkMuted,
            fontSize = 10.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        DownloadStatusLine(entry)
        if (entry.state in setOf(DownloadState.Queued, DownloadState.Downloading, DownloadState.Paused)) {
            val total = entry.totalBytes
            if (total != null && total > 0L) {
                LinearProgressIndicator(
                    progress = { (entry.bytesDownloaded.toFloat() / total.toFloat()).coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxWidth().padding(top = 5.dp).height(4.dp),
                    color = WebPink,
                    trackColor = WebSurfaceSoft,
                )
            } else {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth().padding(top = 5.dp).height(4.dp),
                    color = WebPink,
                    trackColor = WebSurfaceSoft,
                )
            }
        }
        Text(downloadSizeLabel(entry), color = WebInkMuted, fontSize = 10.sp, modifier = Modifier.padding(top = 4.dp))
        Text(
            downloadKeepUntilLabel(entry.keepUntilSelection, locale),
            color = WebInkMuted,
            fontSize = 10.sp,
            modifier = Modifier.padding(top = 2.dp),
        )
    }
}

@Composable
private fun DownloadListActions(
    entry: DownloadEntity,
    onEditKeepUntil: () -> Unit,
    onTogglePauseOrRetry: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(modifier) {
        IconButton(onClick = onEditKeepUntil) {
            Icon(Icons.Outlined.Edit, contentDescription = playarrString(PlayarrString.DownloadsEdit), tint = WebInkMuted)
        }
        if (entry.state != DownloadState.Completed && entry.state != DownloadState.Removing) {
            IconButton(onClick = onTogglePauseOrRetry) {
                val resuming = entry.state == DownloadState.Paused || entry.state == DownloadState.Failed
                Icon(
                    if (resuming) Icons.Outlined.PlayArrow else Icons.Outlined.Pause,
                    contentDescription = playarrString(
                        if (resuming) PlayarrString.DownloadsResume else PlayarrString.DownloadsPause,
                    ),
                    tint = WebInkMuted,
                )
            }
        }
        IconButton(onClick = onCancel) {
            Icon(
                Icons.Outlined.Delete,
                contentDescription = playarrString(
                    if (entry.state in setOf(DownloadState.Queued, DownloadState.Downloading, DownloadState.Paused)) {
                        PlayarrString.DownloadsCancel
                    } else {
                        PlayarrString.DownloadsDelete
                    },
                ),
                tint = WebInkMuted,
            )
        }
    }
}

@Composable
private fun downloadTypeLabel(kind: String): String? = when (kind) {
    "movie" -> playarrString(PlayarrString.DownloadsTypeMovie)
    "episode" -> playarrString(PlayarrString.DownloadsTypeEpisode)
    "track" -> playarrString(PlayarrString.DownloadsTypeTrack)
    "book" -> playarrString(PlayarrString.DownloadsTypeBook)
    else -> null
}

@Composable
private fun downloadSizeLabel(entry: DownloadEntity): String {
    val downloaded = formatDownloadSize(entry.bytesDownloaded, isEstimate = false)
    val total = entry.totalBytes?.let { formatDownloadSize(it, isEstimate = false) }
        ?: playarrString(PlayarrString.DownloadsUnknownSize)
    return if (entry.state in setOf(DownloadState.Queued, DownloadState.Downloading, DownloadState.Paused)) {
        playarrString(PlayarrString.DownloadsBytesOfTotal, "downloaded" to downloaded, "total" to total)
    } else {
        entry.totalBytes?.let { formatDownloadSize(it, isEstimate = false) } ?: downloaded
    }
}

@Composable
private fun DownloadStatusLine(entry: DownloadEntity) {
    val (icon, label) = when (entry.state) {
        DownloadState.Queued -> Icons.Outlined.Schedule to playarrString(PlayarrString.DownloadsStatusQueued)
        DownloadState.Downloading -> Icons.Outlined.Downloading to downloadProgressLabel(entry)
        DownloadState.Paused -> Icons.Outlined.Pause to playarrString(PlayarrString.DownloadsStatusPaused)
        DownloadState.Completed -> Icons.Outlined.DownloadDone to playarrString(PlayarrString.DownloadsStatusReady)
        DownloadState.Failed -> Icons.Outlined.Error to (entry.failureMessage ?: playarrString(PlayarrString.DownloadsStatusFailed))
        DownloadState.Removing -> Icons.Outlined.Delete to playarrString(PlayarrString.DownloadsStatusRemoving)
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = WebInkMuted, modifier = Modifier.size(14.dp))
        Text(label, color = WebInkMuted, fontSize = 11.sp, modifier = Modifier.padding(start = 4.dp))
    }
}

private fun downloadProgressLabel(entry: DownloadEntity): String {
    val total = entry.totalBytes
    return if (total != null && total > 0) {
        "${(entry.bytesDownloaded * 100 / total).coerceIn(0, 100)}%"
    } else {
        formatDownloadSize(entry.bytesDownloaded, isEstimate = false)
    }
}

@Composable
private fun downloadKeepUntilLabel(selection: KeepUntilSelection, locale: Locale): String = when (selection) {
    KeepUntilSelection.Forever -> playarrString(PlayarrString.DownloadsKeepForever)
    is KeepUntilSelection.SpecificDate -> playarrString(
        PlayarrString.DownloadsKeepUntilDate,
        "date" to formatDate(selection.epochMillis, locale),
    )
    is KeepUntilSelection.AfterWatched -> playarrString(
        if (selection.unit == KeepUntilUnit.Weeks) {
            PlayarrString.DownloadsKeepAfterWatchedWeeks
        } else {
            PlayarrString.DownloadsKeepAfterWatchedDays
        },
        "count" to selection.amount,
    )
}

@Composable
private fun DownloadThumbnail(posterUrl: String?, serverUrl: String, accessToken: String?, modifier: Modifier) {
    val context = LocalContext.current
    val serverAccess = rememberPlayarrUrlServerAccess(serverUrl, accessToken)
    val resolved = serverAccess?.let { access -> posterUrl?.let { resolveArtworkUrl(access.serverUrl, it) } }
    if (resolved == null) {
        Box(modifier.background(WebSurfaceSoft))
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
    AsyncImage(model = request, contentDescription = null, contentScale = ContentScale.Crop, modifier = modifier)
}

@Composable
private fun KeepUntilEditDialog(entry: DownloadEntity, onDismiss: () -> Unit, onConfirm: (KeepUntilSelection) -> Unit) {
    var selection by remember(entry.mediaFileId) {
        mutableStateOf<KeepUntilSelection>(
            entry.keepUntilSelection,
        )
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(playarrString(PlayarrString.DownloadsEditKeepUntil, "title" to entry.title))
        },
        text = {
            Box(Modifier.fillMaxWidth().heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                KeepUntilPicker(selection) { selection = it }
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(selection) }) { Text(playarrString(PlayarrString.DownloadsSave)) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(playarrString(PlayarrString.CommonCancel)) }
        },
    )
}

// ---- Quality / Keep-until picker (opened from PlayarrExperience.kt) --------

@HiltViewModel
internal class DownloadOptionsViewModel @Inject constructor(
    private val downloadRepository: DownloadRepository,
) : ViewModel() {
    private val _options = MutableStateFlow<ExperienceLoad<List<DownloadQualityOption>>>(ExperienceLoad.Loading)
    val options = _options.asStateFlow()

    fun load(mediaFileId: String) {
        viewModelScope.launch {
            _options.value = ExperienceLoad.Loading
            _options.value = runCatching { downloadRepository.listQualityOptions(mediaFileId) }
                .fold(
                    onSuccess = { ExperienceLoad.Ready(it) },
                    onFailure = { ExperienceLoad.Failed(PlayarrMessage.Dynamic(it.message.orEmpty())) },
                )
        }
    }

    fun enqueue(
        candidates: List<DownloadCandidate>,
        qualityId: String,
        qualityLabel: String,
        keepUntil: KeepUntilSelection,
        onDone: () -> Unit,
    ) {
        viewModelScope.launch {
            downloadRepository.enqueue(candidates, qualityId, keepUntil, qualityLabel)
            onDone()
        }
    }
}

/**
 * Quality + Keep-until picker, opened from `PlayRow`'s download button, a
 * season/album "download all" header, and `MediaContextDialog`'s Download
 * row. For a multi-file batch, [candidates]' download-options are fetched
 * from only the *first* candidate (see [DownloadOptionsViewModel.load]'s
 * call site below) and the chosen quality is applied to every candidate in
 * [DownloadRepository.enqueue] -- not one options request per candidate.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun DownloadOptionsSheet(
    candidates: List<DownloadCandidate>,
    onDismiss: () -> Unit,
    viewModel: DownloadOptionsViewModel = hiltViewModel(),
) {
    val state by viewModel.options.collectAsState()
    var selectedQualityId by remember(candidates) { mutableStateOf<String?>(null) }
    var keepUntilSelection by remember(candidates) { mutableStateOf<KeepUntilSelection>(KeepUntilSelection.Forever) }
    var enqueuing by remember(candidates) { mutableStateOf(false) }

    LaunchedEffect(candidates) {
        candidates.firstOrNull()?.let { viewModel.load(it.mediaFileId) }
    }

    if (candidates.isEmpty()) {
        // Every child leaf was unavailable (no resolved mediaFileId) --
        // nothing to fetch options for or enqueue; dismiss immediately
        // rather than showing an empty sheet.
        LaunchedEffect(Unit) { onDismiss() }
        return
    }

    val sheetState = rememberModalBottomSheetState()
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 28.dp),
        ) {
            Text(
                playarrString(PlayarrString.DownloadDrawerKicker).uppercase(LocalPlayarrLanguage.current.locale),
                color = WebPink,
                fontSize = 10.sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = 1.2.sp,
            )
            Text(
                if (candidates.size == 1) {
                    playarrString(PlayarrString.DownloadDrawerDialogLabel, "title" to candidates.first().title)
                } else {
                    playarrString(PlayarrString.ContextDownloadCount, "count" to candidates.size)
                },
                color = WebInk,
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(16.dp))
            when (val current = state) {
                ExperienceLoad.Loading -> Column(
                    Modifier.fillMaxWidth().padding(vertical = 24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    CircularProgressIndicator(color = WebPink)
                    Text(playarrString(PlayarrString.DownloadDrawerLoading), color = WebInkMuted)
                }
                is ExperienceLoad.Failed -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(playarrString(PlayarrString.DownloadDrawerLoadError), color = MaterialTheme.colorScheme.error)
                    playarrText(current.message).takeIf(String::isNotBlank)?.let {
                        Text(it, color = WebInkMuted, fontSize = 11.sp)
                    }
                }
                is ExperienceLoad.Ready -> {
                    LaunchedEffect(current.value) {
                        if (selectedQualityId == null) {
                            selectedQualityId = current.value.firstOrNull { it.id == "original" }?.id ?: current.value.firstOrNull()?.id
                        }
                    }
                    if (current.value.isEmpty()) {
                        Text(playarrString(PlayarrString.DownloadDrawerNoPlayable), color = WebInkMuted)
                    } else {
                        Text(
                            playarrString(PlayarrString.DownloadDrawerQuality),
                            color = WebInk,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            current.value.forEach { option ->
                                val baseSizeLabel = option.estimatedSizeBytes
                                    ?.let { formatDownloadSize(it, option.sizeIsEstimate) }
                                    ?: playarrString(PlayarrString.DownloadsUnknownSize)
                                val sizeLabel = if (candidates.size > 1) {
                                    playarrString(
                                        PlayarrString.DownloadDrawerPerItemSize,
                                        "size" to baseSizeLabel,
                                        "count" to candidates.size,
                                    )
                                } else {
                                    baseSizeLabel
                                }
                                Row(
                                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
                                        .clickable { selectedQualityId = option.id }.padding(vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    RadioButton(selected = selectedQualityId == option.id, onClick = { selectedQualityId = option.id })
                                    Column(Modifier.padding(start = 4.dp)) {
                                        Text(option.label, color = WebInk)
                                        Text(sizeLabel, color = WebInkMuted, fontSize = 11.sp)
                                    }
                                }
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                        KeepUntilPicker(keepUntilSelection) { keepUntilSelection = it }
                        Spacer(Modifier.height(20.dp))
                        Button(
                            onClick = {
                                val qualityId = selectedQualityId ?: return@Button
                                val qualityLabel = current.value.first { it.id == qualityId }.label
                                enqueuing = true
                                viewModel.enqueue(candidates, qualityId, qualityLabel, keepUntilSelection, onDismiss)
                            },
                            enabled = selectedQualityId != null && !enqueuing,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                playarrString(
                                    if (enqueuing) PlayarrString.DownloadDrawerStarting else PlayarrString.DownloadDrawerDownload,
                                ),
                            )
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun KeepUntilPicker(selection: KeepUntilSelection, onSelectionChange: (KeepUntilSelection) -> Unit) {
    var showDatePicker by remember { mutableStateOf(false) }
    var afterWatchedAmount by remember {
        mutableStateOf((selection as? KeepUntilSelection.AfterWatched)?.amount?.toString() ?: DEFAULT_AFTER_WATCHED_AMOUNT.toString())
    }
    val language = LocalPlayarrLanguage.current
    val afterWatched = selection as? KeepUntilSelection.AfterWatched
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            playarrString(PlayarrString.DownloadDrawerKeepUntil),
            color = WebInk,
            fontWeight = FontWeight.SemiBold,
            fontSize = 13.sp,
            modifier = Modifier.padding(bottom = 4.dp),
        )
        KeepUntilChoiceRow(
            playarrString(PlayarrString.DownloadDrawerForever),
            selection == KeepUntilSelection.Forever,
        ) { onSelectionChange(KeepUntilSelection.Forever) }
        val dateLabel = (selection as? KeepUntilSelection.SpecificDate)?.let {
            playarrString(
                PlayarrString.DownloadsKeepUntilDate,
                "date" to formatDate(it.epochMillis, language.locale),
            )
        } ?: playarrString(PlayarrString.DownloadDrawerOnDate)
        KeepUntilChoiceRow(
            dateLabel,
            selection is KeepUntilSelection.SpecificDate,
        ) { showDatePicker = true }
        KeepUntilChoiceRow(
            playarrString(PlayarrString.DownloadDrawerAfterWatched),
            afterWatched != null,
        ) {
            onSelectionChange(
                KeepUntilSelection.AfterWatched(
                    afterWatchedAmount.toIntOrNull()?.coerceAtLeast(1) ?: DEFAULT_AFTER_WATCHED_AMOUNT,
                    afterWatched?.unit ?: KeepUntilUnit.Days,
                ),
            )
        }
        if (afterWatched != null) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 48.dp, top = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    value = afterWatchedAmount,
                    onValueChange = { value ->
                        val digits = value.filter(Char::isDigit)
                        afterWatchedAmount = digits
                        digits.toIntOrNull()?.takeIf { it > 0 }?.let { amount ->
                            onSelectionChange(KeepUntilSelection.AfterWatched(amount, afterWatched.unit))
                        }
                    },
                    label = { Text(playarrString(PlayarrString.DownloadDrawerAmount)) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.width(104.dp),
                )
                KeepUntilUnitButton(
                    label = playarrString(PlayarrString.DownloadDrawerDays),
                    selected = afterWatched.unit == KeepUntilUnit.Days,
                ) {
                    onSelectionChange(
                        KeepUntilSelection.AfterWatched(
                            afterWatchedAmount.toIntOrNull()?.coerceAtLeast(1) ?: DEFAULT_AFTER_WATCHED_AMOUNT,
                            KeepUntilUnit.Days,
                        ),
                    )
                }
                KeepUntilUnitButton(
                    label = playarrString(PlayarrString.DownloadDrawerWeeks),
                    selected = afterWatched.unit == KeepUntilUnit.Weeks,
                ) {
                    onSelectionChange(
                        KeepUntilSelection.AfterWatched(
                            afterWatchedAmount.toIntOrNull()?.coerceAtLeast(1) ?: DEFAULT_AFTER_WATCHED_AMOUNT,
                            KeepUntilUnit.Weeks,
                        ),
                    )
                }
            }
            Text(
                playarrString(PlayarrString.DownloadDrawerAfterWatchedHint),
                color = WebInkMuted,
                fontSize = 10.sp,
                modifier = Modifier.padding(start = 48.dp, top = 4.dp),
            )
        }
    }
    if (showDatePicker) {
        val initialDate = (selection as? KeepUntilSelection.SpecificDate)?.epochMillis
            ?: System.currentTimeMillis() + DEFAULT_KEEP_UNTIL_DAYS * MILLIS_PER_DAY
        val datePickerState = rememberDatePickerState(initialSelectedDateMillis = initialDate)
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    datePickerState.selectedDateMillis?.let { onSelectionChange(KeepUntilSelection.SpecificDate(it)) }
                    showDatePicker = false
                }) { Text(playarrString(PlayarrString.DownloadsSave)) }
            },
            dismissButton = {
                TextButton(onClick = { showDatePicker = false }) { Text(playarrString(PlayarrString.CommonCancel)) }
            },
        ) { DatePicker(state = datePickerState) }
    }
}

@Composable
private fun KeepUntilUnitButton(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        color = if (selected) WebPink else WebSurfaceSoft,
        contentColor = if (selected) Color.White else WebInk,
        shape = RoundedCornerShape(8.dp),
    ) {
        Text(label, modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp), fontSize = 11.sp)
    }
}

@Composable
private fun KeepUntilChoiceRow(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable(onClick = onClick).padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = onClick)
        Text(label, color = WebInk, modifier = Modifier.padding(start = 4.dp))
    }
}

private fun formatDate(epochMillis: Long, locale: Locale): String =
    SimpleDateFormat("d MMM yyyy", locale).format(Date(epochMillis))

private fun formatDownloadSize(bytes: Long, isEstimate: Boolean): String {
    val prefix = if (isEstimate) "~" else ""
    val gb = bytes / 1_000_000_000.0
    return if (gb >= 1) {
        "$prefix${"%.1f".format(Locale.ROOT, gb)} GB"
    } else {
        "$prefix${(bytes / 1_000_000).coerceAtLeast(if (bytes > 0) 1 else 0)} MB"
    }
}

private const val DEFAULT_AFTER_WATCHED_AMOUNT = 30
private const val DEFAULT_KEEP_UNTIL_DAYS = 30L
private const val MILLIS_PER_DAY = 24L * 60L * 60L * 1000L
