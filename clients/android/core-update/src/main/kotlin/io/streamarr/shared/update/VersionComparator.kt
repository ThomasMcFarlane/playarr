package io.streamarr.shared.update

/**
 * Compares two release-version strings (`CompatibilityEntry.latestVersion`/
 * `minSupportedVersion` from `GET /api/system/version`, and this build's own
 * `BuildConfig.VERSION_NAME`) numerically, component by component, the way
 * SemVer's precedence rules do for the common case -- see
 * `docs/versioning-policy.md`'s "Release version (SemVer)".
 *
 * Deliberately not a full SemVer implementation: it ignores build metadata
 * (`+...`) and treats a pre-release suffix (`-beta.1`) as if it weren't
 * there, comparing only the numeric `major.minor.patch...` run at the
 * front of each string. That is enough for this module's one job --
 * deciding whether this build's version is at least as new as a
 * server-reported floor/latest -- without pulling in a full SemVer
 * dependency for a comparison this narrow. A component that isn't a
 * plain non-negative integer (including a missing one, e.g. comparing
 * `"1.2"` against `"1.2.3"`) is treated as `0`, and a version string with no
 * parseable numeric component at all sorts as entirely `0` -- lower than
 * anything with a real number in it, so a malformed server value degrades
 * to "always looks outdated" rather than silently comparing as up to date.
 */
object VersionComparator {

    /** Returns a negative number if [a] < [b], zero if equal, positive if [a] > [b] (same contract as [Comparator.compare]). */
    fun compare(a: String, b: String): Int {
        val partsA = numericParts(a)
        val partsB = numericParts(b)
        val length = maxOf(partsA.size, partsB.size)
        for (i in 0 until length) {
            val partA = partsA.getOrElse(i) { 0 }
            val partB = partsB.getOrElse(i) { 0 }
            val result = partA.compareTo(partB)
            if (result != 0) return result
        }
        return 0
    }

    /** `a < b`. */
    fun isLessThan(a: String, b: String): Boolean = compare(a, b) < 0

    private fun numericParts(version: String): List<Long> =
        version
            .substringBefore('+')
            .substringBefore('-')
            .split('.')
            .map { it.toLongOrNull() ?: 0L }
}
