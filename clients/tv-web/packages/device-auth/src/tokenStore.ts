/**
 * Single shared holder for the access/refresh token pair a client is
 * currently authenticated with, however it was obtained: RFC 8628 device
 * pairing (`pollForToken`, TV shells) or the transparent `POST
 * /api/v1/auth/login` call `ensureAccessToken` (see `./session`) makes for
 * clients with no pairing UI of their own (Web). Both paths write into one
 * `TokenStore` rather than each keeping its own -- see `ensureAccessToken`'s
 * doc comment.
 *
 * Backed by `localStorage` when available (survives a page reload) with an
 * in-memory-only fallback otherwise (legacy TV WebKit runtimes without
 * persistent storage, tests, SSR) -- the same storage-availability guard
 * `@streamarr-tv/domain`'s `getStoredApiBaseUrl`/`setStoredApiBaseUrl`
 * already use.
 */
export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  /** Epoch ms after which `accessToken` should be treated as no longer valid. */
  expiresAt: number;
}

const SESSION_STORAGE_KEY = "streamarr:session";

function hasLocalStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StoredSession>;
  return (
    typeof candidate.accessToken === "string" &&
    typeof candidate.refreshToken === "string" &&
    typeof candidate.tokenType === "string" &&
    typeof candidate.expiresAt === "number"
  );
}

function readPersisted(): StoredSession | undefined {
  if (!hasLocalStorage()) return undefined;
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStoredSession(parsed) ? parsed : undefined;
  } catch {
    // Corrupt/foreign value under this key -- behave as if nothing were stored.
    return undefined;
  }
}

function writePersisted(session: StoredSession | undefined): void {
  if (!hasLocalStorage()) return;
  if (session) {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

// Module-level, not a `TokenStore` instance field: the in-memory fallback
// (used only when `localStorage` is unavailable) must be shared by every
// `TokenStore()` constructed anywhere in the app, not private to whichever
// instance happened to call `set()`. Multiple independent `new TokenStore()`
// call sites are normal and expected (e.g. a login page constructs its own
// short-lived instance rather than reaching into `ApiClientProvider`'s) --
// when `localStorage` is available this doesn't matter, `get()` always
// re-reads it fresh below, but a per-instance cache field previously meant
// that on runtimes *without* `localStorage` (and, more subtly, even a
// stale in-memory cache read ordering bug was possible before this became
// a pure passthrough) one instance's `set()` was invisible to another
// instance's `get()` until the page reloaded. Concretely: Admin's Login
// page constructs its own `TokenStore` to persist a freshly-obtained
// session, while `ApiClientProvider` already holds a *different* long-lived
// instance whose `getAccessToken` callback reads from it on every
// protected request -- that second instance needs to see the first one's
// write immediately, not after a reload.
let memoryFallback: StoredSession | undefined;

export class TokenStore {
  get(): StoredSession | undefined {
    return hasLocalStorage() ? readPersisted() : memoryFallback;
  }

  set(session: StoredSession): void {
    memoryFallback = session;
    writePersisted(session);
  }

  clear(): void {
    memoryFallback = undefined;
    writePersisted(undefined);
  }

  /** True when a session is stored and its access token has not (yet) passed its expiry. */
  hasValidAccessToken(nowMs: number = Date.now()): boolean {
    const current = this.get();
    return current !== undefined && current.expiresAt > nowMs;
  }
}
