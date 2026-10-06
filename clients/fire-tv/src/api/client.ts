/**
 * Constructs a `@playarr-tv/api-client` `ApiClient` wired for React
 * Native's `fetch` and this app's platform headers. This is a from-scratch
 * RN port, not a byte-for-byte copy, of two things
 * `clients/tv-web/web/src/lib/ApiClientProvider.tsx`'s
 * `createManagedApiClient` already does for the web app -- ported here
 * rather than re-derived because both are pure logic over
 * `@playarr-tv/domain`, with nothing DOM-specific in either:
 *
 *   1. Peer-group self-healing (docs/architecture/peer-groups.md, design
 *      doc §5.5's mandatory rules): every successful response marks this
 *      `baseUrl` as reachable in the remembered `KnownServerGroup`
 *      (`rememberServerSuccess`), and every login/refresh response that
 *      carries `peer_addresses` folds them into the remembered group
 *      (`rememberGroup`/`mergeKnownServerGroup`). A standalone deployment
 *      (no peer group joined) makes both of these harmless no-ops --
 *      `rememberServerSuccess` has nothing to update, and
 *      `peer_addresses` stays `null` -- so this is safe to wire
 *      unconditionally rather than gating it behind "is this deployment
 *      peer-grouped".
 *   2. The `X-Streamarr-Client-Platform`/`X-Streamarr-Client-Version`
 *      headers every non-web Playarr client sends (verified exact header
 *      names against the web app's own `PLAYARR_PLATFORM_HEADERS`).
 *
 * Deliberately NOT ported: the web app's `withLocalNetworkFetch` (a
 * browser-only XHR shim working around Chrome's mixed-content/CORS
 * treatment of private-network fetches -- RN has neither CORS nor
 * mixed-content blocking, so there is nothing for an equivalent to work
 * around), `PLAYARR_LOGIN_IDENTITY`'s per-platform `deviceName` branching
 * (this app only ever is one platform; `config/appConfig.ts`'s
 * `deviceName` is already the single right answer, no branch needed), and
 * the joined-server fan-out `createJoinedApiClient` supports (design doc
 * §4.5: explicitly dropped from v1).
 */
import {ApiClient, type ApiClientConfig, type PeerAddressBundle} from '@playarr-tv/api-client';
import {mergeKnownServerGroup, rememberGroup, rememberServerSuccess} from '@playarr-tv/domain';
import {APP_CONFIG} from '../config/appConfig';

/**
 * `ApiClientConfig.fetchImpl`'s real declared shape -- it takes the already-
 * constructed `Request` `openapi-fetch` builds, not the two-argument
 * `(url, init)` form `fetch` is more commonly called with. RN's global
 * `fetch` supports being invoked this way (it is itself the fallback
 * `ApiClient`'s constructor uses when no `fetchImpl` is supplied at all),
 * so `(input) => fetch(input)` below is not a shim, only a name RN's global
 * agrees with.
 */
type RnFetch = (input: Request) => Promise<Response>;

function withServerSuccessTracking(fetchImpl: RnFetch, baseUrl: string): RnFetch {
  return async (input) => {
    const response = await fetchImpl(input);
    if (response.ok) rememberServerSuccess(baseUrl);
    return response;
  };
}

function withPeerAddressSelfHealing(client: ApiClient, baseUrl: string): ApiClient {
  const originalLogin = client.login.bind(client);
  const originalRefresh = client.refresh.bind(client);

  const fold = (response: {peer_addresses?: PeerAddressBundle | null}): void => {
    if (response.peer_addresses) {
      rememberGroup(mergeKnownServerGroup(response.peer_addresses, baseUrl));
    }
  };

  client.login = async (body) => {
    const response = await originalLogin(body);
    fold(response);
    return response;
  };
  client.refresh = async (body) => {
    const response = await originalRefresh(body);
    fold(response);
    return response;
  };

  return client;
}

export interface CreateApiClientOptions {
  /**
   * Reads the current access token, or `undefined` to send the protected
   * request tokenless anyway (the server 401s it -- see
   * `ApiClientConfig.getAccessToken`'s own doc comment). Left undefined
   * here entirely -- e.g. while browsing catalog/playback endpoints, which
   * never need one -- rather than always wired, because `ApiClientProvider`
   * is the one place that should decide what "the current token" means
   * (this file has no opinion on token storage at all).
   */
  getAccessToken?: ApiClientConfig['getAccessToken'];
  /** Injectable for tests; defaults to RN's global `fetch`. */
  fetchImpl?: RnFetch;
}

/**
 * Builds an `ApiClient` bound to one server address, wired for peer-group
 * self-healing and this app's platform headers. Every `ApiClient`
 * construction site in this app should go through this rather than `new
 * ApiClient(...)` directly -- `ApiClientProvider.tsx` is the one call site
 * today; a later per-server client (for the joined-server case, if v2 ever
 * adds it back) would be another.
 */
export function createApiClient(baseUrl: string, options: CreateApiClientOptions = {}): ApiClient {
  const baseFetch: RnFetch = options.fetchImpl ?? ((input) => fetch(input));

  const instance = new ApiClient({
    baseUrl,
    getAccessToken: options.getAccessToken,
    fetchImpl: withServerSuccessTracking(baseFetch, baseUrl),
    defaultHeaders: {
      'X-Streamarr-Client-Platform': APP_CONFIG.clientPlatform,
      'X-Streamarr-Client-Version': APP_CONFIG.clientVersion,
    },
  });

  return withPeerAddressSelfHealing(instance, baseUrl);
}
