package io.playarr.mobile.ui

import android.content.Context
import android.content.Intent
import android.view.Display
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.playarr.shared.data.model.ClientPlaybackReport
import io.playarr.shared.data.model.HealthFact
import io.playarr.shared.data.model.HealthFinding
import io.playarr.shared.data.model.HealthProvenance
import io.playarr.shared.data.model.HealthSeverity
import io.playarr.shared.data.model.MeasuredPlayback
import io.playarr.shared.data.model.PlaybackHealthExport
import io.playarr.shared.data.model.PlaybackHealthReport
import io.playarr.shared.data.model.ReportedCapabilities
import io.playarr.shared.data.remote.PlayarrHttpClient
import io.playarr.shared.player.DecoderKind
import io.playarr.shared.player.PlaybackDiagnostics
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import retrofit2.HttpException

/** Outcome of the bounded connection test. */
internal data class PlayarrConnectionTestResult(
    val bytes: Long,
    val latencyMs: Long,
    val throughputBps: Long,
)

/** How loading the health report failed, so the dialog can say something useful. */
internal enum class PlayarrHealthError { NoSession, NotAvailable, Network }

internal class PlayarrHealthException(val error: PlayarrHealthError) : Exception(error.name)

/**
 * Everything the playback health dialog needs from the player screen, kept as
 * plain suspend lambdas so the dialog never touches Hilt, Retrofit or Media3.
 */
internal data class PlayarrPlayerHealth(
    val load: suspend () -> Result<PlaybackHealthReport>,
    val runConnectionTest: suspend () -> Result<PlayarrConnectionTestResult>,
) {
    companion object {
        val Unavailable = PlayarrPlayerHealth(
            load = { Result.failure(PlayarrHealthException(PlayarrHealthError.NoSession)) },
            runConnectionTest = { Result.failure(PlayarrHealthException(PlayarrHealthError.NoSession)) },
        )
    }
}

internal const val PLAYARR_CONNECTION_TEST_BYTES = 1024 * 1024
internal const val PLAYARR_CONNECTION_TEST_TIMEOUT_MS = 8_000L

/**
 * Builds the client half of the health request. Declared capabilities go under
 * `reported`; only values the player actually observed go under `measured`.
 * HDR output state and the connected receiver are not observable from here, so
 * they are left out and the server shows them as unknown.
 */
internal fun playarrBuildHealthRequest(
    diagnostics: PlaybackDiagnostics,
    displayHdrFormats: List<String>,
    throughputOverrideBps: Long? = null,
): ClientPlaybackReport {
    val observed = diagnostics.hasMeasurements
    val throughput = throughputOverrideBps?.takeIf { it > 0 } ?: diagnostics.throughputBps.takeIf { it > 0 }
    return ClientPlaybackReport(
        reported = ReportedCapabilities(
            videoCodecs = playarrAndroidVideoCodecs.split(','),
            audioCodecs = playarrAndroidAudioCodecs.split(','),
            displayHdrFormats = displayHdrFormats,
        ),
        measured = MeasuredPlayback(
            videoCodec = diagnostics.videoCodec,
            decoderKind = diagnostics.decoderKind.takeUnless { it == DecoderKind.Unknown }?.wire,
            width = diagnostics.width.takeIf { it > 0 },
            height = diagnostics.height.takeIf { it > 0 },
            audioCodec = diagnostics.audioCodec,
            audioChannels = diagnostics.audioChannels.takeIf { it > 0 },
            audioPassthrough = diagnostics.audioPassthrough,
            droppedFrames = diagnostics.droppedFrames.takeIf { observed },
            rebufferCount = diagnostics.rebufferCount.takeIf { observed },
            rebufferMs = diagnostics.rebufferMs.takeIf { observed },
            throughputBps = throughput,
        ),
    )
}

/** Maps `Display.HdrCapabilities` type ids to the wire names. Unknown ids are dropped. */
internal fun playarrHdrTypeNames(types: IntArray): List<String> = types.toList().mapNotNull { type ->
    when (type) {
        Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION -> "dolby_vision"
        Display.HdrCapabilities.HDR_TYPE_HDR10 -> "hdr10"
        Display.HdrCapabilities.HDR_TYPE_HLG -> "hlg"
        Display.HdrCapabilities.HDR_TYPE_HDR10_PLUS -> "hdr10_plus"
        else -> null
    }
}.distinct()

@Suppress("DEPRECATION")
internal fun playarrDisplayHdrFormats(context: Context): List<String> = runCatching {
    val display: Display? = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
        context.display
    } else {
        (context.getSystemService(Context.WINDOW_SERVICE) as? android.view.WindowManager)?.defaultDisplay
    }
    playarrHdrTypeNames(display?.hdrCapabilities?.supportedHdrTypes ?: IntArray(0))
}.getOrDefault(emptyList())

internal fun playarrHealthErrorFor(error: Throwable): PlayarrHealthError = when {
    error is PlayarrHealthException -> error.error
    error is HttpException && (error.code() == 404 || error.code() == 403) -> PlayarrHealthError.NotAvailable
    else -> PlayarrHealthError.Network
}

