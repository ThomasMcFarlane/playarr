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
import {
  ApiClient,
  type AccessTokenRequest,
  type ApiClientConfig,
  type LoginRequest,
  type PeerAddressBundle,
} from "@playarr-tv/api-client";
import {
  decodeAccessTokenDeviceId,
  decodeAccessTokenUserId,
  ensureAccessToken,
  isTransientAuthFailure,
  getOrCreateDeviceId,
  toStoredSession,
  TokenStore,
  type DeviceTokenSuccess,
  type StoredSession,
} from "@playarr-tv/device-auth";
import {
  API_BASE_URL_QUERY_PARAM,
  forgetGroup,
  getStoredApiBaseUrl,
  mergeKnownServerGroup,
  normaliseApiBaseUrl,
  readKnownServers,
  rememberGroup,
  rememberServerSuccess,
  resolveReachableServer,
  setStoredApiBaseUrl,
} from "@playarr-tv/domain";
import { IS_PACKAGED_TV, PLAYARR_CLIENT_PLATFORM } from "./clientPlatform";
import { createLocalNetworkFetch } from "./localNetworkFetch";
import { publicIpv4RelayUrl } from "./loginServerUrl";
import {
  clearJoinedServerRegistry,
  createJoinedApiClient,
  type ConnectedServerClient,
} from "./joinedServers";
import { useLanguage } from "./i18n/LanguageProvider";

const browserFetch = createLocalNetworkFetch();

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
      : PLAYARR_CLIENT_PLATFORM === "tv-webos"
        ? "Playarr for LG webOS"
        : PLAYARR_CLIENT_PLATFORM === "tv-tizen"
          ? "Playarr for Samsung Tizen"
          : PLAYARR_CLIENT_PLATFORM === "android-tv"
            ? "Playarr for Android TV"
            : PLAYARR_CLIENT_PLATFORM === "android-mobile"
              ? "Playarr for Android"
              : "Playarr Web",
  clientPlatform: PLAYARR_CLIENT_PLATFORM,
  clientVersion: __APP_VERSION__,
};

const PLAYARR_PLATFORM_HEADERS =
  PLAYARR_CLIENT_PLATFORM === "web"
    ? undefined
    : {
        "X-Playarr-Client-Platform": PLAYARR_LOGIN_IDENTITY.clientPlatform,
        "X-Playarr-Client-Version": PLAYARR_LOGIN_IDENTITY.clientVersion,
      };

const CURRENT_USER_NAME_STORAGE_KEY = "playarr.currentUserName";
const SAVED_PROFILE_SESSIONS_STORAGE_KEY = "playarr.profileSessions.v4";
const ACTIVE_PROFILE_STORAGE_KEY = "playarr.activeProfile.v1";
const LEGACY_SAVED_PROFILE_SESSIONS_STORAGE_KEYS = [
  "playarr.profileSessions.v3",
  "playarr.profileSessions.v2",
];

function readStoredCurrentUserName(): string | undefined {
  const value = window.localStorage.getItem(CURRENT_USER_NAME_STORAGE_KEY)?.trim();
  return value || undefined;
}

export interface StoredProfileSession {
  profileKey: string;
  apiBaseUrl: string;
  userId: string;
  name: string;
  deviceId: string;
  session: StoredSession;
}

export interface ActiveProfileMarker {
  profileKey: string;
  apiBaseUrl: string;
  userId: string;
}

export interface SavedProfile {
  userId: string;
  name: string;
}

export interface ConnectedServer {
  url: string;
  label: string;
  username: string;
  primary: boolean;
}

export interface DeviceLoginTarget {
  serverUrl: string;
  serverUrls: string[];
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
      LEGACY_SAVED_PROFILE_SESSIONS_STORAGE_KEYS.map((key) =>
        window.localStorage.getItem(key)
      ).find((value) => value !== null);
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
            profileKey:
              typeof profile.profileKey === "string"
                ? profile.profileKey
                : `legacy:${profile.name.trim().toLocaleLowerCase()}`,
            apiBaseUrl: publicIpv4RelayUrl(
              typeof profile.apiBaseUrl === "string"
                ? profile.apiBaseUrl
                : fallbackApiBaseUrl
            ),
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
      for (const key of LEGACY_SAVED_PROFILE_SESSIONS_STORAGE_KEYS) {
        window.localStorage.removeItem(key);
      }
    }
    return profiles;
  } catch {
    return [];
  }
}

function writeStoredProfileSessions(profiles: StoredProfileSession[]): void {
  try {
    window.localStorage.setItem(SAVED_PROFILE_SESSIONS_STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    // Storage full or blocked: the in-memory copy still works for this tab.
  }
}

/**
 * The saved-profile list as every tab last wrote it. Local storage, not a
 * tab's React state, is the source of truth: a tab that rotated a refresh
 * token must never be overwritten by another tab's older copy, and a
 * rotation must never be lost to a stale snapshot -- the server only honours
 * the latest refresh token (plus a short grace window).
 */
function freshStoredProfileSessions(
  fallback: StoredProfileSession[],
  fallbackApiBaseUrl: string
): StoredProfileSession[] {
  try {
    if (window.localStorage.getItem(SAVED_PROFILE_SESSIONS_STORAGE_KEY) === null) return fallback;
  } catch {
    return fallback;
  }
  return readStoredProfileSessions(fallbackApiBaseUrl);
}

function readActiveProfileMarker(): ActiveProfileMarker | undefined {
  try {
    const raw = window.localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY);
    if (!raw) return undefined;
    const marker = JSON.parse(raw) as Partial<ActiveProfileMarker>;
    if (
      typeof marker.profileKey !== "string" ||
      typeof marker.apiBaseUrl !== "string" ||
      typeof marker.userId !== "string"
    ) {
      return undefined;
    }
    return {
      profileKey: marker.profileKey,
      apiBaseUrl: publicIpv4RelayUrl(marker.apiBaseUrl),
      userId: marker.userId,
    };
  } catch {
    return undefined;
  }
}

