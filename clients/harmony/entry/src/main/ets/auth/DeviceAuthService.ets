/**
 * Drives the RFC 8628 device-authorisation ("pairing") flow (brief section
 * 4.3), using `core/DeviceCodePolicy.ts`'s poll-scheduling state machine
 * EXACTLY -- this file never re-implements or second-guesses its timing.
 *
 * Two-step public API, matching the two distinct phases a pairing screen
 * (a later slice) needs:
 *
 * 1. `requestDeviceCode()` -- one-shot `POST /api/v1/oauth/device/code`
 *    (brief section 4.3(a)), body `{client_platform: <wire name>}` where the
 *    wire name is the CURRENT resolved value from
 *    `core/AppConfig.ts#resolveClientPlatform`, driven by the
 *    `device/DeviceProfileService.ets`-published `AppStorage` value (see
 *    `currentClientPlatform`, below). On success, also decodes the
 *    `servers=` query parameter off `verification_uri_complete` via
 *    `core/ServerBundle.ts#decodeServersParam` and seeds the
 *    `ServerDirectory`'s peer failover address book with it -- this is the
 *    only source of peer-address information available THIS early, before
 *    any login/refresh response exists.
 *
 * 2. `beginPolling(...)` -- starts polling `POST /api/v1/oauth/token`
 *    (brief section 4.3(b)) on the schedule `core/DeviceCodePolicy.ts`
 *    computes, decoding every response through `core/ErrorEnvelope.ts`'s
 *    dedicated OAuth-error branch (via `net/ApiResult.ets`'s
 *    `ApiHttpFailure.envelope`). Returns a `DeviceAuthHandle` whose
 *    `cancel()` stops future polling -- the "cancellable polling handle" a
 *    pairing screen needs to abandon a flow the user backed out of.
 *
 * On success, `device_id` is decoded from the returned access token via
 * `core/Jwt.ts#decodeAccessTokenClaims` -- per that file's own header
 * comment, THIS IS THE ONLY WAY a device-flow session ever learns its own
 * `device_id`, since the server never returns it in any response body.
 * `device_id` is persisted via `SettingsStore#setDeviceId` and the token
 * pair is handed to `SessionManager#establishSession` to persist and start
 * tracking.
 *
 * A malformed/unparseable access token on an otherwise-200 poll response,
 * or any non-OAuth-shaped error envelope on this endpoint, is not a case
 * `core/DeviceCodePolicy.ts` has a slot for; both are treated conservatively
 * (see `pollOnce`'s own comments) rather than silently losing a session or
 * hot-looping.
 */

import { PlayarrClient } from '../net/PlayarrClient';
import { ApiResult } from '../net/ApiResult';

import { deviceCodeUrl, tokenUrl } from '../core/Endpoints.ts';
import { DeviceCodeResponse, TokenResponse, PeerAddressBundle } from '../core/Types/Auth.ts';
import { decodeServersParam } from '../core/ServerBundle.ts';
import { decodeAccessTokenClaims } from '../core/Jwt.ts';
import {
  DEVICE_CODE_GRANT_TYPE,
  DeviceCodePollState,
  DeviceCodePollOutcome,
  nextPollDecision,
  applyPollResult,
} from '../core/DeviceCodePolicy.ts';
import { resolveClientPlatform } from '../core/AppConfig.ts';
import { DeviceProfile } from '../core/DeviceProfile.ts';

import { ServerDirectory } from './ServerDirectory';
import { SessionManager } from './SessionManager';
import { setDeviceId } from './SettingsStore';

import { DEVICE_PROFILE_STORAGE_KEY } from '../device/DeviceProfileService';

interface DeviceCodeRequest {
  client_platform: string;
}

interface DeviceTokenPollRequest {
  grant_type: string;
  device_code: string;
}

export type DeviceAuthOutcomeKind = 'success' | 'access_denied' | 'expired' | 'cancelled' | 'request_failed';

/** The terminal (or cancelled) outcomes `beginPolling`'s callback reports.
 * `message` is only meaningful for `'request_failed'` (empty otherwise). */
export class DeviceAuthOutcome {
  public readonly kind: DeviceAuthOutcomeKind;
  public readonly message: string;

  constructor(kind: DeviceAuthOutcomeKind, message: string = '') {
    this.kind = kind;
    this.message = message;
  }
}

/** A cancellable in-progress poll loop -- see `beginPolling`. */
export interface DeviceAuthHandle {
  cancel(): void;
}

class CallbackAuthHandle implements DeviceAuthHandle {
  private readonly onCancel: () => void;

  constructor(onCancel: () => void) {
    this.onCancel = onCancel;
  }

  cancel(): void {
    this.onCancel();
  }
}

interface PollAttemptSuccess {
  kind: 'success';
  response: TokenResponse;
  deviceId: string;
}

