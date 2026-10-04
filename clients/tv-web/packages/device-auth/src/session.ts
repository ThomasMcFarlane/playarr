/**
 * Session / token-acquisition path for clients with no RFC 8628 pairing UI
 * of their own -- today just the standalone Web app (the TV shells always
 * pair first via `pollForToken`/`PairingScreenContainer` before they can
 * reach any screen that needs a token). The admin source-instance calls
 * require a real `Authorization: Bearer <token>`; `ensureAccessToken`
 * obtains one transparently via `POST /api/v1/auth/login` -- the default
 * `AuthMode::TrustedNetwork` server
 * config needs no credentials at all, a trusted-source-IP caller just gets
 * a token back -- and persists it through the same `TokenStore` shape the
 * device-pairing flow's `DeviceTokenSuccess` result would populate, rather
 * than building a second, parallel place to keep a token.
 *
 * Access tokens are short-lived by design (`JwtIssuer::access_ttl`, minutes
 * not hours), so `ensureAccessToken` also owns redeeming the stored refresh
 * token via `POST /api/v1/auth/refresh` when the access token has expired
 * but a session still exists -- see that path below for why this matters:
 * without it, ANY session (however it was obtained -- a real login, RFC
 * 8628 pairing, whatever) would silently stop working the moment its
 * access token's TTL elapsed, even though a perfectly good refresh token
 * was sitting right there unused.
 *
 * `docs/architecture/peer-groups.md` §7.2/§3.7: once a client remembers a
 * peer group (`@playarr-tv/domain`'s `KnownServerGroup`), a refresh
 * failure against the current server no longer falls straight through to a
 * full login -- it retries the *same* refresh token against every other
 * remembered address first (`serverGroup`/`clientForUrl` below), since
 * refresh tokens are never synced peer-to-peer (§3.7) and the issuing peer
 * being temporarily down is not the same thing as the session being dead.
 *
 * That retry is node-scoped, not group-wide: a refresh token is only ever
 * recognized by the peer that issued it (§3.7 again -- refresh tokens are
 * never synced), so retrying it against a *different* node's address is a
 * guaranteed 401, not a real chance at recovery. `refreshAcrossServerGroup`
 * below only tries addresses `@playarr-tv/domain`'s `KnownServerGroup`
 * attributes to the same `peer_node_id` that issued the stored access token
 * (read off its `iss` claim via `decodeAccessTokenIssuer` -- unverified,
 * used purely as a routing hint, never a trust decision). A fresh
 * credential-less login, by contrast, *is* valid at any group node --
 * accounts/policies sync (Phase 2) -- so the final login fallback
 * (`loginAcrossServerGroup`) is deliberately the opposite: never node-scoped,
 * tried across every remembered address.
 */
import type {
  ApiClient,
  ClientPlatform,
  LoginRequest,
  LoginResponse,
  RefreshRequest,
  RefreshResponse,
} from "@playarr-tv/api-client";
import { getOrCreateDeviceId } from "./deviceId";
import { decodeAccessTokenDeviceId, decodeAccessTokenIssuer } from "./jwt";
import type { StoredSession, TokenStore } from "./tokenStore";

export interface EnsureAccessTokenIdentity {
  deviceName: string;
  clientPlatform: ClientPlatform;
  clientVersion: string;
  /** Override for clients that persist more than one independent session per installation. */
  deviceId?: string;
}

/**
 * Structural mirror of `@playarr-tv/domain`'s `KnownServerGroup` -- this
 * package deliberately doesn't depend on `@playarr-tv/domain` for one
 * shape (same "no new package dependency for a structural type" convention
 * `inviteUrl.ts`'s `PeerAddressBundleLike` and `knownServers.ts`'s own doc
 * comment both explain for the identical reason), so callers pass the real
 * `KnownServerGroup` straight through -- it already satisfies this
 * structurally, no cast needed.
 */
