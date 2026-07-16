import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiClient, type LoginRequest } from "@streamarr-tv/api-client";
import {
  decodeAccessTokenDeviceId,
  decodeAccessTokenUserId,
  ensureAccessToken,
  getOrCreateDeviceId,
  toStoredSession,
  TokenStore,
  type DeviceTokenSuccess,
  type StoredSession,
} from "@streamarr-tv/device-auth";
import {
  API_BASE_URL_QUERY_PARAM,
  getStoredApiBaseUrl,
  normaliseApiBaseUrl,
  setStoredApiBaseUrl,
} from "@streamarr-tv/domain";
import { PLAYARR_CLIENT_PLATFORM } from "./clientPlatform";

/**
 * This build's own identity for the transparent `POST /api/v1/auth/login`
 * call (see `ensureAccessToken`) -- the Web app has no RFC 8628 pairing
 * flow of its own, so this is how it obtains a real access token the first
 * time it needs one (the admin source-instance create/list/delete/sync
 * calls). `__APP_VERSION__` is injected at build time by `vite.config.ts`,
 * same as `lib/appUpdate.ts` uses.
 */
const PLAYARR_LOGIN_IDENTITY = {
  deviceName:
    PLAYARR_CLIENT_PLATFORM === "tv-vidaa"
      ? "Playarr for VIDAA"
      : PLAYARR_CLIENT_PLATFORM === "android-tv"
        ? "Playarr for Android TV"
        : "Playarr Web",
  clientPlatform: PLAYARR_CLIENT_PLATFORM,
  clientVersion: __APP_VERSION__,
};

const CURRENT_USER_NAME_STORAGE_KEY = "playarr.currentUserName";
const SAVED_PROFILE_SESSIONS_STORAGE_KEY = "playarr.profileSessions.v3";
const LEGACY_SAVED_PROFILE_SESSIONS_STORAGE_KEY = "playarr.profileSessions.v2";

function readStoredCurrentUserName(): string | undefined {
  const value = window.localStorage.getItem(CURRENT_USER_NAME_STORAGE_KEY)?.trim();
  return value || undefined;
}

interface StoredProfileSession {
  apiBaseUrl: string;
  userId: string;
  name: string;
  deviceId: string;
  session: StoredSession;
}

export interface SavedProfile {
  userId: string;
  name: string;
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<StoredSession>;
  return (
    typeof session.accessToken === "string" &&
    typeof session.refreshToken === "string" &&
    typeof session.tokenType === "string" &&
    typeof session.expiresAt === "number"
  );
}

