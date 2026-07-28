/**
 * Central hilog wrapper for Playarr's HarmonyOS NEXT client.
 *
 * ONE domain constant (`LOG_DOMAIN`, below) is defined in this file and
 * nowhere else, so every log line across every layer -- net/, auth/,
 * data/, player/, device/ -- shares a single, searchable hilog domain. Call
 * sites must go through `logInfo` / `logWarn` / `logError` rather than
 * importing `hilog` directly, so the `%{public}s` formatting discipline
 * (hilog's own privacy-marking requirement: a raw `%s` redacts as
 * "<private>" on release builds) is applied uniformly and no call site can
 * accidentally interpolate a value straight into the format string.
 *
 * ============================================================================
 * NEVER pass a bearer/access token, a refresh token, a device/session pairing
 * secret, or any URL that embeds one (a login/refresh response body, an
 * `Authorization` header value, a `token=` / `access_token=` query string) as
 * the `message` argument to any of these functions. hilog output lands in the
 * device's persistent log buffer -- once written it is effectively public,
 * and there is no "log it now, scrub it later." An HLS/segment URL that
 * merely carries a `playback_session_id` (brief section 4.12) is fine to
 * log; a URL or header value carrying a bearer token is never fine to log.
 * ============================================================================
 */

import { hilog } from '@kit.PerformanceAnalysisKit';

// Single hilog domain for every Playarr HarmonyOS log line. Valid domains
// range 0x0-0xFFFF; 0xD0C1 is an arbitrary fixed value reserved for this
// app and unrelated to any HarmonyOS system domain.
const LOG_DOMAIN: number = 0xd0c1;

/** Logs `message` at info level under `tag`, via the one shared domain. */
export function logInfo(tag: string, message: string): void {
  hilog.info(LOG_DOMAIN, tag, '%{public}s', message);
}

/** Logs `message` at warn level under `tag`, via the one shared domain. */
export function logWarn(tag: string, message: string): void {
  hilog.warn(LOG_DOMAIN, tag, '%{public}s', message);
}

/** Logs `message` at error level under `tag`, via the one shared domain. */
export function logError(tag: string, message: string): void {
  hilog.error(LOG_DOMAIN, tag, '%{public}s', message);
}