export interface KnownServerGroupLike {
  /** Priority-ordered. */
  servers: ReadonlyArray<{
    url: string;
    /**
     * The `peer_nodes` row this address is attributed to
     * (`@playarr-tv/domain`'s `KnownServer::peerNodeId`), when known.
     * `refreshAcrossServerGroup` below only retries addresses whose
     * `peerNodeId` matches the current session's issuing peer -- absent
     * for a standalone deployment, or anything remembered before this
     * attribution existed, in which case that address is never a refresh
     * candidate (see `nodeScopedServerGroupCandidates`).
     */
    peerNodeId?: string;
  }>;
  /** Fast path: tried before `servers`. */
  lastGoodUrl?: string;
}

export interface EnsureAccessTokenOptions {
  /** Refresh even when the stored access token has not reached its renewal window. */
  forceRefresh?: boolean;
  /**
   * With `forceRefresh`: the access token the server just rejected. When the
   * store already holds a different, still-usable one (another caller or tab
   * renewed it meanwhile) that token is returned without another rotation,
   * so a burst of 401s costs one refresh, not one per request.
   */
  rejectedAccessToken?: string;
  /**
   * Every remembered address for this account's peer group (§7.1/§7.2).
   * Supplied together with `clientForUrl`; when both are present:
   *
   * - A refresh failure against `client` retries the *same* refresh token
   *   against each other remembered candidate *attributed to the same
   *   issuing peer* (§3.7 -- refresh tokens never sync peer-to-peer), in
   *   the same priority order `@playarr-tv/domain`'s
   *   `resolveReachableServer` uses (`lastGoodUrl` first, then
   *   `servers[]`). A no-op -- nothing to retry -- when the issuing peer
   *   can't be determined or no remembered address is attributed to it.
   * - Once refresh is exhausted (or wasn't attempted) and a fresh
   *   credential-less login against `client` also fails, that login is
   *   retried across *every* remembered candidate, not node-scoped --
   *   unlike refresh, a login is valid at any group node (accounts/
   *   policies sync, Phase 2).
   *
   * Ignored -- and behavior is identical to omitting both -- without a
   * matching `clientForUrl`.
   */
  serverGroup?: KnownServerGroupLike;
  /** Builds an `ApiClient` bound to one candidate address, for the retries above. */
  clientForUrl?: (url: string) => ApiClient;
}

/**
 * Converts a raw `POST /api/v1/auth/login` (or refresh) response body into
 * the shape `TokenStore` persists. Exported so every caller that stores a
 * login response -- this module's own transparent-login path below, and
 * the Web app's real username/password `Login` page, which calls
 * `ApiClient.login` directly with real credentials -- shares this one
 * mapping instead of each reimplementing the `expires_in` -> `expiresAt`
 * epoch-ms conversion.
 */
export function toStoredSession(response: {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}): StoredSession {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    tokenType: response.token_type,
    expiresAt: Date.now() + response.expires_in * 1000,
  };
}

// One pending login per `TokenStore`, so concurrent callers (e.g. a user
// double-clicking Approve before the first login round-trip lands) reuse the
// same in-flight `POST /api/v1/auth/login` call instead of firing several.
const inFlightLogins = new WeakMap<TokenStore, Promise<string>>();

// Leave enough life on every returned JWT for a media request to wait through
// the player's retry window without crossing the server-side expiry boundary.
// Playarr Server currently issues 15-minute access tokens, so renewing two minutes
// early keeps refresh traffic modest while avoiding edge-of-expiry 401s.
const ACCESS_TOKEN_MINIMUM_VALIDITY_MS = 2 * 60 * 1000;

/**
 * Same candidate ordering as `@playarr-tv/domain`'s
 * `resolveReachableServer`: `lastGoodUrl` first, then `servers[]`,
 * de-duplicated. Duplicated locally rather than imported -- see
 * `KnownServerGroupLike`'s doc comment for why this package doesn't depend
 * on `@playarr-tv/domain`.
 */
