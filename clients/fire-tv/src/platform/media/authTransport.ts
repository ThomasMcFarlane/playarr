/**
 * The one function that decides how a credential reaches a media request
 * (design doc §6.1/§6.2). Every Streamarr manifest, segment, licence and
 * subtitle request requires `Authorization: Bearer`, but the moment a
 * request leaves this app's own `fetch()` calls and enters Shaka's
 * networking engine or the native `VideoPlayer` pipeline, whether a header
 * actually reaches the server is either unverified (assumption A3: does
 * Shaka's Vega fork honour `registerRequestFilter` on `MANIFEST`/`SEGMENT`,
 * not just the `LICENSE` type Amazon documents?) or assumed impossible
 * outright (assumption A2: `VideoPlayer.src` has no documented header hook
 * at all).
 *
 * This file is deliberately the ONLY place that decision is made. Every
 * caller -- `shakaAdapter.ts`'s request filter, `subtitles.ts`'s sidecar
 * fetch -- asks `attachAuth()` for a set of headers and never has its own
 * opinion about bearer-vs-cookie; that is what makes flipping `AUTH_STRATEGY`
 * a one-line fix if a real device proves A3 wrong, rather than a hunt
 * through every module that touches a media URL.
 *
 * Deliberately has zero `@amazon-devices/*` imports, unlike its siblings in
 * this directory -- there is nothing Vega-specific about "which header wins"
 * as a decision, only about whether the header actually lands once made, so
 * this file stays plain, fully unit-testable TypeScript.
 */

/** Which stage of a playback request `attachAuth` is being asked to authenticate -- mirrors the three Shaka `RequestType`s design doc §6.2 names, plus the sidecar-subtitle fetch `subtitles.ts` makes outside Shaka entirely. */
export type MediaRequestKind = 'manifest' | 'segment' | 'license' | 'subtitle';

/**
 * The two strategies design doc §6.2 lays out:
 *
 *  - `bearer-header`: attach `Authorization: Bearer <token>` directly.
 *    Assumed to work (Plan A) -- the default here.
 *  - `session-cookie`: attach `Cookie: streamarr_playback_session=<id>`
 *    instead, scoped to one live `PlaybackSession`. This is Plan B, the
 *    same escape hatch Samsung AVPlay already relies on
 *    (`clients/tv-web/packages/player-avplay`'s `setPlaybackSessionId`) for
 *    a native pipeline that cannot set arbitrary headers at all -- kept
 *    available here purely so flipping this one constant is enough if a
 *    real Vega device proves Shaka's request filter does not actually reach
 *    `MANIFEST`/`SEGMENT` the way it documented-does for `LICENSE`.
 *
 * A `subtitle` request never uses the cookie strategy regardless of this
 * setting: `subtitles.ts` makes a plain JS `fetch()` call (see that file's
 * own doc comment), which has no platform limitation on setting
 * `Authorization` at all -- the whole reason the cookie fallback exists is
 * for pipelines that cannot set headers, and a JS `fetch()` is not one of
 * those.
 */
export const AUTH_STRATEGY: 'bearer-header' | 'session-cookie' = 'bearer-header';

export interface AuthTransportContext {
  kind: MediaRequestKind;
  /** Reads the current access token; may itself be async (e.g. a token refresh in flight). `undefined`/a rejected promise leaves the request unauthenticated rather than throwing -- the server 401s it, which is a real, visible failure mode, not a silent hang. */
  getAccessToken: () => string | undefined | Promise<string | undefined>;
  /** The active `PlaybackSession` id (`PlaybackInfoResponse.session_id`), needed only by the `session-cookie` strategy. `undefined`/`null` before a session has been negotiated -- `attachAuth` falls back to `bearer-header` in that case, since there is nothing to build a cookie value from. */
  sessionId?: string | null;
}

/**
 * Mutates `headers` in place with whichever credential `context.kind` and
 * `AUTH_STRATEGY` resolve to -- mutation, not a returned object, so this
 * drops straight into Shaka's own `request.headers['Authorization'] = ...`
 * idiom (design doc §6.2's code sample) with no extra spreading at the call
 * site. A `headers` object that already had values is preserved; only the
 * one credential header this function owns is ever written or overwritten.
 */
export async function attachAuth(
  headers: Record<string, string>,
  context: AuthTransportContext
): Promise<void> {
  const usesCookieStrategy =
    context.kind !== 'subtitle' && AUTH_STRATEGY === 'session-cookie' && Boolean(context.sessionId);

  if (usesCookieStrategy && context.sessionId) {
    headers.Cookie = `streamarr_playback_session=${encodeURIComponent(context.sessionId)}`;
    return;
  }

  const token = await context.getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
}
