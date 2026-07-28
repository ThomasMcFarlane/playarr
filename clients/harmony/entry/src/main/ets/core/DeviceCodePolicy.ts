/**
 * RFC 8628 device-authorisation poll scheduling state machine.
 *
 * This file lives under `core/` and is deliberately plain TypeScript: no
 * ArkUI, no `@kit.*` / `@ohos.*` imports, no decorators. It is Linux
 * testable with `node --test` and has zero dependency on the HarmonyOS SDK.
 *
 * `auth/DeviceAuthService.ets` drives the poll loop: it calls
 * `nextPollDecision` to decide whether to poll `POST /api/v1/oauth/token`
 * right now, wait, or stop, then feeds the server's outcome back through
 * `applyPollResult` to get the next state. See the implementation brief
 * section 4.3 ("Device authorisation").
 *
 * Exact semantics encoded here:
 * - The FIRST poll never receives `slow_down` back-off handling: with no
 *   prior `lastPolledAtMs`, `nextPollDecision` never applies the interval
 *   check and polls immediately.
 * - A poll arriving less than `intervalSeconds` after the previous one, when
 *   the server responds `slow_down`, permanently increments the stored
 *   `intervalSeconds` by exactly 5 and stamps `lastPolledAtMs = now`. This
 *   ratchets forever under repeated fast polling.
 * - Expiry (`now >= expiresAtMs`) is checked before the interval check.
 * - `access_denied` and `expired_token` are terminal. `success` is terminal
 *   by definition.
 */

/** The one grant type this client ever sends to `POST /api/v1/oauth/token`. */
export const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

/** Seconds permanently added to `intervalSeconds` on every `slow_down`. */
const SLOW_DOWN_INCREMENT_SECONDS = 5;

/** Poll-scheduling state for one in-flight device-authorisation session. */
export interface DeviceCodePollState {
  intervalSeconds: number;
  expiresAtMs: number;
  lastPolledAtMs: number | null;
  terminal: boolean;
}

/**
 * The five outcomes `POST /api/v1/oauth/token` can report for the device
 * flow (the `error` field on failure, or the literal "success" once the
 * caller has decoded a 200 `TokenResponse`).
 */
export type DeviceCodePollOutcome =
  | "authorization_pending"
  | "slow_down"
  | "access_denied"
  | "expired_token"
  | "success";

/** Why `nextPollDecision` says to stop polling. */
export type PollStopReason = "expired" | "terminal";

/** Poll `POST /api/v1/oauth/token` immediately. */
export interface PollNowDecision {
  kind: "poll-now";
}

/** Wait `waitMs` milliseconds before polling again. */
export interface PollWaitDecision {
  kind: "wait";
  waitMs: number;
}

/** Stop polling altogether; `reason` explains why. */
export interface PollStopDecision {
  kind: "stop";
  reason: PollStopReason;
}

export type PollDecision = PollNowDecision | PollWaitDecision | PollStopDecision;

function buildPollNowDecision(): PollDecision {
  const decision: PollNowDecision = { kind: "poll-now" };
  return decision;
}

function buildWaitDecision(waitMs: number): PollDecision {
  const decision: PollWaitDecision = { kind: "wait", waitMs: waitMs };
  return decision;
}

function buildStopDecision(reason: PollStopReason): PollDecision {
  const decision: PollStopDecision = { kind: "stop", reason: reason };
  return decision;
}

function buildPollState(
  intervalSeconds: number,
  expiresAtMs: number,
  lastPolledAtMs: number | null,
  terminal: boolean
): DeviceCodePollState {
  const state: DeviceCodePollState = {
    intervalSeconds: intervalSeconds,
    expiresAtMs: expiresAtMs,
    lastPolledAtMs: lastPolledAtMs,
    terminal: terminal
  };
  return state;
}

/**
 * Decide what `auth/DeviceAuthService.ets` should do right now: poll
 * immediately, wait a bounded number of milliseconds, or stop because the
 * device code has expired or the flow already reached a terminal outcome.
 *
 * Order of checks matters and is fixed by the brief:
 * 1. A `terminal` state always stops (nothing left to poll for).
 * 2. Expiry (`nowMs >= expiresAtMs`) is checked before the interval check.
 * 3. With no prior poll (`lastPolledAtMs === null`) the first poll goes out
 *    immediately -- there is no back-off to honour yet.
 * 4. Otherwise poll now if at least `intervalSeconds` have elapsed since the
 *    last poll, else wait for the remainder of that interval.
 */
export function nextPollDecision(state: DeviceCodePollState, nowMs: number): PollDecision {
  if (state.terminal) {
    return buildStopDecision("terminal");
  }
  if (nowMs >= state.expiresAtMs) {
    return buildStopDecision("expired");
  }
  if (state.lastPolledAtMs === null) {
    return buildPollNowDecision();
  }

  const intervalMs = state.intervalSeconds * 1000;
  const elapsedMs = nowMs - state.lastPolledAtMs;
  if (elapsedMs >= intervalMs) {
    return buildPollNowDecision();
  }
  return buildWaitDecision(intervalMs - elapsedMs);
}

/**
 * Fold the server's response into the next `DeviceCodePollState` after a
 * poll made at `nowMs`.
 *
 * - `authorization_pending`: keep waiting, interval unchanged, stamp the
 *   poll time.
 * - `slow_down`: the ratchet -- permanently add `SLOW_DOWN_INCREMENT_SECONDS`
 *   to `intervalSeconds` and stamp the poll time. Repeated fast polling
 *   keeps compounding this.
 * - `access_denied` / `expired_token`: terminal, stop polling.
 * - `success`: terminal by definition.
 */
export function applyPollResult(
  state: DeviceCodePollState,
  outcome: DeviceCodePollOutcome,
  nowMs: number
): DeviceCodePollState {
  if (outcome === "authorization_pending") {
    return buildPollState(state.intervalSeconds, state.expiresAtMs, nowMs, false);
  }
  if (outcome === "slow_down") {
    return buildPollState(state.intervalSeconds + SLOW_DOWN_INCREMENT_SECONDS, state.expiresAtMs, nowMs, false);
  }
  if (outcome === "access_denied") {
    return buildPollState(state.intervalSeconds, state.expiresAtMs, nowMs, true);
  }
  if (outcome === "expired_token") {
    return buildPollState(state.intervalSeconds, state.expiresAtMs, nowMs, true);
  }
  // outcome === "success"
  return buildPollState(state.intervalSeconds, state.expiresAtMs, nowMs, true);
}
