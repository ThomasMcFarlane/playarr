/**
 * Owns the live, in-memory access token (mirrored to `SecretStore`) and
 * implements the `AccessTokenProvider` interface `net/PlayarrClient.ets`
 * declares, so an instance of this class can be handed directly to a
 * `PlayarrClient` during bootstrap (brief sections 3.2 and 4.5).
 *
 * SINGLE-FLIGHT REFRESH: `refreshAccessToken()` guarantees that concurrent
 * callers arriving while a refresh is already in progress all await the
 * SAME in-flight promise -- never a second `POST /api/v1/auth/refresh`.
 * This works because an `async` function runs synchronously up to its own
 * first `await`: `refreshAccessToken()` starts `performRefresh()`, stores
 * the resulting promise in `this.refreshInFlight`, and only THEN awaits it
 * -- so any call that arrives before that promise resolves (and clears
 * `refreshInFlight` in its `finally`) observes the field already set and
 * returns the same promise instead of starting a second attempt.
 *
 * The refresh call itself goes DIRECTLY through `net/HttpTransport.ets`,
 * never through `PlayarrClient` -- `POST /api/v1/auth/refresh` is
 * unauthenticated (brief section 4.5), and routing it through
 * `PlayarrClient` (whose own 401 handling calls back into THIS class)
 * would risk a circular retry.
 *
 * On success, the new access+refresh tokens are persisted and the old
 * refresh token discarded ATOMICALLY -- both `SecretStore` writes complete
 * before `performRefresh()`'s promise resolves, and every waiter on
 * `refreshAccessToken()` only resumes after that promise resolves, so no
 * waiter can ever observe a half-updated store.
 *
 * On a definitive 401 refresh failure, all session material is cleared via
 * `SecretStore.clearAllSecrets()` (the server list in `SettingsStore` is
 * left untouched) and `needsRePairing()` starts reporting `true` -- a later
 * pairing/boot-state-machine slice is expected to poll this and route back
 * to pairing.
 *
 * PROACTIVE REFRESH: `core/RefreshPolicy.ts#shouldProactivelyRefresh` (~80%
 * of `expires_in` elapsed) is checked on a PERIODIC TIMER
 * (`PROACTIVE_REFRESH_CHECK_INTERVAL_MS`, started by `startProactiveRefreshTimer()`)
 * rather than before every request. This is a deliberate choice: a
 * per-request check would never fire while the app is idle on a screen
 * that issues no requests of its own (e.g. a paused player, or a Pairing
 * screen waiting on user action) and the token would still die silently at
 * the 15-minute mark; a periodic timer keeps the session alive regardless
 * of what the user is doing. The reactive 401-triggered path in
 * `net/PlayarrClient.ets` remains as a backstop either way.
 */

import { AccessTokenProvider } from '../net/PlayarrClient';
import { sendHttpRequest, HttpRequestOptions } from '../net/HttpTransport';

import { refreshUrl } from '../core/Endpoints.ts';
import { buildJsonBodyHeaders } from '../core/Headers.ts';
import { clientVersion } from '../core/AppConfig.ts';
import { absoluteUrl } from '../core/Url.ts';
import { shouldProactivelyRefresh } from '../core/RefreshPolicy.ts';
import { decodePeerAddressBundle } from '../core/ServerBundle.ts';
import { RefreshRequest, RefreshResponse } from '../core/Types/Auth.ts';

import { ServerDirectory } from './ServerDirectory';
import {
  getAccessToken as loadStoredAccessToken,
  saveAccessToken as persistAccessToken,
  getRefreshToken as loadStoredRefreshToken,
  saveRefreshToken as persistRefreshToken,
  clearAllSecrets,
} from './SecretStore';
import { getDeviceId, clearSelectedProfile } from './SettingsStore';

import { logError } from '../util/Log';

/** How often the proactive-refresh timer checks `shouldProactivelyRefresh`
 * against the current token's age. Independent of `expires_in` -- a fixed
 * 1-minute cadence comfortably catches the ~80%-of-900s (~12 minute) mark
 * without needing to schedule a bespoke one-shot timer per token. */
export const PROACTIVE_REFRESH_CHECK_INTERVAL_MS: number = 60000;

const LOG_TAG: string = 'SessionManager';

/** `sendHttpRequest`'s JSON response-decoding mode, for the refresh call. */
const REFRESH_DATA_TYPE = 'string';

interface RefreshAttemptOk {
  kind: 'ok';
  response: RefreshResponse;
}

interface RefreshAttemptUnauthorized {
  kind: 'unauthorized';
}

interface RefreshAttemptNetworkFailure {
  kind: 'network_failure';
}

type RefreshAttemptResult = RefreshAttemptOk | RefreshAttemptUnauthorized | RefreshAttemptNetworkFailure;

export class SessionManager implements AccessTokenProvider {
  private readonly serverDirectory: ServerDirectory;
  private readonly clientPlatform: string;

