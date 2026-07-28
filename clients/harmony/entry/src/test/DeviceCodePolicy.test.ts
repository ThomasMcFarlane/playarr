// entry/src/test/DeviceCodePolicy.test.ts
//
// Pure Node unit tests for core/DeviceCodePolicy.ts (brief section 4.3 / 7.2).
// This file imports only the plain-TypeScript core module below and node's
// own test/assert builtins -- no ArkUI, no @kit.*/@ohos.* imports, no
// decorators.
//
// Covers the RFC 8628 poll-scheduling semantics fixed by the brief:
//   - The FIRST poll never receives slow_down back-off handling: with no
//     prior lastPolledAtMs, nextPollDecision polls immediately.
//   - slow_down adds exactly 5s to intervalSeconds and ratchets forever
//     under repeated fast polling.
//   - Expiry (nowMs >= expiresAtMs) is checked before the interval check,
//     and before the "first poll" check, and before nothing (terminal wins
//     over everything).
//   - access_denied / expired_token / success are all terminal.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  DEVICE_CODE_GRANT_TYPE,
  applyPollResult,
  nextPollDecision,
  DeviceCodePollState,
  PollDecision
} from "../main/ets/core/DeviceCodePolicy";

function buildState(
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

function assertPollNow(decision: PollDecision): void {
  assert.equal(decision.kind, "poll-now");
}

function assertWait(decision: PollDecision, expectedWaitMs: number): void {
  assert.equal(decision.kind, "wait");
  if (decision.kind === "wait") {
    assert.equal(decision.waitMs, expectedWaitMs);
  }
}

function assertStop(decision: PollDecision, expectedReason: string): void {
  assert.equal(decision.kind, "stop");
  if (decision.kind === "stop") {
    assert.equal(decision.reason, expectedReason);
  }
}

describe("DEVICE_CODE_GRANT_TYPE", () => {
  it("is the exact RFC 8628 device-code grant-type URN", () => {
    assert.equal(DEVICE_CODE_GRANT_TYPE, "urn:ietf:params:oauth:grant-type:device_code");
  });
});

describe("nextPollDecision: first poll never applies slow_down back-off", () => {
  it("polls immediately when lastPolledAtMs is null, even with a large interval", () => {
    const now = 1_000_000;
    const state = buildState(300, now + 600_000, null, false);
    const decision = nextPollDecision(state, now);
    assertPollNow(decision);
  });

  it("polls immediately on the very first call regardless of how close nowMs is to expiry", () => {
    const now = 1_000_000;
    const state = buildState(5, now + 1, null, false);
    const decision = nextPollDecision(state, now);
    assertPollNow(decision);
  });
});

describe("nextPollDecision: expiry beats the interval check", () => {
  it("stops as expired even before a first poll has ever happened", () => {
    const now = 1_000_000;
    const state = buildState(5, now - 1, null, false);
    const decision = nextPollDecision(state, now);
    assertStop(decision, "expired");
  });

  it("stops as expired instead of waiting out the remainder of the interval", () => {
    const now = 1_000_000;
    // Only 1s has elapsed since the last poll of a 30s interval -- absent
    // the expiry check this would be a "wait" decision -- but expiresAtMs
    // has already passed.
    const state = buildState(30, now - 1, now - 1_000, false);
    const decision = nextPollDecision(state, now);
    assertStop(decision, "expired");
  });

  it("stops as expired exactly at the expiry instant (nowMs === expiresAtMs)", () => {
    const now = 1_000_000;
    const state = buildState(5, now, now - 100, false);
    const decision = nextPollDecision(state, now);
    assertStop(decision, "expired");
  });
});

describe("nextPollDecision: terminal beats everything, including expiry", () => {
  it("stops as terminal even when the state has also already expired", () => {
    const now = 1_000_000;
    const state = buildState(5, now - 1, null, true);
    const decision = nextPollDecision(state, now);
    assertStop(decision, "terminal");
  });

  it("stops as terminal even on what would otherwise be an immediate first poll", () => {
    const now = 1_000_000;
    const state = buildState(5, now + 600_000, null, true);
    const decision = nextPollDecision(state, now);
    assertStop(decision, "terminal");
  });
});

describe("nextPollDecision: interval-elapsed check once a poll has happened", () => {
  it("waits for the exact remainder of intervalSeconds when polled too soon", () => {
    const now = 1_000_000;
    const state = buildState(5, now + 600_000, now - 2_000, false);
    const decision = nextPollDecision(state, now);
    assertWait(decision, 3_000);
  });

  it("polls now once the full interval has elapsed", () => {
    const now = 1_000_000;
    const state = buildState(5, now + 600_000, now - 5_000, false);
    const decision = nextPollDecision(state, now);
    assertPollNow(decision);
  });

  it("polls now at the exact interval boundary (elapsedMs === intervalMs)", () => {
    const now = 1_000_000;
    const state = buildState(5, now + 600_000, now - 5_000, false);
    const decision = nextPollDecision(state, now);
    assertPollNow(decision);
  });
});

describe("applyPollResult: authorization_pending", () => {
  it("keeps the interval unchanged, stamps lastPolledAtMs, and stays non-terminal", () => {
    const now = 1_000_000;
    const state = buildState(5, now + 600_000, null, false);
    const next = applyPollResult(state, "authorization_pending", now);
    assert.equal(next.intervalSeconds, 5);
    assert.equal(next.expiresAtMs, now + 600_000);
    assert.equal(next.lastPolledAtMs, now);
    assert.equal(next.terminal, false);
  });
});

describe("applyPollResult: slow_down adds exactly 5 seconds and ratchets", () => {
  it("adds exactly 5 seconds to intervalSeconds on a single slow_down", () => {
    const now = 1_000_000;
    const state = buildState(5, now + 600_000, now - 1_000, false);
    const next = applyPollResult(state, "slow_down", now);
    assert.equal(next.intervalSeconds, 10);
    assert.equal(next.lastPolledAtMs, now);
    assert.equal(next.terminal, false);
    assert.equal(next.expiresAtMs, now + 600_000);
  });

  it("ratchets the interval upward permanently under repeated fast polling", () => {
    const start = 1_000_000;
    let state = buildState(5, start + 600_000, null, false);
    let now = start;
    for (let i = 0; i < 4; i = i + 1) {
      now = now + 1_000;
      state = applyPollResult(state, "slow_down", now);
    }
    // 5 (initial) + 4 * 5 (one ratchet per repeated fast poll) = 25.
    assert.equal(state.intervalSeconds, 25);
    assert.equal(state.lastPolledAtMs, now);
    assert.equal(state.terminal, false);
  });

  it("feeds the newly ratcheted interval into the next wait calculation", () => {
    const t0 = 1_000_000;
    let state = buildState(5, t0 + 600_000, null, false);

    // First poll goes out immediately (no prior lastPolledAtMs).
    assertPollNow(nextPollDecision(state, t0));

    // Server says slow_down: interval becomes 5 + 5 = 10.
    state = applyPollResult(state, "slow_down", t0);
    assert.equal(state.intervalSeconds, 10);

    // 6s later would have been enough under the OLD 5s interval, but the
    // ratcheted 10s interval means 4s remain.
    const t1 = t0 + 6_000;
    assertWait(nextPollDecision(state, t1), 4_000);
  });
});

describe("applyPollResult: access_denied and expired_token are terminal", () => {
  it("marks access_denied as terminal without touching interval or expiry", () => {
    const now = 1_000_000;
    const state = buildState(5, now + 600_000, now - 1_000, false);
    const next = applyPollResult(state, "access_denied", now);
    assert.equal(next.terminal, true);
    assert.equal(next.intervalSeconds, 5);
    assert.equal(next.expiresAtMs, now + 600_000);
    assert.equal(next.lastPolledAtMs, now);
  });

  it("marks expired_token as terminal without touching interval or expiry", () => {
    const now = 1_000_000;
    const state = buildState(5, now + 600_000, now - 1_000, false);
    const next = applyPollResult(state, "expired_token", now);
    assert.equal(next.terminal, true);
    assert.equal(next.intervalSeconds, 5);
    assert.equal(next.expiresAtMs, now + 600_000);
  });

  it("a terminal state from access_denied stops all further polling, even before expiry", () => {
    const now = 1_000_000;
    const pending = buildState(5, now + 600_000, now - 1_000, false);
    const denied = applyPollResult(pending, "access_denied", now);
    const decision = nextPollDecision(denied, now + 1);
    assertStop(decision, "terminal");
  });
});

describe("applyPollResult: success is terminal by definition", () => {
  it("marks success as terminal", () => {
    const now = 1_000_000;
    const state = buildState(5, now + 600_000, now - 1_000, false);
    const next = applyPollResult(state, "success", now);
    assert.equal(next.terminal, true);
  });
});
