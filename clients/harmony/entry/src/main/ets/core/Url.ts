/**
 * Pure server-URL helpers: normalising user-entered server addresses and
 * joining server-relative paths onto an active server origin.
 *
 * No ArkUI, no @kit./@ohos. imports, no decorators -- plain TypeScript only.
 * Node-testable under `node --test` after a tsc transpile.
 */

const HTTPS_SCHEME = 'https://';
const HTTP_SCHEME = 'http://';

/**
 * Normalises a single user-entered server URL:
 * - trims leading/trailing whitespace
 * - requires an http:// or https:// scheme (matched case-insensitively)
 * - rejects internal whitespace and an empty host
 * - strips exactly one trailing slash
 *
 * Never throws. Returns null for anything unparseable.
 */
export function normaliseServerUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (/\s/.test(trimmed)) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  let schemeLength = 0;
  if (lower.indexOf(HTTPS_SCHEME) === 0) {
    schemeLength = HTTPS_SCHEME.length;
  } else if (lower.indexOf(HTTP_SCHEME) === 0) {
    schemeLength = HTTP_SCHEME.length;
  } else {
    return null;
  }
  let normalised = trimmed;
  if (normalised.charAt(normalised.length - 1) === '/') {
    normalised = normalised.substring(0, normalised.length - 1);
  }
  if (normalised.length <= schemeLength) {
    // Nothing left after the scheme once the trailing slash is stripped --
    // e.g. "http://" or "http:///" -- there is no host at all.
    return null;
  }
  return normalised;
}

/**
 * Normalises a list of user-entered server URLs: maps each one through
 * normaliseServerUrl, drops anything unparseable, and dedupes the survivors
 * while preserving first-seen order.
 */
export function normaliseServerUrlList(inputs: string[]): string[] {
  const result: string[] = [];
  for (const input of inputs) {
    const normalised = normaliseServerUrl(input);
    if (normalised === null) {
      continue;
    }
    if (result.indexOf(normalised) === -1) {
      result.push(normalised);
    }
  }
  return result;
}

/**
 * Joins a server-relative path onto a base server origin, ensuring exactly
 * one slash sits between them.
 *
 * INVARIANT (brief section 4.10): `PlaybackInfoResponse.url` is ALWAYS a
 * server-relative path -- e.g. "/api/v1/media/{media_file_id}/stream?..." or
 * "/api/v1/media/renditions/{rendition_id}/playlist.m3u8" -- never an
 * absolute URL. Every branch of playback negotiation (direct play, an
 * existing ready rendition, a fresh on-demand transcode) produces a path
 * beginning with "/api/v1/...". It must never be treated as already
 * absolute. If serverRelativePath ever arrives with its own http:// or
 * https:// scheme, that is a server contract violation, not a value this
 * function should silently mis-join -- throw loudly instead of guessing.
 */
export function absoluteUrl(base: string, serverRelativePath: string): string {
  const lowerPath = serverRelativePath.toLowerCase();
  if (lowerPath.indexOf(HTTPS_SCHEME) === 0 || lowerPath.indexOf(HTTP_SCHEME) === 0) {
    throw new Error(
      'absoluteUrl: expected a server-relative path but received an absolute URL: ' + serverRelativePath
    );
  }
  let normalisedBase = base;
  if (normalisedBase.length > 0 && normalisedBase.charAt(normalisedBase.length - 1) === '/') {
    normalisedBase = normalisedBase.substring(0, normalisedBase.length - 1);
  }
  let normalisedPath = serverRelativePath;
  if (normalisedPath.length > 0 && normalisedPath.charAt(0) === '/') {
    normalisedPath = normalisedPath.substring(1);
  }
  return normalisedBase + '/' + normalisedPath;
}
