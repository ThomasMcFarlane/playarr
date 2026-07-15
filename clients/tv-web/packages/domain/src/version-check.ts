/**
 * Client-version floor/deprecation evaluation, shared by every Streamarr
 * client surface that talks to `GET /api/system/version`
 * (`VersionEnvelope`/`CompatibilityEntry` in `backend/openapi/streamarr.yaml`)
 * -- see `docs/versioning-policy.md` for the server-side half of this
 * contract (the `426 Upgrade Required` version-gate middleware) and
 * `docs/architecture/clients/*.md`'s "Self-update / OTA mechanism" /
 * "Store submission process and constraints" sections for what each
 * platform does with the result.
 *
 * This module intentionally does not import `@streamarr-tv/api-client`'s
 * generated types (see this package's top-of-file comment) -- `CompatibilityEntryLike`
 * below is a structural duck-type of the real `CompatibilityEntry` wire
 * shape, so callers can pass `VersionEnvelope.compatibility` straight
 * through without this package depending on the generated schema.
 */

/** Structural mirror of `components["schemas"]["CompatibilityEntry"]`. */
export interface CompatibilityEntryLike {
  platform: string;
  latest_version: string;
  min_supported_version: string;
  deprecated_below?: string | null;
  sunset?: string | null;
}

export type ClientVersionStatus = "supported" | "deprecated" | "unsupported";

export interface ClientVersionEvaluation {
  /**
   * `"unsupported"`: below `min_supported_version` -- the server would
   * reject requests with `426 Upgrade Required`; the client should treat
   * this as a hard floor (force-reload on Web, non-dismissible banner on TV).
   * `"deprecated"`: below `deprecated_below` but still `>= min_supported_version`
   * -- still works today, but update-nagging is appropriate.
   * `"supported"`: at or above `deprecated_below` (or no `deprecated_below` set).
   */
  status: ClientVersionStatus;
  latestVersion?: string;
  sunset?: string | null;
}

/**
 * Compares two dot-separated, numeric-segment version strings (e.g.
 * `"1.4.0"` vs `"1.12.2"`), numerically per segment rather than
 * lexicographically, so `"1.12.0" > "1.9.0"`. Returns `-1 | 0 | 1`.
 *
 * Deliberately permissive rather than a full semver implementation: a
 * missing segment is treated as `0`, and a non-numeric segment also
 * compares as `0` -- an unparsable version string never throws, it just
 * stops being a useful ordering signal (better to silently treat it as
 * equal than to crash a client's version-check on a malformed string).
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const segmentsA = a.split(".");
  const segmentsB = b.split(".");
  const length = Math.max(segmentsA.length, segmentsB.length);

  for (let i = 0; i < length; i++) {
    const numA = Number.parseInt(segmentsA[i] ?? "0", 10);
    const numB = Number.parseInt(segmentsB[i] ?? "0", 10);
    const valueA = Number.isNaN(numA) ? 0 : numA;
    const valueB = Number.isNaN(numB) ? 0 : numB;
    if (valueA < valueB) return -1;
    if (valueA > valueB) return 1;
  }
  return 0;
}

/**
 * Evaluates a running client's own version against the server's
 * compatibility table for its platform. Looks up `platform` in
 * `compatibility` (matching `VersionEnvelope.compatibility` straight from
 * `GET /api/system/version`); when this platform has no entry in the table
 * at all, that's treated as "nothing to enforce" (`"supported"`) rather
 * than an error, since an operator's server may not have published rows
 * for every platform yet.
 */
export function evaluateClientVersion(
  currentVersion: string,
  platform: string,
  compatibility: readonly CompatibilityEntryLike[]
): ClientVersionEvaluation {
  const entry = compatibility.find((candidate) => candidate.platform === platform);
  if (!entry) {
    return { status: "supported" };
  }

  if (compareVersions(currentVersion, entry.min_supported_version) < 0) {
    return { status: "unsupported", latestVersion: entry.latest_version, sunset: entry.sunset };
  }

  if (entry.deprecated_below && compareVersions(currentVersion, entry.deprecated_below) < 0) {
    return { status: "deprecated", latestVersion: entry.latest_version, sunset: entry.sunset };
  }

  return { status: "supported", latestVersion: entry.latest_version, sunset: entry.sunset };
}