function readStoredProfileSessions(fallbackApiBaseUrl: string): StoredProfileSession[] {
  try {
    const currentRaw = window.localStorage.getItem(SAVED_PROFILE_SESSIONS_STORAGE_KEY);
    const raw =
      currentRaw ??
      window.localStorage.getItem(LEGACY_SAVED_PROFILE_SESSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const profiles = parsed.flatMap((value): StoredProfileSession[] => {
      if (!value || typeof value !== "object") return [];
      const profile = value as Partial<StoredProfileSession>;
      if (
        typeof profile.userId === "string" &&
        typeof profile.name === "string" &&
        typeof profile.deviceId === "string" &&
        isStoredSession(profile.session)
      ) {
        return [
          {
            apiBaseUrl:
              typeof profile.apiBaseUrl === "string"
                ? profile.apiBaseUrl
                : fallbackApiBaseUrl,
            userId: profile.userId,
            name: profile.name,
            deviceId: profile.deviceId,
            session: profile.session,
          },
        ];
      }
      return [];
    });
    if (!currentRaw) {
      writeStoredProfileSessions(profiles);
      window.localStorage.removeItem(LEGACY_SAVED_PROFILE_SESSIONS_STORAGE_KEY);
    }
    return profiles;
  } catch {
    return [];
  }
}

function writeStoredProfileSessions(profiles: StoredProfileSession[]): void {
  window.localStorage.setItem(SAVED_PROFILE_SESSIONS_STORAGE_KEY, JSON.stringify(profiles));
}

function storedSessionsEqual(left: StoredSession, right: StoredSession): boolean {
  return (
    left.accessToken === right.accessToken &&
    left.refreshToken === right.refreshToken &&
    left.tokenType === right.tokenType &&
    left.expiresAt === right.expiresAt
  );
}

function createProfileDeviceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Credentials for the real username/password login flow -- see `ApiClientContextValue.login`. */
export interface LoginCredentials {
  serverUrl: string;
  username: string;
  password: string;
}

interface ApiClientContextValue {
  client: ApiClient;
  apiBaseUrl: string;
  /** Persists to localStorage, clears the current session, and rebuilds the shared `ApiClient`. */
  setApiBaseUrl: (value: string) => void;
  /**
   * The signed-in user's id, decoded (unverified -- see
   * `decodeAccessTokenUserId`'s doc comment) from the current access
   * token's `sub` claim. `undefined` until the first protected request has
   * actually obtained a token (the Web app logs in transparently/lazily --
   * see `ensureAccessToken` -- so there is nothing to decode before then).
   * Purely a UX hint for things like the Admin Users screen's self-lockout
   * guard, never a security boundary.
   */
  currentUserId: string | undefined;
  /**
   * Best display name available for the signed-in viewer. Full-account
   * logins persist their username because access tokens only carry a user
   * id; transparent/server-managed sessions leave this undefined.
   */
  currentUserName: string | undefined;
  /** Profiles with a refresh session saved in this browser. Tokens remain private to this provider. */
  savedProfiles: SavedProfile[];
  /**
   * True once a protected request's transparent login (`ensureAccessToken`)
   * has failed with nothing else to fall back on -- e.g. the server is
   * configured for `AuthMode::FullAccount`/`ManagedProfiles` and no stored
   * session covers it. `App.tsx`'s app shell redirects to `/login` on this
   * instead of letting every protected screen render its own opaque
   * "sign-in required" error inline (see `describeApiError`). Cleared
   * again by the next successful token acquisition, or by `login()`.
   */
  authFailed: boolean;
  /**
   * Real username/password login (`pages/Login.tsx`'s form) -- calls the
   * selected server's `POST /api/v1/auth/login` directly from the browser
   * with credentials (unlike
   * `ensureAccessToken`'s transparent, credential-less call) and persists
   * the result through the same `TokenStore` transparent login already
   * uses, via the shared `toStoredSession` mapping -- one place stores a
   * session, not two. Rejects on failure (invalid credentials, account
   * disabled, etc.); the caller surfaces that to the user.
   */
  login: (credentials: LoginCredentials) => Promise<void>;
  /** Stores the token pair returned by the TV device-code flow. */
  loginWithDeviceToken: (token: DeviceTokenSuccess) => void;
  /** Activates a profile session already saved in this browser and validates/refreshes it. */
  switchProfile: (userId: string) => Promise<void>;
  /** True when this browser already has a reusable session for the profile. */
  isProfileSaved: (userId: string) => boolean;
  /** Clears the stored session and `currentUserId`/`authFailed`. Callers still navigate to `/login` themselves. */
  logout: () => void;
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
  // One `TokenStore` for the lifetime of this provider. A server change clears
  // its current value before reusing it so no token is sent to another instance.
  const tokenStoreRef = useRef<TokenStore>();
  if (!tokenStoreRef.current) {
    tokenStoreRef.current = new TokenStore();
  }

  const applyApiBaseUrl = useCallback((value: string) => {
    setStoredApiBaseUrl(value);
    setApiBaseUrlState(value);
  }, []);

  // Seeded synchronously from whatever's already persisted (a page reload
  // with a still-valid session), then kept in sync by `getAccessToken`
  // below every time a protected request actually (re)acquires a token.
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(() => {
    const existing = tokenStoreRef.current?.get();
    return existing ? decodeAccessTokenUserId(existing.accessToken) : undefined;
  });
  const [currentUserName, setCurrentUserName] = useState<string | undefined>(
    readStoredCurrentUserName
  );
  const [storedProfileSessions, setStoredProfileSessions] = useState<StoredProfileSession[]>(() => {
    const stored = readStoredProfileSessions(apiBaseUrl);
    const activeSession = tokenStoreRef.current?.get();
    const activeUserId = activeSession
      ? decodeAccessTokenUserId(activeSession.accessToken)
      : undefined;
    if (
      !activeSession ||
      !activeUserId ||
      stored.some(
        (profile) =>
          profile.apiBaseUrl === apiBaseUrl && profile.userId === activeUserId
      )
    ) {
      return stored;
    }
    const migrated = [
      ...stored,
      {
        apiBaseUrl,
        userId: activeUserId,
        name: readStoredCurrentUserName() ?? "Viewer",
        deviceId: getOrCreateDeviceId(),
        session: activeSession,
      },
    ];
    writeStoredProfileSessions(migrated);
    return migrated;
  });
  const initialActiveSession = tokenStoreRef.current.get();
  const initialActiveUserId = initialActiveSession
    ? decodeAccessTokenUserId(initialActiveSession.accessToken)
    : undefined;
  const initialStoredProfile = initialActiveUserId
    ? storedProfileSessions.find(
        (profile) =>
          profile.apiBaseUrl === apiBaseUrl && profile.userId === initialActiveUserId
      )
    : undefined;
  const activeProfileRef = useRef<
    { apiBaseUrl: string; userId: string; name: string; deviceId: string } | undefined
  >(
    initialActiveUserId
      ? {
          apiBaseUrl,
          userId: initialActiveUserId,
          name: initialStoredProfile?.name ?? readStoredCurrentUserName() ?? "Viewer",
          deviceId: initialStoredProfile?.deviceId ?? getOrCreateDeviceId(),
        }
      : undefined
  );
  const [authFailed, setAuthFailed] = useState(false);

  const setApiBaseUrl = useCallback(
    (value: string) => {
      if (value === apiBaseUrl) return;
      tokenStoreRef.current?.clear();
      window.localStorage.removeItem(CURRENT_USER_NAME_STORAGE_KEY);
      activeProfileRef.current = undefined;
      setAuthFailed(false);
      setCurrentUserId(undefined);
      setCurrentUserName(undefined);
      applyApiBaseUrl(value);
    },
    [apiBaseUrl, applyApiBaseUrl]
  );

  const persistProfileSession = useCallback(
    (
      sessionApiBaseUrl: string,
      userId: string,
      name: string,
      deviceId: string,
      session: StoredSession
    ) => {
      setStoredProfileSessions((existing) => {
        const currentIndex = existing.findIndex(
          (profile) =>
            profile.apiBaseUrl === sessionApiBaseUrl && profile.userId === userId
        );
        const current = currentIndex >= 0 ? existing[currentIndex] : undefined;
        if (
          current &&
          current.name === name &&
          current.deviceId === deviceId &&
          storedSessionsEqual(current.session, session)
        ) {
          return existing;
        }
        const next =
          currentIndex >= 0
            ? existing.map((profile, index) =>
                index === currentIndex
                  ? { apiBaseUrl: sessionApiBaseUrl, userId, name, deviceId, session }
                  : profile
              )
            : [
                ...existing,
                { apiBaseUrl: sessionApiBaseUrl, userId, name, deviceId, session },
              ];
        writeStoredProfileSessions(next);
        return next;
      });
    },
    []
  );

  const client = useMemo<ApiClient | null>(() => {
    if (!apiBaseUrl) return null;
    const tokenStore = tokenStoreRef.current as TokenStore;
    // `instance` is referenced inside `getAccessToken` below before this
    // `const` finishes initializing -- safe because that closure only ever
    // runs later (on a protected request), by which point `instance` is bound.
    const instance: ApiClient = new ApiClient({
      baseUrl: apiBaseUrl,
      defaultHeaders:
        PLAYARR_CLIENT_PLATFORM === "tv-vidaa"
          ? {
              "X-Streamarr-Client-Platform": PLAYARR_LOGIN_IDENTITY.clientPlatform,
              "X-Streamarr-Client-Version": PLAYARR_LOGIN_IDENTITY.clientVersion,
            }
          : undefined,
      getAccessToken: async () => {
        try {
          const activeProfile = activeProfileRef.current;
          const token = await ensureAccessToken(instance, tokenStore, {
            ...PLAYARR_LOGIN_IDENTITY,
            deviceId: activeProfile?.deviceId,
          });
          const userId = decodeAccessTokenUserId(token);
          const activeSession = tokenStore.get();
          if (
            userId &&
            activeSession &&
            activeProfile?.apiBaseUrl === apiBaseUrl &&
            activeProfile.userId === userId
          ) {
            persistProfileSession(
              apiBaseUrl,
              userId,
              activeProfile.name,
              activeProfile.deviceId,
              activeSession
            );
          }
          setAuthFailed(false);
          setCurrentUserId(userId);
          return token;
        } catch (err) {
          // Transparent login had nothing left to fall back on (no stored
          // session, and the server didn't auto-login this connection) --
          // the app shell redirects to `/login` on this flag. Still
          // rethrown so any caller doing its own try/catch (`describeApiError`
          // call sites) keeps working exactly as before.
          setAuthFailed(true);
          throw err;
        }
      },
    });
    return instance;
  }, [apiBaseUrl, persistProfileSession]);

  const login = useCallback(
    async ({ serverUrl, username, password }: LoginCredentials) => {
      const targetApiBaseUrl = normaliseApiBaseUrl(serverUrl);
      const tokenStore = tokenStoreRef.current as TokenStore;
      const normalizedUsername = username.trim();
      const profileDeviceId =
        storedProfileSessions.find(
          (profile) =>
            profile.apiBaseUrl === targetApiBaseUrl &&
            profile.name.toLowerCase() === normalizedUsername.toLowerCase()
        )?.deviceId ?? createProfileDeviceId();
      const loginClient = new ApiClient({
        baseUrl: targetApiBaseUrl,
        defaultHeaders:
          PLAYARR_CLIENT_PLATFORM === "tv-vidaa"
            ? {
                "X-Streamarr-Client-Platform": PLAYARR_LOGIN_IDENTITY.clientPlatform,
                "X-Streamarr-Client-Version": PLAYARR_LOGIN_IDENTITY.clientVersion,
              }
            : undefined,
      });
      const body: LoginRequest = {
        device_id: profileDeviceId,
        device_name: PLAYARR_LOGIN_IDENTITY.deviceName,
        client_platform: PLAYARR_LOGIN_IDENTITY.clientPlatform,
        client_version: PLAYARR_LOGIN_IDENTITY.clientVersion,
        username,
        password,
      };
      const response = await loginClient.login(body);
      const session = toStoredSession(response);
      tokenStore.set(session);
      const userId = decodeAccessTokenUserId(response.access_token);
      const displayName = normalizedUsername;
      if (displayName) {
        window.localStorage.setItem(CURRENT_USER_NAME_STORAGE_KEY, displayName);
        setCurrentUserName(displayName);
      } else {
        window.localStorage.removeItem(CURRENT_USER_NAME_STORAGE_KEY);
        setCurrentUserName(undefined);
      }
      setAuthFailed(false);
      setCurrentUserId(userId);
      if (userId) {
        const name = displayName || "Viewer";
        activeProfileRef.current = {
          apiBaseUrl: targetApiBaseUrl,
          userId,
          name,
          deviceId: profileDeviceId,
        };
        persistProfileSession(targetApiBaseUrl, userId, name, profileDeviceId, session);
      }
      applyApiBaseUrl(targetApiBaseUrl);
    },
    [applyApiBaseUrl, persistProfileSession, storedProfileSessions]
  );

  const loginWithDeviceToken = useCallback(
    (token: DeviceTokenSuccess) => {
      const userId = decodeAccessTokenUserId(token.accessToken);
      const deviceId = decodeAccessTokenDeviceId(token.accessToken);
      if (!userId || !deviceId) {
        throw new Error("The server returned an invalid device login token.");
      }

      const session = toStoredSession({
        access_token: token.accessToken,
        refresh_token: token.refreshToken,
        token_type: token.tokenType,
        expires_in: token.expiresInSeconds,
      });
      const name = "Viewer";
      (tokenStoreRef.current as TokenStore).set(session);
      window.localStorage.removeItem(CURRENT_USER_NAME_STORAGE_KEY);
      activeProfileRef.current = { apiBaseUrl, userId, name, deviceId };
      persistProfileSession(apiBaseUrl, userId, name, deviceId, session);
      setAuthFailed(false);
      setCurrentUserId(userId);
      setCurrentUserName(undefined);
    },
    [apiBaseUrl, persistProfileSession]
  );

  const switchProfile = useCallback(
    async (userId: string) => {
      if (!client) {
        throw new Error("Cannot switch profiles before the API client is ready.");
      }
      const target = storedProfileSessions.find(
        (profile) => profile.apiBaseUrl === apiBaseUrl && profile.userId === userId
      );
      if (!target) {
        throw new Error("This profile has not been signed in on this browser yet.");
      }

      const tokenStore = tokenStoreRef.current as TokenStore;
      const previousSession = tokenStore.get();
      const previousProfile = activeProfileRef.current;
      tokenStore.set(target.session);
      activeProfileRef.current = {
        apiBaseUrl,
        userId: target.userId,
        name: target.name,
        deviceId: target.deviceId,
      };

      try {
        const token = await ensureAccessToken(client, tokenStore, {
          ...PLAYARR_LOGIN_IDENTITY,
          deviceId: target.deviceId,
        });
        const resolvedUserId = decodeAccessTokenUserId(token);
        if (resolvedUserId !== userId) {
          throw new Error("The saved profile session no longer matches this profile.");
        }
        const refreshedSession = tokenStore.get();
        if (refreshedSession) {
          persistProfileSession(
            apiBaseUrl,
            userId,
            target.name,
            target.deviceId,
            refreshedSession
          );
        }
        window.localStorage.setItem(CURRENT_USER_NAME_STORAGE_KEY, target.name);
        setCurrentUserId(userId);
        setCurrentUserName(target.name);
        setAuthFailed(false);
      } catch (error) {
        if (previousSession) {
          tokenStore.set(previousSession);
        } else {
          tokenStore.clear();
        }
        activeProfileRef.current = previousProfile;
        throw error;
      }
    },
    [apiBaseUrl, client, persistProfileSession, storedProfileSessions]
  );

  const isProfileSaved = useCallback(
    (userId: string) =>
      storedProfileSessions.some(
        (profile) => profile.apiBaseUrl === apiBaseUrl && profile.userId === userId
      ),
    [apiBaseUrl, storedProfileSessions]
  );

  const logout = useCallback(() => {
    const activeProfile = activeProfileRef.current;
    tokenStoreRef.current?.clear();
    window.localStorage.removeItem(CURRENT_USER_NAME_STORAGE_KEY);
    activeProfileRef.current = undefined;
    if (activeProfile) {
      setStoredProfileSessions((existing) => {
        const next = existing.filter(
          (profile) =>
            profile.apiBaseUrl !== activeProfile.apiBaseUrl ||
            profile.userId !== activeProfile.userId
        );
        writeStoredProfileSessions(next);
        return next;
      });
    }
    setAuthFailed(false);
    setCurrentUserId(undefined);
    setCurrentUserName(undefined);
  }, []);

  if (!apiBaseUrl || !client) {
    // Briefly resolving the stored/query-param base URL; nothing to render yet.
    return null;
  }

  return (
    <ApiClientContext.Provider
      value={{
        client,
        apiBaseUrl,
        setApiBaseUrl,
        currentUserId,
        currentUserName,
        savedProfiles: storedProfileSessions
          .filter((profile) => profile.apiBaseUrl === apiBaseUrl)
          .map(({ userId, name }) => ({ userId, name })),
        authFailed,
        login,
        loginWithDeviceToken,
        switchProfile,
        isProfileSaved,
        logout,
      }}
    >
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

/** See `ApiClientContextValue.currentUserId`'s doc comment. */
export function useCurrentUserId(): string | undefined {
  return useApiClientContext().currentUserId;
}

/**
 * Auth state + actions for the Web app's real login/logout flow --
 * `authFailed` drives `App.tsx`'s shell-level redirect to `/login`;
 * `login`/`logout` back `pages/Login.tsx`'s form and `pages/Settings.tsx`'s
 * "Sign out" button respectively.
 */
export function useAuth(): {
  authFailed: boolean;
  currentUserId: string | undefined;
  currentUserName: string | undefined;
  savedProfiles: SavedProfile[];
  login: (credentials: LoginCredentials) => Promise<void>;
  loginWithDeviceToken: (token: DeviceTokenSuccess) => void;
  switchProfile: (userId: string) => Promise<void>;
  isProfileSaved: (userId: string) => boolean;
  logout: () => void;
} {
  const {
    authFailed,
    currentUserId,
    currentUserName,
    savedProfiles,
    login,
    loginWithDeviceToken,
    switchProfile,
    isProfileSaved,
    logout,
  } = useApiClientContext();
  return {
    authFailed,
    currentUserId,
    currentUserName,
    savedProfiles,
    login,
    loginWithDeviceToken,
    switchProfile,
    isProfileSaved,
    logout,
  };
}
