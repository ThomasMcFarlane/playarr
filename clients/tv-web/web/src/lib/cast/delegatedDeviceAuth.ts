/**
 * Delegated device auth for the Cast receiver -- the sender mints a
 * SEPARATE device identity for the Cast device using the existing RFC 8628
 * device-authorization-grant flow (`@playarr-tv/device-auth`), rather
 * than ever shipping its own access/refresh token to the receiver. Handing
 * the receiver the sender's own refresh token would let the receiver's
 * later token rotation revoke the sender's own session via the backend's
 * reuse-detection (a rotated-and-then-reused refresh token is treated as
 * theft) -- exactly the failure mode this indirection avoids.
 *
 * Three calls, all against the media's own server:
 *
 *   1. `POST /api/v1/oauth/device/code`      { client_platform: "cast" }   (unauthenticated)
 *   2. `POST /api/v1/oauth/device/authorize` Authorization: Bearer <sender token>, { user_code }
 *      -- self-approval: the *signed-in sender* approves the code it just
 *      minted for itself, no second device/viewer interaction needed. This
 *      call and the device/code call above happen sequentially, awaited in
 *      order against the same server, so the following token exchange
 *      reliably observes the approval -- there is no separate device
 *      polling/waiting loop the way the TV pairing flow needs one.
 *   3. `POST /api/v1/oauth/token`            { grant_type: device_code grant, device_code }
 *
 * `device_id` is read from the resulting access token's JWT `device_id`
 * claim (`decodeAccessTokenDeviceId`), not from the token response body --
 * mirroring the TV device-pairing flow's own convention.
 *
 * Only `{castDeviceId, castRefreshToken}` are cached (under
 * `playarr.cast.delegated.v1`) -- the access token itself is short-lived by
 * design and is never persisted; every call to `ensureDelegatedCastCredentials`
 * redeems a fresh one, either via the three-call mint above (first ever
 * cast to this server) or a single `POST /api/v1/auth/refresh` against the
 * cached refresh token (every subsequent cast).
 */
import {
  ApiClient,
  type AccessTokenRequest,
} from "@playarr-tv/api-client";
import {
  decodeAccessTokenDeviceId,
  pollDeviceToken,
  requestDeviceCode,
} from "@playarr-tv/device-auth";
import type { PlayarrCastCredentials } from "@playarr-tv/cast-protocol";

const DELEGATED_CAST_AUTH_STORAGE_KEY = "playarr.cast.delegated.v1";

export interface DelegatedCastDeviceIdentity {
  castDeviceId: string;
  castRefreshToken: string;
}

interface StoredDelegatedCastAuth extends DelegatedCastDeviceIdentity {
  /** The server these credentials were minted against; a different server needs its own device identity. */
  apiBaseUrl: string;
}

export type CastAuthStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function safeLocalStorage(): CastAuthStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function isStoredDelegatedCastAuth(value: unknown): value is StoredDelegatedCastAuth {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredDelegatedCastAuth>;
  return (
    typeof candidate.castDeviceId === "string" &&
    typeof candidate.castRefreshToken === "string" &&
    typeof candidate.apiBaseUrl === "string"
  );
}

function readCachedIdentity(
  storage: CastAuthStorage | undefined,
  apiBaseUrl: string
): DelegatedCastDeviceIdentity | undefined {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(DELEGATED_CAST_AUTH_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredDelegatedCastAuth(parsed) || parsed.apiBaseUrl !== apiBaseUrl) {
      return undefined;
    }
    return { castDeviceId: parsed.castDeviceId, castRefreshToken: parsed.castRefreshToken };
  } catch {
    return undefined;
  }
}

