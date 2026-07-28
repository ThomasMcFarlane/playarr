// core/Headers.ts
//
// Builds the header map every Playarr Server request carries. This is the ONLY
// file under core/ allowed to contain the literal header-name strings
// "x-playarr-client-platform" and "x-playarr-client-version": every
// other layer must import CLIENT_PLATFORM_HEADER / CLIENT_VERSION_HEADER
// from here, or call buildHeaders / buildJsonBodyHeaders, never redeclare
// the literals elsewhere.
//
// There is NO API-version request header; do not invent one.
//
// No ArkUI, no @kit./@ohos. imports, no decorators: plain, Linux-testable
// TypeScript.

export const CLIENT_PLATFORM_HEADER: string = "x-playarr-client-platform";
export const CLIENT_VERSION_HEADER: string = "x-playarr-client-version";

// Recorded on the playback session when no client version was supplied.
const UNKNOWN_CLIENT_VERSION: string = "unknown";

// The Authorization scheme prefix. Case-sensitive, exactly one trailing
// space: the server parses it via `raw.strip_prefix("Bearer ")`.
const BEARER_PREFIX: string = "Bearer ";

// Builds the base header map for a JSON request:
// - `Accept: application/json` always.
// - `X-Playarr-Client-Platform`: the caller-resolved ClientPlatform wire
//   name (see core/AppConfig.ts resolveClientPlatform). An unknown or
//   missing value silently falls back to ClientPlatform::Web server-side;
//   still always send it.
// - `X-Playarr-Client-Version`: `clientVersion`, or the literal
//   "unknown" when `clientVersion` is empty.
// - `Authorization: Bearer <token>`: attached ONLY when `accessToken` is a
//   non-empty string. Never attached when `accessToken` is null or empty:
//   an empty bearer token 401s server-side just like a missing one.
export function buildHeaders(platform: string, clientVersion: string, accessToken: string | null): Map<string, string> {
  const headers: Map<string, string> = new Map<string, string>();
  headers.set("Accept", "application/json");
  headers.set(CLIENT_PLATFORM_HEADER, platform);
  if (clientVersion.length > 0) {
    headers.set(CLIENT_VERSION_HEADER, clientVersion);
  } else {
    headers.set(CLIENT_VERSION_HEADER, UNKNOWN_CLIENT_VERSION);
  }
  if (accessToken !== null && accessToken.length > 0) {
    headers.set("Authorization", BEARER_PREFIX + accessToken);
  }
  return headers;
}

// Same as buildHeaders, plus `Content-Type: application/json` for requests
// that carry a JSON body (device-code, token, refresh, login, PATCH
// player-preferences, PUT progress, POST playback events, ...).
export function buildJsonBodyHeaders(platform: string, clientVersion: string, accessToken: string | null): Map<string, string> {
  const headers: Map<string, string> = buildHeaders(platform, clientVersion, accessToken);
  headers.set("Content-Type", "application/json");
  return headers;
}
