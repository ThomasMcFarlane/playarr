package io.playarr.shared.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Wire models for `POST /api/v1/playback/sessions/{session_id}/health` and
 * the redacted export it returns. See `docs/architecture/playback-health.md`.
 */
@Serializable
data class ClientPlaybackReport(
    val reported: ReportedCapabilities = ReportedCapabilities(),
    val measured: MeasuredPlayback = MeasuredPlayback(),
)

/** Declared by the device; never proof that a feature works. */
@Serializable
data class ReportedCapabilities(
    val videoCodecs: List<String> = emptyList(),
    val audioCodecs: List<String> = emptyList(),
    val hdrFormats: List<String> = emptyList(),
    val displayHdrFormats: List<String> = emptyList(),
    val audioOutput: String? = null,
    val maxHeight: Int? = null,
)

/** Observed on this playback. Unknown values are omitted (null), never guessed. */
@Serializable
data class MeasuredPlayback(
    val videoCodec: String? = null,
    val decoderKind: String? = null,
    val width: Int? = null,
    val height: Int? = null,
    val hdrActive: Boolean? = null,
    val audioCodec: String? = null,
    val audioChannels: Int? = null,
    val audioPassthrough: Boolean? = null,
    val droppedFrames: Long? = null,
    val rebufferCount: Int? = null,
    val rebufferMs: Long? = null,
    val throughputBps: Long? = null,
)

@Serializable
enum class HealthProvenance {
    @SerialName("measured") Measured,
    @SerialName("reported") Reported,
    @SerialName("unknown") Unknown,
}

@Serializable
enum class HealthSeverity {
    @SerialName("ok") Ok,
    @SerialName("info") Info,
    @SerialName("warning") Warning,
    @SerialName("problem") Problem,
}

@Serializable
data class HealthFact(
    val key: String,
    val label: String,
    val value: String? = null,
    val provenance: HealthProvenance = HealthProvenance.Unknown,
    val source: String? = null,
)

@Serializable
data class HealthFinding(
    val code: String,
    val severity: HealthSeverity,
    val title: String,
    val detail: String,
    val nextAction: String? = null,
)

@Serializable
data class HealthQualification(val status: String, val note: String)

@Serializable
data class HealthExportFact(
    val key: String,
    val value: String? = null,
    val provenance: HealthProvenance = HealthProvenance.Unknown,
)

/** Redacted evidence safe to copy or share. */
@Serializable
data class PlaybackHealthExport(
    val schema: String,
    val generatedAt: String,
    val clientPlatform: String,
    val clientVersion: String,
    val playMethod: String,
    val transcodeReason: String? = null,
    val facts: List<HealthExportFact> = emptyList(),
    val findingCodes: List<String> = emptyList(),
    val redaction: String = "",
)

@Serializable
data class PlaybackHealthReport(
    val headline: String,
    val severity: HealthSeverity,
    val playMethod: String,
    val facts: List<HealthFact> = emptyList(),
    val findings: List<HealthFinding> = emptyList(),
    val qualification: HealthQualification,
    val export: PlaybackHealthExport,
)