/** Problems first, then warnings, info and ok; stable within a severity. */
internal fun playarrSortFindings(findings: List<HealthFinding>): List<HealthFinding> =
    findings.sortedBy { 3 - it.severity.ordinal }

/** The delivery facts worth showing without opening technical detail. */
private val summaryFactKeys = setOf(
    "play_method",
    "source_video",
    "delivered_video",
    "delivered_dynamic_range",
    "delivered_audio",
)

internal fun playarrSummaryFacts(facts: List<HealthFact>): List<HealthFact> =
    facts.filter { it.key in summaryFactKeys }

/** A fact without a value is unknown no matter what provenance the server attached. */
internal fun playarrFactProvenance(fact: HealthFact): HealthProvenance =
    if (fact.value == null) HealthProvenance.Unknown else fact.provenance

internal fun playarrFormatBitrate(bps: Long): String =
    if (bps >= 1_000_000) "%.1f Mbit/s".format(java.util.Locale.ROOT, bps / 1_000_000.0) else "${bps / 1000} kbit/s"

/** The only text that leaves the device: the server-redacted export, pretty-printed. */
internal fun playarrHealthExportText(export: PlaybackHealthExport): String =
    PlayarrHttpClient.json.let { json ->
        val pretty = kotlinx.serialization.json.Json(from = json) { prettyPrint = true }
        pretty.encodeToString(export)
    }

private sealed interface HealthLoad {
    data object Loading : HealthLoad
    data class Failed(val error: PlayarrHealthError) : HealthLoad
    data class Ready(val report: PlaybackHealthReport) : HealthLoad
}

private sealed interface TestState {
    data object Idle : TestState
    data object Running : TestState
    data object Cancelled : TestState
    data class Done(val result: PlayarrConnectionTestResult) : TestState
    data class Failed(val error: PlayarrHealthError) : TestState
}

@Composable
internal fun PlayarrPlaybackHealthDialog(
    health: PlayarrPlayerHealth,
    isTelevision: Boolean,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current
    var load by remember { mutableStateOf<HealthLoad>(HealthLoad.Loading) }
    var test by remember { mutableStateOf<TestState>(TestState.Idle) }
    var detail by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<PlayarrString?>(null) }
    var testJob by remember { mutableStateOf<Job?>(null) }
    var reloadKey by remember { mutableStateOf(0) }

    LaunchedEffect(reloadKey) {
        load = HealthLoad.Loading
        load = health.load().fold(
            onSuccess = { HealthLoad.Ready(it) },
            onFailure = { HealthLoad.Failed(playarrHealthErrorFor(it)) },
        )
    }

    fun dismiss() {
        testJob?.cancel()
        onDismiss()
    }

    AlertDialog(
        onDismissRequest = ::dismiss,
        title = {
            Text(
                (load as? HealthLoad.Ready)?.report?.headline
                    ?: playarrString(PlayarrString.HealthTitle),
            )
        },
        text = {
            LazyColumn(
                modifier = Modifier.fillMaxWidth().heightIn(max = if (isTelevision) 420.dp else 480.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                when (val state = load) {
                    HealthLoad.Loading -> item { Text(playarrString(PlayarrString.HealthLoading)) }
                    is HealthLoad.Failed -> {
                        item {
                            HealthFocusable {
                                Text(
                                    playarrString(
                                        when (state.error) {
                                            PlayarrHealthError.NoSession -> PlayarrString.HealthNoSession
                                            PlayarrHealthError.NotAvailable -> PlayarrString.HealthNotAvailable
                                            PlayarrHealthError.Network -> PlayarrString.HealthNetworkError
                                        },
                                    ),
                                )
                            }
                        }
                        item {
                            OutlinedButton(onClick = { reloadKey += 1 }) {
                                Text(playarrString(PlayarrString.HealthRetry))
                            }
                        }
                    }
                    is HealthLoad.Ready -> {
                        val report = state.report
                        items(playarrSortFindings(report.findings).size) { index ->
                            HealthFindingCard(playarrSortFindings(report.findings)[index])
                        }
                        item {
                            TextButton(onClick = { detail = !detail }) {
                                Text(
                                    playarrString(
                                        if (detail) PlayarrString.HealthHideDetail else PlayarrString.HealthShowDetail,
                                    ),
                                )
                            }
                        }
                        val facts = if (detail) report.facts else playarrSummaryFacts(report.facts)
                        items(facts.size) { index -> HealthFactRow(facts[index]) }
                        if (detail) {
                            item {
                                HealthFocusable {
                                    Text(report.qualification.note, fontSize = 12.sp, color = WebInkMuted)
                                }
                            }
                        }
                        item {
                            Text(
                                playarrString(PlayarrString.HealthTestHeading),
                                fontWeight = FontWeight.Bold,
                            )
                        }
                        item {
                            HealthFocusable {
                                Text(playarrString(PlayarrString.HealthTestHint), fontSize = 12.sp, color = WebInkMuted)
                            }
                        }
                        item {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (test == TestState.Running) {
                                    OutlinedButton(onClick = { testJob?.cancel() }) {
                                        Text(playarrString(PlayarrString.HealthTestCancel))
                                    }
                                } else {
                                    OutlinedButton(
                                        onClick = {
                                            test = TestState.Running
                                            testJob = scope.launch {
                                                val outcome = health.runConnectionTest()
                                                test = outcome.fold(
                                                    onSuccess = { TestState.Done(it) },
                                                    onFailure = { error ->
                                                        if (error is kotlinx.coroutines.TimeoutCancellationException) {
                                                            TestState.Failed(PlayarrHealthError.Network)
                                                        } else if (error is kotlinx.coroutines.CancellationException) {
                                                            TestState.Cancelled
                                                        } else {
                                                            TestState.Failed(playarrHealthErrorFor(error))
                                                        }
                                                    },
                                                )
                                                if (test is TestState.Done) reloadKey += 1
                                            }
                                        },
                                    ) { Text(playarrString(PlayarrString.HealthTestRun)) }
                                }
                            }
                        }
                        item {
                            val message: String? = when (val result = test) {
                                TestState.Idle -> null
                                TestState.Running -> playarrString(PlayarrString.HealthTestRunning)
                                TestState.Cancelled -> playarrString(PlayarrString.HealthTestCancelled)
                                is TestState.Failed -> playarrString(PlayarrString.HealthTestFailed)
                                is TestState.Done -> playarrString(
                                    PlayarrString.HealthTestResult,
                                    "rate" to playarrFormatBitrate(result.result.throughputBps),
                                    "latency" to result.result.latencyMs.toString(),
                                )
                            }
                            message?.let { HealthFocusable { Text(it, fontSize = 13.sp) } }
                        }
                        item {
                            Text(
                                playarrString(PlayarrString.HealthExportHeading),
                                fontWeight = FontWeight.Bold,
                            )
                        }
                        item {
                            HealthFocusable {
                                Text(playarrString(PlayarrString.HealthExportHint), fontSize = 12.sp, color = WebInkMuted)
                            }
                        }
                        item {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(
                                    onClick = {
                                        clipboard.setText(AnnotatedString(playarrHealthExportText(report.export)))
                                        note = PlayarrString.HealthCopied
                                    },
                                ) { Text(playarrString(PlayarrString.HealthExportCopy)) }
                                if (!isTelevision) {
                                    OutlinedButton(
                                        onClick = {
                                            val send = Intent(Intent.ACTION_SEND).apply {
                                                type = "text/plain"
                                                putExtra(Intent.EXTRA_TEXT, playarrHealthExportText(report.export))
                                            }
                                            runCatching {
                                                context.startActivity(Intent.createChooser(send, null))
                                            }
                                        },
                                    ) { Text(playarrString(PlayarrString.HealthExportShare)) }
                                }
                            }
                        }
                        note?.let { key -> item { HealthFocusable { Text(playarrString(key), fontSize = 13.sp) } } }
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = ::dismiss) { Text(playarrString(PlayarrString.CommonClose)) }
        },
    )
}

