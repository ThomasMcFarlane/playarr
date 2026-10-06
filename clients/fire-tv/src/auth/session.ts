/**
 * Session management for a linked Fire TV: turning a hosted-link claim into
 * a real Streamarr session (`completeServerDeviceLink` + `commitLinkedSession`),
 * and keeping that session's access token fresh for the lifetime of the
 * install (`ensureFireTvAccessToken`). Design doc §5's "ensureAccessToken +
 * refresh + known-server fallback wiring" file-purpose comment for this
 * file, read literally: the refresh/fallback machinery itself is
 * `@playarr-tv/device-auth`'s `ensureAccessToken`, reused verbatim per
 * design doc §5.5 ("This is already implemented in
 * @playarr-tv/device-auth/session.ts -- we reuse it, we do not
 * re-derive it") -- this file's own job is wiring THIS app's identity,
 * storage, and known-server group into that reused function, plus owning
 * the one step upstream of it that doesn't exist on tv-web at all: turning
 * a freshly-approved hosted-link claim into the first stored session in the
 * first place.
 *
 * `completeServerDeviceLink`/`commitLinkedSession` live here rather than in
 * `./hostedLink.ts` because they are a different concern from that file's
 * hosted-broker-only wire protocol: `hostedLink.ts` never talks to a real
 * Streamarr server, only to playarr.app's worker. The moment a claim names
 * a real `server_url`, redeeming it (`completeServerDeviceLink`, a direct
 * port of the inline logic in tv-web's `DeviceLogin.tsx`) and persisting
 * the result (`commitLinkedSession`) are session-lifecycle concerns, which
 * is exactly this file's remit.
 */
import type {ApiClient} from '@playarr-tv/api-client';
import {
  decodeAccessTokenDeviceId,
  decodeAccessTokenUserId,
  ensureAccessToken,
  pollForToken,
  toStoredSession,
  TokenStore,
  type DeviceTokenSuccess,
  type EnsureAccessTokenIdentity,
  type KnownServerGroupLike,
} from '@playarr-tv/device-auth';
import {readKnownServers, rememberGroup} from '@playarr-tv/domain';
import {createApiClient} from '../api/client';
import {APP_CONFIG} from '../config/appConfig';
import type {HostedLinkClaim, HostedLinkCode} from './hostedLink';

// ---------------------------------------------------------------------
// publicIpv4RelayUrl -- ported from clients/tv-web/web/src/lib/loginServerUrl.ts
// ---------------------------------------------------------------------

/**
 * PORTED, not imported, from `clients/tv-web/web/src/lib/loginServerUrl.ts`
 * -- the same "lives in `web/src/lib`, unreachable via this project's Metro
 * aliases" reasoning as `hostedLink.ts`'s own top comment explains, applied
 * to one function this time rather than a whole file (the rest of that
 * module, `initialLoginServerUrl`, is a server-URL-text-field prefill
 * concern with no Fire TV equivalent -- this app has no such field). Logic
 * unchanged from the original: give a public IPv4 Streamarr server a
 * deterministic, TLS-eligible DNS name that resolves straight back to the
 * encoded address, so a claim naming e.g. `http://203.0.113.9:8484`
 * doesn't force plaintext HTTP to a public address (design doc §9.2's R8
 * risk) or a self-signed certificate warning. Private/loopback/link-local/
 * documentation-range addresses (the common case: most Streamarr servers
 * are a bare LAN address) are returned unchanged.
 */
export function publicIpv4RelayUrl(value: string): string {
  const input = value.trim();
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(input)
    ? input
    : input.startsWith('//')
      ? `http:${input}`
      : `http://${input}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return value;

    const encodedOctets = encodedPublicIpv4Octets(url.hostname);
    const octets = encodedOctets ?? publicIpv4Octets(url.hostname);
    if (!octets) return value;

    const hostname = `v4-${octets.join('-')}.${PUBLIC_IPV4_RELAY_HOSTNAME}`;
    const path = url.pathname === '/' ? '' : url.pathname;
    return `https://${hostname}:${STREAMARR_PORT}${path}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}

const PUBLIC_IPV4_RELAY_HOSTNAME = 'relay.playarr.app';
const STREAMARR_PORT = '8484';

function publicIpv4Octets(hostname: string): [number, number, number, number] | undefined {
  const rawOctets = hostname.split('.');
  if (rawOctets.length !== 4) return undefined;

  const octets = rawOctets.map((octet) => Number(octet));
  if (!octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)) {
    return undefined;
  }

  const parsed = octets as [number, number, number, number];
  const [first, second] = parsed;
  if (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && (parsed[2] === 0 || parsed[2] === 2)) ||
    (first === 192 && second === 88 && parsed[2] === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && second >= 18 && second <= 19) ||
    (first === 198 && second === 51 && parsed[2] === 100) ||
    (first === 203 && second === 0 && parsed[2] === 113) ||
    first >= 224
  ) {
    return undefined;
  }

  return parsed;
}

