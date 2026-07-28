/**
 * The only place any `pages/` code calls for "who is watching" profile
 * data, PIN verification, self-capability gating, or player preferences
 * (brief section 4.7). Every function here wraps the single
 * `PlayarrClient` instance from `AppContainer.ets` (`getPlayarrClient`)
 * -- this file never constructs its own `PlayarrClient`, never imports
 * `net/HttpTransport.ets` directly, and never touches `@kit.NetworkKit`.
 *
 * Every function resolves to an `ApiResult<T>` (`net/ApiResult.ets`) and
 * never throws: `PlayarrClient` already guarantees that end to end, so
 * this file is a thin, typed pass-through, not a second place that could
 * reintroduce a rejected promise.
 *
 * Endpoints covered (brief 4.7), each backed by its own `core/Endpoints.ts`
 * path function so this file never hand-writes an `"/api/..."` literal:
 * - `GET /api/v1/users/profiles` -- `listProfiles()`.
 * - `POST /api/v1/users/profiles/{id}/verify-pin` -- `verifyPin(...)`.
 * - `GET /api/v1/users/me/capabilities` -- `getCapabilities()`.
 * - `GET`/`PATCH /api/v1/users/me/player-preferences` --
 *   `getPlayerPreferences()` / `updatePlayerPreferences(...)`.
 */

import { getPlayarrClient } from '../AppContainer';
import { ApiResult } from '../net/ApiResult';

import {
  profilesUrl,
  verifyPinUrl,
  capabilitiesUrl,
  playerPreferencesUrl,
} from '../core/Endpoints.ts';
import {
  AvailableProfileResponse,
  VerifyPinRequest,
  VerifyPinResponse,
  Capabilities,
  PlayerPreferences,
} from '../core/Types/Profiles.ts';

/**
 * `GET /api/v1/users/profiles` (brief 4.7). The server sorts the list
 * `is_current` first, then case-insensitive `display_name`; this function
 * returns that list exactly as received, with no client-side re-sort --
 * there is no reason here to distrust the server's ordering, and re-sorting
 * would risk disagreeing with it on tie-breaks the server already resolved
 * (e.g. two profiles sharing a `display_name`). Under `AuthMode::FullAccount`
 * the response degrades to a single entry (the caller's own account); a
 * page rendering this list must handle that single-entry case gracefully
 * rather than assuming siblings always exist.
 */
export function listProfiles(): Promise<ApiResult<AvailableProfileResponse[]>> {
  return getPlayarrClient().getJson<AvailableProfileResponse[]>(profilesUrl());
}

/**
 * `POST /api/v1/users/profiles/{id}/verify-pin` (brief 4.7). Only unlocks
 * the target profile for this call; it is not itself a profile switch --
 * a caller still needs a separately stored per-profile session, or a fresh
 * pairing for that profile, to actually switch into it.
 *
 * The response's `verified` field is `true` both for a correct PIN AND for
 * a profile that has no PIN set at all -- callers must use the target
 * `AvailableProfileResponse.pin_locked` (from `listProfiles()`) to decide
 * whether to prompt for a PIN in the first place, and must never infer
 * "this profile has no PIN" from a `verified: true` response here. A wrong
 * PIN, a disabled/missing target profile, and a cross-account probe under
 * `AuthMode::FullAccount` all come back as the same 401 `ApiHttpFailure`,
 * deliberately indistinguishable from one another.
 */
export function verifyPin(profileId: string, pin: string): Promise<ApiResult<VerifyPinResponse>> {
  const body: VerifyPinRequest = { pin: pin };
  return getPlayarrClient().postJson<VerifyPinRequest, VerifyPinResponse>(verifyPinUrl(profileId), body);
}

/**
 * `GET /api/v1/users/me/capabilities` (brief 4.7). Resolves to an
 * `ApiResult<Capabilities>` whose `value.can_download` is always a plain
 * boolean on a successful response -- the "three-state" (`null` = loading,
 * `false` = hide, `true` = show) described in the brief is a UI-layer
 * concern, not a wire value: a page should hold its own local state that
 * starts `null`, then is set to `result.value.can_download` once this
 * call's `ApiResult` resolves with `kind === 'ok'` (or back to `false` on
 * failure, since a gated feature should hide rather than show on an
 * inconclusive answer).
 */
export function getCapabilities(): Promise<ApiResult<Capabilities>> {
  return getPlayarrClient().getJson<Capabilities>(capabilitiesUrl());
}

/** `GET /api/v1/users/me/player-preferences` (brief 4.7). */
export function getPlayerPreferences(): Promise<ApiResult<PlayerPreferences>> {
  return getPlayarrClient().getJson<PlayerPreferences>(playerPreferencesUrl());
}

/**
 * `PATCH /api/v1/users/me/player-preferences` (brief 4.7). Same shape both
 * ways, so the updated `PlayerPreferences` a caller wants persisted is also
 * exactly what a successful response echoes back.
 */
export function updatePlayerPreferences(preferences: PlayerPreferences): Promise<ApiResult<PlayerPreferences>> {
  return getPlayarrClient().patchJson<PlayerPreferences, PlayerPreferences>(playerPreferencesUrl(), preferences);
}