/** Text is not focusable on its own, so D-pad users could not scroll past it. */
@Composable
private fun HealthFocusable(content: @Composable () -> Unit) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    androidx.compose.foundation.layout.Box(
        Modifier
            .fillMaxWidth()
            .border(
                BorderStroke(if (focused) 2.dp else 0.dp, if (focused) WebPink else Color.Transparent),
                RoundedCornerShape(10.dp),
            )
            .focusable(interactionSource = source)
            .padding(4.dp),
    ) { content() }
}

@Composable
private fun HealthFindingCard(finding: HealthFinding) {
    val accent = when (finding.severity) {
        HealthSeverity.Ok -> Color(0xFF6FCF97)
        HealthSeverity.Info -> Color(0xFF7FB7FF)
        HealthSeverity.Warning -> Color(0xFFFFD27A)
        HealthSeverity.Problem -> Color(0xFFFF7A6B)
    }
    HealthFocusable {
        Column(Modifier.padding(start = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(finding.title, fontWeight = FontWeight.Bold, color = accent)
            Text(finding.detail, fontSize = 13.sp)
            finding.nextAction?.let {
                Text(
                    playarrString(PlayarrString.HealthNextAction) + " " + it,
                    fontSize = 13.sp,
                    color = Color(0xFFFFE2A8),
                )
            }
        }
    }
}

@Composable
private fun HealthFactRow(fact: HealthFact) {
    val provenance = playarrFactProvenance(fact)
    HealthFocusable {
        Column {
            Text(fact.label, fontSize = 12.sp, color = WebInkMuted)
            Text(fact.value ?: playarrString(PlayarrString.HealthUnknown))
            Text(
                playarrString(
                    when (provenance) {
                        HealthProvenance.Measured -> PlayarrString.HealthMeasured
                        HealthProvenance.Reported -> PlayarrString.HealthReported
                        HealthProvenance.Unknown -> PlayarrString.HealthNotAvailableValue
                    },
                ),
                fontSize = 11.sp,
                color = WebInkMuted,
            )
        }
    }
}