function writeActiveProfileMarker(profile: ActiveProfileMarker): void {
  window.localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

function clearActiveProfileMarker(): void {
  window.localStorage.removeItem(ACTIVE_PROFILE_STORAGE_KEY);
}

export function selectRestorableProfileSession(
  profiles: StoredProfileSession[],
  apiBaseUrl: string,
  activeMarker?: ActiveProfileMarker
): StoredProfileSession | undefined {
  const candidates = profiles.filter((profile) => profile.apiBaseUrl === apiBaseUrl);
  if (activeMarker?.apiBaseUrl === apiBaseUrl) {
    const marked = candidates.find(
      (profile) =>
        profile.profileKey === activeMarker.profileKey &&
        profile.userId === activeMarker.userId
    );
    if (marked) return marked;
  }
  // Backwards compatibility for sessions saved before the active-profile
  // marker existed. A sole profile is unambiguous and safe to restore.
  return candidates.length === 1 ? candidates[0] : undefined;
}

function storedSessionsEqual(left: StoredSession, right: StoredSession): boolean {
  return (
    left.accessToken === right.accessToken &&
    left.refreshToken === right.refreshToken &&
    left.tokenType === right.tokenType &&
    left.expiresAt === right.expiresAt
  );
}

/**
 * Inserts or updates `entry` in `sessions`. Returns the very same array
 * (identity) when the entry is already stored with equal content.
 */
export function upsertProfileSession(
  sessions: StoredProfileSession[],
  entry: StoredProfileSession
): StoredProfileSession[] {
  const currentIndex = sessions.findIndex(
    (profile) =>
      profile.profileKey === entry.profileKey &&
      profile.apiBaseUrl === entry.apiBaseUrl &&
      profile.userId === entry.userId
  );
  const current = currentIndex >= 0 ? sessions[currentIndex] : undefined;
  if (
    current &&
    current.name === entry.name &&
    current.deviceId === entry.deviceId &&
    storedSessionsEqual(current.session, entry.session)
  ) {
    return sessions;
  }
  return currentIndex >= 0
    ? sessions.map((profile, index) => (index === currentIndex ? entry : profile))
    : [...sessions, entry];
}

/** Element-wise equality of two stored profile session lists. */
export function sameStoredProfileSessions(
  left: StoredProfileSession[],
  right: StoredProfileSession[]
): boolean {
  return (
    left === right ||
    (left.length === right.length &&
      left.every((profile, index) => {
        const other = right[index] as StoredProfileSession;
        return (
          profile.profileKey === other.profileKey &&
          profile.apiBaseUrl === other.apiBaseUrl &&
          profile.userId === other.userId &&
          profile.name === other.name &&
          profile.deviceId === other.deviceId &&
          storedSessionsEqual(profile.session, other.session)
        );
      }))
  );
}

class ScopedTokenStore extends TokenStore {
  constructor(
    private session: StoredSession | undefined,
    private readonly onChange: (session: StoredSession | undefined) => void,
    /** Latest persisted session for this profile (shared by every tab and rebuilt client). */
    private readonly readLatest?: () => StoredSession | undefined
  ) {
    super();
  }

  override get(): StoredSession | undefined {
    // Clients are rebuilt whenever the saved list changes, but callers still
    // holding an older one must not redeem an already-rotated refresh token.
    const latest = this.readLatest?.();
    if (latest) this.session = latest;
    return this.session;
  }

  override set(session: StoredSession): void {
    this.session = session;
    this.onChange(session);
  }

  override clear(): void {
    this.session = undefined;
    this.onChange(undefined);
  }

  override hasValidAccessToken(nowMs: number = Date.now()): boolean {
    const session = this.get();
    return session !== undefined && session.expiresAt > nowMs;
  }
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

function serverLabel(serverUrl: string): string {
  try {
    return new URL(serverUrl).host;
  } catch {
    return serverUrl;
  }
}

// ---------------------------------------------------------------------
// §7.1 self-healing: `docs/architecture/peer-groups.md`. Every `ApiClient`
// this provider builds goes through `createManagedApiClient` (never a bare
// `new ApiClient(...)`) so both halves of self-healing apply uniformly:
// every successful request marks its server reachable
// (`withServerSuccessTracking`), and a grouped login/refresh response folds
// its `peer_addresses` into the remembered address book
// (`withPeerAddressSelfHealing`). Both are no-ops for an ungrouped
// deployment -- `rememberServerSuccess` no-ops with nothing remembered yet,
// and `peer_addresses` stays `null` for a standalone node (see
// `admin_peer.rs::peer_addresses_for_response`'s doc comment) -- so this
// is the rollout invariant restated in code, not just prose.
// ---------------------------------------------------------------------

/**
 * Wraps `fetchImpl` so a completed 2xx response marks `baseUrl` as
 * reachable in the remembered `KnownServerGroup` (§7.1) -- every
 * successful call against this client counts, not just login/refresh.
 */
function withServerSuccessTracking(
  fetchImpl: (input: Request) => Promise<Response>,
  baseUrl: string
): (input: Request) => Promise<Response> {
  return async (input) => {
    const response = await fetchImpl(input);
    if (response.ok) rememberServerSuccess(baseUrl);
    return response;
  };
}

/**
 * Wraps `client.login`/`client.refresh` so a grouped response's
 * `peer_addresses` self-heals the remembered `KnownServerGroup` (§7.1) --
 * every call site that logs in or refreshes a token against this client
 * (the transparent `ensureAccessToken` path below, and the real
 * username/password `login()`/`connectServer()` flows) gets this for free
 * instead of each one remembering to call `rememberGroup` itself.
 */
function withPeerAddressSelfHealing(client: ApiClient, baseUrl: string): ApiClient {
  const originalLogin = client.login.bind(client);
  const originalRefresh = client.refresh.bind(client);
  const fold = (response: { peer_addresses?: PeerAddressBundle | null }) => {
    if (response.peer_addresses) rememberGroup(mergeKnownServerGroup(response.peer_addresses, baseUrl));
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

/**
 * Builds an `ApiClient` wired for §7.1's self-healing -- see the comment
 * above this section. Every `ApiClient` construction site in this provider
 * goes through this instead of `new ApiClient(...)` directly.
 */
export function createManagedApiClient(config: ApiClientConfig): ApiClient {
  const instance = new ApiClient({
    ...config,
    fetchImpl: withServerSuccessTracking(config.fetchImpl ?? browserFetch, config.baseUrl),
  });
  return withPeerAddressSelfHealing(instance, config.baseUrl);
}

/** Credentials for the real username/password login flow -- see `ApiClientContextValue.login`. */
export interface LoginCredentials {
  serverUrl: string;
  username: string;
  password: string;
}

interface ApiClientContextValue {
  client: ApiClient;
  primaryClient: ApiClient;
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
   * session covers it. `App.tsx`'s app shell redirects to `/profiles` on this
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
  connectedServers: ConnectedServer[];
  connectServer: (credentials: LoginCredentials) => Promise<void>;
  disconnectServer: (serverUrl: string) => void;
  getServerClient: (serverUrl?: string) => ApiClient;
  getServerAccessToken: (
    serverUrl?: string,
    request?: AccessTokenRequest
  ) => Promise<string | undefined>;
  /** Stores the token pair returned by the TV device-code flow. */
  loginWithDeviceToken: (
    token: DeviceTokenSuccess,
    target?: DeviceLoginTarget
  ) => void;
  /** Activates a profile session already saved in this browser and validates/refreshes it. */
  switchProfile: (userId: string) => Promise<void>;
  /**
   * Redeems a saved PIN-locked profile's stored session with its PIN
   * (`POST /api/v1/auth/unlock`) and switches to it: the server then holds
   * an unlock lease for this device. Call after `switchProfile` rejected
   * with `PinRequiredError`.
   */
  unlockProfile: (userId: string, pin: string) => Promise<void>;
  /** True when this browser already has a reusable session for the profile. */
  isProfileSaved: (userId: string) => boolean;
  /** Clears the stored session and `currentUserId`/`authFailed`. Callers still navigate to `/profiles` themselves. */
  logout: () => void;
  /** Clears the saved session for one profile without requiring that profile's PIN. */
  logoutProfile: (userId: string) => void;
  /**
   * Clears the remembered `KnownServerGroup` (§7.1/§7.3) -- the explicit
   * manual escape hatch if a group becomes fully defunct. Does not touch
   * the active session, the legacy single `apiBaseUrl` key, or
   * `apiBaseUrl` itself: it only resets which addresses future resolution
   * (a fresh boot, or `ensureAccessToken`'s §7.2 retry) considers
   * "remembered." Settings > Server's "Forget this server" action.
   */
  forgetKnownServerGroup: () => void;
}

const ApiClientContext = createContext<ApiClientContextValue | null>(null);

/**
 * Today's pre-§7.1 resolution chain: an operator-entered value persisted
 * from the Settings page wins, then a `?apiBaseUrl=...` query param (for a
 * split reverse-proxy deployment or pointing a dev build at a non-default
 * backend), then this page's own origin.
 *
 * Same-origin is the real default, not a placeholder: `playarr-bin` co-
 * hosts this app's built assets with the API on one port (see
 * `playarr_api::build_router`'s `web_assets_dir`), matching how every
 * other `*arr` app ships its own UI, so "this page's origin" *is* the API
 * for the common case -- no configuration required. `vite.config.ts`
 * proxies `/api` etc. to a local backend so this also holds for
 * `pnpm run dev`. Unlike the TV app shells, the web app has a real
 * Settings text field (see `pages/Settings.tsx`) instead of the TV-only
 * `playarr-config.json` runtime-config-file lookup, so that lookup is
 * skipped here.
 *
 * Kept verbatim as `resolveInitialApiBaseUrl`'s fallback once no
 * `KnownServerGroup` is remembered at all (§7.3's rollout invariant) --
 * see that function's own doc comment.
 */
function resolveLegacyInitialApiBaseUrl(): string {
  const stored = getStoredApiBaseUrl();
  if (stored) return publicIpv4RelayUrl(stored);

  const fromQuery = new URLSearchParams(window.location.search).get(API_BASE_URL_QUERY_PARAM);
  if (fromQuery) return publicIpv4RelayUrl(fromQuery);

  const packagedDefault = window.PlayarrPackagedConfig?.apiBaseUrl?.trim();
  if (IS_PACKAGED_TV && packagedDefault) return publicIpv4RelayUrl(packagedDefault);

  // Installed packages run from a file/widget origin, which is never a
  // Playarr Server API. Keep an inert but valid HTTP base until hosted pairing
  // supplies the user's real server (or an operator sets the packaged
  // runtime config).
  if (IS_PACKAGED_TV) return "http://localhost:8484";

  return window.location.origin;
}

/**
 * Resolves the initial API base URL for the web app -- `docs/architecture/
 * peer-groups.md` §7.3: group-aware first, before falling back to
 * `resolveLegacyInitialApiBaseUrl`'s chain above. A remembered
 * `KnownServerGroup`'s `lastGoodUrl` (or, absent that, its first `servers[]`
 * entry) wins over the legacy single-key/query-param/origin chain: once a
 * group is known, it is a strictly more specific answer to "which server"
 * than a same-origin guess or a stale legacy key. This is a synchronous
 * *best guess*, deliberately not a network probe -- see the `useEffect`
 * below (`ApiClientProvider`'s body) for the actual `resolveReachableServer`
 * verification/self-heal, which runs in the background so this function
 * stays a plain, synchronous `useState` lazy initializer exactly as it
 * always has (no added render pass for *any* client, grouped or not).
 * Falls through to `resolveLegacyInitialApiBaseUrl` untouched when no group
 * is remembered at all: the rollout invariant -- a client that has never
 * been grouped resolves exactly as it does today, byte for byte.
 */
export function resolveInitialApiBaseUrl(): string {
  const group = readKnownServers();
  const knownGroupUrl = group?.lastGoodUrl ?? group?.servers[0]?.url;
  if (knownGroupUrl) return publicIpv4RelayUrl(knownGroupUrl);

  return resolveLegacyInitialApiBaseUrl();
}

/**
 * Short reachability-probe budget per address, mirroring `Signup.tsx`'s
 * own identical constant for the same "try each remembered address, short
 * per-attempt timeout" shape (`docs/architecture/peer-groups.md` §6.1/§7.3)
 * -- duplicated rather than shared across those two files' otherwise
 * unrelated import graphs, same convention `signupInvite.ts`'s
 * `base64UrlDecode` duplication comment explains.
 */
const SERVER_PROBE_TIMEOUT_MS = 3000;

/** Wraps a `fetchImpl` so a single request aborts after `timeoutMs`. */
function fetchWithTimeout(
  fetchImpl: (input: Request) => Promise<Response>,
  timeoutMs: number
): (input: Request) => Promise<Response> {
  return (input) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetchImpl(new Request(input, { signal: controller.signal })).finally(() =>
      clearTimeout(timer)
    );
  };
}

/** `resolveReachableServer`'s probe: a real `GET /api/system/version` against `url`, short-timeout. */
async function probeServerReachable(url: string): Promise<boolean> {
  const probeClient = new ApiClient({
    baseUrl: publicIpv4RelayUrl(url),
    fetchImpl: fetchWithTimeout(browserFetch, SERVER_PROBE_TIMEOUT_MS),
  });
  try {
    await probeClient.getVersion();
    return true;
  } catch {
    return false;
  }
}

/**
 * §7.2's `clientForUrl`: builds a managed `ApiClient` (self-healing, §7.1)
 * bound to one candidate address in the primary account's own remembered
 * `KnownServerGroup` -- for `ensureAccessToken`'s cross-peer refresh retry
 * below, never for the unrelated "joined servers" feature's own,
 * independently-accounted secondary clients (`serverClients`), which each
 * belong to a different server/account with no shared group of its own.
 * A plain module-level function, not a hook: every input (`PLAYARR_LOGIN_IDENTITY`'s
 * platform, `browserFetch`) is already a stable module constant.
 */
function buildClientForServerGroupUrl(url: string): ApiClient {
  return createManagedApiClient({
    baseUrl: url,
    fetchImpl: browserFetch,
    defaultHeaders: PLAYARR_PLATFORM_HEADERS,
  });
}

export function ApiClientProvider({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  // Resolvable synchronously now that same-origin (rather than an awaited
  // config-file fetch) is the fallback -- see `resolveInitialApiBaseUrl` --
  // so this is a plain lazy initializer, not a `null`-until-resolved effect.
  const [apiBaseUrl, setApiBaseUrlState] = useState<string>(resolveInitialApiBaseUrl);
  const initialStoredProfilesRef = useRef<StoredProfileSession[]>();
  if (!initialStoredProfilesRef.current) {
    initialStoredProfilesRef.current = readStoredProfileSessions(apiBaseUrl);
  }
  // One `TokenStore` for the lifetime of this provider. A server change clears
  // its current value before reusing it so no token is sent to another instance.
  const tokenStoreRef = useRef<TokenStore>();
  if (!tokenStoreRef.current) {
    tokenStoreRef.current = new TokenStore();
  }
  if (!tokenStoreRef.current.get()) {
    const restoredProfile = selectRestorableProfileSession(
      initialStoredProfilesRef.current ?? [],
      apiBaseUrl,
      readActiveProfileMarker()
    );
    if (restoredProfile) {
      tokenStoreRef.current.set(restoredProfile.session);
      writeActiveProfileMarker(restoredProfile);
    }
  }

  const applyApiBaseUrl = useCallback((value: string) => {
    setStoredApiBaseUrl(value);
    setApiBaseUrlState(value);
  }, []);

  // §7.3's group-aware initial resolution, second half: `resolveInitialApiBaseUrl`'s
  // synchronous lazy initializer above already prefers a remembered group's
  // `lastGoodUrl`/first server over the legacy chain, but as a best guess,
  // with no network round trip -- keeping the ungrouped path exactly as
  // synchronous as it always was (the rollout invariant). This effect is
  // what actually calls `resolveReachableServer` to verify that guess and
  // self-heal onto a different address in the same group if it was wrong
  // (e.g. the previously-good node is down): §8's "survives node A being
  // down by trying B then C without user action" acceptance criterion for
  // ordinary reads, which never flow through `ensureAccessToken`'s own
  // §7.2 retry (that only triggers on an actual token acquisition/refresh).
  // A no-op when no group is remembered at all: reads straight through to
  // `return` before ever touching the network. Runs once at mount against
  // the group captured then -- ongoing mid-session failover during token
  // acquisition is §7.2's `ensureAccessToken` retry path, not this effect
  // re-running.
  useEffect(() => {
    const group = readKnownServers();
    if (!group || group.servers.length === 0) return;
    let cancelled = false;

    void resolveReachableServer(group, probeServerReachable)
      .then((resolvedUrl) => {
        if (cancelled) return;
        rememberServerSuccess(resolvedUrl);
        const normalized = publicIpv4RelayUrl(resolvedUrl);
        if (normalized !== apiBaseUrl) applyApiBaseUrl(normalized);
      })
      .catch(() => {
        // Every remembered address failed its probe -- stay on whatever
        // the synchronous best guess above already picked; a real request
        // failing against it surfaces through the app's normal error
        // handling, same as an unreachable server always has.
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const stored = initialStoredProfilesRef.current ?? readStoredProfileSessions(apiBaseUrl);
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
        profileKey: `legacy:${(readStoredCurrentUserName() ?? "Viewer").toLocaleLowerCase()}`,
        apiBaseUrl,
        userId: activeUserId,
        name: readStoredCurrentUserName() ?? t("lib.apiClientProvider.defaultViewerName"),
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
    {
      profileKey: string;
      apiBaseUrl: string;
      userId: string;
      name: string;
      deviceId: string;
    } | undefined
  >(
    initialActiveUserId
      ? {
          apiBaseUrl,
          profileKey:
            initialStoredProfile?.profileKey ??
            `legacy:${(readStoredCurrentUserName() ?? "Viewer").toLocaleLowerCase()}`,
          userId: initialActiveUserId,
          name:
            initialStoredProfile?.name ??
            readStoredCurrentUserName() ??
            t("lib.apiClientProvider.defaultViewerName"),
          deviceId: initialStoredProfile?.deviceId ?? getOrCreateDeviceId(),
        }
      : undefined
  );
  const [authFailed, setAuthFailed] = useState(false);

  // Another tab saved, rotated or removed a profile session: adopt it so
  // this tab never redeems (or re-saves) a refresh token that is already old.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SAVED_PROFILE_SESSIONS_STORAGE_KEY) return;
      setStoredProfileSessions(readStoredProfileSessions(apiBaseUrl));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [apiBaseUrl]);

  const setApiBaseUrl = useCallback(
    (value: string) => {
      if (value === apiBaseUrl) return;
      tokenStoreRef.current?.clear();
      window.localStorage.removeItem(CURRENT_USER_NAME_STORAGE_KEY);
      clearActiveProfileMarker();
      activeProfileRef.current = undefined;
      clearJoinedServerRegistry();
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
      profileKey: string,
      userId: string,
      name: string,
      deviceId: string,
      session: StoredSession
    ) => {
      setStoredProfileSessions((stale) => {
        const existing = freshStoredProfileSessions(stale, sessionApiBaseUrl);
        const next = upsertProfileSession(existing, {
          profileKey,
          apiBaseUrl: sessionApiBaseUrl,
          userId,
          name,
          deviceId,
          session,
        });
        // Nothing changed: keep the identity React already holds. Every
        // access-token fetch lands here (including each segment request
        // the player makes), and a fresh-but-equal array used to rebuild
        // `serverClients` and every callback derived from it.
        if (next === existing) {
          return sameStoredProfileSessions(stale, existing) ? stale : existing;
        }
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
    const instance: ApiClient = createManagedApiClient({
      baseUrl: apiBaseUrl,
      fetchImpl: browserFetch,
      defaultHeaders: PLAYARR_PLATFORM_HEADERS,
      getAccessToken: async (request) => {
        try {
          const activeProfile = activeProfileRef.current;
          const token = await ensureAccessToken(
            instance,
            tokenStore,
            {
              ...PLAYARR_LOGIN_IDENTITY,
              deviceId: activeProfile?.deviceId,
            },
            {
              ...request,
              // §7.2: a refresh failure against `apiBaseUrl` retries the
              // same refresh token across the rest of the remembered
              // group before falling through to a full login. A no-op
              // (retry never fires) when nothing is remembered --
              // `readKnownServers()` reads as `undefined`.
              serverGroup: readKnownServers(),
              clientForUrl: buildClientForServerGroupUrl,
            }
          );
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
              activeProfile.profileKey,
              userId,
              activeProfile.name,
              activeProfile.deviceId,
              activeSession
            );
          }
          // If that retry just succeeded against a different address than
          // `apiBaseUrl` (the current server's own refresh failed, another
          // group member's didn't), that address is now this group's
          // `lastGoodUrl` (`withServerSuccessTracking`/`withPeerAddressSelfHealing`,
          // §7.1) -- switch over for every future request too, not just
          // this one token, so ordinary reads stop hitting the down peer
          // without the viewer doing anything (§8's Phase 5 acceptance
          // criterion). A no-op on the overwhelmingly common path where
          // `apiBaseUrl`'s own calls are already succeeding: `lastGoodUrl`
          // then already equals it.
          const healedUrl = readKnownServers()?.lastGoodUrl;
          if (healedUrl && healedUrl !== apiBaseUrl) {
            applyApiBaseUrl(publicIpv4RelayUrl(healedUrl));
          }
          setAuthFailed(false);
          setCurrentUserId(userId);
          return token;
        } catch (err) {
          // Transparent login had nothing left to fall back on (no stored
          // session, and the server didn't auto-login this connection) --
          // the app shell redirects to `/profiles` on this flag. Still
          // rethrown so any caller doing its own try/catch (`describeApiError`
          // call sites) keeps working exactly as before.
          // Only a definitive refusal means "signed out". A network failure,
          // a restarting server (5xx/429/408) or a hung request says nothing
          // about the session: keep the stored credentials, stay on the
          // page and let the next request retry.
          if (!isTransientAuthFailure(err)) setAuthFailed(true);
          throw err;
        }
      },
    });
    return instance;
  }, [apiBaseUrl, applyApiBaseUrl, persistProfileSession]);

  const activeProfileKey = activeProfileRef.current?.profileKey;
  const serverClients = useMemo<ConnectedServerClient[]>(() => {
    if (!client) return [];
    const activeSessions = activeProfileKey
      ? storedProfileSessions.filter((profile) => profile.profileKey === activeProfileKey)
      : [];
    const primary: ConnectedServerClient = {
      url: apiBaseUrl,
      label: serverLabel(apiBaseUrl),
      client,
      getAccessToken: (request) => client.getAccessToken(request),
    };
    const secondary = activeSessions
      .filter((profile) => profile.apiBaseUrl !== apiBaseUrl)
      .map((profile): ConnectedServerClient => {
        const store = new ScopedTokenStore(
          profile.session,
          (session) => {
            if (!session) return;
            persistProfileSession(
              profile.apiBaseUrl,
              profile.profileKey,
              profile.userId,
              profile.name,
              profile.deviceId,
              session
            );
          },
          () =>
            readStoredProfileSessions(profile.apiBaseUrl).find(
              (saved) =>
                saved.profileKey === profile.profileKey &&
                saved.apiBaseUrl === profile.apiBaseUrl &&
                saved.userId === profile.userId
            )?.session
        );
        let instance: ApiClient;
        instance = createManagedApiClient({
          baseUrl: profile.apiBaseUrl,
          fetchImpl: browserFetch,
          defaultHeaders: PLAYARR_PLATFORM_HEADERS,
          getAccessToken: async (request) =>
            ensureAccessToken(instance, store, {
              ...PLAYARR_LOGIN_IDENTITY,
              deviceId: profile.deviceId,
            }, request),
        });
        return {
          url: profile.apiBaseUrl,
          label: serverLabel(profile.apiBaseUrl),
          client: instance,
          getAccessToken: (request) => instance.getAccessToken(request),
        };
      });
    return [primary, ...secondary];
  }, [activeProfileKey, apiBaseUrl, client, persistProfileSession, storedProfileSessions]);

  const [serverNames, setServerNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      serverClients.map(async (server) => {
        try {
          const version = await server.client.getVersion();
          return [server.url, version.instance_name] as const;
        } catch {
          return [server.url, server.label] as const;
        }
      })
    ).then((entries) => {
      if (!cancelled) setServerNames(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [serverClients]);

  const joinedClient = useMemo(
    () => (serverClients.length > 0 ? createJoinedApiClient(serverClients) : client),
    [client, serverClients]
  );

  const login = useCallback(
    async ({ serverUrl, username, password }: LoginCredentials) => {
      const targetApiBaseUrl = normaliseApiBaseUrl(publicIpv4RelayUrl(serverUrl));
      const tokenStore = tokenStoreRef.current as TokenStore;
      const normalizedUsername = username.trim();
      const existingProfile = storedProfileSessions.find(
          (profile) =>
            profile.apiBaseUrl === targetApiBaseUrl &&
            profile.name.toLowerCase() === normalizedUsername.toLowerCase()
        );
      const profileDeviceId = existingProfile?.deviceId ?? createProfileDeviceId();
      const profileKey = existingProfile?.profileKey ?? createProfileDeviceId();
      const loginClient = createManagedApiClient({
        baseUrl: targetApiBaseUrl,
        fetchImpl: browserFetch,
        defaultHeaders: PLAYARR_PLATFORM_HEADERS,
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
        const name = displayName || t("lib.apiClientProvider.defaultViewerName");
        activeProfileRef.current = {
          profileKey,
          apiBaseUrl: targetApiBaseUrl,
          userId,
          name,
          deviceId: profileDeviceId,
        };
        writeActiveProfileMarker(activeProfileRef.current);
        persistProfileSession(
          targetApiBaseUrl,
          profileKey,
          userId,
          name,
          profileDeviceId,
          session
        );
      }
      clearJoinedServerRegistry();
      applyApiBaseUrl(targetApiBaseUrl);
    },
    [applyApiBaseUrl, persistProfileSession, storedProfileSessions]
  );

  const connectServer = useCallback(
    async ({ serverUrl, username, password }: LoginCredentials) => {
      const activeProfile = activeProfileRef.current;
      if (!activeProfile) {
        throw new Error(t("lib.apiClientProvider.signInBeforeAddingServer"));
      }
      const targetApiBaseUrl = normaliseApiBaseUrl(publicIpv4RelayUrl(serverUrl));
      if (targetApiBaseUrl === apiBaseUrl) {
        throw new Error(t("lib.apiClientProvider.alreadyPrimaryServer"));
      }
      const existing = storedProfileSessions.find(
        (profile) =>
          profile.profileKey === activeProfile.profileKey &&
          profile.apiBaseUrl === targetApiBaseUrl
      );
      const deviceId = existing?.deviceId ?? createProfileDeviceId();
      const loginClient = createManagedApiClient({
        baseUrl: targetApiBaseUrl,
        fetchImpl: browserFetch,
        defaultHeaders: PLAYARR_PLATFORM_HEADERS,
      });
      const response = await loginClient.login({
        device_id: deviceId,
        device_name: PLAYARR_LOGIN_IDENTITY.deviceName,
        client_platform: PLAYARR_LOGIN_IDENTITY.clientPlatform,
        client_version: PLAYARR_LOGIN_IDENTITY.clientVersion,
        username,
        password,
      });
      const userId = decodeAccessTokenUserId(response.access_token);
      if (!userId) throw new Error(t("lib.apiClientProvider.invalidLoginToken"));
      persistProfileSession(
        targetApiBaseUrl,
        activeProfile.profileKey,
        userId,
        username.trim() || t("lib.apiClientProvider.defaultViewerName"),
        deviceId,
        toStoredSession(response)
      );
      clearJoinedServerRegistry();
    },
    [apiBaseUrl, persistProfileSession, storedProfileSessions]
  );

  const disconnectServer = useCallback(
    (serverUrl: string) => {
      const activeProfile = activeProfileRef.current;
      if (!activeProfile || serverUrl === apiBaseUrl) return;
      setStoredProfileSessions((stale) => {
        const existing = freshStoredProfileSessions(stale, apiBaseUrl);
        const next = existing.filter(
          (profile) =>
            profile.profileKey !== activeProfile.profileKey ||
            profile.apiBaseUrl !== serverUrl
        );
        writeStoredProfileSessions(next);
        return next;
      });
      clearJoinedServerRegistry();
    },
    [apiBaseUrl]
  );

  const getServerClient = useCallback(
    (serverUrl?: string) => {
      const resolved = serverUrl
        ? serverClients.find((server) => server.url === serverUrl)?.client
        : client;
      if (!resolved) throw new Error(t("lib.apiClientProvider.clientNotReady"));
      return resolved;
    },
    [client, serverClients]
  );

  const getServerAccessToken = useCallback(
    async (serverUrl?: string, request?: AccessTokenRequest) => {
      if (!serverUrl) return client?.getAccessToken(request);
      return serverClients
        .find((server) => server.url === serverUrl)
        ?.getAccessToken(request);
    },
    [client, serverClients]
  );

  const loginWithDeviceToken = useCallback(
    (token: DeviceTokenSuccess, target?: DeviceLoginTarget) => {
      const userId = decodeAccessTokenUserId(token.accessToken);
      const deviceId = decodeAccessTokenDeviceId(token.accessToken);
      if (!userId || !deviceId) {
        throw new Error(t("lib.apiClientProvider.invalidDeviceLoginToken"));
      }

      const session = toStoredSession({
        access_token: token.accessToken,
        refresh_token: token.refreshToken,
        token_type: token.tokenType,
        expires_in: token.expiresInSeconds,
      });
      const name = t("lib.apiClientProvider.defaultViewerName");
      const targetApiBaseUrl = target
        ? publicIpv4RelayUrl(normaliseApiBaseUrl(target.serverUrl))
        : apiBaseUrl;
      if (target) {
        const serverUrls = [...new Set([target.serverUrl, ...target.serverUrls])].map(
          (url) => publicIpv4RelayUrl(normaliseApiBaseUrl(url))
        );
        rememberGroup({
          servers: serverUrls.map((url) => ({ url })),
          lastGoodUrl: targetApiBaseUrl,
        });
      }
      (tokenStoreRef.current as TokenStore).set(session);
      window.localStorage.removeItem(CURRENT_USER_NAME_STORAGE_KEY);
      const profileKey = createProfileDeviceId();
      activeProfileRef.current = {
        profileKey,
        apiBaseUrl: targetApiBaseUrl,
        userId,
        name,
        deviceId,
      };
      writeActiveProfileMarker(activeProfileRef.current);
      persistProfileSession(
        targetApiBaseUrl,
        profileKey,
        userId,
        name,
        deviceId,
        session
      );
      clearJoinedServerRegistry();
      setAuthFailed(false);
      setCurrentUserId(userId);
      setCurrentUserName(undefined);
      if (targetApiBaseUrl !== apiBaseUrl) applyApiBaseUrl(targetApiBaseUrl);

      // The device-code/QR link flow (the only sign-in path IS_TV platforms --
      // VIDAA, webOS, Tizen -- offer; see Login.tsx) never has the viewer type
      // a username the way `login()` above does, so `name` above is only ever
      // the generic placeholder. Fetch the real profile the token belongs to
      // and correct it in place -- fire-and-forget so it doesn't block the
      // redirect `finishLogin()` triggers right after this call returns.
      const profileClient = createManagedApiClient({
        baseUrl: targetApiBaseUrl,
        fetchImpl: browserFetch,
        defaultHeaders: PLAYARR_PLATFORM_HEADERS,
        getAccessToken: async () => token.accessToken,
      });
      void profileClient
        .listAvailableProfiles()
        .then((profiles) => {
          const realName = profiles.find((profile) => profile.id === userId)?.display_name;
          // Bail if a logout/profile-switch already moved past this session
          // by the time this resolves -- stale enrichment must not stomp it.
          if (!realName || activeProfileRef.current?.profileKey !== profileKey) return;
          activeProfileRef.current = { ...activeProfileRef.current, name: realName };
          window.localStorage.setItem(CURRENT_USER_NAME_STORAGE_KEY, realName);
          setCurrentUserName(realName);
          persistProfileSession(targetApiBaseUrl, profileKey, userId, realName, deviceId, session);
        })
        .catch(() => {
          // Best-effort enrichment only -- the placeholder name already
          // covers the offline/unreachable case.
        });
    },
    [apiBaseUrl, applyApiBaseUrl, persistProfileSession, t]
  );

  const activateStoredProfile = useCallback(
    async (target: StoredProfileSession) => {
      if (!client) {
        throw new Error(t("lib.apiClientProvider.cannotSwitchProfilesNotReady"));
      }
      const userId = target.userId;
      const tokenStore = tokenStoreRef.current as TokenStore;
      const previousSession = tokenStore.get();
      const previousProfile = activeProfileRef.current;
      // Switching away locks the profile being left (TASKS 115): if it has a
      // PIN, its stored session needs the PIN again before it can refresh.
      // Best effort -- a failure never blocks the switch.
      if (previousSession && previousProfile && previousProfile.userId !== userId) {
        try {
          await client.lockProfile();
        } catch {
          // Offline or already signed out: the server-side lease also lapses on its own.
        }
      }
      tokenStore.set(target.session);
      activeProfileRef.current = {
        profileKey: target.profileKey,
        apiBaseUrl,
        userId: target.userId,
        name: target.name,
        deviceId: target.deviceId,
      };
      try {
        const token = await ensureAccessToken(
          client,
          tokenStore,
          {
            ...PLAYARR_LOGIN_IDENTITY,
            deviceId: target.deviceId,
          },
          {
            serverGroup: readKnownServers(),
            clientForUrl: buildClientForServerGroupUrl,
            // Always go to the server on a switch so a PIN-locked profile
            // is checked against its unlock lease, not a cached token.
            forceRefresh: true,
          }
        );
        const resolvedUserId = decodeAccessTokenUserId(token);
        if (resolvedUserId !== userId) {
          throw new Error(t("lib.apiClientProvider.profileSessionMismatch"));
        }
        const refreshedSession = tokenStore.get();
        if (refreshedSession) {
          persistProfileSession(
            apiBaseUrl,
            target.profileKey,
            userId,
            target.name,
            target.deviceId,
            refreshedSession
          );
        }
        window.localStorage.setItem(CURRENT_USER_NAME_STORAGE_KEY, target.name);
        clearJoinedServerRegistry();
        setCurrentUserId(userId);
        setCurrentUserName(target.name);
        setAuthFailed(false);
        writeActiveProfileMarker(activeProfileRef.current);
        // §7.1/§7.2: switch over to whichever address the retry actually
        // succeeded against -- see the primary client's `getAccessToken`
        // for the identical, more fully-commented check.
        const healedUrl = readKnownServers()?.lastGoodUrl;
        if (healedUrl && healedUrl !== apiBaseUrl) {
          applyApiBaseUrl(publicIpv4RelayUrl(healedUrl));
        }
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
    [apiBaseUrl, applyApiBaseUrl, client, persistProfileSession, t]
  );

  const switchProfile = useCallback(
    async (userId: string) => {
      const target = storedProfileSessions.find(
        (profile) => profile.apiBaseUrl === apiBaseUrl && profile.userId === userId
      );
      if (!target) {
        throw new Error(t("lib.apiClientProvider.profileNotSignedIn"));
      }
      await activateStoredProfile(target);
    },
    [activateStoredProfile, apiBaseUrl, storedProfileSessions, t]
  );

  const unlockProfile = useCallback(
    async (userId: string, pin: string) => {
      if (!client) {
        throw new Error(t("lib.apiClientProvider.cannotSwitchProfilesNotReady"));
      }
      const target = storedProfileSessions.find(
        (profile) => profile.apiBaseUrl === apiBaseUrl && profile.userId === userId
      );
      if (!target) {
        throw new Error(t("lib.apiClientProvider.profileNotSignedIn"));
      }
      const unlocked = await client.unlockProfile({
        device_id: target.deviceId,
        refresh_token: target.session.refreshToken,
        pin,
      });
      const session = toStoredSession(unlocked);
      persistProfileSession(apiBaseUrl, target.profileKey, userId, target.name, target.deviceId, session);
      // Switch with the freshly rotated session: the saved-sessions state
      // has not re-rendered yet and still holds the retired refresh token.
      await activateStoredProfile({ ...target, session });
    },
    [activateStoredProfile, apiBaseUrl, client, persistProfileSession, storedProfileSessions, t]
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
    clearActiveProfileMarker();
    activeProfileRef.current = undefined;
    clearJoinedServerRegistry();
    if (activeProfile) {
      setStoredProfileSessions((stale) => {
        const existing = freshStoredProfileSessions(stale, activeProfile.apiBaseUrl);
        const next = existing.filter(
          (profile) => profile.profileKey !== activeProfile.profileKey
        );
        writeStoredProfileSessions(next);
        return next;
      });
    }
    setAuthFailed(false);
    setCurrentUserId(undefined);
    setCurrentUserName(undefined);
  }, []);

  const logoutProfile = useCallback(
    (userId: string) => {
      const activeProfile = activeProfileRef.current;
      const isActiveProfile =
        activeProfile?.apiBaseUrl === apiBaseUrl && activeProfile.userId === userId;

      if (isActiveProfile) {
        tokenStoreRef.current?.clear();
        window.localStorage.removeItem(CURRENT_USER_NAME_STORAGE_KEY);
        clearActiveProfileMarker();
        activeProfileRef.current = undefined;
        clearJoinedServerRegistry();
        setAuthFailed(false);
        setCurrentUserId(undefined);
        setCurrentUserName(undefined);
      }

      setStoredProfileSessions((stale) => {
        const existing = freshStoredProfileSessions(stale, apiBaseUrl);
        const next = existing.filter(
          (profile) => profile.apiBaseUrl !== apiBaseUrl || profile.userId !== userId
        );
        writeStoredProfileSessions(next);
        return next;
      });
    },
    [apiBaseUrl]
  );

  const forgetKnownServerGroup = useCallback(() => {
    forgetGroup();
  }, []);

  if (!apiBaseUrl || !client || !joinedClient) {
    // Briefly resolving the stored/query-param base URL; nothing to render yet.
    return null;
  }

  return (
    <ApiClientContext.Provider
      value={{
        client: joinedClient,
        primaryClient: client,
        apiBaseUrl,
        setApiBaseUrl,
        currentUserId,
        currentUserName,
        savedProfiles: storedProfileSessions
          .filter((profile) => profile.apiBaseUrl === apiBaseUrl)
          .map(({ userId, name }) => ({ userId, name })),
        authFailed,
        login,
        connectedServers: serverClients.map((server) => {
          const profile = storedProfileSessions.find(
            (stored) =>
              stored.profileKey === activeProfileKey && stored.apiBaseUrl === server.url
          );
          return {
            url: server.url,
            label: serverNames[server.url] ?? server.label,
            username: profile?.name ?? currentUserName ?? t("lib.apiClientProvider.defaultViewerName"),
            primary: server.url === apiBaseUrl,
          };
        }),
        connectServer,
        disconnectServer,
        getServerClient,
        getServerAccessToken,
        loginWithDeviceToken,
        switchProfile,
        unlockProfile,
        isProfileSaved,
        logout,
        logoutProfile,
        forgetKnownServerGroup,
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

export function usePrimaryApiClient(): ApiClient {
  return useApiClientContext().primaryClient;
}

export function useServerClient(serverUrl?: string): ApiClient {
  const { getServerClient } = useApiClientContext();
  return getServerClient(serverUrl);
}

export function useServerAccessToken(
  serverUrl?: string
): (request?: AccessTokenRequest) => Promise<string | undefined> {
  const { getServerAccessToken } = useApiClientContext();
  return useCallback(
    (request?: AccessTokenRequest) => getServerAccessToken(serverUrl, request),
    [getServerAccessToken, serverUrl]
  );
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
 * `authFailed` drives `App.tsx`'s shell-level redirect to `/profiles`;
 * `login`/`logout` back `pages/Login.tsx`'s form and `pages/Settings.tsx`'s
 * "Sign out" button respectively.
 */
export function useAuth(): {
  authFailed: boolean;
  currentUserId: string | undefined;
  currentUserName: string | undefined;
  savedProfiles: SavedProfile[];
  connectedServers: ConnectedServer[];
  login: (credentials: LoginCredentials) => Promise<void>;
  connectServer: (credentials: LoginCredentials) => Promise<void>;
  disconnectServer: (serverUrl: string) => void;
  loginWithDeviceToken: (
    token: DeviceTokenSuccess,
    target?: DeviceLoginTarget
  ) => void;
  switchProfile: (userId: string) => Promise<void>;
  unlockProfile: (userId: string, pin: string) => Promise<void>;
  isProfileSaved: (userId: string) => boolean;
  logout: () => void;
  logoutProfile: (userId: string) => void;
  forgetKnownServerGroup: () => void;
} {
  const {
    authFailed,
    currentUserId,
    currentUserName,
    savedProfiles,
    connectedServers,
    login,
    connectServer,
    disconnectServer,
    loginWithDeviceToken,
    switchProfile,
    unlockProfile,
    isProfileSaved,
    logout,
    logoutProfile,
    forgetKnownServerGroup,
  } = useApiClientContext();
  return {
    authFailed,
    currentUserId,
    currentUserName,
    savedProfiles,
    connectedServers,
    login,
    connectServer,
    disconnectServer,
    loginWithDeviceToken,
    switchProfile,
    unlockProfile,
    isProfileSaved,
    logout,
    logoutProfile,
    forgetKnownServerGroup,
  };
}