function serverGroupCandidates(group: KnownServerGroupLike): string[] {
  const candidates: string[] = [];
  if (group.lastGoodUrl) candidates.push(group.lastGoodUrl);
  for (const server of group.servers) {
    if (!candidates.includes(server.url)) candidates.push(server.url);
  }
  return candidates;
}

/**
 * RFC 4122's hyphenated form -- the only shape `Uuid::new_v4()`/serde ever
 * produce for a `peer_id`, and the same gate
 * `playarr_auth::jwt::JwtIssuer::verify_access_token` itself applies to a
 * token's `iss` claim (`Uuid::parse_str`) to decide EdDSA-peer verification
 * vs. the fixed HS256 issuer string. Good enough for a client-side routing
 * hint -- this is never a trust decision (see `decodeAccessTokenIssuer`'s
 * doc comment) -- without pulling in a UUID-parsing dependency for one
 * regex-shaped check.
 */
const PEER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function looksLikePeerId(iss: string | undefined): iss is string {
  return iss !== undefined && PEER_ID_PATTERN.test(iss);
}

/**
 * `serverGroupCandidates`, filtered down to only the addresses
 * `serverGroup` attributes to `issuingPeerId` -- §3.7's "refresh tokens are
 * never synced peer-to-peer": an address with no recorded attribution, or
 * one attributed to a *different* peer, cannot possibly recognize a
 * refresh token issued by `issuingPeerId`, so retrying it is a guaranteed
 * 401, not a real chance at recovery. Returns an empty list -- the retry
 * step below becomes a no-op, exactly like having no group at all -- when
 * `issuingPeerId` doesn't look like a peer id (a standalone/HS256-issued
 * token, whose `iss` is a fixed issuer string, not a `peer_id`) or no
 * remembered address is attributed to it (e.g. a group remembered before
 * this attribution existed).
 */
function nodeScopedServerGroupCandidates(
  serverGroup: KnownServerGroupLike,
  issuingPeerId: string | undefined
): string[] {
  if (!looksLikePeerId(issuingPeerId)) return [];
  const peerNodeIdByUrl = new Map(serverGroup.servers.map((server) => [server.url, server.peerNodeId]));
  return serverGroupCandidates(serverGroup).filter((url) => peerNodeIdByUrl.get(url) === issuingPeerId);
}

/**
 * §7.2/§3.7's retry-before-reprompt: tries `refreshBody`'s *same* refresh
 * token against every candidate address in `candidates` (already
 * node-scoped by the caller -- see `nodeScopedServerGroupCandidates`), in
 * priority order, stopping at the first one that accepts it. Returns
 * `undefined` -- never throws -- once every candidate has failed (or
 * `candidates` was empty to begin with), so the caller's existing "fall
 * through to a full login" path handles that exactly like it already does
 * for a single server with no group at all.
 */
async function refreshAcrossServerGroup(
  refreshBody: RefreshRequest,
  candidates: readonly string[],
  clientForUrl: (url: string) => ApiClient
): Promise<RefreshResponse | undefined> {
  for (const url of candidates) {
    try {
      return await clientForUrl(url).refresh(refreshBody);
    } catch {
      // Unreachable, or (should be rare now that candidates are node-
      // scoped) this peer doesn't recognize the token -- try the next
      // same-node address before giving up.
    }
  }
  return undefined;
}

/**
 * The *other* half of §7.2/§3.7's retry-before-reprompt, and this fix's
 * second bug: a fresh credential-less login (`POST /api/v1/auth/login`) is
 * valid at *any* node in the group -- accounts/policies are synced (Phase
 * 2) -- so, unlike `refreshAcrossServerGroup` above, this is deliberately
 * never node-scoped. Tries every remembered address in `serverGroup`, same
 * priority order, stopping at the first that accepts the login. Returns
 * `undefined` -- never throws -- once every candidate has failed, so the
 * caller's own direct `client.login` failure is what actually surfaces.
 */
