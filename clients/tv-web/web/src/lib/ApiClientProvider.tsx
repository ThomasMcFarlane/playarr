import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiClient } from "@streamarr-tv/api-client";
import { ensureAccessToken, TokenStore } from "@streamarr-tv/device-auth";
import { getStoredApiBaseUrl, resolveApiBaseUrl, setStoredApiBaseUrl } from "@streamarr-tv/domain";

/**
 * This build's own identity for the transparent `POST /api/v1/auth/login`
 * call (see `ensureAccessToken`) -- the Web app has no RFC 8628 pairing
 * flow of its own, so this is how it obtains a real access token the first
 * time it needs one (the request submit/approve/reject calls, per Round
 * E's auth middleware). `__APP_VERSION__` is injected at build time by
 * `vite.config.ts`, same as `lib/appUpdate.ts` uses.
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
 * query param, then `DEFAULT_API_BASE_URL`. Unlike the TV app shells, the
 * web app has a real Settings text field (see `pages/Settings.tsx`), so it
 * skips the TV-only `streamarr-config.json` runtime-config-file lookup.
 */
async function resolveInitialApiBaseUrl(): Promise<string> {
  return getStoredApiBaseUrl() ?? (await resolveApiBaseUrl({ configFileUrl: null }));
}

export function ApiClientProvider({ children }: { children: ReactNode }) {
  const [apiBaseUrl, setApiBaseUrlState] = useState<string | null>(null);
  // One `TokenStore` for the lifetime of this provider (survives an `apiBaseUrl`
  // change, e.g. from the Settings page) -- see `ensureAccessToken`'s doc comment
  // on why the login path and any future pairing path must share exactly one.
  const tokenStoreRef = useRef<TokenStore>();
  if (!tokenStoreRef.current) {
    tokenStoreRef.current = new TokenStore();
  }

  useEffect(() => {
    void resolveInitialApiBaseUrl().then(setApiBaseUrlState);
  }, []);

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
