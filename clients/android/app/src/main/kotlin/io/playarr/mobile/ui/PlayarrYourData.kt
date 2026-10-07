package io.playarr.mobile.ui

import io.playarr.shared.designsystem.component.PlayarrButton
import io.playarr.shared.designsystem.component.PlayarrButtonSize
import io.playarr.shared.designsystem.component.PlayarrButtonVariant
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
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.layout
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.Dp
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
import io.playarr.shared.data.model.UserDataImportSession
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
import retrofit2.HttpException

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
    /** Television: the absolute one-time download link for the ready export. */
    val exportLinkUrl: String? = null,
    val exportLinkExpiresAt: String? = null,
    val exportLinkBusy: Boolean = false,
    /** Television: the open import session and its absolute one-time upload link. */
    val session: UserDataImportSession? = null,
    val uploadUrl: String? = null,
    val sessionBusy: Boolean = false,
    val sessionExpired: Boolean = false,
) {
    val exportRunning: Boolean
        get() = exportJob?.status == UserDataExportStatus.Queued ||
            exportJob?.status == UserDataExportStatus.Running
    val canPreview: Boolean get() = fileName != null && !importBusy
    val canPreviewSession: Boolean get() = session?.isUploaded == true && !importBusy
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
    private var sessionJob: Job? = null

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

    /** Television: asks the server for a one-time link to download the ready export on another device. */
    fun showExportLink() {
        val job = _state.value.exportJob ?: return
        if (_state.value.exportLinkBusy) return
        _state.update { it.copy(exportLinkBusy = true, exportError = null) }
        viewModelScope.launch {
            runCatching {
                val link = api.createUserDataTransferLink(job.id)
                check(link.url.isNotBlank()) { "the server returned no transfer link" }
                link
            }.onSuccess { link ->
                _state.update {
                    it.copy(exportLinkUrl = link.url, exportLinkExpiresAt = link.expiresAt, exportLinkBusy = false)
                }
            }.onFailure { failure ->
                _state.update { it.copy(exportLinkBusy = false, exportError = failure.yourDataMessage()) }
            }
        }
    }

    /**
     * Television: opens an import session, shows its upload link, then polls until the other
     * device has uploaded (or the session runs out) and previews what arrived.
     */
    fun startSession() {
        if (_state.value.sessionBusy || _state.value.session?.status == "uploading") return
        sessionJob?.cancel()
        _state.update {
            it.copy(sessionBusy = true, sessionExpired = false, preview = null, result = null, importError = null)
        }
        sessionJob = viewModelScope.launch {
            try {
                val created = api.createUserDataImportSession()
                check(!created.uploadUrl.isNullOrBlank()) { "the server returned no upload link" }
                _state.update { it.copy(session = created, uploadUrl = created.uploadUrl, sessionBusy = false) }
                while (true) {
                    delay(SESSION_POLL_MILLIS)
                    val next = try {
                        api.getUserDataImportSession(created.id)
                    } catch (failure: HttpException) {
                        if (failure.code() == 404 || failure.code() == 410) {
                            _state.update { it.copy(sessionExpired = true, uploadUrl = null) }
                            return@launch
                        }
                        throw failure
                    }
                    _state.update { it.copy(session = next) }
                    if (next.isUploaded) {
                        previewSession(created.id)
                        return@launch
                    }
                }
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (failure: Throwable) {
                _state.update {
                    it.copy(sessionBusy = false, session = null, uploadUrl = null, importError = failure.yourDataMessage())
                }
            }
        }
    }

    fun cancelSession() {
        sessionJob?.cancel()
        val id = _state.value.session?.id
        _state.update {
            it.copy(session = null, uploadUrl = null, preview = null, result = null, sessionExpired = false, sessionBusy = false)
        }
        if (id != null) {
            // The session may already have expired; nothing is left to close then.
            viewModelScope.launch { runCatching { api.deleteUserDataImportSession(id) } }
        }
    }

    private suspend fun previewSession(id: String) {
        val current = _state.value
        _state.update { it.copy(importBusy = true, importError = null, result = null) }
        runCatching {
            api.previewUserDataImportSession(id, current.includePreferences, current.conflicts.wire)
        }.onSuccess { preview ->
            _state.update { it.copy(preview = preview, importBusy = false) }
        }.onFailure { failure ->
            if (failure is CancellationException) throw failure
            _state.update { it.copy(preview = null, importBusy = false, importError = failure.yourDataMessage()) }
        }
    }

    fun preview() {
        val current = _state.value
        if (current.importBusy) return
        current.session?.let { session ->
            if (session.isUploaded) viewModelScope.launch { previewSession(session.id) }
            return
        }
        val bytes = packageBytes ?: return
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
        val current = _state.value
        val session = current.session
        val bytes = packageBytes
        if (session == null && bytes == null) return
        val preview = current.preview ?: return
        if (current.importBusy || current.result != null) return
        _state.update { it.copy(importBusy = true, importError = null) }
        viewModelScope.launch {
            runCatching {
                if (session != null) {
                    api.applyUserDataImportSession(
                        session.id,
                        preview.packageSha256,
                        current.includePreferences,
                        current.conflicts.wire,
                    )
                } else {
                    api.applyUserDataImport(
                        bytes!!.toRequestBody(ZIP_MEDIA_TYPE),
                        preview.packageSha256,
                        current.includePreferences,
                        current.conflicts.wire,
                    )
                }
            }.onSuccess { result ->
                _state.update {
                    it.copy(
                        result = result,
                        importBusy = false,
                        // The server closes the session once everything applied.
                        session = if (session != null && result.completed) null else it.session,
                        uploadUrl = if (session != null && result.completed) null else it.uploadUrl,
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
        const val SESSION_POLL_MILLIS = 2_000L
        val ZIP_MEDIA_TYPE = "application/zip".toMediaType()
    }
}

internal fun Throwable.yourDataMessage(): PlayarrMessage = playarrMessage(PlayarrFailureSubject.YourData)

/** Name proposed in the system "save" dialog for an export. */
internal fun userDataExportFileName(isoDate: String): String = "playarr-user-data-$isoDate.zip"

@Composable
internal fun PlayarrYourDataSection(isTelevision: Boolean, viewModel: YourDataViewModel = hiltViewModel()) {
    if (isTelevision) {
        // Android TV has no usable document picker: move the package through a phone or computer.
        YourDataTelevision(viewModel)
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
        PlayarrButton(onClick = viewModel::startExport, enabled = !state.exportBusy && !state.exportRunning) {
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
                PlayarrButton(
                    onClick = { saveExport.launch(userDataExportFileName(job.createdAt.take(10))) },
                    variant = PlayarrButtonVariant.Secondary,
                ) { Text(playarrString(PlayarrString.YourDataExportSave)) }
            }
        }
        state.exportError?.let { ErrorLine(playarrText(it)) }

        Text(playarrString(PlayarrString.YourDataImportTitle), color = WebInk, fontWeight = FontWeight.SemiBold)
        Text(playarrString(PlayarrString.YourDataImportDescription), color = WebInkMuted, fontSize = 11.sp)
        PlayarrButton(
            onClick = { chooseFile.launch(arrayOf("application/zip", "application/x-zip-compressed", "application/octet-stream")) },
            variant = PlayarrButtonVariant.Secondary,
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
        PlayarrButton(onClick = viewModel::preview, enabled = state.canPreview, variant = PlayarrButtonVariant.Secondary) {
            Text(playarrString(PlayarrString.YourDataPreviewButton))
        }
        state.importError?.let { ErrorLine(playarrText(it)) }
        state.preview?.let { preview ->
            PreviewSummary(preview)
            Text(playarrString(PlayarrString.YourDataConfirmNote), color = WebInkMuted, fontSize = 11.sp)
            PlayarrButton(onClick = viewModel::apply, enabled = state.canApply) {
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
                PlayarrButton(onClick = { saveUnmatched.launch("playarr-unmatched.zip") }, variant = PlayarrButtonVariant.Secondary) {
                    Text(playarrString(PlayarrString.YourDataSaveUnmatched, "count" to result.unmatchedTotal))
                }
            }
        }
        state.notice?.let {
            Text(playarrString(it), color = WebPink, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

/** Television: QR codes for one-time links; no file picker, no file save. */
@Composable
private fun YourDataTelevision(viewModel: YourDataViewModel) {
    val state by viewModel.state.collectAsState()
    // Web TV `.settings-your-data`: 22.464 px bold headings, 19.2 px muted body, a 12.48 px note, 58 px pills; blocks 30.24 px apart.
    val gap = 30.24.dp
    val heading: @Composable (String) -> Unit = { text ->
        Text(text, color = WebInk, fontSize = 22.464.sp, lineHeight = 33.7.sp, fontWeight = FontWeight.Bold, style = cssLine())
    }
    val body: @Composable (String) -> Unit = { text ->
        Text(text, color = WebInkMuted, fontSize = 19.2.sp, lineHeight = 28.8.sp, style = cssLine(), modifier = Modifier.requiredWidth(995.dp).padding(top = gap))
    }
    Column(Modifier.layout { measurable, constraints ->
        val placeable = measurable.measure(constraints)
        layout(placeable.width, placeable.height) { placeable.place(0, -2) }
    }, verticalArrangement = Arrangement.spacedBy(0.dp)) {
        heading(playarrString(PlayarrString.YourDataExportTitle))
        body(playarrString(PlayarrString.YourDataExportDescription))
        Text(playarrString(PlayarrString.YourDataScopeNote), color = WebInkMuted, fontSize = 12.48.sp, lineHeight = 18.72.sp, style = cssLine(), modifier = Modifier.padding(top = gap - 1.dp))
        Box(Modifier.padding(top = gap + 1.dp)) {
            TvPrimaryPill(
                playarrString(if (state.exportRunning) PlayarrString.YourDataExportPreparing else PlayarrString.YourDataExportStart),
                onClick = viewModel::startExport, enabled = !state.exportBusy && !state.exportRunning, height = 58,
            )
        }
        state.exportJob?.let { job ->
            Text(exportStatusText(job), color = WebInkSoft, fontSize = 12.sp)
            if (job.status == UserDataExportStatus.Ready) {
                PlayarrButton(onClick = viewModel::showExportLink, enabled = !state.exportLinkBusy, variant = PlayarrButtonVariant.Secondary) {
                    Text(
                        playarrString(
                            if (state.exportLinkUrl != null) PlayarrString.YourDataTransferNewCode
                            else PlayarrString.YourDataTransferShowDownloadCode,
                        ),
                    )
                }
            }
        }
        state.exportLinkUrl?.let { url ->
            Text(playarrString(PlayarrString.YourDataTransferDownloadHelp), color = WebInkMuted, fontSize = 11.sp)
            PlayarrQrCode(
                value = url,
                contentDescription = playarrString(PlayarrString.YourDataTransferQrLabel),
                modifier = Modifier.size(220.dp),
            )
            Text(
                playarrString(PlayarrString.YourDataTransferLinkExpires, "time" to expiryClock(state.exportLinkExpiresAt)),
                color = WebInkMuted,
                fontSize = 11.sp,
            )
        }
        state.exportError?.let { ErrorLine(playarrText(it)) }

        Spacer(Modifier.height(96.dp))
        heading(playarrString(PlayarrString.YourDataImportTitle))
        body(playarrString(PlayarrString.YourDataImportDescription))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = gap)) {
            TvPrimaryPill(
                playarrString(if (state.session != null) PlayarrString.YourDataTransferNewCode else PlayarrString.YourDataTransferStartUpload),
                onClick = viewModel::startSession, enabled = !state.sessionBusy && state.session?.status != "uploading", height = 58,
            )
            if (state.session != null) {
                PlayarrButton(onClick = viewModel::cancelSession, variant = PlayarrButtonVariant.Secondary) {
                    Text(playarrString(PlayarrString.YourDataTransferCancel))
                }
            }
        }
        val session = state.session
        if (session?.status == "waiting") {
            state.uploadUrl?.let { url ->
                Text(playarrString(PlayarrString.YourDataTransferUploadHelp), color = WebInkMuted, fontSize = 11.sp)
                PlayarrQrCode(
                    value = url,
                    contentDescription = playarrString(PlayarrString.YourDataTransferQrLabel),
                    modifier = Modifier.size(220.dp),
                )
                Text(
                    playarrString(PlayarrString.YourDataTransferLinkExpires, "time" to expiryClock(session.expiresAt)),
                    color = WebInkMuted,
                    fontSize = 11.sp,
                )
            }
        }
        if (session?.status == "uploading") {
            Text(playarrString(PlayarrString.YourDataTransferReceiving), color = WebInkSoft, fontSize = 12.sp)
        }
        if (session?.isUploaded == true) {
            Text(
                playarrString(PlayarrString.YourDataTransferReceived, "size" to formatTransferSize(session.sizeBytes)),
                color = WebInkSoft,
                fontSize = 12.sp,
            )
        }
        if (state.sessionExpired) ErrorLine(playarrString(PlayarrString.YourDataTransferExpired))
        Column(Modifier.padding(top = gap)) {
            Text(
                playarrString(PlayarrString.YourDataConflictsLabel).uppercase(LocalPlayarrLanguage.current.locale),
                color = WebInkMuted, fontSize = 11.2.sp, lineHeight = 16.8.sp, fontWeight = FontWeight(720), letterSpacing = 0.896.sp, style = cssLine(),
            )
            Spacer(Modifier.height(0.dp))
            TvSelectField(
                choices = listOf(
                    UserDataProgressConflicts.Newest to playarrString(PlayarrString.YourDataConflictsNewest),
                    UserDataProgressConflicts.KeepExisting to playarrString(PlayarrString.YourDataConflictsKeep),
                ),
                selected = state.conflicts, onSelected = viewModel::setConflicts,
            )
        }
        Row(Modifier.padding(top = 39.4.dp).clickable { viewModel.setIncludePreferences(!state.includePreferences) }, verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.padding(start = 2.dp, end = 8.5.dp).size(13.dp)
                    .border(1.dp, androidx.compose.ui.graphics.Color(0xFF767676), RoundedCornerShape(2.dp))
                    .then(if (state.includePreferences) Modifier.background(WebInk, RoundedCornerShape(2.dp)) else Modifier),
            )
            Text(
                playarrString(PlayarrString.YourDataIncludePreferences).uppercase(LocalPlayarrLanguage.current.locale),
                color = WebInkMuted, fontSize = 11.2.sp, lineHeight = 20.8.sp, fontWeight = FontWeight(720), letterSpacing = 0.896.sp, style = cssLine(),
            )
        }
        Box(Modifier.padding(top = 35.5.dp)) {
            TvSecondaryPill(playarrString(PlayarrString.YourDataPreviewButton), onClick = viewModel::preview, enabled = state.canPreviewSession)
        }
        state.importError?.let { ErrorLine(playarrText(it)) }
        state.preview?.let { preview ->
            PreviewSummary(preview)
            Text(playarrString(PlayarrString.YourDataConfirmNote), color = WebInkMuted, fontSize = 11.sp)
            PlayarrButton(onClick = viewModel::apply, enabled = state.canApply) {
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
        }
        state.notice?.let {
            Text(playarrString(it), color = WebPink, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

/** Local wall-clock time of an ISO-8601 instant, for "stops working at ..."; blank when unparseable. */
internal fun expiryClock(iso: String?, zone: java.time.ZoneId = java.time.ZoneId.systemDefault()): String =
    runCatching {
        playarrLocaleTime(java.time.Instant.parse(iso), zone, java.util.Locale.getDefault())
    }.getOrDefault("")

internal fun formatTransferSize(bytes: Long?): String = when {
    bytes == null -> ""
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> "%.1f KB".format(java.util.Locale.ROOT, bytes / 1024.0)
    else -> "%.1f MB".format(java.util.Locale.ROOT, bytes / (1024.0 * 1024.0))
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
            PlayarrButton(onClick = { onSelected(choice) }, enabled = choice != selected, variant = PlayarrButtonVariant.Secondary) {
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
