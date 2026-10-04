package io.playarr.mobile.ui

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import io.playarr.shared.data.model.UserDataExportJob
import io.playarr.shared.data.model.UserDataExportStatus
import io.playarr.shared.data.model.UserDataImportPreview
import io.playarr.shared.data.model.UserDataImportResult
import io.playarr.shared.data.model.UserDataProgressConflicts
import io.playarr.shared.data.remote.PlayarrApi
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

/** Largest package the server accepts; larger files are refused before upload. */
internal const val USER_DATA_MAX_IMPORT_BYTES = 50 * 1024 * 1024

internal data class YourDataState(
    val exportJob: UserDataExportJob? = null,
    val exportBusy: Boolean = false,
    val exportError: PlayarrMessage? = null,
    val fileName: String? = null,
    val includePreferences: Boolean = false,
    val conflicts: UserDataProgressConflicts = UserDataProgressConflicts.Newest,
    val preview: UserDataImportPreview? = null,
    val result: UserDataImportResult? = null,
    val importBusy: Boolean = false,
    val importError: PlayarrMessage? = null,
    val notice: PlayarrString? = null,
) {
    val exportRunning: Boolean
        get() = exportJob?.status == UserDataExportStatus.Queued ||
            exportJob?.status == UserDataExportStatus.Running
    val canPreview: Boolean get() = fileName != null && !importBusy
    val canApply: Boolean get() = preview != null && result == null && !importBusy
}

/** Reads at most [USER_DATA_MAX_IMPORT_BYTES] + 1 bytes; `null` when the file is larger. */
internal fun readBoundedBytes(stream: java.io.InputStream, limit: Int = USER_DATA_MAX_IMPORT_BYTES): ByteArray? {
    val out = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(64 * 1024)
    var total = 0
    while (true) {
        val read = stream.read(buffer)
        if (read < 0) break
        total += read
        if (total > limit) return null
        out.write(buffer, 0, read)
    }
    return out.toByteArray()
}

