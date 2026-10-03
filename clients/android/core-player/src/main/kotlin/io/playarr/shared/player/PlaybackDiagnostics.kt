package io.playarr.shared.player

import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build
import androidx.media3.common.C
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.Util

/** Whether the active video decoder runs on dedicated hardware. */
enum class DecoderKind(val wire: String?) {
    Hardware("hardware"),
    Software("software"),

    /** The platform could not say; shown as unknown, never guessed. */
    Unknown(null),
}

/**
 * What the player has actually observed during this playback, for the
 * playback health screen (`docs/architecture/playback-health.md`). Every field
 * is a measurement taken from Media3 callbacks; absent values stay null/zero
 * rather than being inferred from capability advertisements. In particular
 * HDR output is not part of this snapshot: the player cannot see what the
 * display does, so it is never claimed.
 */
data class PlaybackDiagnostics(
    val videoCodec: String? = null,
    val decoderName: String? = null,
    val decoderKind: DecoderKind = DecoderKind.Unknown,
    val width: Int = 0,
    val height: Int = 0,
    val droppedFrames: Long = 0,
    val rebufferCount: Int = 0,
    val rebufferMs: Long = 0,
    val throughputBps: Long = 0,
    val audioCodec: String? = null,
    val audioChannels: Int = 0,
    /** True only when an AudioTrack was created for a non-PCM (bitstream) encoding. */
    val audioPassthrough: Boolean? = null,
) {
    /** False until the player has reported anything about video or audio. */
    val hasMeasurements: Boolean
        get() = videoCodec != null || audioCodec != null || decoderName != null
}

internal object DiagnosticNames {
    /** Stable short codec names matching the server's vocabulary. */
    fun videoCodec(mimeType: String?): String? = when (mimeType) {
        null -> null
        MimeTypes.VIDEO_H264 -> "h264"
        MimeTypes.VIDEO_H265 -> "hevc"
        MimeTypes.VIDEO_VP9 -> "vp9"
        MimeTypes.VIDEO_AV1 -> "av1"
        MimeTypes.VIDEO_DOLBY_VISION -> "dolby_vision"
        else -> mimeType.substringAfter('/').lowercase()
    }

    fun audioCodec(mimeType: String?): String? = when (mimeType) {
        null -> null
        MimeTypes.AUDIO_AAC -> "aac"
        MimeTypes.AUDIO_AC3 -> "ac3"
        MimeTypes.AUDIO_E_AC3, MimeTypes.AUDIO_E_AC3_JOC -> "eac3"
        MimeTypes.AUDIO_TRUEHD -> "truehd"
        MimeTypes.AUDIO_DTS, MimeTypes.AUDIO_DTS_HD, MimeTypes.AUDIO_DTS_EXPRESS -> "dts"
        MimeTypes.AUDIO_OPUS -> "opus"
        MimeTypes.AUDIO_FLAC -> "flac"
        MimeTypes.AUDIO_MPEG -> "mp3"
        MimeTypes.AUDIO_VORBIS -> "vorbis"
        else -> mimeType.substringAfter('/').lowercase()
    }

    /**
     * Prefers what the platform says about the codec. A name pattern is only
     * used for the well-known AOSP software decoders; anything else stays
     * unknown rather than being called hardware.
     */
    fun decoderKind(name: String?, hardwareAccelerated: Boolean?, softwareOnly: Boolean?): DecoderKind {
        if (name.isNullOrBlank()) return DecoderKind.Unknown
        if (softwareOnly == true) return DecoderKind.Software
        if (hardwareAccelerated == true) return DecoderKind.Hardware
        val lower = name.lowercase()
        if (lower.startsWith("omx.google.") || lower.startsWith("c2.android.") || ".sw." in lower) {
            return DecoderKind.Software
        }
        return if (hardwareAccelerated == false) DecoderKind.Software else DecoderKind.Unknown
    }

    /** A non-PCM AudioTrack encoding means the bitstream is handed to the receiver untouched. */
    fun isPassthroughEncoding(encoding: Int): Boolean =
        encoding != C.ENCODING_INVALID && !Util.isEncodingLinearPcm(encoding)

    fun lookupDecoderKind(name: String?): DecoderKind {
        if (name.isNullOrBlank()) return DecoderKind.Unknown
        val info: MediaCodecInfo? = runCatching {
            MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos.firstOrNull { it.name == name }
        }.getOrNull()
        val hardware: Boolean?
        val softwareOnly: Boolean?
        if (info != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            hardware = info.isHardwareAccelerated
            softwareOnly = info.isSoftwareOnly
        } else {
            hardware = null
            softwareOnly = null
        }
        return decoderKind(name, hardwareAccelerated = hardware, softwareOnly = softwareOnly)
    }
}
