// entry/src/test/PlaybackMath.test.ts
//
// Pure Node unit tests for core/PlaybackMath.ts (brief section 4.10 / 4.12).
// This file imports only the plain-TypeScript core module below and node's
// own test/assert builtins -- no ArkUI, no @kit.*/@ohos.* imports, no
// decorators.
//
// Covers:
//   - reportedPositionMs: source_offset_ms is ADDED to every reported
//     player position (brief 4.10 / 4.12).
//   - resolveDurationMs: duration_ms === 0 means server-side duration
//     probing failed, not an error -- fall back to the player's own
//     reported duration (brief 4.10).
//   - clampSeekTargetMs: a seek target is clamped to [0, durationMs].
//   - isPlaybackComplete: the 5000ms "completed" threshold (brief 4.12:
//     "Mark completed when position >= duration - 5000").

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  reportedPositionMs,
  resolveDurationMs,
  clampSeekTargetMs,
  isPlaybackComplete,
  resumeStartMs,
  shouldCheckpointProgress
} from "../main/ets/core/PlaybackMath";

describe("reportedPositionMs: source_offset_ms is added to the player position", () => {
  it("adds a positive source offset onto the player position", () => {
    assert.equal(reportedPositionMs(1000, 5000), 6000);
  });

  it("returns the player position unchanged when the offset is zero", () => {
    assert.equal(reportedPositionMs(42000, 0), 42000);
  });

  it("adds zero player position to a non-zero offset", () => {
    assert.equal(reportedPositionMs(0, 7500), 7500);
  });

  it("adds when both are zero", () => {
    assert.equal(reportedPositionMs(0, 0), 0);
  });

  it("is pure addition, not player-position-only, for large offsets", () => {
    assert.equal(reportedPositionMs(120000, 3600000), 3720000);
  });
});

describe("resolveDurationMs: duration_ms === 0 falls back to the player-reported duration", () => {
  it("falls back to the player-reported duration when the server duration is exactly zero", () => {
    assert.equal(resolveDurationMs(0, 123456), 123456);
  });

  it("uses the server duration when it is non-zero, ignoring the player-reported duration", () => {
    assert.equal(resolveDurationMs(60000, 999), 60000);
  });

  it("falls back to zero when both the server and the player report zero", () => {
    assert.equal(resolveDurationMs(0, 0), 0);
  });

  it("does not treat a very small non-zero server duration as a probing failure", () => {
    assert.equal(resolveDurationMs(1, 999999), 1);
  });
});

describe("clampSeekTargetMs: seek target is clamped to [0, durationMs]", () => {
  it("clamps a negative seek target up to zero", () => {
    assert.equal(clampSeekTargetMs(-500, 10000), 0);
  });

  it("clamps a seek target past the end down to the duration", () => {
    assert.equal(clampSeekTargetMs(15000, 10000), 10000);
  });

  it("leaves an in-range seek target unchanged", () => {
    assert.equal(clampSeekTargetMs(5000, 10000), 5000);
  });

  it("leaves the lower boundary (0) unchanged", () => {
    assert.equal(clampSeekTargetMs(0, 10000), 0);
  });

  it("leaves the upper boundary (durationMs) unchanged", () => {
    assert.equal(clampSeekTargetMs(10000, 10000), 10000);
  });

  it("clamps to zero when durationMs itself is zero and the target is negative", () => {
    assert.equal(clampSeekTargetMs(-1, 0), 0);
  });

  it("clamps a positive target down to a zero duration", () => {
    assert.equal(clampSeekTargetMs(500, 0), 0);
  });
});

describe("isPlaybackComplete: the 5000ms completion threshold", () => {
  it("is not complete just before the threshold (94999 of 100000)", () => {
    assert.equal(isPlaybackComplete(94999, 100000), false);
  });

  it("is complete exactly at the threshold (95000 of 100000)", () => {
    assert.equal(isPlaybackComplete(95000, 100000), true);
  });

  it("is complete past the threshold, up to and including the exact duration", () => {
    assert.equal(isPlaybackComplete(99000, 100000), true);
    assert.equal(isPlaybackComplete(100000, 100000), true);
  });

  it("is not complete at the very start of a normal-length title", () => {
    assert.equal(isPlaybackComplete(0, 100000), false);
  });

  it("treats a title shorter than the threshold as already complete at position 0", () => {
    // duration(3000) - 5000 = -2000; 0 >= -2000 is true.
    assert.equal(isPlaybackComplete(0, 3000), true);
  });

  it("is complete when position overshoots the duration entirely", () => {
    assert.equal(isPlaybackComplete(200000, 100000), true);
  });
});

describe("resumeStartMs: resume only from part-watched server progress", () => {
  it("resumes a part-watched item at its saved position", () => {
    assert.equal(resumeStartMs("part_watched", 42000), 42000);
  });

  it("starts from the top for unseen, watched or a zero position", () => {
    assert.equal(resumeStartMs("unseen", 0), 0);
    assert.equal(resumeStartMs("watched", 90000), 0);
    assert.equal(resumeStartMs("part_watched", 0), 0);
  });
});

describe("shouldCheckpointProgress: never write before playback started or at 0", () => {
  it("blocks writes before playback started, even at a resume position", () => {
    assert.equal(shouldCheckpointProgress(false, 42000), false);
  });

  it("blocks position 0 after playback started", () => {
    assert.equal(shouldCheckpointProgress(true, 0), false);
  });

  it("allows a positive position once playback started", () => {
    assert.equal(shouldCheckpointProgress(true, 1), true);
  });
});
