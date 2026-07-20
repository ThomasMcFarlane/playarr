package io.streamarr.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.DownloadDone
import androidx.compose.material.icons.outlined.Downloading
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
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
import io.streamarr.shared.download.resolveEpochMillis
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.inject.Inject
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

    fun setKeepUntil(mediaFileId: String, keepUntilEpochMillis: Long?) {
        viewModelScope.launch { downloadRepository.setKeepUntil(mediaFileId, keepUntilEpochMillis) }
    }
}

@Composable
internal fun ExperienceDownloadsScreen(
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    viewModel: DownloadsViewModel = hiltViewModel(),
) {
    val downloads by viewModel.downloads.collectAsState()
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
        Text("Downloads", color = WebInk, fontSize = if (isTelevision) 44.sp else 30.sp, fontWeight = FontWeight.Medium, letterSpacing = (-1).sp)
        if (downloads.isEmpty()) {
            ExperienceEmpty("Nothing downloaded yet. Use the download icon on any title to save it for offline playback.")
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(top = 20.dp),
                contentPadding = PaddingValues(bottom = 104.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(downloads, key = DownloadEntity::mediaFileId) { entry ->
                    DownloadListItem(
                        entry = entry,
                        serverUrl = serverUrl,
                        accessToken = accessToken,
                        onTogglePauseOrRetry = { viewModel.togglePauseOrRetry(entry) },
                        onCancel = { viewModel.cancel(entry.mediaFileId) },
                        onEditKeepUntil = { keepUntilTarget = entry },
                    )
                }
            }
        }
    }
    keepUntilTarget?.let { entry ->
        KeepUntilEditDialog(
            entry = entry,
            onDismiss = { keepUntilTarget = null },
            onConfirm = { selection ->
                viewModel.setKeepUntil(entry.mediaFileId, selection.resolveEpochMillis())
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
    onTogglePauseOrRetry: () -> Unit,
    onCancel: () -> Unit,
    onEditKeepUntil: () -> Unit,
) {
    Surface(color = WebSurfaceSoft.copy(alpha = 0.72f), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            DownloadThumbnail(
                posterUrl = entry.posterUrl,
                serverUrl = serverUrl,
                accessToken = accessToken,
                modifier = Modifier.width(58.dp).aspectRatio(2f / 3f).clip(RoundedCornerShape(8.dp)),
            )
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(entry.title, color = WebInk, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (entry.workTitle != entry.title) {
                    Text(entry.workTitle, color = WebInkMuted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Spacer(Modifier.height(6.dp))
                DownloadStatusLine(entry)
                Text(
                    entry.keepUntilEpochMillis?.let { "Keep until ${formatDate(it)}" } ?: "Keep forever",
                    color = WebInkMuted,
                    fontSize = 10.sp,
                    modifier = Modifier.padding(top = 4.dp).clickable(onClick = onEditKeepUntil),
                )
            }
            if (entry.state != DownloadState.Completed && entry.state != DownloadState.Removing) {
                IconButton(onClick = onTogglePauseOrRetry) {
                    val resuming = entry.state == DownloadState.Paused || entry.state == DownloadState.Failed
                    Icon(
                        if (resuming) Icons.Outlined.PlayArrow else Icons.Outlined.Pause,
                        contentDescription = if (resuming) "Resume" else "Pause",
                        tint = WebInkMuted,
                    )
                }
            }
            IconButton(onClick = onCancel) {
                Icon(Icons.Outlined.Delete, contentDescription = "Remove download", tint = WebInkMuted)
            }
        }
    }
}

@Composable
private fun DownloadStatusLine(entry: DownloadEntity) {
    val (icon, label) = when (entry.state) {
        DownloadState.Queued -> Icons.Outlined.Schedule to "Queued"
        DownloadState.Downloading -> Icons.Outlined.Downloading to downloadProgressLabel(entry)
        DownloadState.Paused -> Icons.Outlined.Pause to "Paused"
        DownloadState.Completed -> Icons.Outlined.DownloadDone to "Downloaded"
        DownloadState.Failed -> Icons.Outlined.Error to (entry.failureMessage ?: "Failed")
        DownloadState.Removing -> Icons.Outlined.Delete to "Removing…"
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
private fun DownloadThumbnail(posterUrl: String?, serverUrl: String, accessToken: String?, modifier: Modifier) {
    val context = LocalContext.current
    val resolved = posterUrl?.let { resolveArtworkUrl(serverUrl, it) }
    if (resolved == null) {
        Box(modifier.background(WebSurfaceSoft))
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
    AsyncImage(model = request, contentDescription = null, contentScale = ContentScale.Crop, modifier = modifier)
}

@Composable
private fun KeepUntilEditDialog(entry: DownloadEntity, onDismiss: () -> Unit, onConfirm: (KeepUntilSelection) -> Unit) {
    var selection by remember(entry.mediaFileId) {
        mutableStateOf<KeepUntilSelection>(
            entry.keepUntilEpochMillis?.let { KeepUntilSelection.SpecificDate(it) } ?: KeepUntilSelection.Forever,
        )
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Keep until") },
        text = { KeepUntilPicker(selection) { selection = it } },
        confirmButton = { TextButton(onClick = { onConfirm(selection) }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
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
                    onFailure = { ExperienceLoad.Failed(it.message ?: "Could not load download qualities.") },
                )
        }
    }

    fun enqueue(candidates: List<DownloadCandidate>, qualityId: String, keepUntilEpochMillis: Long?, onDone: () -> Unit) {
        viewModelScope.launch {
            downloadRepository.enqueue(candidates, qualityId, keepUntilEpochMillis)
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
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 28.dp)) {
            Text(
                if (candidates.size == 1) "Download “${candidates.first().title}”" else "Download ${candidates.size} items",
                color = WebInk,
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(16.dp))
            when (val current = state) {
                ExperienceLoad.Loading -> Box(Modifier.fillMaxWidth().padding(vertical = 24.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = WebPink)
                }
                is ExperienceLoad.Failed -> Text(current.message, color = MaterialTheme.colorScheme.error)
                is ExperienceLoad.Ready -> {
                    LaunchedEffect(current.value) {
                        if (selectedQualityId == null) {
                            selectedQualityId = current.value.firstOrNull { it.id == "original" }?.id ?: current.value.firstOrNull()?.id
                        }
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        current.value.forEach { option ->
                            val sizeLabel = option.estimatedSizeBytes
                                ?.let { formatDownloadSize(it, option.sizeIsEstimate) }
                                ?: "Unknown size"
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
                            enqueuing = true
                            viewModel.enqueue(candidates, qualityId, keepUntilSelection.resolveEpochMillis(), onDismiss)
                        },
                        enabled = selectedQualityId != null && !enqueuing,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(if (enqueuing) "Starting…" else "Download") }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun KeepUntilPicker(selection: KeepUntilSelection, onSelectionChange: (KeepUntilSelection) -> Unit) {
    var showDatePicker by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text("Keep until", color = WebInk, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, modifier = Modifier.padding(bottom = 4.dp))
        KeepUntilChoiceRow("Forever", selection == KeepUntilSelection.Forever) { onSelectionChange(KeepUntilSelection.Forever) }
        KeepUntilChoiceRow(
            "30 days after watched",
            selection is KeepUntilSelection.AfterWatched && selection.amount == 30 && selection.unit == KeepUntilUnit.Days,
        ) { onSelectionChange(KeepUntilSelection.AfterWatched(30, KeepUntilUnit.Days)) }
        KeepUntilChoiceRow(
            "2 weeks after watched",
            selection is KeepUntilSelection.AfterWatched && selection.amount == 2 && selection.unit == KeepUntilUnit.Weeks,
        ) { onSelectionChange(KeepUntilSelection.AfterWatched(2, KeepUntilUnit.Weeks)) }
        val specificDateLabel = (selection as? KeepUntilSelection.SpecificDate)?.let { "Until ${formatDate(it.epochMillis)}" } ?: "Specific date…"
        KeepUntilChoiceRow(specificDateLabel, selection is KeepUntilSelection.SpecificDate) { showDatePicker = true }
    }
    if (showDatePicker) {
        val datePickerState = rememberDatePickerState(initialSelectedDateMillis = System.currentTimeMillis())
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    datePickerState.selectedDateMillis?.let { onSelectionChange(KeepUntilSelection.SpecificDate(it)) }
                    showDatePicker = false
                }) { Text("Set") }
            },
            dismissButton = { TextButton(onClick = { showDatePicker = false }) { Text("Cancel") } },
        ) { DatePicker(state = datePickerState) }
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

private fun formatDate(epochMillis: Long): String =
    SimpleDateFormat("d MMM yyyy", Locale.getDefault()).format(Date(epochMillis))

private fun formatDownloadSize(bytes: Long, isEstimate: Boolean): String {
    val prefix = if (isEstimate) "~" else ""
    val gb = bytes / 1_000_000_000.0
    return if (gb >= 1) {
        "$prefix${"%.1f".format(gb)} GB"
    } else {
        "$prefix${(bytes / 1_000_000).coerceAtLeast(if (bytes > 0) 1 else 0)} MB"
    }
}
