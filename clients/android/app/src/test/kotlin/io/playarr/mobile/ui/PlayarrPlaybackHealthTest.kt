package io.playarr.mobile.ui

import android.view.Display
import io.playarr.shared.data.model.HealthFact
import io.playarr.shared.data.model.HealthFinding
import io.playarr.shared.data.model.HealthProvenance
import io.playarr.shared.data.model.HealthSeverity
import io.playarr.shared.data.model.PlaybackHealthExport
import io.playarr.shared.player.DecoderKind
import io.playarr.shared.player.PlaybackDiagnostics
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class PlayarrPlaybackHealthTest {
    @Test
    fun requestWithNoPlayerDataMeasuresNothing() {
        val request = playarrBuildHealthRequest(PlaybackDiagnostics(), emptyList())
        val measured = request.measured
        assertNull(measured.videoCodec)
        assertNull(measured.decoderKind)
        assertNull(measured.droppedFrames)
        assertNull(measured.rebufferCount)
        assertNull(measured.audioPassthrough)
        assertNull(measured.hdrActive)
        assertTrue(request.reported.videoCodecs.contains("h264"))
        assertTrue(request.reported.hdrFormats.isEmpty())
    }

    @Test
    fun requestCarriesOnlyWhatThePlayerObserved() {
        val request = playarrBuildHealthRequest(
            PlaybackDiagnostics(
                videoCodec = "hevc",
                decoderName = "c2.vendor.hevc.decoder",
                decoderKind = DecoderKind.Hardware,
                width = 3840,
                height = 2160,
                droppedFrames = 12,
                rebufferCount = 2,
                rebufferMs = 3400,
                throughputBps = 40_000_000,
                audioCodec = "eac3",
                audioChannels = 6,
                audioPassthrough = true,
            ),
            displayHdrFormats = listOf("hdr10"),
            throughputOverrideBps = 55_000_000,
        )
        val measured = request.measured
        assertEquals("hevc", measured.videoCodec)
        assertEquals("hardware", measured.decoderKind)
        assertEquals(3840, measured.width)
        assertEquals(12L, measured.droppedFrames)
        assertEquals(true, measured.audioPassthrough)
        assertEquals(55_000_000L, measured.throughputBps)
        assertEquals(listOf("hdr10"), request.reported.displayHdrFormats)
        assertNull("HDR output is never claimed from the player side", measured.hdrActive)
    }

    @Test
    fun unknownDecoderKindIsOmittedNotGuessed() {
        val request = playarrBuildHealthRequest(
            PlaybackDiagnostics(videoCodec = "h264", decoderName = "c2.vendor.avc", decoderKind = DecoderKind.Unknown),
            emptyList(),
        )
        assertNull(request.measured.decoderKind)
        assertEquals(0L, request.measured.droppedFrames)
    }

    @Test
    fun hdrTypeIdsMapToWireNamesAndDropUnknownOnes() {
        val names = playarrHdrTypeNames(
            intArrayOf(
                Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION,
                Display.HdrCapabilities.HDR_TYPE_HDR10,
                Display.HdrCapabilities.HDR_TYPE_HDR10,
                Display.HdrCapabilities.HDR_TYPE_HLG,
                99,
            ),
        )
        assertEquals(listOf("dolby_vision", "hdr10", "hlg"), names)
    }

    @Test
    fun findingsAreOrderedBySeverityAndStable() {
        fun finding(code: String, severity: HealthSeverity) = HealthFinding(code, severity, code, "", null)
        val sorted = playarrSortFindings(
            listOf(
                finding("a", HealthSeverity.Ok),
                finding("b", HealthSeverity.Warning),
                finding("c", HealthSeverity.Problem),
                finding("d", HealthSeverity.Warning),
                finding("e", HealthSeverity.Info),
            ),
        )
        assertEquals(listOf("c", "b", "d", "e", "a"), sorted.map { it.code })
    }

    @Test
    fun aFactWithoutAValueIsUnknownWhateverTheServerSays() {
        val fact = HealthFact("k", "k", null, HealthProvenance.Reported)
        assertEquals(HealthProvenance.Unknown, playarrFactProvenance(fact))
        assertEquals(HealthProvenance.Reported, playarrFactProvenance(fact.copy(value = "x")))
    }

    @Test
    fun summaryViewKeepsOnlyDeliveryFacts() {
        val facts = listOf("play_method", "decoder_kind", "delivered_audio").map { HealthFact(it, it, "v") }
        assertEquals(listOf("play_method", "delivered_audio"), playarrSummaryFacts(facts).map { it.key })
    }

    @Test
    fun bitratesAreFormattedForHumans() {
        assertEquals("25.4 Mbit/s", playarrFormatBitrate(25_400_000))
        assertEquals("640 kbit/s", playarrFormatBitrate(640_000))
    }

    @Test
    fun errorsMapToUsefulMessages() {
        val notFound = HttpException(Response.error<Any>(404, "".toResponseBody()))
        val forbidden = HttpException(Response.error<Any>(403, "".toResponseBody()))
        val server = HttpException(Response.error<Any>(500, "".toResponseBody()))
        assertEquals(PlayarrHealthError.NotAvailable, playarrHealthErrorFor(notFound))
        assertEquals(PlayarrHealthError.NotAvailable, playarrHealthErrorFor(forbidden))
        assertEquals(PlayarrHealthError.Network, playarrHealthErrorFor(server))
        assertEquals(PlayarrHealthError.Network, playarrHealthErrorFor(java.io.IOException("x")))
        assertEquals(
            PlayarrHealthError.NoSession,
            playarrHealthErrorFor(PlayarrHealthException(PlayarrHealthError.NoSession)),
        )
    }

    @Test
    fun exportTextIsTheRedactedExportOnly() {
        val export = PlaybackHealthExport(
            schema = "playarr.playback-health.v1",
            generatedAt = "2026-10-03T10:00:00Z",
            clientPlatform = "android",
            clientVersion = "1.0.0",
            playMethod = "direct_play",
            findingCodes = listOf("direct_play"),
            redaction = "none",
        )
        val text = playarrHealthExportText(export)
        assertTrue(text, "\"finding_codes\"" in text)
        assertTrue(text, "direct_play" in text)
        assertFalse(text, "token" in text.lowercase())
        assertTrue("pretty printed", text.contains("\n"))
    }

    @Test
    fun everyHealthStringIsTranslated() {
        val health = PlayarrString.entries.filter { it.name.startsWith("Health") }
        assertTrue(health.size >= 20)
        health.forEach {
            assertTrue(it.name, it.english.isNotBlank() && it.thai.isNotBlank() && it.japanese.isNotBlank())
        }
    }
}
