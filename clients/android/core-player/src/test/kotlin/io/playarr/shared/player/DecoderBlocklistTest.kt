package io.playarr.shared.player

import androidx.media3.exoplayer.mediacodec.MediaCodecInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DecoderBlocklistTest {
    private fun codec(name: String): MediaCodecInfo = MediaCodecInfo.newInstance(
        name,
        "video/hevc",
        "video/hevc",
        /* capabilities = */ null,
        /* hardwareAccelerated = */ name.contains("goldfish"),
        /* softwareOnly = */ !name.contains("goldfish"),
        /* vendor = */ false,
        /* forceDisableAdaptive = */ false,
        /* forceSecure = */ false,
    )

    @Test
    fun `blocking a decoder is reported once`() {
        val blocklist = DecoderBlocklist()
        assertTrue(blocklist.block("c2.goldfish.hevc.decoder"))
        assertFalse(blocklist.block("c2.goldfish.hevc.decoder"))
        assertTrue(blocklist.isBlocked("c2.goldfish.hevc.decoder"))
    }

    @Test
    fun `blocked decoders are dropped but order is kept`() {
        val blocklist = DecoderBlocklist()
        blocklist.block("a")
        val result = blocklist.filter(listOf(codec("a"), codec("b"), codec("c")))
        assertEquals(listOf("b", "c"), result.map { it.name })
    }

    @Test
    fun `the last remaining decoder is never filtered away`() {
        val blocklist = DecoderBlocklist()
        blocklist.block("a")
        blocklist.block("b")
        val result = blocklist.filter(listOf(codec("a"), codec("b")))
        assertEquals(listOf("a", "b"), result.map { it.name })
    }
}
