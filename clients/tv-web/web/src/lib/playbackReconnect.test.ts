import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_RECONNECT_ATTEMPTS,
  canReconnect,
  isRecoverableConnectionError,
  isUnhandledEngineError,
  sessionCloseForEngineState,
  reconnectDelayMs,
  shouldFallBackToTranscodeAfterDecodeError,
} from "./playbackReconnect";

const session = "https://server.example/api/v1/media/sessions/abc/master.m3u8";

describe("playback reconnect rules", () => {
  it("recovers expired or unreachable on-demand sessions", () => {
    expect(isRecoverableConnectionError({ code: "1001", httpStatus: 404, requestUri: session }, { onDemandSession: true })).toBe(true);
    expect(isRecoverableConnectionError({ code: "1001", httpStatus: 503, requestUri: session }, { onDemandSession: true })).toBe(true);
    expect(isRecoverableConnectionError({ code: "1002" }, { onDemandSession: true })).toBe(true);
    expect(isRecoverableConnectionError({ code: "1003", requestUri: session }, { onDemandSession: true })).toBe(true);
  });

  it("does not treat codec, auth or direct-play failures as connection loss", () => {
    expect(isRecoverableConnectionError({ code: "MEDIA_3" }, { onDemandSession: true })).toBe(false);
    expect(isRecoverableConnectionError({ code: "1001", httpStatus: 403, requestUri: session }, { onDemandSession: true })).toBe(false);
    expect(isRecoverableConnectionError({ code: "1002" }, { onDemandSession: false })).toBe(false);
    expect(isRecoverableConnectionError({ code: "1001", httpStatus: 404, requestUri: "https://x.example/poster.jpg" }, { onDemandSession: true })).toBe(false);
    expect(isRecoverableConnectionError(undefined, { onDemandSession: true })).toBe(false);
  });

  it("backs off and gives up after a bounded number of attempts", () => {
    expect([0, 1, 2, 3, 4, 9].map(reconnectDelayMs)).toEqual([1000, 2000, 4000, 8000, 10000, 10000]);
    expect(canReconnect(MAX_RECONNECT_ATTEMPTS - 1)).toBe(true);
    expect(canReconnect(MAX_RECONNECT_ATTEMPTS)).toBe(false);
  });
});

describe("handled engine errors", () => {
  it("ignores the error a reconnect was already started for", () => {
    const error = { code: "1001", httpStatus: 404 };
    expect(isUnhandledEngineError(error, error)).toBe(false);
  });

  it("handles a new error, including one with identical content", () => {
    expect(isUnhandledEngineError({ code: "1001" }, { code: "1001" })).toBe(true);
    expect(isUnhandledEngineError({ code: "1001" }, undefined)).toBe(true);
  });

  it("has nothing to handle without an error", () => {
    expect(isUnhandledEngineError(undefined, undefined)).toBe(false);
  });
});

describe("session close on terminal engine state", () => {
  it("closes the session once when the engine ends or fails", () => {
    expect(sessionCloseForEngineState("playing", "ended")).toBe("completed");
    expect(sessionCloseForEngineState("buffering", "error")).toBe("error");
  });

  it("does not close a replacement session while the old terminal state is still shown", () => {
    expect(sessionCloseForEngineState("error", "error")).toBeNull();
    expect(sessionCloseForEngineState("ended", "ended")).toBeNull();
  });

  it("ignores non-terminal states", () => {
    expect(sessionCloseForEngineState("loading", "playing")).toBeNull();
    expect(sessionCloseForEngineState("error", "loading")).toBeNull();
  });
});

describe("decode-error fallback to a forced transcode", () => {
  const fresh = { forceTranscode: false, alreadyAttempted: false };
  it("falls back once for a source-video session that fails to decode", () => {
    for (const code of ["3014", "3015", "3016", "4032", "MEDIA_3", "MEDIA_4"]) {
      expect(shouldFallBackToTranscodeAfterDecodeError({ code }, fresh)).toBe(true);
    }
    expect(shouldFallBackToTranscodeAfterDecodeError({ code: "3016" }, { ...fresh, alreadyAttempted: true })).toBe(false);
  });
  it("never falls back from a forced transcode or for network errors", () => {
    expect(shouldFallBackToTranscodeAfterDecodeError({ code: "3016" }, { ...fresh, forceTranscode: true })).toBe(false);
    expect(shouldFallBackToTranscodeAfterDecodeError({ code: "1001", httpStatus: 404, requestUri: session }, fresh)).toBe(false);
    expect(shouldFallBackToTranscodeAfterDecodeError(undefined, fresh)).toBe(false);
  });
  it("is wired into the playback engine", () => {
    const engine = readFileSync(new URL("./usePlaybackEngine.ts", import.meta.url), "utf8");
    expect(engine).toContain("shouldFallBackToTranscodeAfterDecodeError(engineState.error");
    expect(engine).toContain("profile: DECODE_FALLBACK_PROFILE,");
  });
});
