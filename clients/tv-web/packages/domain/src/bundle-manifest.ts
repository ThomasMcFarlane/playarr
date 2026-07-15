/**
 * The CDN-hosted "build manifest" poll pattern documented as the Web
 * client's OTA mechanism in
 * `docs/architecture/clients/web.md#self-update--ota-mechanism`: every
 * deployed build publishes a small JSON file recording the bundle version it
 * shipped, at a well-known path served alongside (but distinct from) the PWA
 * installability `manifest.json`. A running client polls this file and
 * compares it to its own baked-in bundle version to decide whether a newer
 * build exists.
 *
 * This is deliberately the same shape of defensive, never-throws resolution
 * as `resolveApiBaseUrl` above: a missing/unreachable manifest (no CDN
 * fronting it yet, offline, dev server with no manifest file) is the
 * expected common case, not an error worth surfacing to the caller as one.
 *
 * Only meaningful for the Web/TV-web family that actually has an OTA path
 * (Web, and -- per `vidaa.md` -- optionally the VIDAA PWA sideload fallback
 * once that path is validated); webOS and Tizen have no OTA loophole at all
 * (full store resubmission every release) and don't poll this.
 */
import { compareVersions } from "./version-check";

/** Path (relative to the app's own base) of the CDN-hosted build manifest. */
export const BUNDLE_MANIFEST_FILE_NAME = "build-manifest.json";

/** Shape of the build manifest file described above. */
export interface BuildManifest {
  /** The bundle version this deploy shipped, compared against the running client's own baked-in version. */
  bundleVersion: string;
  /** The `apiVersion` this bundle was built against, informational only today. */
  apiVersion?: string;
}

export interface FetchBuildManifestOptions {
  /** Defaults to `BUNDLE_MANIFEST_FILE_NAME` (root-relative). */
  manifestUrl?: string;
  /** Injectable for tests / non-browser runtimes. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

function isBuildManifestShape(value: unknown): value is BuildManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { bundleVersion?: unknown }).bundleVersion === "string"
  );
}

/**
 * Fetches and parses the CDN build manifest. Never throws -- a missing
 * file (404), an unreachable CDN, or a malformed body all resolve to
 * `null` so callers can treat "no manifest available this tick" as simply
 * "nothing to prompt about yet" rather than a fetch error to handle.
 */
export async function fetchBuildManifest(options: FetchBuildManifestOptions = {}): Promise<BuildManifest | null> {
  const fetchImpl = options.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  const manifestUrl = options.manifestUrl ?? BUNDLE_MANIFEST_FILE_NAME;
  if (!fetchImpl) return null;

  try {
    const response = await fetchImpl(manifestUrl, { cache: "no-store" });
    if (!response.ok) return null;
    const json: unknown = await response.json();
    if (!isBuildManifestShape(json)) return null;
    return { bundleVersion: json.bundleVersion, apiVersion: json.apiVersion };
  } catch {
    return null;
  }
}

/** True when the manifest advertises a strictly newer bundle than the one currently running. */
export function isNewerBundleAvailable(currentBundleVersion: string, manifest: BuildManifest): boolean {
  return compareVersions(manifest.bundleVersion, currentBundleVersion) > 0;
}