async function loginAcrossServerGroup(
  loginBody: LoginRequest,
  serverGroup: KnownServerGroupLike,
  clientForUrl: (url: string) => ApiClient
): Promise<LoginResponse | undefined> {
  for (const url of serverGroupCandidates(serverGroup)) {
    try {
      return await clientForUrl(url).login(loginBody);
    } catch {
      // Unreachable, or this peer rejected the transparent login (e.g. a
      // non-default AuthMode) -- try the next remembered address before
      // giving up.
    }
  }
  return undefined;
}


/**
 * Raised when the session could not be renewed for a reason that says
 * nothing about whether it is still valid: the network is down, the server
 * is restarting or overloaded (5xx, 408, 429), or the refresh request hung.
 * Callers must keep the stored credentials and retry later -- never treat
 * this as "signed out".
 */
export class TransientAuthError extends Error {
  override readonly name = "TransientAuthError";
  constructor(message: string, cause?: unknown) {
    super(message);
    (this as { cause?: unknown }).cause = cause;
  }
}

/** HTTP statuses on which the server has definitively refused the credential. */
const DEFINITIVE_REJECTION_STATUSES = new Set([400, 401, 403, 404, 410, 422]);

/** The server answered and said "this credential is not valid". */
function isDefinitiveRejection(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" && DEFINITIVE_REJECTION_STATUSES.has(status);
}

/**
 * True for any failure that must not sign the user out: a `TransientAuthError`,
 * a network failure (no HTTP status at all) or a 408/425/429/5xx answer.
 */
export function isTransientAuthFailure(err: unknown): boolean {
  if (err instanceof TransientAuthError) return true;
  return !isDefinitiveRejection(err);
}

// Refresh tokens the server definitively refused, remembered briefly so a
// polling caller (live events, downloads, retries) does not hammer
// `/auth/refresh` and `/auth/login` every few seconds with a dead token.
const REJECTION_COOLDOWN_MS = 30_000;
const deadRefreshTokens = new Map<string, { until: number; error: unknown }>();
const loginCooldowns = new WeakMap<TokenStore, { until: number; error: unknown }>();

// Upper bound on one refresh round trip while holding the cross-tab lock, so
// a hung request cannot wedge every other tab behind it.
const REFRESH_LOCK_TIMEOUT_MS = 30_000;

interface WebLocks {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

/**
 * Runs `task` while holding a browser-wide (all tabs, one origin) exclusive
 * lock named `name` (Web Locks API). Where the API is unavailable the task
 * just runs, which keeps the in-tab single flight as the only protection.
 */
async function withCrossTabLock<T>(name: string, task: () => Promise<T>): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: WebLocks } }).navigator?.locks;
  if (!locks || typeof locks.request !== "function") return task();
  return locks.request(name, () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new TransientAuthError("session refresh timed out")),
        REFRESH_LOCK_TIMEOUT_MS
      );
    });
    return Promise.race([task(), timeout]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
  });
}

