/**
 * The only place any `pages/` code calls the unauthenticated system probe
 * (brief section 4.13). Wraps the single `PlayarrClient` instance from
 * `AppContainer.ets` (`getPlayarrClient`), the same thin pass-through
 * pattern `data/ProfileRepository.ets` already establishes for this
 * client's `data/` layer: this file never constructs its own
 * `PlayarrClient`, never imports `net/HttpTransport.ets` directly, and
 * never touches `@kit.NetworkKit`.
 *
 * Endpoint covered, backed by its own `core/Endpoints.ts` path function so
 * this file never hand-writes an `"/api/..."` literal:
 * - `GET /api/system/version` -- `getSystemVersion()`.
 */

import { getPlayarrClient } from '../AppContainer';
import { ApiResult } from '../net/ApiResult';

import { systemVersionUrl } from '../core/Endpoints.ts';
import { VersionEnvelope } from '../core/Types/Version.ts';

/**
 * `GET /api/system/version` (brief 4.13). Used both as the boot-time
 * connectivity probe (`pages/Index.ets`) and, per that same brief section,
 * as the trigger `auth/ServerDirectory.ets`'s address book advances past on
 * failure. Never throws: `PlayarrClient` already guarantees an `ApiResult`
 * end to end, so this is a thin, typed pass-through, not a second place
 * that could reintroduce a rejected promise.
 */
export function getSystemVersion(): Promise<ApiResult<VersionEnvelope>> {
  return getPlayarrClient().getJson<VersionEnvelope>(systemVersionUrl());
}
