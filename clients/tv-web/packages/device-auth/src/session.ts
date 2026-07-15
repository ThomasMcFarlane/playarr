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
 */
import type { ApiClient, ClientPlatform, LoginRequest } from "@streamarr-tv/api-client";
import { getOrCreateDeviceId } from "./deviceId";
import type { StoredSession, TokenStore } from "./tokenStore";

export interface EnsureAccessTokenIdentity {
  deviceName: string;
  clientPlatform: ClientPlatform;
  clientVersion: string;
}

function toStoredSession(response: {
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

/**
 * Returns a currently-valid access token, transparently calling
 * `POST /api/v1/auth/login` when `store` holds nothing usable yet.
 * `LoginRequest`'s `username`/`password`/`pin`/`profile_user_id` are only
 * consulted by auth tiers other than the default `TrustedNetwork`, so this
 * never needs to prompt for anything -- see `ApiClient.login`'s doc comment.
 */
export async function ensureAccessToken(
  client: ApiClient,
  store: TokenStore,
  identity: EnsureAccessTokenIdentity
): Promise<string> {
  const existing = store.get();
  if (existing && store.hasValidAccessToken()) {
    return existing.accessToken;
  }

  const pending = inFlightLogins.get(store);
  if (pending) return pending;

  const loginPromise = (async () => {
    try {
      const body: LoginRequest = {
        device_id: getOrCreateDeviceId(),
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

  inFlightLogins.set(store, loginPromise);
  return loginPromise;
}
