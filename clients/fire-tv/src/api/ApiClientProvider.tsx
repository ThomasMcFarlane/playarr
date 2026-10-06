/**
 * A deliberately reduced RN port of
 * `clients/tv-web/web/src/lib/ApiClientProvider.tsx` (1381 lines) --
 * design doc §4.5 names exactly what v1 keeps (token store, known-server
 * group, authFailed, platform headers) and what it drops (joined-server
 * fan-out, downloads engine, OTA/service-worker, Firebase). This file is
 * that reduced slice, plus one more deliberate narrowing worth stating
 * explicitly: it does NOT yet implement `profile sessions` (multi-profile
 * switching) or the `ensureAccessToken` refresh-retry orchestration.
 * Both need state (a linked server, a known device id and server group)
 * that only exists after a later step builds `src/auth/**` -- attempting
 * either here, before that exists, would mean inventing the very contract
 * that step should own. What this file DOES provide is the seam that step
 * plugs into: `getAccessToken` is passed through openly rather than
 * hard-coded to "read the raw stored token" internally, and `authFailed`
 * is exposed as plain state with a setter, for that later code to drive.
 *
 * `TokenStore` is used exactly as-is from `@playarr-tv/device-auth` --
 * see that package's own doc comment for why a module-level
 * `memoryFallback` (not a per-instance field) is load-bearing there, and
 * why constructing `new TokenStore()` here rather than reaching for some
 * singleton is deliberately harmless given that.
 */
import React, {createContext, useContext, useMemo, useState, type ReactNode} from 'react';
import type {ApiClient} from '@playarr-tv/api-client';
import {TokenStore} from '@playarr-tv/device-auth';
import {DEFAULT_API_BASE_URL, getStoredApiBaseUrl, setStoredApiBaseUrl} from '@playarr-tv/domain';
import {createApiClient} from './client';

const tokenStore = new TokenStore();

interface ApiClientContextValue {
  client: ApiClient;
  apiBaseUrl: string;
  /** Persists to the storage shim, clears the current session (a session tied to the old server is meaningless against a new one), and rebuilds `client`. */
  setApiBaseUrl: (value: string) => void;
  /**
   * True once something has decided the current session cannot be trusted
   * any further (today: nothing internally does -- this is plain state a
   * later `src/auth/session.ts` drives via `markAuthFailed`, the same
   * contract the web app's `App.tsx` shell-level redirect-to-`/profiles`
   * reads from its own provider).
   */
  authFailed: boolean;
  markAuthFailed: () => void;
  clearAuthFailed: () => void;
}

const ApiClientContext = createContext<ApiClientContextValue | undefined>(undefined);

function buildClient(baseUrl: string): ApiClient {
  return createApiClient(baseUrl, {
    // Deliberately the simplest correct thing today: the raw stored access
    // token, not expiry-checked or refreshed here. A paired TV session's
    // access token is short-lived by design (server-side JwtIssuer::
    // access_ttl) and WILL eventually expire mid-session; silently
    // re-authenticating when that happens is `ensureAccessToken`'s job
    // (`@playarr-tv/device-auth`, already fully implemented, reused
    // verbatim per design doc §5.5) -- wiring its retry-across-server-group
    // behaviour needs a `KnownServerGroup`/device id that only exist once
    // `src/auth/**` (a later step) has actually linked a server. Until
    // then, an expired token means the next protected call 401s and
    // whatever called it sees an `ApiError` -- a real, if unpolished,
    // failure mode, not a silent hang.
    getAccessToken: () => tokenStore.get()?.accessToken,
  });
}

/**
 * Initial `apiBaseUrl`, resolved once at first render. Deliberately reads
 * only the operator-entered value already stored via a previous device
 * link (`getStoredApiBaseUrl`) rather than calling
 * `@playarr-tv/domain`'s fuller `resolveApiBaseUrl` (which also checks a
 * `?apiBaseUrl=` query param and an optional bundled runtime-config JSON
 * file): that function reads `window.location.search` when `window`
 * exists, and `src/bootstrap/polyfills.ts` deliberately installs only a
 * bare `{fetch}` stub under that name for Shaka's benefit, with no
 * `.location` -- calling it unmodified here would throw, not gracefully
 * skip the query-param check. Query-param launch has no verified mechanism
 * on Vega yet in any case (design doc's deep-link discussion defers that to
 * v2); the one real source of truth for "which server" before any linking
 * has happened is "none yet", which is exactly what falling through to
 * `DEFAULT_API_BASE_URL` represents.
 */
function resolveInitialApiBaseUrl(): string {
  return getStoredApiBaseUrl() ?? DEFAULT_API_BASE_URL;
}

export function ApiClientProvider({children}: {children: ReactNode}): JSX.Element {
  const [apiBaseUrl, setApiBaseUrlState] = useState(resolveInitialApiBaseUrl);
  const [authFailed, setAuthFailed] = useState(false);

  // Rebuilding only when apiBaseUrl actually changes -- not on every render
  // -- matters here specifically because VegaPlaybackEngine (a later step)
  // is a shell-mounted singleton wrapping a single secure decoder instance
  // (design doc §6.3); a new ApiClient identity on every render would be
  // harmless in itself, but there is no reason to manufacture the churn.
  const client = useMemo(() => buildClient(apiBaseUrl), [apiBaseUrl]);

  function setApiBaseUrl(value: string): void {
    setStoredApiBaseUrl(value);
    tokenStore.clear();
    setAuthFailed(false);
    setApiBaseUrlState(value);
  }

  const value = useMemo<ApiClientContextValue>(
    () => ({
      client,
      apiBaseUrl,
      setApiBaseUrl,
      authFailed,
      markAuthFailed: () => setAuthFailed(true),
      clearAuthFailed: () => setAuthFailed(false),
    }),
    // setApiBaseUrl is a fresh closure each render but is stable in every
    // way that matters (it only ever reads the latest `apiBaseUrl` setter,
    // never `apiBaseUrl` itself) -- omitted rather than wrapped in its own
    // useCallback purely to avoid a second memoisation whose only job would
    // be feeding this one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, apiBaseUrl, authFailed]
  );

  return <ApiClientContext.Provider value={value}>{children}</ApiClientContext.Provider>;
}

function useApiClientContext(): ApiClientContextValue {
  const context = useContext(ApiClientContext);
  if (!context) {
    throw new Error('This hook must be used within an <ApiClientProvider>.');
  }
  return context;
}

/** The shared `ApiClient` instance every screen's data fetching (`@playarr-tv/api-client/react`'s hooks included) should use. */
export function useApiClient(): ApiClient {
  return useApiClientContext().client;
}

/** The current server address, and a setter that persists + clears the session + rebuilds `client` as a unit. */
export function useApiBaseUrl(): [string, (value: string) => void] {
  const {apiBaseUrl, setApiBaseUrl} = useApiClientContext();
  return [apiBaseUrl, setApiBaseUrl];
}

/** Whether the app shell should treat the current session as unusable and route back to `LinkScreen`/`ProfilesScreen`. */
export function useAuthFailed(): {
  authFailed: boolean;
  markAuthFailed: () => void;
  clearAuthFailed: () => void;
} {
  const {authFailed, markAuthFailed, clearAuthFailed} = useApiClientContext();
  return {authFailed, markAuthFailed, clearAuthFailed};
}