function encodedPublicIpv4Octets(hostname: string): [number, number, number, number] | undefined {
  const match = hostname.match(/^v4-(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})\.relay\.playarr\.app$/i);
  return match ? publicIpv4Octets(match.slice(1).join('.')) : undefined;
}

// ---------------------------------------------------------------------
// Claiming a real Streamarr session off a hosted-link claim
// ---------------------------------------------------------------------

/**
 * Redeems an already-approved hosted-link claim against the real Streamarr
 * server it names. Direct port of the second half of tv-web's
 * `DeviceLogin.tsx` (its hosted-link branch, after `pollHostedDeviceLink`
 * resolves): the phone/browser that approved this TV's code already called
 * the real server's device-authorize endpoint on our behalf (worker's
 * `POST /api/link/authorize` -> `hostedDeviceLink.ts`'s
 * `authoriseHostedLink`, which this app never runs -- see `hostedLink.ts`'s
 * top comment), so there is nothing left to *request*, only to *poll*:
 * `claim.server_device_code` is already a valid, approved RFC 8628 device
 * code against `claim.server_url`. `intervalSeconds: 1` (not the hosted
 * code's own, slower `intervalSeconds`) matches the original exactly --
 * approval already happened by the time this claim exists, so there is no
 * reason to wait the RFC 8628-recommended interval before the first poll;
 * a fast poll just shaves latency off the last leg of a flow the user is
 * actively watching.
 */
export async function completeServerDeviceLink(
  claim: HostedLinkClaim,
  hostedCode: HostedLinkCode,
  options: {signal?: AbortSignal} = {}
): Promise<DeviceTokenSuccess> {
  const serverClient = createApiClient(claim.server_url);
  return pollForToken(
    serverClient,
    {
      deviceCode: claim.server_device_code,
      userCode: claim.user_code,
      verificationUri: hostedCode.verificationUri,
      verificationUriComplete: hostedCode.verificationUriComplete,
      expiresInSeconds: Math.max(1, Math.floor((hostedCode.expiresAt - Date.now()) / 1000)),
      intervalSeconds: 1,
    },
    {signal: options.signal}
  );
}

/** What `commitLinkedSession` resolves to -- the server address `ApiClientProvider` should now point at, and the full remembered address list. */
export interface LinkedSession {
  apiBaseUrl: string;
  serverUrls: string[];
}

export interface CommitLinkedSessionOptions {
  token: DeviceTokenSuccess;
  claim: HostedLinkClaim;
  /**
   * `useApiBaseUrl()`'s setter from `../api/ApiClientProvider`. Passed in
   * rather than imported and called via a hook here, so this function stays
   * a plain, synchronous, hook-free piece of logic `session.test.ts` can
   * exercise with a bare spy -- exactly the same reason `../api/client.ts`
   * takes its dependencies as parameters instead of reaching for context.
   */
  setApiBaseUrl: (url: string) => void;
}

/**
 * Commits a freshly-obtained device token as this install's active
 * session: validates it carries usable identity, relay-rewrites every
 * server address (§5.4's "mandatory transforms before storing or dialling
 * any claimed address"), points `ApiClientProvider` at the primary one,
 * writes the session into `TokenStore`, and remembers the full address list
 * as a `KnownServerGroup` (§5.5's peer-group rule #1: remember a list,
 * never a single URL). Direct port of tv-web's
 * `ApiClientProvider.tsx::loginWithDeviceToken`'s hosted-link branch,
 * narrowed to what a single-profile, single-device Fire TV install needs --
 * that function's per-profile session bookkeeping
 * (`playarr.profileSessions.v4`) has no equivalent here yet, deliberately:
 * design doc §7 marks Fire TV as v1-single-profile-per-install, and
 * inventing a profile-session contract nothing calls yet would be exactly
 * the kind of pre-guessing `theme/styles.ts`'s own doc comment already
 * warns against elsewhere in this codebase.
 *
 * ORDERING IS LOAD-BEARING, and would fail completely silently if reversed:
 * `options.setApiBaseUrl` (`ApiClientProvider.tsx`'s own `setApiBaseUrl`)
 * clears the current `TokenStore` session and `authFailed` flag as a
 * documented side effect of pointing the shared client at a new server --
 * see that file's own comment. Writing our freshly-obtained session to
 * `TokenStore` BEFORE calling `setApiBaseUrl` would have that same call
 * immediately wipe it again; nothing here would throw, no local test would
 * catch it, and the only symptom would be a Fire TV that appears to link
 * successfully and then silently forgets its session the moment
 * `ApiClientProvider`'s `client` rebuilds. `setApiBaseUrl` therefore runs
 * FIRST, deliberately, and everything that writes session state runs after
 * it.
 */
