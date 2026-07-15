import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiClient } from "@streamarr-tv/api-client";
import { getStoredApiBaseUrl, resolveApiBaseUrl, setStoredApiBaseUrl } from "@streamarr-tv/domain";

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

  useEffect(() => {
    void resolveInitialApiBaseUrl().then(setApiBaseUrlState);
  }, []);

  const setApiBaseUrl = useCallback((value: string) => {
    setStoredApiBaseUrl(value);
    setApiBaseUrlState(value);
  }, []);

  const client = useMemo(() => (apiBaseUrl ? new ApiClient({ baseUrl: apiBaseUrl }) : null), [apiBaseUrl]);

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
