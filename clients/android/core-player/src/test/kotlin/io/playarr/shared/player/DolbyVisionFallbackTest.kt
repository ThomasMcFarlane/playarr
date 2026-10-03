package io.playarr.shared.player

import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import io.playarr.shared.player.DolbyVisionFallbackExtractorsFactory.Companion.dolbyVisionBaseLayerFormat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DolbyVisionFallbackTest {
    private fun dolbyVision(codecs: String) = Format.Builder()
        .setSampleMimeType(MimeTypes.VIDEO_DOLBY_VISION)
        .setCodecs(codecs)
        .setWidth(3840)
        .setHeight(2160)
        .setContainerMimeType(MimeTypes.VIDEO_MATROSKA)
        .build()

    @Test
    fun `profile 7 dual layer falls back to its hevc base layer`() {
        val result = dolbyVisionBaseLayerFormat(dolbyVision("dvhe.07.06"))!!
        assertEquals(MimeTypes.VIDEO_H265, result.sampleMimeType)
        assertNull(result.codecs)
        assertEquals(3840, result.width)
        assertEquals(2160, result.height)
        assertEquals(MimeTypes.VIDEO_MATROSKA, result.containerMimeType)
    }

    @Test
    fun `profile 8 hevc falls back to hevc`() {
        assertEquals(MimeTypes.VIDEO_H265, dolbyVisionBaseLayerFormat(dolbyVision("dvh1.08.06"))!!.sampleMimeType)
    }

    @Test
    fun `avc and av1 based profiles fall back to their own base codec`() {
        assertEquals(MimeTypes.VIDEO_H264, dolbyVisionBaseLayerFormat(dolbyVision("dvav.09.03"))!!.sampleMimeType)
        assertEquals(MimeTypes.VIDEO_AV1, dolbyVisionBaseLayerFormat(dolbyVision("dav1.10.01"))!!.sampleMimeType)
    }

    @Test
    fun `non dolby vision formats are left alone`() {
        val hevc = Format.Builder().setSampleMimeType(MimeTypes.VIDEO_H265).setCodecs("hvc1.2.4.L153").build()
        assertNull(dolbyVisionBaseLayerFormat(hevc))
    }
}
