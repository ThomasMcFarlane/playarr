import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiClient } from "@playarr-tv/api-client";
import { decodeAccessTokenUserId, ensureAccessToken, TokenStore } from "@playarr-tv/device-auth";
import { API_BASE_URL_QUERY_PARAM } from "@playarr-tv/domain";

/**
 * This build's own identity for the transparent `POST /api/v1/auth/login`
 * call (see `ensureAccessToken`). `clientPlatform: "playarr-admin"` is a
 * real, dedicated `ClientPlatform` variant (not a borrowed Playarr one) --
 * `login_handler` on the backend uses it to skip the `can_stream` gate it
 * otherwise requires for every other platform, since this app is
 * Playarr Server's own admin surface, not a Playarr client (see that handler's
 * doc comment).
 */
const ADMIN_LOGIN_IDENTITY = {
  deviceName: "Playarr Server Admin",
  clientPlatform: "playarr-admin" as const,
  clientVersion: "0.1.0",
};

interface ApiClientContextValue {
  client: ApiClient;
  apiBaseUrl: string;
  /**
   * The signed-in user's id, decoded (unverified -- see
   * `decodeAccessTokenUserId`'s doc comment) from the current access
   * token's `sub` claim. Seeded synchronously from whatever `TokenStore`
   * already has on mount (a page reload with a still-valid session, the
   * normal case since `LoginPage` navigates here only after storing a
   * session) -- purely a UX hint for the Users page's self-lockout guard,
   * never a security boundary.
   */
  currentUserId: string | undefined;
  /**
   * Resolves `true` once a valid access token is available -- redeeming
   * the stored refresh token first (see `ensureAccessToken`'s doc
   * comment) if the access token has expired, rather than assuming an
   * expired access token means "not logged in." `App.tsx`'s `RequireAuth`
   * calls this before deciding whether to redirect to `/login`: a stored
   * session's *access* token expires every ~15 minutes by design (see
   * `JwtIssuer::access_ttl` on the backend), and without this, `RequireAuth`
   * previously redirected on that alone -- bouncing an operator to a full
   * re-login every ~15 minutes even though their (much longer-lived,
   * durably persisted) refresh token was still perfectly valid the whole
   * time. Resolves `false` (never throws) if refresh genuinely fails too
   * (expired/revoked refresh token, or no session at all).
   */
  ensureSignedIn: () => Promise<boolean>;
}

const ApiClientContext = createContext<ApiClientContextValue | null>(null);

/**
 * Playarr Server's admin UI is co-hosted by the backend itself (same origin,
 * same port -- see `playarr_api::build_router`'s `web_assets_dir`), so
 * the API base URL is always this page's own origin. A `?apiBaseUrl=...`
 * override exists only for pointing a local dev build at a non-default
 * backend; there is no Settings-page override here (unlike Playarr Web) --
 * this app only ever talks to the one Playarr Server instance serving it.
 */
function resolveApiBaseUrl(): string {
  const fromQuery = new URLSearchParams(window.location.search).get(API_BASE_URL_QUERY_PARAM);
  if (fromQuery) return fromQuery;
  return window.location.origin;
}

export function ApiClientProvider({ children }: { children: ReactNode }) {
  const [apiBaseUrl] = useState<string>(resolveApiBaseUrl);
  const tokenStoreRef = useRef<TokenStore>();
  if (!tokenStoreRef.current) {
    tokenStoreRef.current = new TokenStore();
  }

  const [currentUserId, setCurrentUserId] = useState<string | undefined>(() => {
    const existing = tokenStoreRef.current?.get();
    return existing ? decodeAccessTokenUserId(existing.accessToken) : undefined;
  });

  const client = useMemo<ApiClient>(() => {
    const tokenStore = tokenStoreRef.current as TokenStore;
    const instance: ApiClient = new ApiClient({
      baseUrl: apiBaseUrl,
      getAccessToken: async () => {
        const token = await ensureAccessToken(instance, tokenStore, ADMIN_LOGIN_IDENTITY);
        setCurrentUserId(decodeAccessTokenUserId(token));
        return token;
      },
    });
    return instance;
  }, [apiBaseUrl]);

  const ensureSignedIn = useCallback(async () => {
    try {
      await ensureAccessToken(client, tokenStoreRef.current as TokenStore, ADMIN_LOGIN_IDENTITY);
      return true;
    } catch {
      return false;
    }
  }, [client]);

  return (
    <ApiClientContext.Provider value={{ client, apiBaseUrl, currentUserId, ensureSignedIn }}>
      {children}
    </ApiClientContext.Provider>
  );
}

function useApiClientContext(): ApiClientContextValue {
  const value = useContext(ApiClientContext);
  if (!value) {
    throw new Error("useApiClient() must be called within an <ApiClientProvider>.");
  }
  return value;
}

export function useApiClient(): ApiClient {
  return useApiClientContext().client;
}

export function useApiBaseUrl(): string {
  return useApiClientContext().apiBaseUrl;
}

/** See `ApiClientContextValue.currentUserId`'s doc comment. */
export function useCurrentUserId(): string | undefined {
  return useApiClientContext().currentUserId;
}

/** See `ApiClientContextValue.ensureSignedIn`'s doc comment. */
export function useEnsureSignedIn(): () => Promise<boolean> {
  return useApiClientContext().ensureSignedIn;
}
