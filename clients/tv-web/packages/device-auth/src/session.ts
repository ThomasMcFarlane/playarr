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
 */
import type { ApiClient, ClientPlatform, LoginRequest, RefreshRequest } from "@streamarr-tv/api-client";
import { getOrCreateDeviceId } from "./deviceId";
import type { StoredSession, TokenStore } from "./tokenStore";

export interface EnsureAccessTokenIdentity {
  deviceName: string;
  clientPlatform: ClientPlatform;
  clientVersion: string;
  /** Override for clients that persist more than one independent session per installation. */
  deviceId?: string;
}

export interface EnsureAccessTokenOptions {
  /** Refresh even when the stored access token has not reached its renewal window. */
  forceRefresh?: boolean;
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
// Streamarr currently issues 15-minute access tokens, so renewing two minutes
// early keeps refresh traffic modest while avoiding edge-of-expiry 401s.
const ACCESS_TOKEN_MINIMUM_VALIDITY_MS = 2 * 60 * 1000;

/**
 * Returns a currently-valid access token. Three cases, in order:
 *
 * 1. The stored access token hasn't expired yet -- return it as-is.
 * 2. A stored session exists but its access token has expired -- redeem
 *    its refresh token via `POST /api/v1/auth/refresh` (rotates it; see
 *    `ApiClient.refresh`'s doc comment) rather than starting over. Only
 *    falls through to (3) if the refresh token itself no longer works
 *    (expired, revoked, already-rotated-and-reused) -- a real "you're
 *    logged out" case, not just "some time passed."
 * 3. Nothing usable is stored (or (2) failed) -- transparently call
 *    `POST /api/v1/auth/login` with no credentials. `LoginRequest`'s
 *    `username`/`password`/`pin`/`profile_user_id` are only consulted by
 *    auth tiers other than the default `TrustedNetwork`, so this never
 *    needs to prompt for anything -- see `ApiClient.login`'s doc comment.
 *    Under `AuthMode::FullAccount`/`ManagedProfiles` this step has nothing
 *    to fall back on and rejects -- callers (`ApiClientProvider`) treat
 *    that as "redirect to a real login screen."
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
    !options.forceRefresh &&
    existing &&
    existing.expiresAt > Date.now() + ACCESS_TOKEN_MINIMUM_VALIDITY_MS
  ) {
    return existing.accessToken;
  }

  const acquirePromise = (async () => {
    try {
      if (existing) {
        try {
          const refreshBody: RefreshRequest = {
            device_id: identity.deviceId ?? getOrCreateDeviceId(),
            refresh_token: existing.refreshToken,
          };
          const refreshed = await client.refresh(refreshBody);
          store.set(toStoredSession(refreshed));
          return refreshed.access_token;
        } catch {
          // Refresh token itself is dead -- fall through to a fresh
          // transparent login attempt below, same as having nothing
          // stored at all.
        }
      }

      const body: LoginRequest = {
        device_id: identity.deviceId ?? getOrCreateDeviceId(),
        device_name: identity.deviceName,
        client_platform: identity.clientPlatform,
        client_version: identity.clientVersion,
      };
      const response = await client.login(body);
      store.set(toStoredSession(response));
      return response.access_token;
    } finally {
      inFlightLogins.delete(store);
    }
  })();

  inFlightLogins.set(store, acquirePromise);
  return acquirePromise;
}