export function commitLinkedSession(options: CommitLinkedSessionOptions): LinkedSession {
  const userId = decodeAccessTokenUserId(options.token.accessToken);
  const deviceId = decodeAccessTokenDeviceId(options.token.accessToken);
  if (!userId || !deviceId) {
    throw new Error('Playarr returned a device session with no usable identity.');
  }

  const apiBaseUrl = publicIpv4RelayUrl(options.claim.server_url);
  const serverUrls = [...new Set([options.claim.server_url, ...options.claim.server_urls])].map(
    publicIpv4RelayUrl
  );

  // See this function's own doc comment: this call MUST happen before any
  // of the writes below.
  options.setApiBaseUrl(apiBaseUrl);

  const store = new TokenStore();
  store.set(
    toStoredSession({
      access_token: options.token.accessToken,
      refresh_token: options.token.refreshToken,
      token_type: options.token.tokenType,
      expires_in: options.token.expiresInSeconds,
    })
  );

  // No `PeerAddressBundle` (and therefore no `peerNodeId` attribution)
  // exists yet at this point in the flow -- that only arrives on a later
  // login/refresh response, which is exactly what
  // `@playarr-tv/domain`'s `mergeKnownServerGroup` is for (see
  // `../api/client.ts`'s `withPeerAddressSelfHealing`, which folds it in
  // once one does arrive). Building the group by hand here, from the
  // claim's own `server_urls`, mirrors tv-web's own
  // `loginWithDeviceToken` precedent for this exact first-write case.
  rememberGroup({servers: serverUrls.map((url) => ({url})), lastGoodUrl: apiBaseUrl});

  return {apiBaseUrl, serverUrls};
}

// ---------------------------------------------------------------------
// Keeping a linked session's access token fresh
// ---------------------------------------------------------------------

export interface EnsureFireTvAccessTokenOptions {
  /** Forces a refresh even when the stored access token has not yet reached its renewal window -- see `ensureAccessToken`'s own `forceRefresh`. */
  forceRefresh?: boolean;
}

/**
 * `@playarr-tv/device-auth`'s `ensureAccessToken`, closed over this app's
 * own identity and known-server fallback wiring, so every future caller
 * (a later PlayerScreen's progress heartbeat, a protected catalogue
 * request that just 401'd, anything that needs "a currently-valid token")
 * gets design doc §5.5/§7.2's retry-before-reprompt behaviour for free
 * instead of re-deriving `EnsureAccessTokenIdentity`/`serverGroup`/
 * `clientForUrl` at each call site.
 */
export function ensureFireTvAccessToken(
  client: ApiClient,
  store: TokenStore,
  options: EnsureFireTvAccessTokenOptions = {}
): Promise<string> {
  const existing = store.get();
  const identity: EnsureAccessTokenIdentity = {
    deviceName: APP_CONFIG.deviceName,
    clientPlatform: APP_CONFIG.clientPlatform,
    clientVersion: APP_CONFIG.clientVersion,
    // The device id embedded in the CURRENTLY stored access token's
    // `device_id` claim -- deliberately NOT
    // `@playarr-tv/device-auth`'s own `getOrCreateDeviceId()` fallback.
    // Fire TV never sends a client-chosen device id anywhere in the RFC
    // 8628 pairing flow (`DeviceCodeRequest` carries only
    // `client_platform`), so the server assigns one during pairing and
    // embeds it in the issued token; that assigned id is the ONLY one
    // `POST /api/v1/auth/refresh` will ever recognise for this session.
    // Re-decoded fresh on every call rather than cached under a separate
    // storage key: a rotated refresh response's access token carries the
    // same claim (this is the same device, still), so there is nothing
    // that could go stale by re-reading it each time, and one fewer
    // AsyncStorage key to keep in sync with `TokenStore` is one fewer way
    // for the two to disagree after a partial write.
    deviceId: existing ? decodeAccessTokenDeviceId(existing.accessToken) : undefined,
  };

  const serverGroup: KnownServerGroupLike | undefined = readKnownServers();

  return ensureAccessToken(client, store, identity, {
    forceRefresh: options.forceRefresh,
    serverGroup,
    // Retry candidates never need a bearer token of their own -- both
    // `.refresh()` and the credential-less `.login()` fallback
    // `ensureAccessToken` may call against them are themselves how a
    // token gets obtained, not endpoints that require one.
    clientForUrl: (url) => createApiClient(url),
  });
}
