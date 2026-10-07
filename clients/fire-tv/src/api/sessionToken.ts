import type {ApiClient} from '@playarr-tv/api-client';
import {TransientAuthError, type TokenStore} from '@playarr-tv/device-auth';

/** The slice of `ApiClientConfig['getAccessToken']`'s request this provider reads. */
export interface AccessTokenRequestLike {
  forceRefresh?: boolean;
  rejectedAccessToken?: string;
}

export interface SessionTokenProviderDeps {
  store: TokenStore;
  getClient: () => ApiClient;
  /** Called when the stored session can no longer be renewed anywhere: the shell then returns to the profile picker. */
  onAuthFailed: () => void;
  ensure: (
    client: ApiClient,
    store: TokenStore,
    options: {forceRefresh?: boolean; rejectedAccessToken?: string}
  ) => Promise<string>;
}

/**
 * The client's access-token source: the stored token while it is valid, a refreshed one when it is about to expire or
 * the server rejected it. The raw stored token alone (what this app used) stops working 15 minutes after pairing, so
 * every request after that failed with 401 until the device paired again.
 */
export function createSessionTokenProvider(deps: SessionTokenProviderDeps) {
  return async function getAccessToken(request?: AccessTokenRequestLike): Promise<string | undefined> {
    const stored = deps.store.get();
    if (!stored) return undefined;
    try {
      return await deps.ensure(deps.getClient(), deps.store, {
        forceRefresh: request?.forceRefresh,
        rejectedAccessToken: request?.rejectedAccessToken,
      });
    } catch (error) {
      // A network failure leaves the session alone and lets the request go out with what is stored.
      if (error instanceof TransientAuthError) return stored.accessToken;
      deps.onAuthFailed();
      return undefined;
    }
  };
}
