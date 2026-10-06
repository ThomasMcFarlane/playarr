/**
 * The TV-side half of Playarr's hosted, first-contact device-linking flow
 * (design doc §5.1's wire diagram): before a Fire TV has ever heard of a
 * Streamarr server, it talks to `playarr.app`'s worker (`/api/link/code`,
 * `/api/link/code/{device_code}`) to get a short user code and a QR-encoded
 * URL, waits for a phone/browser at that URL to pick a server and approve,
 * then receives that server's own address(es) plus a server-scoped device
 * code it can redeem directly against the real Streamarr instance (that
 * redemption -- `completeServerDeviceLink` -- lives in `./session`, not
 * here; see that file's own doc comment for why the split falls there).
 *
 * PORTED, not imported, from
 * `clients/tv-web/web/src/lib/hostedDeviceLink.ts`. This is a deliberate
 * consequence of design doc §4.1's workspace-placement decision: this
 * project's Metro `watchFolders`/tsconfig `paths` only alias
 * `clients/tv-web/packages/*`'s TypeScript source, never
 * `clients/tv-web/web/src/**` -- `hostedDeviceLink.ts` lives in the latter,
 * so it is genuinely unreachable from here at both bundle time and
 * typecheck time, not merely inconvenient to import. Per this task's own
 * brief, the wire protocol itself is NOT re-derived: every field name,
 * status-code branch, and error message in `requestHostedDeviceLink`/
 * `pollHostedDeviceLink` below is carried over unchanged from the reviewed
 * source, so this client's behaviour against playarr.app's worker cannot
 * silently drift from tv-web's. Two things are deliberately NOT ported:
 *
 *  - `inspectHostedLink`/`authoriseHostedLink` -- the *approver* side of
 *    this flow (a phone or browser choosing a server and calling
 *    `/api/link/session` + `/api/link/authorize`). Design doc §5.5 states
 *    plainly that no TV client, Fire TV included, ever acts as the
 *    approver, so there is nothing here for this app to do with them.
 *  - `shouldUseHostedDeviceLink` -- on the web app this decides whether a
 *    *browser* on a given hostname should skip hosted linking in favour of
 *    a build-time-configured server address (`window.PlayarrPackagedConfig`).
 *    Fire TV has no such concept -- `src/config/appConfig.ts` carries no
 *    baked-in server address field -- so `LinkScreen.tsx` always takes this
 *    path unconditionally; there is no branch to decide.
 *
 * One deliberate adaptation, not a behavioural change: the hosted origin is
 * read from `APP_CONFIG.hostedLinkOrigin` rather than restating
 * `"https://playarr.app"` as a second module-level literal the way the
 * original file does -- `src/config/appConfig.ts` already owns that value
 * for exactly this reason (its own doc comment: "the one file naming this
 * app's ... identity"), so this file defers to it rather than risking the
 * two literals silently disagreeing after a future edit to one side only.
 */
import type {ClientPlatform} from '@playarr-tv/device-auth';
import {APP_CONFIG} from '../config/appConfig';

/** The server-scoped claim the hosted broker hands back once a phone/browser has approved this TV's code against a real Streamarr server. */
export interface HostedLinkClaim {
  user_code: string;
  server_url: string;
  server_device_code: string;
  server_urls: string[];
}

/** Wire shape of `POST /api/link/code`'s response body -- see `HostedLinkCode` for the camelCase form callers actually use. */
interface HostedLinkCodeWire {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

/** `requestHostedDeviceLink`'s result: the wire response normalised to camelCase, plus a resolved absolute expiry so `pollHostedDeviceLink` never has to redo that arithmetic on every tick. */
export interface HostedLinkCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresInSeconds: number;
  intervalSeconds: number;
  /** Epoch ms, resolved once at request time (`options.now` if supplied, else `Date.now()`). */
  expiresAt: number;
}

export interface HostedLinkRequestOptions {
  /** Injectable for tests; defaults to the real global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to `Date.now`. */
  now?: () => number;
}