@HiltViewModel
internal class YourDataViewModel @Inject constructor(
    private val api: PlayarrApi,
    @param:ApplicationContext private val context: Context,
) : ViewModel() {
    private val _state = MutableStateFlow(YourDataState())
    val state: StateFlow<YourDataState> = _state.asStateFlow()
    private var pollJob: Job? = null
    private var packageBytes: ByteArray? = null

    fun startExport() {
        if (_state.value.exportBusy || _state.value.exportRunning) return
        pollJob?.cancel()
        _state.update { it.copy(exportBusy = true, exportError = null, notice = null) }
        pollJob = viewModelScope.launch {
            try {
                var job = api.startUserDataExport()
                _state.update { it.copy(exportJob = job, exportBusy = false) }
                while (job.status == UserDataExportStatus.Queued || job.status == UserDataExportStatus.Running) {
                    delay(800)
                    job = api.getUserDataExport(job.id)
                    _state.update { it.copy(exportJob = job) }
                }
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (failure: Throwable) {
                _state.update { it.copy(exportBusy = false, exportError = failure.yourDataMessage()) }
            }
        }
    }

    /** Streams the ready export into the document the user chose. */
    fun saveExport(destination: Uri) {
        val job = _state.value.exportJob ?: return
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    api.downloadUserDataExport(job.id).use { body ->
                        context.contentResolver.openOutputStream(destination, "w")?.use { out ->
                            body.byteStream().use { input -> input.copyTo(out) }
                        } ?: error("could not open the destination file")
                    }
                }
            }.onSuccess {
                _state.update { it.copy(notice = PlayarrString.YourDataSaved, exportError = null) }
            }.onFailure { failure ->
                _state.update { it.copy(exportError = failure.yourDataMessage()) }
            }
        }
    }

    fun chooseFile(uri: Uri) {
        viewModelScope.launch {
            val loaded = runCatching {
                withContext(Dispatchers.IO) {
                    val name = context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                        val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (column >= 0 && cursor.moveToFirst()) cursor.getString(column) else null
                    }
                    val bytes = context.contentResolver.openInputStream(uri)?.use { readBoundedBytes(it) }
                    name to bytes
                }
            }
            loaded.onSuccess { (name, bytes) ->
                if (bytes == null) {
                    packageBytes = null
                    _state.update {
                        it.copy(
                            fileName = null,
                            preview = null,
                            result = null,
                            importError = PlayarrMessage.Localized(PlayarrString.YourDataFileTooLarge),
                        )
                    }
                } else {
                    packageBytes = bytes
                    _state.update {
                        it.copy(
                            fileName = name ?: "playarr-user-data.zip",
                            preview = null,
                            result = null,
                            importError = null,
                        )
                    }
                }
            }.onFailure {
                _state.update { state ->
                    state.copy(importError = PlayarrMessage.Localized(PlayarrString.YourDataFileUnreadable))
                }
            }
        }
    }

    fun setIncludePreferences(value: Boolean) =
        _state.update { it.copy(includePreferences = value, preview = null, result = null) }

    fun setConflicts(value: UserDataProgressConflicts) =
        _state.update { it.copy(conflicts = value, preview = null, result = null) }

    fun preview() {
        val bytes = packageBytes ?: return
        val current = _state.value
        if (current.importBusy) return
        _state.update { it.copy(importBusy = true, importError = null, result = null) }
        viewModelScope.launch {
            runCatching {
                api.previewUserDataImport(
                    bytes.toRequestBody(ZIP_MEDIA_TYPE),
                    current.includePreferences,
                    current.conflicts.wire,
                )
            }.onSuccess { preview ->
                _state.update { it.copy(preview = preview, importBusy = false) }
            }.onFailure { failure ->
                _state.update { it.copy(preview = null, importBusy = false, importError = failure.yourDataMessage()) }
            }
        }
    }

    fun apply() {
        val bytes = packageBytes ?: return
        val current = _state.value
        val preview = current.preview ?: return
        if (current.importBusy || current.result != null) return
        _state.update { it.copy(importBusy = true, importError = null) }
        viewModelScope.launch {
            runCatching {
                api.applyUserDataImport(
                    bytes.toRequestBody(ZIP_MEDIA_TYPE),
                    preview.packageSha256,
                    current.includePreferences,
                    current.conflicts.wire,
                )
            }.onSuccess { result ->
                _state.update {
                    it.copy(
                        result = result,
                        importBusy = false,
                        notice = if (result.completed) PlayarrString.YourDataImported else null,
                    )
                }
            }.onFailure { failure ->
                _state.update { it.copy(importBusy = false, importError = failure.yourDataMessage()) }
            }
        }
    }

    fun saveUnmatched(destination: Uri) {
        val bytes = packageBytes ?: return
        val conflicts = _state.value.conflicts
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    api.downloadUnmatchedUserData(bytes.toRequestBody(ZIP_MEDIA_TYPE), conflicts.wire).use { body ->
                        context.contentResolver.openOutputStream(destination, "w")?.use { out ->
                            body.byteStream().use { input -> input.copyTo(out) }
                        } ?: error("could not open the destination file")
                    }
                }
            }.onFailure { failure ->
                _state.update { it.copy(importError = failure.yourDataMessage()) }
            }
        }
    }

    fun clearNotice() = _state.update { it.copy(notice = null) }

    override fun onCleared() {
        packageBytes = null
        super.onCleared()
    }

    private companion object {
        val ZIP_MEDIA_TYPE = "application/zip".toMediaType()
    }
}

internal fun Throwable.yourDataMessage(): PlayarrMessage = playarrMessage(PlayarrFailureSubject.YourData)

/** Name proposed in the system "save" dialog for an export. */
internal fun userDataExportFileName(isoDate: String): String = "playarr-user-data-$isoDate.zip"

