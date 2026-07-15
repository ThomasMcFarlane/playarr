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

export class TokenStore {
  private current: StoredSession | undefined;

  constructor() {
    this.current = readPersisted();
  }

  get(): StoredSession | undefined {
    return this.current;
  }

  set(session: StoredSession): void {
    this.current = session;
    writePersisted(session);
  }

  clear(): void {
    this.current = undefined;
    writePersisted(undefined);
  }

  /** True when a session is stored and its access token has not (yet) passed its expiry. */
  hasValidAccessToken(nowMs: number = Date.now()): boolean {
    return this.current !== undefined && this.current.expiresAt > nowMs;
  }
}
