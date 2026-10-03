package io.playarr.shared.player

import androidx.media3.exoplayer.mediacodec.MediaCodecInfo
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import java.util.concurrent.ConcurrentHashMap

/**
 * Decoders that accepted a stream at configuration time but then failed
 * while decoding it (typically a hardware or emulator decoder that claims
 * HEVC Main10 / 4K support it cannot deliver). Media3's decoder fallback only
 * covers initialisation failures, so the player records such a decoder here
 * and re-prepares; [selector] then offers the next candidate.
 */
internal class DecoderBlocklist {
    private val names: MutableSet<String> = ConcurrentHashMap.newKeySet()

    /** Returns true if [name] was not already blocked. */
    fun block(name: String): Boolean = names.add(name)

    fun isBlocked(name: String): Boolean = name in names

    /**
     * Wraps [delegate], dropping blocked decoders. If that would leave no
     * decoder at all the full list is kept: a flaky decoder beats silence.
     */
    fun selector(delegate: MediaCodecSelector = MediaCodecSelector.DEFAULT): MediaCodecSelector =
        MediaCodecSelector { mimeType, requiresSecureDecoder, requiresTunnelingDecoder ->
            val all = delegate.getDecoderInfos(mimeType, requiresSecureDecoder, requiresTunnelingDecoder)
            filter(all)
        }

    internal fun filter(all: List<MediaCodecInfo>): List<MediaCodecInfo> {
        val allowed = all.filterNot { it.name in names }
        return allowed.ifEmpty { all }
    }
}