interface PollAttemptOutcome {
  kind: 'outcome';
  outcome: DeviceCodePollOutcome;
}

interface PollAttemptTransientError {
  kind: 'transient_error';
}

interface PollAttemptFatalError {
  kind: 'fatal_error';
  message: string;
}

type PollAttemptResult = PollAttemptSuccess | PollAttemptOutcome | PollAttemptTransientError | PollAttemptFatalError;

/**
 * The current resolved `ClientPlatform` wire name, read from the
 * `DeviceProfile` `device/DeviceProfileService.ets` publishes into
 * `AppStorage` at ability creation (brief section 6.1: this value is fixed
 * for the process lifetime). Falls back to
 * `core/AppConfig.ts#resolveClientPlatform` only in the defensive case
 * where nothing has been published yet.
 */
function currentClientPlatform(): string {
  const profile = AppStorage.get<DeviceProfile>(DEVICE_PROFILE_STORAGE_KEY);
  if (profile !== undefined) {
    return profile.platformWireName;
  }
  return resolveClientPlatform('phone');
}

/**
 * Extracts the raw (still percent-encoded) value of the `servers=` query
 * parameter from `verificationUriComplete`, or `''` if the parameter is
 * absent -- matching `core/ServerBundle.ts#decodeServersParam`'s own
 * documented "empty string means absent" convention. Hand-rolled with plain
 * `String` methods rather than the `URL`/`URLSearchParams` globals, whose
 * availability under the ArkTS runtime is not guaranteed (the same
 * reasoning `core/Base64Url.ts` and `auth/SecretStore.ets` apply to
 * `TextEncoder`/`TextDecoder`/`Buffer`).
 */
function extractServersParam(verificationUriComplete: string): string {
  const queryIndex = verificationUriComplete.indexOf('?');
  if (queryIndex === -1) {
    return '';
  }
  const query = verificationUriComplete.substring(queryIndex + 1);
  const parts = query.split('&');
  for (const part of parts) {
    const eqIndex = part.indexOf('=');
    const key = eqIndex === -1 ? part : part.substring(0, eqIndex);
    if (key === 'servers') {
      const rawValue = eqIndex === -1 ? '' : part.substring(eqIndex + 1);
      try {
        return decodeURIComponent(rawValue);
      } catch (err) {
        return rawValue;
      }
    }
  }
  return '';
}

export class DeviceAuthService {
  private readonly client: PlayarrClient;
  private readonly serverDirectory: ServerDirectory;
  private readonly sessionManager: SessionManager;

  constructor(client: PlayarrClient, serverDirectory: ServerDirectory, sessionManager: SessionManager) {
    this.client = client;
    this.serverDirectory = serverDirectory;
    this.sessionManager = sessionManager;
  }

  /**
   * `POST /api/v1/oauth/device/code` (brief section 4.3(a)), unauthenticated.
   * On success, also seeds the `ServerDirectory`'s peer failover address
   * book from the response's `servers=` parameter. Returns the raw
   * `ApiResult` so a pairing screen can render `user_code`,
   * `verification_uri` and a QR of `verification_uri_complete` directly, or
   * show `AsyncState`'s error path on failure.
   */
  public async requestDeviceCode(): Promise<ApiResult<DeviceCodeResponse>> {
    const requestBody: DeviceCodeRequest = { client_platform: currentClientPlatform() };
    const result = await this.client.postJson<DeviceCodeRequest, DeviceCodeResponse>(deviceCodeUrl(), requestBody);

    if (result.kind === 'ok') {
      const serversParam = extractServersParam(result.value.verification_uri_complete);
      const peerAddresses = decodeServersParam(serversParam);
      const bundle: PeerAddressBundle = { group_id: null, group_name: null, addresses: peerAddresses };
      this.serverDirectory.setPeerAddressBundle(bundle);
    }

    return result;
  }

