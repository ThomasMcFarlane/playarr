package io.playarr.shared.player

import android.os.Build
import androidx.media3.common.C
import androidx.media3.common.MimeTypes
import androidx.media3.decoder.DecoderInputBuffer
import androidx.media3.exoplayer.BaseRenderer
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.FormatHolder
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.RendererCapabilities
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.source.SampleStream
import androidx.media3.exoplayer.video.VideoRendererEventListener
import android.content.Context
import android.os.Handler

/**
 * Diagnostic video renderer that consumes video samples in real time but
 * decodes and shows nothing.
 *
 * Purpose: measuring the network and buffering pipeline of a stream the test
 * device cannot decode (for example 4K HEVC Main10 on the Android TV
 * emulator, whose decoders are 8-bit only). Samples are read at the pace the
 * playback clock advances, so load control, buffer depth, rebuffering and the
 * parallel range fetcher behave exactly as with a real decoder, while the
 * decoder-side result (`dropped_frames`) is honestly absent.
 *
 * Only ever installed when the `debug.playarr.discard_video` system property
 * is `1`, which only `adb shell setprop` can set; see [isRequested].
 */
internal class DiscardingVideoRenderer : BaseRenderer(C.TRACK_TYPE_VIDEO) {
    private val formatHolder = FormatHolder()
    private val buffer = DecoderInputBuffer(DecoderInputBuffer.BUFFER_REPLACEMENT_MODE_DISABLED)
    private var ended = false

    override fun getName(): String = "DiscardingVideoRenderer"

    override fun supportsFormat(format: androidx.media3.common.Format): Int =
        if (MimeTypes.isVideo(format.sampleMimeType)) {
            RendererCapabilities.create(C.FORMAT_HANDLED)
        } else {
            RendererCapabilities.create(C.FORMAT_UNSUPPORTED_TYPE)
        }

    override fun onPositionReset(positionUs: Long, joining: Boolean, sampleStreamIsResuming: Boolean) {
        ended = false
    }

    override fun render(positionUs: Long, elapsedRealtimeUs: Long) {
        while (!ended) {
            buffer.clear()
            val peek = readSource(formatHolder, buffer, SampleStream.FLAG_PEEK or SampleStream.FLAG_OMIT_SAMPLE_DATA)
            if (peek == C.RESULT_NOTHING_READ) return
            if (peek == C.RESULT_FORMAT_READ) {
                // Format changes are consumed without the peek flag.
                buffer.clear()
                readSource(formatHolder, buffer, SampleStream.FLAG_OMIT_SAMPLE_DATA)
                continue
            }
            if (buffer.isEndOfStream) {
                ended = true
                return
            }
            // Behave like a decoder with a short input queue: only take
            // samples that are about to be due, leaving the rest buffered.
            if (buffer.timeUs > positionUs + LOOKAHEAD_US) return
            buffer.clear()
            readSource(formatHolder, buffer, SampleStream.FLAG_OMIT_SAMPLE_DATA)
        }
    }

    override fun isReady(): Boolean = ended || isSourceReady()

    override fun isEnded(): Boolean = ended

    companion object {
        private const val LOOKAHEAD_US = 100_000L
        private const val PROPERTY = "debug.playarr.discard_video"

        /** True when `adb shell setprop debug.playarr.discard_video 1` was run. */
        fun isRequested(): Boolean = try {
            val properties = Class.forName("android.os.SystemProperties")
            properties.getMethod("get", String::class.java, String::class.java)
                .invoke(null, PROPERTY, "0") == "1" && Build.VERSION.SDK_INT >= 26
        } catch (_: ReflectiveOperationException) {
            false
        }
    }
}

/** Swaps the platform video renderer for [DiscardingVideoRenderer] when requested. */
internal class PlayarrRenderersFactory(
    context: Context,
    private val discardVideo: Boolean,
) : DefaultRenderersFactory(context) {
    // Audio passthrough: DefaultRenderersFactory's default sink is built from
    // the live AudioCapabilities (HDMI plug state and, on API 33+, direct
    // playback profiles), so DTS, DTS-HD, TrueHD and E-AC3 are passed through
    // to an AVR when the sink advertises them, and tracks the device can
    // neither pass through nor decode are reported unsupported. Nothing extra
    // is needed; audio offload is deliberately left off (PCM power saving
    // only, and it disables speed changes).
    override fun buildVideoRenderers(
        context: Context,
        extensionRendererMode: Int,
        mediaCodecSelector: MediaCodecSelector,
        enableDecoderFallback: Boolean,
        eventHandler: Handler,
        eventListener: VideoRendererEventListener,
        allowedVideoJoiningTimeMs: Long,
        out: ArrayList<Renderer>,
    ) {
        if (discardVideo) {
            out.add(DiscardingVideoRenderer())
        } else {
            super.buildVideoRenderers(
                context,
                extensionRendererMode,
                mediaCodecSelector,
                enableDecoderFallback,
                eventHandler,
                eventListener,
                allowedVideoJoiningTimeMs,
                out,
            )
        }
    }
}
