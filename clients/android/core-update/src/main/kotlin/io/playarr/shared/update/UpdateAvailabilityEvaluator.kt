package io.playarr.shared.update

import io.playarr.shared.data.model.ClientPlatform
import io.playarr.shared.data.model.VersionEnvelope

/**
 * Compares this build's own version against the `GET /api/system/version`
 * envelope's row for its platform (`VersionEnvelope.compatibility`, keyed
 * by [ClientPlatform] -- `"android-mobile"`/`"android-tv"` on the wire, see
 * `CompatibilityEntry`), producing an [UpdateSeverity]. Pure and
 * side-effect-free so it's fully unit-testable against hand-built envelope
 * fixtures, independent of any real network call or Play Core API -- see
 * `AppUpdateCoordinator` for where the result actually drives Play's
 * In-App Updates flow.
 */
object UpdateAvailabilityEvaluator {

    fun evaluate(
        currentVersion: String,
        platform: ClientPlatform,
        envelope: VersionEnvelope,
    ): UpdateSeverity {
        val entry = envelope.compatibility.firstOrNull { it.platform == platform }
            // No row for this platform at all -- nothing to compare against, so there's nothing to say but "no update".
            ?: return UpdateSeverity.None

        return when {
            VersionComparator.isLessThan(currentVersion, entry.minSupportedVersion) -> UpdateSeverity.Required(entry.minSupportedVersion)
            VersionComparator.isLessThan(currentVersion, entry.latestVersion) -> UpdateSeverity.Recommended(entry.latestVersion)
            else -> UpdateSeverity.None
        }
    }
}
