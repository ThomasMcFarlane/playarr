package io.playarr.shared.player

import android.media.AudioFormat
import androidx.media3.common.MimeTypes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackDiagnosticsTest {
    @Test
    fun codecNamesMatchTheServerVocabulary() {
        assertEquals("h264", DiagnosticNames.videoCodec(MimeTypes.VIDEO_H264))
        assertEquals("hevc", DiagnosticNames.videoCodec(MimeTypes.VIDEO_H265))
        assertEquals("av1", DiagnosticNames.videoCodec(MimeTypes.VIDEO_AV1))
        assertEquals("eac3", DiagnosticNames.audioCodec(MimeTypes.AUDIO_E_AC3))
        assertEquals("eac3", DiagnosticNames.audioCodec(MimeTypes.AUDIO_E_AC3_JOC))
        assertEquals("truehd", DiagnosticNames.audioCodec(MimeTypes.AUDIO_TRUEHD))
        assertNull(DiagnosticNames.videoCodec(null))
    }

    @Test
    fun decoderKindTrustsThePlatformBeforeNames() {
        assertEquals(DecoderKind.Software, DiagnosticNames.decoderKind("c2.vendor.fancy", false, true))
        assertEquals(DecoderKind.Hardware, DiagnosticNames.decoderKind("c2.vendor.fancy", true, false))
        assertEquals(DecoderKind.Software, DiagnosticNames.decoderKind("c2.android.hevc.decoder", null, null))
        assertEquals(DecoderKind.Software, DiagnosticNames.decoderKind("OMX.google.h264.decoder", null, null))
    }

    @Test
    fun decoderKindStaysUnknownRatherThanGuessingHardware() {
        assertEquals(DecoderKind.Unknown, DiagnosticNames.decoderKind("c2.vendor.fancy", null, null))
        assertEquals(DecoderKind.Unknown, DiagnosticNames.decoderKind(null, true, false))
        assertEquals(DecoderKind.Unknown, DiagnosticNames.decoderKind("", null, null))
        assertNull(DecoderKind.Unknown.wire)
    }

    @Test
    fun onlyBitstreamEncodingsCountAsPassthrough() {
        assertFalse(DiagnosticNames.isPassthroughEncoding(AudioFormat.ENCODING_PCM_16BIT))
        assertFalse(DiagnosticNames.isPassthroughEncoding(AudioFormat.ENCODING_PCM_FLOAT))
        assertTrue(DiagnosticNames.isPassthroughEncoding(AudioFormat.ENCODING_E_AC3))
        assertTrue(DiagnosticNames.isPassthroughEncoding(AudioFormat.ENCODING_DTS))
        assertFalse(DiagnosticNames.isPassthroughEncoding(AudioFormat.ENCODING_INVALID))
    }

    @Test
    fun emptyDiagnosticsReportNoMeasurements() {
        assertFalse(PlaybackDiagnostics().hasMeasurements)
        assertTrue(PlaybackDiagnostics(videoCodec = "h264").hasMeasurements)
        assertNull(PlaybackDiagnostics().audioPassthrough)
    }
}
