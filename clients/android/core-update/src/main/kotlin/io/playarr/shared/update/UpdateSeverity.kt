package io.playarr.shared.update

/**
 * How urgently this build should update, per `docs/versioning-policy.md`'s
 * per-platform table -- the output of [UpdateAvailabilityEvaluator].
 */
sealed interface UpdateSeverity {
    /** This build is at or above the server's reported `latestVersion` for this platform. */
    data object None : UpdateSeverity

    /** Below `latestVersion` but still at/above `minSupportedVersion` -- a routine, backgroundable update (Play's Flexible flow). */
    data class Recommended(val latestVersion: String) : UpdateSeverity

    /** Below `minSupportedVersion` -- this build is no longer supported and must update before continuing (Play's Immediate flow). */
    data class Required(val minSupportedVersion: String) : UpdateSeverity
}
