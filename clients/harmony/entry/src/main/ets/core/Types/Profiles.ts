/**
 * Wire DTOs for the "who is watching" profile picker, PIN verification,
 * self-capability gating and per-user player preferences.
 *
 * This file lives under `core/` and is deliberately plain TypeScript: no
 * ArkUI, no `@kit.*` / `@ohos.*` imports, no decorators. It is Linux
 * testable with `node --test` and has zero dependency on the HarmonyOS SDK.
 *
 * Field names match the JSON wire contract verbatim (snake_case) -- this
 * layer only decodes server responses, it does not remap field casing.
 * See the implementation brief section 4.7 ("Profiles").
 */

/**
 * `GET /api/v1/users/profiles` list entry (brief 4.7). Sorted `is_current`
 * first, then case-insensitive `display_name` -- server-side, this client
 * must not re-sort. Under `AuthMode::FullAccount` the list degrades to a
 * single entry (the caller's own account); the picker must render that
 * gracefully rather than assuming siblings always exist.
 */
export interface AvailableProfileResponse {
  id: string;
  username: string;
  display_name: string;
  is_current: boolean;
  pin_locked: boolean;
}

/** `POST /api/v1/users/profiles/{id}/verify-pin` request body (brief 4.7). */
export interface VerifyPinRequest {
  pin: string;
}

/**
 * `POST /api/v1/users/profiles/{id}/verify-pin` response body (brief 4.7).
 * Returns `verified: true` when the target profile has no PIN set at all
 * -- use `AvailableProfileResponse.pin_locked` to decide whether to prompt
 * at all, never infer lock state from this response. A wrong PIN, a
 * disabled/missing target, and a cross-account probe under
 * `AuthMode::FullAccount` are all deliberately indistinguishable 401s.
 */
export interface VerifyPinResponse {
  verified: boolean;
}

/**
 * `GET /api/v1/users/me/capabilities` response body (brief 4.7). Model
 * this as three-state in the UI: `null`/not-yet-loaded = loading,
 * `false` = hide the gated feature, `true` = show it.
 */
export interface Capabilities {
  can_download: boolean;
}

/**
 * `GET`/`PATCH /api/v1/users/me/player-preferences` request/response body
 * (brief 4.7) -- the same shape both ways.
 */
export interface PlayerPreferences {
  preferred_audio_language: string;
}