@Composable
internal fun PlayarrYourDataSection(isTelevision: Boolean, viewModel: YourDataViewModel = hiltViewModel()) {
    if (isTelevision) {
        // Android TV has no usable document picker; say so instead of offering a dead control.
        Text(playarrString(PlayarrString.YourDataUnavailableOnTv), color = WebInkMuted, fontSize = 12.sp)
        return
    }
    val state by viewModel.state.collectAsState()
    val saveExport = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/zip"),
    ) { uri -> uri?.let(viewModel::saveExport) }
    val saveUnmatched = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/zip"),
    ) { uri -> uri?.let(viewModel::saveUnmatched) }
    val chooseFile = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri -> uri?.let(viewModel::chooseFile) }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(playarrString(PlayarrString.YourDataExportTitle), color = WebInk, fontWeight = FontWeight.SemiBold)
        Text(playarrString(PlayarrString.YourDataExportDescription), color = WebInkMuted, fontSize = 11.sp)
        Text(playarrString(PlayarrString.YourDataScopeNote), color = WebInkMuted, fontSize = 11.sp)
        Button(onClick = viewModel::startExport, enabled = !state.exportBusy && !state.exportRunning) {
            Text(
                playarrString(
                    if (state.exportRunning) PlayarrString.YourDataExportPreparing
                    else PlayarrString.YourDataExportStart,
                ),
            )
        }
        state.exportJob?.let { job ->
            Text(exportStatusText(job), color = WebInkSoft, fontSize = 12.sp)
            if (job.status == UserDataExportStatus.Ready) {
                OutlinedButton(
                    onClick = { saveExport.launch(userDataExportFileName(job.createdAt.take(10))) },
                ) { Text(playarrString(PlayarrString.YourDataExportSave)) }
            }
        }
        state.exportError?.let { ErrorLine(playarrText(it)) }

        Text(playarrString(PlayarrString.YourDataImportTitle), color = WebInk, fontWeight = FontWeight.SemiBold)
        Text(playarrString(PlayarrString.YourDataImportDescription), color = WebInkMuted, fontSize = 11.sp)
        OutlinedButton(
            onClick = { chooseFile.launch(arrayOf("application/zip", "application/x-zip-compressed", "application/octet-stream")) },
        ) {
            Text(
                state.fileName?.let { playarrString(PlayarrString.YourDataFileChosen, "name" to it) }
                    ?: playarrString(PlayarrString.YourDataChooseFile),
            )
        }
        ConflictChoices(state.conflicts, viewModel::setConflicts)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = state.includePreferences, onCheckedChange = viewModel::setIncludePreferences)
            Text(playarrString(PlayarrString.YourDataIncludePreferences), color = WebInkSoft, fontSize = 12.sp)
        }
        OutlinedButton(onClick = viewModel::preview, enabled = state.canPreview) {
            Text(playarrString(PlayarrString.YourDataPreviewButton))
        }
        state.importError?.let { ErrorLine(playarrText(it)) }
        state.preview?.let { preview ->
            PreviewSummary(preview)
            Text(playarrString(PlayarrString.YourDataConfirmNote), color = WebInkMuted, fontSize = 11.sp)
            Button(onClick = viewModel::apply, enabled = state.canApply) {
                Text(playarrString(PlayarrString.YourDataApplyButton))
            }
        }
        state.result?.let { result ->
            Text(
                if (result.completed) {
                    playarrString(
                        PlayarrString.YourDataResultDone,
                        "added" to (result.progressAdded + result.progressUpdated),
                        "items" to result.playlistItemsAdded,
                    )
                } else {
                    playarrString(PlayarrString.YourDataResultFailed, "failure" to result.failure.orEmpty())
                },
                color = if (result.completed) WebInkSoft else MaterialTheme.colorScheme.error,
                fontSize = 12.sp,
            )
            if (result.unmatchedTotal > 0) {
                OutlinedButton(onClick = { saveUnmatched.launch("playarr-unmatched.zip") }) {
                    Text(playarrString(PlayarrString.YourDataSaveUnmatched, "count" to result.unmatchedTotal))
                }
            }
        }
        state.notice?.let {
            Text(playarrString(it), color = WebPink, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun ErrorLine(text: String) {
    Text(text, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
}

@Composable
private fun exportStatusText(job: UserDataExportJob): String = when (job.status) {
    UserDataExportStatus.Ready -> playarrString(
        PlayarrString.YourDataExportReady,
        "watch" to job.counts.watchProgress,
        "playlists" to job.counts.playlists,
    )
    UserDataExportStatus.Failed -> playarrString(PlayarrString.YourDataExportFailed)
    UserDataExportStatus.Expired -> playarrString(PlayarrString.YourDataExportExpired)
    else -> playarrString(PlayarrString.YourDataExportProgress, "stage" to job.progress.stage)
}

@Composable
private fun ConflictChoices(
    selected: UserDataProgressConflicts,
    onSelected: (UserDataProgressConflicts) -> Unit,
) {
    Text(playarrString(PlayarrString.YourDataConflictsLabel), color = WebInkSoft, fontSize = 12.sp)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(
            UserDataProgressConflicts.Newest to PlayarrString.YourDataConflictsNewest,
            UserDataProgressConflicts.KeepExisting to PlayarrString.YourDataConflictsKeep,
        ).forEach { (choice, label) ->
            OutlinedButton(onClick = { onSelected(choice) }, enabled = choice != selected) {
                Text(playarrString(label), fontSize = 11.sp)
            }
        }
    }
}

@Composable
private fun ColumnScope.PreviewSummary(preview: UserDataImportPreview) {
    val summary = preview.summary
    Text(playarrString(PlayarrString.YourDataPreviewTitle), color = WebInk, fontWeight = FontWeight.SemiBold)
    preview.warnings.forEach { Text(it, color = WebInkMuted, fontSize = 11.sp) }
    Text(
        playarrString(
            PlayarrString.YourDataPreviewProgress,
            "add" to summary.watchProgress.willAdd,
            "update" to summary.watchProgress.willUpdate,
            "same" to summary.watchProgress.alreadyPresent,
            "kept" to summary.watchProgress.conflictsKept,
        ),
        color = WebInkSoft,
        fontSize = 12.sp,
        modifier = Modifier.fillMaxWidth(),
    )
    Text(
        playarrString(
            PlayarrString.YourDataPreviewPlaylists,
            "created" to summary.playlists.new,
            "items" to summary.playlists.itemsToAdd,
            "present" to summary.playlists.itemsAlreadyPresent,
        ),
        color = WebInkSoft,
        fontSize = 12.sp,
    )
    summary.watchlist?.let { watchlist ->
        Text(
            playarrString(
                PlayarrString.YourDataPreviewWatchlist,
                "add" to watchlist.willAdd,
                "same" to watchlist.alreadyPresent,
                "unmatched" to watchlist.unmatched,
            ),
            color = WebInkSoft,
            fontSize = 12.sp,
        )
    }
    Text(
        playarrString(
            PlayarrString.YourDataPreviewUnmatched,
            "unmatched" to summary.unmatchedTotal,
            "ambiguous" to summary.watchProgress.ambiguous,
        ),
        color = WebInkSoft,
        fontSize = 12.sp,
    )
    summary.preferredAudioLanguageChange?.let {
        Text(playarrString(PlayarrString.YourDataPreviewLanguage, "language" to it), color = WebInkSoft, fontSize = 12.sp)
    }
    if (summary.playbackPreferencesNotApplied > 0) {
        Text(
            playarrString(PlayarrString.YourDataPreviewPlaybackChoices, "count" to summary.playbackPreferencesNotApplied),
            color = WebInkMuted,
            fontSize = 11.sp,
        )
    }
}