/**
 * Returns a currently-valid access token. Three cases, in order:
 *
 * 1. The stored access token hasn't expired yet -- return it as-is.
 * 2. A stored session exists but its access token has expired -- redeem
 *    its refresh token via `POST /api/v1/auth/refresh` (rotates it; see
 *    `ApiClient.refresh`'s doc comment) rather than starting over. If that
 *    fails and `options.serverGroup`/`clientForUrl` are both supplied, the
 *    *same* refresh token is retried (`refreshAcrossServerGroup`, §7.2)
 *    against every other remembered address attributed to the *same peer
 *    that issued it* -- decoded (unverified) off the expiring access
 *    token's `iss` claim via `decodeAccessTokenIssuer`. Refresh tokens are
 *    never synced peer-to-peer (§3.7), so a different peer's address would
 *    only ever 401; that retry is skipped entirely (not attempted at all)
 *    when the issuer can't be read as a peer id (a standalone/HS256
 *    session) or no remembered address is attributed to it -- the peer that
 *    issued the session being temporarily down isn't "you're logged out,"
 *    but there is nothing meaningful to retry against either.
 * 3. Nothing usable is stored, or (2) failed -- transparently call
 *    `POST /api/v1/auth/login` with no credentials against `client`.
 *    `LoginRequest`'s `username`/`password`/`pin`/`profile_user_id` are only
 *    consulted by auth tiers other than the default `TrustedNetwork`, so
 *    this never needs to prompt for anything -- see `ApiClient.login`'s doc
 *    comment. If *that* fails too and `options.serverGroup`/`clientForUrl`
 *    are both supplied, the same credential-less login is retried across
 *    *every* remembered address (`loginAcrossServerGroup`) -- unlike (2),
 *    never node-scoped: accounts/policies sync group-wide (Phase 2), so a
 *    fresh login is exactly as valid at a reachable sibling node as at
 *    `client` itself. Under `AuthMode::FullAccount`/`ManagedProfiles` (or
 *    with no group to fall back on) this has nothing left to try and
 *    rejects -- callers (`ApiClientProvider`) treat that as "redirect to a
 *    real login screen."
 */
export async function ensureAccessToken(
  client: ApiClient,
  store: TokenStore,
  identity: EnsureAccessTokenIdentity,
  options: EnsureAccessTokenOptions = {}
): Promise<string> {
  const pending = inFlightLogins.get(store);
  if (pending) return pending;

  const existing = store.get();
  if (
    options.forceRefresh &&
    options.rejectedAccessToken !== undefined &&
    existing &&
    existing.accessToken !== options.rejectedAccessToken &&
    existing.expiresAt > Date.now() + ACCESS_TOKEN_MINIMUM_VALIDITY_MS
  ) {
    // Somebody (another request, another tab) already replaced the token the
    // server rejected -- use theirs instead of rotating the family again.
    return existing.accessToken;
  }
  if (
    !options.forceRefresh &&
    existing &&
    existing.expiresAt > Date.now() + ACCESS_TOKEN_MINIMUM_VALIDITY_MS
  ) {
    return existing.accessToken;
  }

  const acquirePromise = (async () => {
    try {
      let transient: TransientAuthError | undefined;
      if (existing) {
        try {
          const renewed = await refreshExistingSession(client, store, existing, identity, options);
          if (renewed !== undefined) return renewed;
          // Refresh token itself is dead everywhere it could plausibly
          // still be recognized (the server answered and refused it) -- fall
          // through to a fresh transparent login attempt below, same as
          // having nothing stored at all.
        } catch (err) {
          if (!(err instanceof TransientAuthError)) throw err;
          transient = err;
        }
      }

      const cooldown = loginCooldowns.get(store);
      if (cooldown && cooldown.until > Date.now()) throw transient ?? cooldown.error;

      const body = buildLoginBody(identity);
      try {
        const response = await client.login(body);
        store.set(toStoredSession(response));
        return response.access_token;
      } catch (err) {
        if (options.serverGroup && options.clientForUrl) {
          const response = await loginAcrossServerGroup(body, options.serverGroup, options.clientForUrl);
          if (response) {
            store.set(toStoredSession(response));
            return response.access_token;
          }
        }
        // The session could not be renewed for an unknown reason and a
        // fresh login did not work either: that is still "try again later",
        // never "signed out" -- the stored credentials stay untouched.
        if (transient) throw transient;
        // Nothing left to try anywhere in the group (or there was no group
        // at all) -- the original failure from `client` itself is the
        // right one to surface, not a generic "everything failed."
        if (isDefinitiveRejection(err)) {
          loginCooldowns.set(store, { until: Date.now() + REJECTION_COOLDOWN_MS, error: err });
        }
        throw err;
      }
    } finally {
      inFlightLogins.delete(store);
    }
  })();

  inFlightLogins.set(store, acquirePromise);
  return acquirePromise;
}

