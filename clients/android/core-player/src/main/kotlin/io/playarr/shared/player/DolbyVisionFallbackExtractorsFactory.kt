package io.playarr.shared.player

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.container.NalUnitUtil
import androidx.media3.exoplayer.mediacodec.MediaCodecUtil
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.ExtractorsFactory
import androidx.media3.extractor.ForwardingExtractor
import androidx.media3.extractor.TrackOutput

/**
 * Lets Dolby Vision remuxes play on devices that have no Dolby Vision
 * decoder.
 *
 * Media3's Matroska/MP4 extractors label a track that carries a Dolby Vision
 * configuration record as `video/dolby-vision` (codecs `dvhe.07.06`, ...).
 * Without a matching decoder the track is "unsupported", the player selects
 * no video renderer at all and reports READY with nothing to show. Every
 * Dolby Vision profile that ships in a Matroska/MP4 file keeps a plain
 * HEVC (or AVC) base layer, so on such devices the track is relabelled to
 * the base codec and the enhancement layer is simply ignored.
 *
 * Devices that do expose a Dolby Vision decoder are left untouched.
 */
internal class DolbyVisionFallbackExtractorsFactory(
    private val delegate: ExtractorsFactory,
    private val hasDolbyVisionDecoder: () -> Boolean = ::deviceHasDolbyVisionDecoder,
) : ExtractorsFactory by delegate {

    override fun createExtractors(): Array<Extractor> = wrap(delegate.createExtractors())

    override fun createExtractors(
        uri: Uri,
        responseHeaders: Map<String, List<String>>,
    ): Array<Extractor> = wrap(delegate.createExtractors(uri, responseHeaders))

    private fun wrap(extractors: Array<Extractor>): Array<Extractor> =
        Array(extractors.size) { index -> FallbackExtractor(extractors[index], hasDolbyVisionDecoder) }

    private class FallbackExtractor(
        delegate: Extractor,
        private val hasDolbyVisionDecoder: () -> Boolean,
    ) : ForwardingExtractor(delegate) {
        override fun init(output: ExtractorOutput) {
            super.init(FallbackExtractorOutput(output, hasDolbyVisionDecoder))
        }
    }

    private class FallbackExtractorOutput(
        private val delegate: ExtractorOutput,
        private val hasDolbyVisionDecoder: () -> Boolean,
    ) : ExtractorOutput by delegate {
        override fun track(id: Int, type: Int): TrackOutput {
            val output = delegate.track(id, type)
            return if (type == C.TRACK_TYPE_VIDEO) FallbackTrackOutput(output, hasDolbyVisionDecoder) else output
        }
    }

    private class FallbackTrackOutput(
        private val delegate: TrackOutput,
        private val hasDolbyVisionDecoder: () -> Boolean,
    ) : TrackOutput by delegate {
        // Resolved lazily and once: querying the codec list is not free.
        private val dolbyVisionSupported by lazy(hasDolbyVisionDecoder)

        override fun format(format: Format) {
            val fallback = if (format.sampleMimeType == MimeTypes.VIDEO_DOLBY_VISION && !dolbyVisionSupported) {
                dolbyVisionBaseLayerFormat(format)
            } else {
                null
            }
            delegate.format(fallback ?: format)
        }
    }

    companion object {
        /**
         * The base-layer format for a Dolby Vision [format], or null when it
         * is not Dolby Vision or its base codec is unknown. `dvav`/`dva1`
         * (profile 9) are AVC based, `dav1` (profile 10) AV1, everything
         * else (profiles 4, 5, 7, 8, ...) HEVC.
         */
        internal fun dolbyVisionBaseLayerFormat(format: Format): Format? {
            if (format.sampleMimeType != MimeTypes.VIDEO_DOLBY_VISION) return null
            val fourCc = format.codecs?.substringBefore('.')?.lowercase()
            val baseMime = when (fourCc) {
                "dvav", "dva1" -> MimeTypes.VIDEO_H264
                "dav1" -> MimeTypes.VIDEO_AV1
                else -> MimeTypes.VIDEO_H265
            }
            // The Dolby Vision codec string describes the enhanced stream and
            // would mislead the decoder's profile/level matching. For HEVC it
            // is rebuilt from the base-layer parameter sets: without it
            // Media3 cannot tell Main10 from Main and may pick a decoder
            // (the emulator's hardware one) that fails on 10-bit streams.
            val baseCodecs = if (baseMime == MimeTypes.VIDEO_H265) {
                runCatching { NalUnitUtil.getH265BaseLayerCodecsString(format.initializationData) }.getOrNull()
            } else {
                null
            }
            return format.buildUpon()
                .setSampleMimeType(baseMime)
                .setCodecs(baseCodecs)
                .build()
        }

        internal fun deviceHasDolbyVisionDecoder(): Boolean = try {
            MediaCodecUtil.getDecoderInfos(MimeTypes.VIDEO_DOLBY_VISION, false, false).isNotEmpty()
        } catch (_: MediaCodecUtil.DecoderQueryException) {
            false
        }
    }
}