  private accessTokenValue: string | null = null;
  private accessTokenIssuedAtMs: number | null = null;
  private expiresInSeconds: number = 0;
  private refreshInFlight: Promise<boolean> | null = null;
  private needsRePairingFlag: boolean = false;
  private proactiveRefreshTimerHandle: number | null = null;

  constructor(serverDirectory: ServerDirectory, clientPlatform: string) {
    this.serverDirectory = serverDirectory;
    this.clientPlatform = clientPlatform;
  }

  /**
   * Hydrates the in-memory access token from `SecretStore`. Call exactly
   * once, during bootstrap. A restored token's issue time cannot survive a
   * process restart (only its VALUE is persisted), so it is treated like
   * `core/DeviceCodePolicy.ts` treats a never-yet-polled state: unknown age
   * means the next proactive-refresh check refreshes it immediately rather
   * than guessing an age that could be dangerously wrong.
   */
  public async initialize(): Promise<void> {
    this.accessTokenValue = await loadStoredAccessToken();
    this.accessTokenIssuedAtMs = null;
    this.expiresInSeconds = 0;
  }

  /** `AccessTokenProvider`: the current bearer, or `null` before pairing / after sign-out. */
  public getAccessToken(): string | null {
    return this.accessTokenValue;
  }

  /**
   * `AccessTokenProvider`: refreshes the access token, single-flight -- see
   * this file's header comment for exactly why concurrent callers are safe.
   */
  public async refreshAccessToken(): Promise<boolean> {
    if (this.refreshInFlight !== null) {
      return this.refreshInFlight;
    }
    const inFlight = this.performRefresh();
    this.refreshInFlight = inFlight;
    try {
      return await inFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  /**
   * `true` once a refresh has failed unrecoverably (a revoked, reused or
   * expired refresh token) and all session material has been cleared. A
   * later pairing/boot-state-machine slice should route back to pairing
   * while this is `true`; it is cleared again the next time
   * `establishSession` runs.
   */
  public needsRePairing(): boolean {
    return this.needsRePairingFlag;
  }

  /**
   * Persists a freshly-issued token pair as the live session and starts
   * tracking its age for proactive refresh. The one caller today is
   * `auth/DeviceAuthService.ets` on a successful device-flow poll; a future
   * credentials-login path would call this too. Deliberately does NOT
   * persist `device_id` -- that is the caller's responsibility (see
   * `core/Jwt.ts`'s header comment on where each flow's `device_id` comes
   * from); this class only ever needs to READ `device_id` back out of
   * `SettingsStore`, at refresh time.
   */
  public async establishSession(accessToken: string, refreshToken: string, expiresInSeconds: number): Promise<void> {
    await persistAccessToken(accessToken);
    await persistRefreshToken(refreshToken);
    this.accessTokenValue = accessToken;
    this.accessTokenIssuedAtMs = Date.now();
    this.expiresInSeconds = expiresInSeconds;
    this.needsRePairingFlag = false;
  }

  /**
   * Clears tokens and the selected-profile setting but PRESERVES the
   * server address list and the persisted `device_id` (brief section 9
   * Slice 3's sign-out contract) -- see `SecretStore.ets#clearAllSecrets`
   * and `SettingsStore.ets#clearSelectedProfile` for exactly what each
   * does and does not touch. This is a deliberate user action, not a
   * broken-session signal, so it does NOT set `needsRePairing()`.
   */
  public async signOut(): Promise<void> {
    await clearAllSecrets();
    await clearSelectedProfile();
    this.accessTokenValue = null;
    this.accessTokenIssuedAtMs = null;
    this.expiresInSeconds = 0;
  }

  /**
   * Starts the periodic proactive-refresh timer -- see this file's header
   * comment for why a timer rather than a per-request check. Safe to call
   * more than once; a later call replaces the previous timer rather than
   * stacking a second one.
   */
  public startProactiveRefreshTimer(): void {
    if (this.proactiveRefreshTimerHandle !== null) {
      clearInterval(this.proactiveRefreshTimerHandle);
    }
    this.proactiveRefreshTimerHandle = setInterval((): void => {
      this.checkProactiveRefresh();
    }, PROACTIVE_REFRESH_CHECK_INTERVAL_MS);
  }

  /** Stops the proactive-refresh timer, if one is running. */
  public stopProactiveRefreshTimer(): void {
    if (this.proactiveRefreshTimerHandle !== null) {
      clearInterval(this.proactiveRefreshTimerHandle);
      this.proactiveRefreshTimerHandle = null;
    }
  }

  private checkProactiveRefresh(): void {
    if (this.accessTokenValue === null) {
      return;
    }
    const now = Date.now();
    const due =
      this.accessTokenIssuedAtMs === null ||
      shouldProactivelyRefresh(this.accessTokenIssuedAtMs, this.expiresInSeconds, now);
    if (!due) {
      return;
    }
    // Fire-and-forget: refreshAccessToken() never rejects (performRefresh
    // catches everything internally and resolves false on any failure).
    this.refreshAccessToken();
  }

  /**
   * Runs one refresh attempt, trying the active server first and then --
   * on a NETWORK failure only, never on a 401 -- other addresses of the
   * SAME issuing peer node (brief section 4.5's node-scoping rule; see
   * `ServerDirectory#getFailoverCandidates`). A 401 is a definitive
   * rejection of the refresh token itself, so trying another route to the
   * same node would never help and is skipped. Never throws.
   */
  private async performRefresh(): Promise<boolean> {
    try {
      const refreshTokenValue = await loadStoredRefreshToken();
      const deviceId = await getDeviceId();
      if (refreshTokenValue === null || deviceId === null) {
        // Nothing to refresh -- no session was ever established.
        return false;
      }

      const primaryBaseUrl = this.serverDirectory.getActiveBaseUrl();
      if (primaryBaseUrl === null) {
        return false;
      }

      const baseUrls: string[] = [primaryBaseUrl];
      if (this.accessTokenValue !== null) {
        const failoverAddresses = this.serverDirectory.getFailoverCandidates(this.accessTokenValue);
        for (const address of failoverAddresses) {
          if (baseUrls.indexOf(address.url) === -1) {
            baseUrls.push(address.url);
          }
        }
      }

      for (const baseUrl of baseUrls) {
        const attempt = await this.attemptRefreshAgainst(baseUrl, deviceId, refreshTokenValue);
        if (attempt.kind === 'ok') {
          await this.applyRefreshSuccess(attempt.response);
          return true;
        }
        if (attempt.kind === 'unauthorized') {
          await this.applyRefreshFailure();
          return false;
        }
        // 'network_failure' -- fall through and try the next candidate
        // address, if any remain.
      }

      return false;
    } catch (err) {
      const asError = err as Error;
      logError(LOG_TAG, 'unexpected error while refreshing the access token: ' + asError.message);
      return false;
    }
  }

  private async attemptRefreshAgainst(
    baseUrl: string,
    deviceId: string,
    refreshTokenValue: string
  ): Promise<RefreshAttemptResult> {
    const requestBody: RefreshRequest = { device_id: deviceId, refresh_token: refreshTokenValue };
    const headers = buildJsonBodyHeaders(this.clientPlatform, clientVersion, null);

    let url: string;
    try {
      url = absoluteUrl(baseUrl, refreshUrl());
    } catch (err) {
      const networkFailure: RefreshAttemptResult = { kind: 'network_failure' };
      return networkFailure;
    }

    const requestOptions: HttpRequestOptions = {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestBody),
      dataType: REFRESH_DATA_TYPE,
    };

    const response = await sendHttpRequest(url, requestOptions);

    if (response.status === 0) {
      const networkFailure: RefreshAttemptResult = { kind: 'network_failure' };
      return networkFailure;
    }
    if (response.status === 401) {
      const unauthorized: RefreshAttemptResult = { kind: 'unauthorized' };
      return unauthorized;
    }
    if (response.status >= 200 && response.status < 300) {
      const bodyText = response.bodyText ?? '';
      try {
        const parsed = JSON.parse(bodyText) as RefreshResponse;
        if (
          typeof parsed.access_token !== 'string' ||
          typeof parsed.refresh_token !== 'string' ||
          typeof parsed.expires_in !== 'number'
        ) {
          const malformed: RefreshAttemptResult = { kind: 'network_failure' };
          return malformed;
        }
        const ok: RefreshAttemptResult = { kind: 'ok', response: parsed };
        return ok;
      } catch (err) {
        const malformed: RefreshAttemptResult = { kind: 'network_failure' };
        return malformed;
      }
    }

    // Any other status (e.g. a 403/500) is not documented for this endpoint
    // -- treat conservatively as transient rather than misdiagnosing a
    // genuine outage as "needs re-pairing".
    const other: RefreshAttemptResult = { kind: 'network_failure' };
    return other;
  }

  private async applyRefreshSuccess(response: RefreshResponse): Promise<void> {
    await persistAccessToken(response.access_token);
    await persistRefreshToken(response.refresh_token);
    this.accessTokenValue = response.access_token;
    this.accessTokenIssuedAtMs = Date.now();
    this.expiresInSeconds = response.expires_in;
    this.needsRePairingFlag = false;

    if (response.peer_addresses !== null) {
      const decoded = decodePeerAddressBundle(response.peer_addresses);
      this.serverDirectory.setPeerAddressBundle(decoded);
    }
  }

  private async applyRefreshFailure(): Promise<void> {
    await clearAllSecrets();
    this.accessTokenValue = null;
    this.accessTokenIssuedAtMs = null;
    this.expiresInSeconds = 0;
    this.needsRePairingFlag = true;
  }
}
