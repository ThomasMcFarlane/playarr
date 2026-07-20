package io.streamarr.shared.update

import io.streamarr.shared.data.model.ClientPlatform
import io.streamarr.shared.data.model.CompatibilityEntry
import io.streamarr.shared.data.model.VersionEnvelope
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Exercises [UpdateAvailabilityEvaluator] against hand-built
 * `VersionEnvelope` fixtures shaped exactly like `GET /api/system/version`'s
 * real response (`VersionEnvelope`/`CompatibilityEntry` in
 * `backend/openapi/streamarr.yaml`) -- no live server or Play Store needed,
 * per this task's mocked-envelope testing requirement.
 */
class UpdateAvailabilityEvaluatorTest {

    private fun envelopeWith(vararg entries: CompatibilityEntry): VersionEnvelope = VersionEnvelope(
        serverVersion = "2.4.1",
        apiVersion = "17",
        compatibility = entries.toList(),
    )

    private fun entry(
        platform: ClientPlatform,
        latestVersion: String,
        minSupportedVersion: String,
    ): CompatibilityEntry = CompatibilityEntry(platform = platform, latestVersion = latestVersion, minSupportedVersion = minSupportedVersion)

    @Test
    fun `a build at the latest version for its platform needs no update`() {
        val envelope = envelopeWith(entry(ClientPlatform.AndroidMobile, latestVersion = "2.4.1", minSupportedVersion = "2.2.0"))
        val severity = UpdateAvailabilityEvaluator.evaluate("2.4.1", ClientPlatform.AndroidMobile, envelope)
        assertEquals(UpdateSeverity.None, severity)
    }

    @Test
    fun `a build ahead of the latest version, e g a dev build, needs no update`() {
        val envelope = envelopeWith(entry(ClientPlatform.AndroidMobile, latestVersion = "2.4.1", minSupportedVersion = "2.2.0"))
        val severity = UpdateAvailabilityEvaluator.evaluate("2.5.0", ClientPlatform.AndroidMobile, envelope)
        assertEquals(UpdateSeverity.None, severity)
    }

    @Test
    fun `a build between the floor and the latest version is Recommended`() {
        val envelope = envelopeWith(entry(ClientPlatform.AndroidMobile, latestVersion = "2.4.1", minSupportedVersion = "2.2.0"))
        val severity = UpdateAvailabilityEvaluator.evaluate("2.3.0", ClientPlatform.AndroidMobile, envelope)
        assertTrue(severity is UpdateSeverity.Recommended)
        assertEquals("2.4.1", (severity as UpdateSeverity.Recommended).latestVersion)
    }

    @Test
    fun `a build exactly at the floor is Recommended, not Required -- the floor is still supported`() {
        val envelope = envelopeWith(entry(ClientPlatform.AndroidMobile, latestVersion = "2.4.1", minSupportedVersion = "2.2.0"))
        val severity = UpdateAvailabilityEvaluator.evaluate("2.2.0", ClientPlatform.AndroidMobile, envelope)
        assertTrue(severity is UpdateSeverity.Recommended)
    }

    @Test
    fun `a build below the floor is Required`() {
        val envelope = envelopeWith(entry(ClientPlatform.AndroidMobile, latestVersion = "2.4.1", minSupportedVersion = "2.2.0"))
        val severity = UpdateAvailabilityEvaluator.evaluate("2.1.9", ClientPlatform.AndroidMobile, envelope)
        assertTrue(severity is UpdateSeverity.Required)
        assertEquals("2.2.0", (severity as UpdateSeverity.Required).minSupportedVersion)
    }

    @Test
    fun `evaluation is keyed by platform -- an android-tv row doesn't affect an android-mobile check`() {
        val envelope = envelopeWith(
            entry(ClientPlatform.AndroidMobile, latestVersion = "2.4.1", minSupportedVersion = "2.2.0"),
            entry(ClientPlatform.AndroidTv, latestVersion = "1.0.0", minSupportedVersion = "0.9.0"),
        )
        val severity = UpdateAvailabilityEvaluator.evaluate("2.4.1", ClientPlatform.AndroidMobile, envelope)
        assertEquals(UpdateSeverity.None, severity)
    }

    @Test
    fun `no row for this platform at all means no update is signalled`() {
        val envelope = envelopeWith(entry(ClientPlatform.Ios, latestVersion = "9.9.9", minSupportedVersion = "9.9.9"))
        val severity = UpdateAvailabilityEvaluator.evaluate("0.1.0", ClientPlatform.AndroidTv, envelope)
        assertEquals(UpdateSeverity.None, severity)
    }
}