function writeCachedIdentity(
  storage: CastAuthStorage | undefined,
  apiBaseUrl: string,
  identity: DelegatedCastDeviceIdentity
): void {
  if (!storage) return;
  try {
    const stored: StoredDelegatedCastAuth = { apiBaseUrl, ...identity };
    storage.setItem(DELEGATED_CAST_AUTH_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Casting still works for this attempt; only cross-session reuse (mint
    // once, reuse thereafter) is lost.
  }
}

function clearCachedIdentity(storage: CastAuthStorage | undefined): void {
  try {
    storage?.removeItem(DELEGATED_CAST_AUTH_STORAGE_KEY);
  } catch {
    // Best-effort; a fresh mint below behaves the same as if this had
    // succeeded.
  }
}

export interface EnsureDelegatedCastCredentialsOptions {
  /** Base URL of the Playarr Server the receiver will negotiate playback against. */
  apiBaseUrl: string;
  /** Injected (rather than defaulted to global `fetch`) so this whole flow is unit-testable against a stub. */
  fetchImpl: (input: Request) => Promise<Response>;
  /**
   * Resolves the SIGNED-IN sender's own bearer token -- used only to
   * self-approve the freshly-minted cast device code (step 2 above). Never
   * forwarded to the receiver; see this module's top comment for why.
   */
  getSenderAccessToken: (request?: AccessTokenRequest) => string | undefined | Promise<string | undefined>;
  storage?: CastAuthStorage;
}

function credentialsFromDeviceToken(
  castDeviceId: string,
  tokenResult: Extract<Awaited<ReturnType<typeof pollDeviceToken>>, { status: "success" }>
): PlayarrCastCredentials {
  return {
    deviceId: castDeviceId,
    accessToken: tokenResult.accessToken,
    accessTokenExpiresAt: Date.now() + tokenResult.expiresInSeconds * 1000,
    refreshToken: tokenResult.refreshToken,
  };
}

async function mintDelegatedCastDeviceIdentity(
  client: ApiClient
): Promise<{ identity: DelegatedCastDeviceIdentity; credentials: PlayarrCastCredentials }> {
  const deviceCodeResponse = await requestDeviceCode(client, "cast");
  await client.authorizeDevice({ user_code: deviceCodeResponse.userCode });
  const tokenResult = await pollDeviceToken(client, deviceCodeResponse.deviceCode);
  if (tokenResult.status !== "success") {
    throw new Error(`Delegated Cast device authorization did not complete: ${tokenResult.status}`);
  }
  const castDeviceId = decodeAccessTokenDeviceId(tokenResult.accessToken);
  if (!castDeviceId) {
    throw new Error("Cast device access token did not carry a device_id claim.");
  }
  return {
    identity: { castDeviceId, castRefreshToken: tokenResult.refreshToken },
    credentials: credentialsFromDeviceToken(castDeviceId, tokenResult),
  };
}

/**
 * Returns a fresh `PlayarrCastCredentials` for `options.apiBaseUrl`, minting
 * a brand-new delegated device identity on the first call for that server
 * and reusing (via a `POST /api/v1/auth/refresh` redemption) the cached one
 * on every call after that. If the cached refresh token turns out to be
 * dead (revoked, reuse-detected, or the device was forgotten server-side),
 * this falls through to minting a fresh identity instead of throwing --
 * the same "refresh fails -> fall through to a fresh credential-less
 * attempt" shape `@playarr-tv/device-auth`'s own `ensureAccessToken` uses
 * for the analogous transparent-login case.
 */
export async function ensureDelegatedCastCredentials(
  options: EnsureDelegatedCastCredentialsOptions
): Promise<PlayarrCastCredentials> {
  const storage = options.storage ?? safeLocalStorage();
  const client = new ApiClient({
    baseUrl: options.apiBaseUrl,
    fetchImpl: options.fetchImpl,
    getAccessToken: options.getSenderAccessToken,
  });

  const cached = readCachedIdentity(storage, options.apiBaseUrl);
  if (cached) {
    try {
      const refreshed = await client.refresh({
        device_id: cached.castDeviceId,
        refresh_token: cached.castRefreshToken,
      });
      writeCachedIdentity(storage, options.apiBaseUrl, {
        castDeviceId: cached.castDeviceId,
        castRefreshToken: refreshed.refresh_token,
      });
      return {
        deviceId: cached.castDeviceId,
        accessToken: refreshed.access_token,
        accessTokenExpiresAt: Date.now() + refreshed.expires_in * 1000,
        refreshToken: refreshed.refresh_token,
      };
    } catch {
      clearCachedIdentity(storage);
    }
  }

  const { identity, credentials } = await mintDelegatedCastDeviceIdentity(client);
  writeCachedIdentity(storage, options.apiBaseUrl, identity);
  return credentials;
}

/**
 * Persists a rotated refresh token the receiver pushes back over the
 * custom channel as an `auth.rotated` message -- once a cast session is
 * underway the *receiver* owns that credential's lifecycle (see
 * `docs`/the protocol design), and rotates its refresh token independently
 * of this module's own `client.refresh` redemptions above. Call this from
 * wherever `auth.rotated` messages are handled so the next
 * `ensureDelegatedCastCredentials` call for this server reuses the
 * up-to-date token instead of one the receiver has already rotated past.
 */
export function persistRotatedDelegatedCastCredentials(
  apiBaseUrl: string,
  credentials: Pick<PlayarrCastCredentials, "deviceId" | "refreshToken">,
  storage: CastAuthStorage | undefined = safeLocalStorage()
): void {
  writeCachedIdentity(storage, apiBaseUrl, {
    castDeviceId: credentials.deviceId,
    castRefreshToken: credentials.refreshToken,
  });
}

/** Forgets the cached delegated identity entirely (e.g. on sign-out). */
export function clearDelegatedCastCredentials(
  storage: CastAuthStorage | undefined = safeLocalStorage()
): void {
  clearCachedIdentity(storage);
}
