import { describe, expect, it } from "vitest";
import {
  MAX_RECONNECT_ATTEMPTS,
  canReconnect,
  isRecoverableConnectionError,
  reconnectDelayMs,
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