  /**
   * Starts polling `POST /api/v1/oauth/token` for `deviceCode` on the
   * schedule `core/DeviceCodePolicy.ts` computes from `intervalSeconds` /
   * `expiresInSeconds` (the `interval` / `expires_in` fields off the
   * `requestDeviceCode()` response). `onOutcome` is called EXACTLY ONCE,
   * with the terminal result -- never again afterwards, including after a
   * `cancel()` call that races a just-delivered terminal outcome. Returns a
   * handle whose `cancel()` stops all further polling.
   */
  public beginPolling(
    deviceCode: string,
    intervalSeconds: number,
    expiresInSeconds: number,
    onOutcome: (outcome: DeviceAuthOutcome) => void
  ): DeviceAuthHandle {
    let cancelled = false;
    let delivered = false;
    let timeoutHandle: number | null = null;
    let state: DeviceCodePollState = {
      intervalSeconds: intervalSeconds,
      expiresAtMs: Date.now() + expiresInSeconds * 1000,
      lastPolledAtMs: null,
      terminal: false,
    };

    const deliver = (outcome: DeviceAuthOutcome): void => {
      if (delivered) {
        return;
      }
      delivered = true;
      onOutcome(outcome);
    };

    const step = async (): Promise<void> => {
      if (cancelled) {
        return;
      }

      const decision = nextPollDecision(state, Date.now());

      if (decision.kind === 'stop') {
        if (decision.reason === 'expired') {
          deliver(new DeviceAuthOutcome('expired'));
        }
        // A 'terminal' stop with nothing delivered yet cannot happen here:
        // every branch below that marks `state` terminal also calls
        // `deliver` in the same step.
        return;
      }

      if (decision.kind === 'wait') {
        timeoutHandle = setTimeout((): void => {
          step();
        }, decision.waitMs);
        return;
      }

      // decision.kind === 'poll-now'
      const attempt = await this.pollOnce(deviceCode);
      if (cancelled) {
        return;
      }
      const now = Date.now();

      if (attempt.kind === 'fatal_error') {
        deliver(new DeviceAuthOutcome('request_failed', attempt.message));
        return;
      }

      if (attempt.kind === 'transient_error') {
        // A request-level hiccup (network failure, or an unexpected
        // non-OAuth envelope on this endpoint) should not abandon an
        // otherwise-healthy pairing flow -- keep the schedule moving as if
        // the server had said "authorization_pending".
        state = applyPollResult(state, 'authorization_pending', now);
        await step();
        return;
      }

      if (attempt.kind === 'success') {
        state = applyPollResult(state, 'success', now);
        await this.completeSuccess(attempt.response, attempt.deviceId);
        deliver(new DeviceAuthOutcome('success'));
        return;
      }

      // attempt.kind === 'outcome'
      state = applyPollResult(state, attempt.outcome, now);
      if (attempt.outcome === 'access_denied') {
        deliver(new DeviceAuthOutcome('access_denied'));
        return;
      }
      if (attempt.outcome === 'expired_token') {
        deliver(new DeviceAuthOutcome('expired'));
        return;
      }
      // 'authorization_pending' / 'slow_down' -- keep polling per the
      // (possibly just-ratcheted) schedule.
      await step();
    };

    step();

    const handle: DeviceAuthHandle = new CallbackAuthHandle((): void => {
      cancelled = true;
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      deliver(new DeviceAuthOutcome('cancelled'));
    });
    return handle;
  }

  /** Persists the newly-learned `device_id` and hands the token pair to `SessionManager`. */
  private async completeSuccess(response: TokenResponse, deviceId: string): Promise<void> {
    await setDeviceId(deviceId);
    await this.sessionManager.establishSession(response.access_token, response.refresh_token, response.expires_in);
  }

  private async pollOnce(deviceCode: string): Promise<PollAttemptResult> {
    const requestBody: DeviceTokenPollRequest = {
      grant_type: DEVICE_CODE_GRANT_TYPE,
      device_code: deviceCode,
    };
    const result = await this.client.postJson<DeviceTokenPollRequest, TokenResponse>(tokenUrl(), requestBody);

    if (result.kind === 'ok') {
      const response = result.value;
      const claims = decodeAccessTokenClaims(response.access_token);
      if (claims === null) {
        const fatal: PollAttemptResult = {
          kind: 'fatal_error',
          message: 'Device pairing succeeded but the returned access token could not be decoded.',
        };
        return fatal;
      }
      const success: PollAttemptResult = { kind: 'success', response: response, deviceId: claims.device_id };
      return success;
    }

    if (result.kind === 'network_failure') {
      const transient: PollAttemptResult = { kind: 'transient_error' };
      return transient;
    }

    // result.kind === 'http_failure'
    if (result.envelope.kind === 'oauth') {
      const mappedOutcome = this.toDeviceCodePollOutcome(result.envelope.code);
      const outcome: PollAttemptResult = { kind: 'outcome', outcome: mappedOutcome };
      return outcome;
    }

    // A general/malformed/not_json/upgrade_required envelope is not one of
    // the documented shapes for THIS endpoint (brief section 4.2 shape 2 is
    // the only one `/oauth/token` ever uses) -- treat as transient rather
    // than abandoning the flow over one unexpected response.
    const transient: PollAttemptResult = { kind: 'transient_error' };
    return transient;
  }

  private toDeviceCodePollOutcome(code: string): DeviceCodePollOutcome {
    if (
      code === 'authorization_pending' ||
      code === 'slow_down' ||
      code === 'access_denied' ||
      code === 'expired_token'
    ) {
      return code;
    }
    // 'unsupported_grant_type', or any future/unrecognised OAuth error code:
    // there is no dedicated DeviceCodePollOutcome slot for it, and polling
    // again can never resolve it, so treat it like an expired code -- stop
    // rather than looping forever.
    return 'expired_token';
  }
}