export interface HostedLinkPollOptions extends HostedLinkRequestOptions {
  signal?: AbortSignal;
  /** Injectable for tests, so a poll loop's tests never depend on real timers. Defaults to a real `setTimeout`-backed wait. */
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

function hostedLinkFetch(fetchImpl?: typeof fetch): typeof fetch {
  return fetchImpl ?? globalThis.fetch.bind(globalThis);
}

function waitForHostedLink(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      {once: true}
    );
  });
}

/**
 * Starts first-contact TV linking against playarr.app, before this Fire TV
 * knows any Streamarr URL. Ported verbatim from tv-web's identically-named
 * function -- see this file's top comment.
 */
export async function requestHostedDeviceLink(
  clientPlatform: Extract<ClientPlatform, 'tv-webos' | 'tv-tizen' | 'tv-vidaa' | 'tv-fire'>,
  options: HostedLinkRequestOptions = {}
): Promise<HostedLinkCode> {
  const response = await hostedLinkFetch(options.fetchImpl)(`${APP_CONFIG.hostedLinkOrigin}/api/link/code`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Accept: 'application/json'},
    body: JSON.stringify({client_platform: clientPlatform}),
  });
  if (!response.ok) {
    throw new Error(`Playarr linking is unavailable (HTTP ${response.status}).`);
  }
  const wire = (await response.json()) as HostedLinkCodeWire;
  const now = options.now?.() ?? Date.now();
  return {
    deviceCode: wire.device_code,
    userCode: wire.user_code,
    verificationUri: wire.verification_uri,
    verificationUriComplete: wire.verification_uri_complete,
    expiresInSeconds: wire.expires_in,
    intervalSeconds: wire.interval,
    expiresAt: now + wire.expires_in * 1000,
  };
}

/**
 * `requestHostedDeviceLink`, closed over this app's own platform identity
 * (`APP_CONFIG.clientPlatform`, always `'tv-fire'`) -- the "wraps ... for
 * the Vega client_platform" this file's own file-purpose comment in the
 * design doc describes. `LinkScreen.tsx` calls this rather than
 * `requestHostedDeviceLink` directly so it never has to restate or import
 * this app's platform identity itself.
 */
export function requestFireTvHostedLinkCode(options: HostedLinkRequestOptions = {}): Promise<HostedLinkCode> {
  return requestHostedDeviceLink(APP_CONFIG.clientPlatform, options);
}

/**
 * Waits for the phone-side Playarr profile choice and returns its
 * server-scoped device claim. Ported verbatim from tv-web's
 * identically-named function -- see this file's top comment. Honours the
 * same contract the original does: sleeps `interval` seconds *before* each
 * poll (never hammers the broker immediately after requesting a code), a
 * `202` means "keep waiting", a `404` means the code itself expired, and
 * the loop's own `expiresAt` deadline is the final backstop if the broker
 * never returns anything at all.
 */
export async function pollHostedDeviceLink(
  code: HostedLinkCode,
  options: HostedLinkPollOptions = {}
): Promise<HostedLinkClaim> {
  const fetchImpl = hostedLinkFetch(options.fetchImpl);
  const now = options.now ?? Date.now;
  const wait = options.wait ?? waitForHostedLink;
  while (now() < code.expiresAt) {
    await wait(code.intervalSeconds * 1000, options.signal);
    const response = await fetchImpl(
      `${APP_CONFIG.hostedLinkOrigin}/api/link/code/${encodeURIComponent(code.deviceCode)}`,
      {headers: {Accept: 'application/json'}, signal: options.signal}
    );
    if (response.status === 202) continue;
    if (response.status === 404) throw new Error('That Playarr link code expired. Try again.');
    if (!response.ok) {
      throw new Error(`Playarr linking is unavailable (HTTP ${response.status}).`);
    }
    const claim = (await response.json()) as HostedLinkClaim;
    if (
      typeof claim.server_url !== 'string' ||
      typeof claim.server_device_code !== 'string' ||
      !Array.isArray(claim.server_urls)
    ) {
      throw new Error('Playarr returned an invalid TV link response.');
    }
    return claim;
  }
  throw new Error('That Playarr link code expired. Try again.');
}