function buildLoginBody(identity: EnsureAccessTokenIdentity): LoginRequest {
  return {
    device_id: identity.deviceId ?? getOrCreateDeviceId(),
    device_name: identity.deviceName,
    client_platform: identity.clientPlatform,
    client_version: identity.clientVersion,
  };
}

/**
 * Redeems the stored refresh token. Resolves to the new access token;
 * resolves to `undefined` only when the server definitively refused the
 * refresh token (the caller may then try a credential-less login); throws a
 * `TransientAuthError` when the outcome is unknown (network, 5xx, timeout)
 * and nothing usable is stored -- the stored session is never touched then.
 *
 * Runs under a browser-wide lock keyed by the device, and re-reads the store
 * once the lock is held: a second tab that lost the race finds the winner's
 * rotated session there and uses it instead of replaying the old refresh
 * token (which the server would otherwise read as theft).
 */
async function refreshExistingSession(
  client: ApiClient,
  store: TokenStore,
  existing: StoredSession,
  identity: EnsureAccessTokenIdentity,
  options: EnsureAccessTokenOptions
): Promise<string | undefined> {
  // The device the refresh token belongs to is whichever one the access
  // token was minted for; fall back to the caller's identity for opaque tokens.
  const deviceId =
    decodeAccessTokenDeviceId(existing.accessToken) ?? identity.deviceId ?? getOrCreateDeviceId();

  return withCrossTabLock(`playarr-refresh:${deviceId}`, async () => {
    const latest = store.get() ?? existing;
    if (
      latest.refreshToken !== existing.refreshToken &&
      latest.expiresAt > Date.now() + ACCESS_TOKEN_MINIMUM_VALIDITY_MS
    ) {
      // Another tab renewed the session while this one waited for the lock.
      return latest.accessToken;
    }
    if (
      options.forceRefresh &&
      options.rejectedAccessToken !== undefined &&
      latest.accessToken !== options.rejectedAccessToken &&
      latest.expiresAt > Date.now() + ACCESS_TOKEN_MINIMUM_VALIDITY_MS
    ) {
      return latest.accessToken;
    }

    const dead = deadRefreshTokens.get(latest.refreshToken);
    if (dead && dead.until > Date.now()) return undefined;

    const refreshBody: RefreshRequest = {
      device_id: deviceId,
      refresh_token: latest.refreshToken,
    };
    try {
      const refreshed = await client.refresh(refreshBody);
      store.set(toStoredSession(refreshed));
      return refreshed.access_token;
    } catch (err) {
      if (options.serverGroup && options.clientForUrl) {
        const candidates = nodeScopedServerGroupCandidates(
          options.serverGroup,
          decodeAccessTokenIssuer(latest.accessToken)
        );
        if (candidates.length > 0) {
          const refreshed = await refreshAcrossServerGroup(
            refreshBody,
            candidates,
            options.clientForUrl
          );
          if (refreshed) {
            store.set(toStoredSession(refreshed));
            return refreshed.access_token;
          }
        }
      }

      if (isDefinitiveRejection(err)) {
        // A concurrent holder of the same session may have rotated it while
        // this request was failing -- prefer its result over giving up.
        const after = store.get();
        if (
          after &&
          after.refreshToken !== latest.refreshToken &&
          after.expiresAt > Date.now() + ACCESS_TOKEN_MINIMUM_VALIDITY_MS
        ) {
          return after.accessToken;
        }
        deadRefreshTokens.set(latest.refreshToken, {
          until: Date.now() + REJECTION_COOLDOWN_MS,
          error: err,
        });
        return undefined;
      }

      // Unknown outcome (offline, server restarting, 5xx, timeout): keep the
      // session. A still-usable access token keeps working meanwhile; with
      // nothing usable the caller gets a TransientAuthError (and may still
      // try a credential-less login, which never overrides that verdict).
      if (!options.forceRefresh && latest.expiresAt > Date.now() + 5_000) {
        return latest.accessToken;
      }
      throw new TransientAuthError("could not renew the session right now", err);
    }
  });
}
