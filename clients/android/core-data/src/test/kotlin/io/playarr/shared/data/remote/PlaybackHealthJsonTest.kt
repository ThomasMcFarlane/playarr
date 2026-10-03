package io.playarr.shared.data.remote

import io.playarr.shared.data.model.ClientPlaybackReport
import io.playarr.shared.data.model.HealthProvenance
import io.playarr.shared.data.model.HealthSeverity
import io.playarr.shared.data.model.MeasuredPlayback
import io.playarr.shared.data.model.PlaybackHealthReport
import io.playarr.shared.data.model.ReportedCapabilities
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackHealthJsonTest {
    private val json = PlayarrHttpClient.json

    @Test
    fun `decodes the server health report shape`() {
        val report = json.decodeFromString<PlaybackHealthReport>(
            """
            {
              "headline": "Playing, with limitations",
              "severity": "warning",
              "play_method": "transcode",
              "facts": [
                {"key": "decoder_kind", "label": "Decoder", "value": null, "provenance": "unknown", "source": null},
                {"key": "play_method", "label": "Delivery", "value": "Transcoding", "provenance": "measured", "source": "server"}
              ],
              "findings": [
                {"code": "hdr_to_sdr", "severity": "warning", "title": "HDR10 was converted to SDR",
                 "detail": "d", "next_action": "Choose Original quality"}
              ],
              "qualification": {"status": "not_assessed", "note": "n"},
              "export": {
                "schema": "playarr.playback-health.v1",
                "generated_at": "2026-10-03T10:00:00Z",
                "client_platform": "android",
                "client_version": "1.0.0",
                "play_method": "transcode",
                "transcode_reason": "video_codec_not_supported",
                "facts": [{"key": "play_method", "value": "Transcoding", "provenance": "measured"}],
                "finding_codes": ["hdr_to_sdr"],
                "redaction": "none"
              },
              "future_field": 1
            }
            """.trimIndent(),
        )
        assertEquals(HealthSeverity.Warning, report.severity)
        assertEquals(HealthProvenance.Unknown, report.facts[0].provenance)
        assertNull(report.facts[0].value)
        assertEquals("Choose Original quality", report.findings[0].nextAction)
        assertEquals(listOf("hdr_to_sdr"), report.export.findingCodes)
        assertEquals("video_codec_not_supported", report.export.transcodeReason)
    }

    @Test
    fun `encodes only what was measured and uses snake_case names`() {
        val body = json.encodeToString(
            ClientPlaybackReport.serializer(),
            ClientPlaybackReport(
                reported = ReportedCapabilities(videoCodecs = listOf("h264"), displayHdrFormats = listOf("hdr10")),
                measured = MeasuredPlayback(droppedFrames = 3, audioPassthrough = false),
            ),
        )
        assertTrue(body, "\"display_hdr_formats\":[\"hdr10\"]" in body)
        assertTrue(body, "\"dropped_frames\":3" in body)
        assertTrue(body, "\"audio_passthrough\":false" in body)
        assertFalse("hdr_active must be omitted when unknown: $body", "hdr_active" in body)
        assertFalse("decoder_kind must be omitted when unknown: $body", "decoder_kind" in body)
    }
}
