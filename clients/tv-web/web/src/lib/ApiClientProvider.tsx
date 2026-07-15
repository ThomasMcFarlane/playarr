import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiClient } from "@streamarr-tv/api-client";
import { ensureAccessToken, TokenStore } from "@streamarr-tv/device-auth";
import { API_BASE_URL_QUERY_PARAM, getStoredApiBaseUrl, setStoredApiBaseUrl } from "@streamarr-tv/domain";

/**
 * This build's own identity for the transparent `POST /api/v1/auth/login`
 * call (see `ensureAccessToken`) -- the Web app has no RFC 8628 pairing
 * flow of its own, so this is how it obtains a real access token the first
 * time it needs one (the admin source-instance create/list/delete/sync
 * calls). `__APP_VERSION__` is injected at build time by `vite.config.ts`,
 * same as `lib/appUpdate.ts` uses.
 */
const WEB_LOGIN_IDENTITY = {
  deviceName: "Streamarr Web",
  clientPlatform: "web" as const,
  clientVersion: __APP_VERSION__,
};

interface ApiClientContextValue {
  client: ApiClient;
  apiBaseUrl: string;
  /** Persists to localStorage (the web app's Settings page) and rebuilds the shared `ApiClient`. */
  setApiBaseUrl: (value: string) => void;
}

const ApiClientContext = createContext<ApiClientContextValue | null>(null);

/**
 * Resolves the initial API base URL for the web app: an operator-entered
 * value persisted from the Settings page wins, then a `?apiBaseUrl=...`
 * query param (for a split reverse-proxy deployment or pointing a dev
 * build at a non-default backend), then this page's own origin.
 *
 * Same-origin is the real default, not a placeholder: `streamarr-bin` co-
 * hosts this app's built assets with the API on one port (see
 * `streamarr_api::build_router`'s `web_assets_dir`), matching how every
 * other `*arr` app ships its own UI, so "this page's origin" *is* the API
 * for the common case -- no configuration required. `vite.config.ts`
 * proxies `/api` etc. to a local backend so this also holds for
 * `pnpm run dev`. Unlike the TV app shells, the web app has a real
 * Settings text field (see `pages/Settings.tsx`) instead of the TV-only
 * `streamarr-config.json` runtime-config-file lookup, so that lookup is
 * skipped here.
 */
function resolveInitialApiBaseUrl(): string {
  const stored = getStoredApiBaseUrl();
  if (stored) return stored;

  const fromQuery = new URLSearchParams(window.location.search).get(API_BASE_URL_QUERY_PARAM);
  if (fromQuery) return fromQuery;

  return window.location.origin;
}

export function ApiClientProvider({ children }: { children: ReactNode }) {
  // Resolvable synchronously now that same-origin (rather than an awaited
  // config-file fetch) is the fallback -- see `resolveInitialApiBaseUrl` --
  // so this is a plain lazy initializer, not a `null`-until-resolved effect.
  const [apiBaseUrl, setApiBaseUrlState] = useState<string>(resolveInitialApiBaseUrl);
  // One `TokenStore` for the lifetime of this provider (survives an `apiBaseUrl`
  // change, e.g. from the Settings page) -- see `ensureAccessToken`'s doc comment
  // on why the login path and any future pairing path must share exactly one.
  const tokenStoreRef = useRef<TokenStore>();
  if (!tokenStoreRef.current) {
    tokenStoreRef.current = new TokenStore();
  }

  const setApiBaseUrl = useCallback((value: string) => {
    setStoredApiBaseUrl(value);
    setApiBaseUrlState(value);
  }, []);

  const client = useMemo<ApiClient | null>(() => {
    if (!apiBaseUrl) return null;
    const tokenStore = tokenStoreRef.current as TokenStore;
    // `instance` is referenced inside `getAccessToken` below before this
    // `const` finishes initializing -- safe because that closure only ever
    // runs later (on a protected request), by which point `instance` is bound.
    const instance: ApiClient = new ApiClient({
      baseUrl: apiBaseUrl,
      getAccessToken: () => ensureAccessToken(instance, tokenStore, WEB_LOGIN_IDENTITY),
    });
    return instance;
  }, [apiBaseUrl]);

  if (!apiBaseUrl || !client) {
    // Briefly resolving the stored/query-param base URL; nothing to render yet.
    return null;
  }

  return (
    <ApiClientContext.Provider value={{ client, apiBaseUrl, setApiBaseUrl }}>
      {children}
    </ApiClientContext.Provider>
  );
}

function useApiClientContext(): ApiClientContextValue {
  const value = useContext(ApiClientContext);
  if (!value) {
    throw new Error("useApiClient()/useApiBaseUrl() must be called within an <ApiClientProvider>.");
  }
  return value;
}

export function useApiClient(): ApiClient {
  return useApiClientContext().client;
}

export function useApiBaseUrl(): [string, (value: string) => void] {
  const { apiBaseUrl, setApiBaseUrl } = useApiClientContext();
  return [apiBaseUrl, setApiBaseUrl];
}
