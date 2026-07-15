/**
 * @streamarr-tv/domain
 *
 * As foretold by this package's original placeholder comment: now that
 * `@streamarr-tv/api-client` generates real wire types straight off
 * `backend/openapi/streamarr.yaml` (`Work`, `PlaybackInfo`,
 * `ClientPlatform`, ...), this package has narrowed down to what's left --
 * client-local concepts that don't round-trip the API. That's where to find
 * the API (below), plus -- per Round D -- the client self-update story built
 * on the same "defensive, never-throws resolution" shape: evaluating a
 * client's own version against the server's compatibility table
 * (`./version-check`) and, for the Web/TV-web family specifically, polling
 * the CDN-hosted build manifest that is Web's OTA update signal
 * (`./bundle-manifest`). Import wire-shape types directly from
 * `@streamarr-tv/api-client` instead of from here.
 */

export {
  compareVersions,
  evaluateClientVersion,
  type ClientVersionEvaluation,
  type ClientVersionStatus,
  type CompatibilityEntryLike,
} from "./version-check";

export {
  BUNDLE_MANIFEST_FILE_NAME,
  fetchBuildManifest,
  isNewerBundleAvailable,
  type BuildManifest,
  type FetchBuildManifestOptions,
} from "./bundle-manifest";

/** Default Streamarr API origin for local development. */
export const DEFAULT_API_BASE_URL = "http://localhost:8080";

/** Query param TV apps (no keyboard input) can be launched with to point at a non-default API origin. */
export const API_BASE_URL_QUERY_PARAM = "apiBaseUrl";

/**
 * Path (relative to the app's own base, see `import.meta.env.BASE_URL`) of an
 * optional operator-editable JSON file shipped alongside the built TV app
 * bundle -- e.g. dropped onto the device/USB image post-install, no rebuild
 * required. Absent by default; see each TV app's README for how to provide one.
 */
export const RUNTIME_CONFIG_FILE_NAME = "streamarr-config.json";

/** Shape of the optional runtime config file above. */
export interface RuntimeConfigFile {
  apiBaseUrl?: string;
}

/** The one setting every Streamarr client needs: which operator-run instance to talk to. */
export interface AppSettings {
  apiBaseUrl: string;
}

export interface ResolveApiBaseUrlOptions {
  /** e.g. `window.location.search`. Defaults to `window.location.search` when `window` exists. */
  search?: string;
  /** Injectable for tests / non-browser runtimes. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Where to look for a runtime config file. Pass `null` to skip the lookup entirely (e.g. on the web app, which has a real Settings UI instead). */
  configFileUrl?: string | null;
}

/**
 * Resolves the API base URL for a client that has no keyboard input to type
 * one in (the three TV app shells): an explicit `?apiBaseUrl=...` query
 * param wins, then an optional operator-provided runtime config JSON file
 * shipped next to the app bundle, then `DEFAULT_API_BASE_URL`. Never throws
 * -- a missing/unreachable config file is the expected common case in dev
 * and just falls through to the next option.
 */
export async function resolveApiBaseUrl(options: ResolveApiBaseUrlOptions = {}): Promise<string> {
  const search = options.search ?? (typeof window !== "undefined" ? window.location.search : "");
  const fromQuery = new URLSearchParams(search).get(API_BASE_URL_QUERY_PARAM);
  if (fromQuery) return fromQuery;

  const fetchImpl = options.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  const configFileUrl = options.configFileUrl === undefined ? RUNTIME_CONFIG_FILE_NAME : options.configFileUrl;

  if (fetchImpl && configFileUrl) {
    try {
      const response = await fetchImpl(configFileUrl, { cache: "no-store" });
      if (response.ok) {
        const json = (await response.json()) as RuntimeConfigFile;
        if (json.apiBaseUrl) return json.apiBaseUrl;
      }
    } catch {
      // No config file shipped, or unreachable -- expected in dev. Fall through to the default.
    }
  }

  return DEFAULT_API_BASE_URL;
}

const STORED_API_BASE_URL_KEY = "streamarr:apiBaseUrl";

/** Reads the operator-entered API base URL persisted by the web app's Settings page, if any. */
export function getStoredApiBaseUrl(): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  return localStorage.getItem(STORED_API_BASE_URL_KEY) ?? undefined;
}

/** Persists (or, given an empty string, clears) the web app's operator-entered API base URL. */
export function setStoredApiBaseUrl(value: string): void {
  if (typeof localStorage === "undefined") return;
  if (value) {
    localStorage.setItem(STORED_API_BASE_URL_KEY, value);
  } else {
    localStorage.removeItem(STORED_API_BASE_URL_KEY);
  }
}
