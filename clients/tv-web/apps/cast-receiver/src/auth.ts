/**
 * Holds the delegated-device credential (see the Playarr Cast design's
 * "Delegated device auth" section) the receiver uses to authenticate every
 * request against the cast target's own Streamarr server: never the
 * sender's own access/refresh token, always a separate device identity the
 * sender minted via RFC 8628 specifically for this cast.
 *
 * `currentAccessToken()` is deliberately SYNCHRONOUS (not a `Promise`) --
 * `PlaybackConfig.manifestRequestHandler`/`segmentRequestHandler` (see
 * `main.ts`) are synchronous callbacks and cannot await a token refresh
 * mid-segment. A proactive refresh timer -- mirroring the same
 * refresh-ahead-of-expiry approach as
 * `@streamarr-tv/device-auth`'s `ensureAccessToken`
 * (`ACCESS_TOKEN_MINIMUM_VALIDITY_MS`) -- keeps the held token valid well
 * before it would ever need a synchronous caller to block on anything.
 */
import type { RefreshRequest, RefreshResponse } from "@streamarr-tv/api-client";
import type { PlayarrCastCredentials } from "@streamarr-tv/cast-protocol";

/** The one `ApiClient` method this module needs -- narrowed so tests can supply a plain fake instead of a real `ApiClient`. `POST /api/v1/auth/refresh` needs no bearer token itself, so there is no circular dependency on this store's own `currentAccessToken()`. */
export interface CastAuthRefreshClient {
  refresh(body: RefreshRequest): Promise<RefreshResponse>;
}

// Streamarr issues 15-minute access tokens (see
// `@streamarr-tv/device-auth`'s `session.ts`); refreshing this far ahead of
// expiry keeps refresh traffic modest while avoiding edge-of-expiry 401s --
// same constant/rationale as that module's `ACCESS_TOKEN_MINIMUM_VALIDITY_MS`,
// duplicated here rather than imported since this store's proactive-timer
// refresh flow is otherwise unrelated to that module's lazy, pull-based one
// (no login fallback, no server-group retry -- just "keep rotating this one
// delegated credential").
const DEFAULT_MINIMUM_VALIDITY_MS = 2 * 60 * 1000;

export interface CastCredentialStoreOptions {
  /** Defaults to `DEFAULT_MINIMUM_VALIDITY_MS`. */
  minimumValidityMs?: number;
  /** Injectable clock, for tests. */
  now?: () => number;
  /** Injectable timer, for tests. */
  setTimeoutFn?: (handler: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
  /** Called every time a proactive or forced refresh succeeds, so the caller can broadcast an `auth.rotated` custom-channel message. */
  onRotated?: (credentials: PlayarrCastCredentials) => void;
  /** Called if a refresh attempt fails outright (e.g. the refresh token was revoked), so the caller can surface a `session_expired` error and end the cast session. */
  onRefreshFailed?: (error: unknown) => void;
}

export class CastCredentialStore {
  private readonly client: CastAuthRefreshClient;
  private readonly minimumValidityMs: number;
  private readonly now: () => number;
  private readonly setTimeoutFn: NonNullable<CastCredentialStoreOptions["setTimeoutFn"]>;
  private readonly clearTimeoutFn: NonNullable<CastCredentialStoreOptions["clearTimeoutFn"]>;
  private readonly onRotated: (credentials: PlayarrCastCredentials) => void;
  private readonly onRefreshFailed: (error: unknown) => void;

  private credentials: PlayarrCastCredentials | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshing: Promise<void> | null = null;

  constructor(client: CastAuthRefreshClient, options: CastCredentialStoreOptions = {}) {
    this.client = client;
    this.minimumValidityMs = options.minimumValidityMs ?? DEFAULT_MINIMUM_VALIDITY_MS;
    this.now = options.now ?? (() => Date.now());
    this.setTimeoutFn = options.setTimeoutFn ?? ((handler, ms) => setTimeout(handler, ms));
    this.clearTimeoutFn = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle));
    this.onRotated = options.onRotated ?? (() => {});
    this.onRefreshFailed = options.onRefreshFailed ?? (() => {});
  }

  /** Installs new credentials (the initial LOAD's customData, or a later `auth.update` message) and (re)schedules the proactive refresh timer. */
  setCredentials(credentials: PlayarrCastCredentials): void {
    this.credentials = credentials;
    this.scheduleRefresh();
  }

  /** Synchronous -- see this file's module doc comment. `undefined` before any credentials have ever been installed. */
  currentAccessToken(): string | undefined {
    return this.credentials?.accessToken;
  }

  get deviceId(): string | undefined {
    return this.credentials?.deviceId;
  }

  /** Whether any credentials have ever been installed. */
  get hasCredentials(): boolean {
    return this.credentials !== null;
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      this.clearTimeoutFn(this.refreshTimer);
      this.refreshTimer = null;
    }
    const credentials = this.credentials;
    if (!credentials) return;

    const delayMs = Math.max(0, credentials.accessTokenExpiresAt - this.now() - this.minimumValidityMs);
    this.refreshTimer = this.setTimeoutFn(() => {
      void this.refreshNow();
    }, delayMs);
  }

  /**
   * Forces an immediate refresh (e.g. after a request came back
   * unauthorized). Concurrent callers share one in-flight attempt instead
   * of each firing their own `POST /api/v1/auth/refresh`.
   */
  async refreshNow(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const credentials = this.credentials;
    if (!credentials) return;

    const attempt = (async () => {
      try {
        const response = await this.client.refresh({
          device_id: credentials.deviceId,
          refresh_token: credentials.refreshToken,
        });
        const rotated: PlayarrCastCredentials = {
          deviceId: credentials.deviceId,
          accessToken: response.access_token,
          accessTokenExpiresAt: this.now() + response.expires_in * 1000,
          refreshToken: response.refresh_token,
        };
        this.credentials = rotated;
        this.scheduleRefresh();
        this.onRotated(rotated);
      } catch (err) {
        this.onRefreshFailed(err);
      } finally {
        this.refreshing = null;
      }
    })();

    this.refreshing = attempt;
    return attempt;
  }

  /** Stops the proactive refresh timer. Call on teardown (`session.end`, receiver shutdown). */
  dispose(): void {
    if (this.refreshTimer) {
      this.clearTimeoutFn(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}
