import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgressGate, isPermanentProgressFailure, safePlay } from "./playbackProgress";
import { createProgressQueueFlusher } from "./offlineProgressQueue";

describe("progress gate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => vi.useRealTimers());

  const playing = (token: object, positionMs: number) => ({
    engineStateToken: token,
    state: "playing",
    positionMs,
    durationMs: 3_600_000,
    nowMs: Date.now(),
  });

  it("heartbeats every ten seconds while playing", () => {
    const gate = createProgressGate();
    const a = {};
    expect(gate.plan(playing(a, 5000)).persist).toBe(true);
    gate.markWritten(Date.now());
    vi.advanceTimersByTime(5000);
    expect(gate.plan(playing({}, 10_000)).persist).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(gate.plan(playing({}, 15_000)).persist).toBe(true);
  });

  it("does not write the previous item's position after the media file changes", () => {
    const gate = createProgressGate();
    const oldState = {};
    gate.reset(oldState);
    // Same commit: engine still reports the old item as playing at 40 minutes.
    expect(gate.plan(playing(oldState, 2_400_000)).persist).toBe(false);
    // Re-runs for the same stale object stay blocked.
    vi.advanceTimersByTime(60_000);
    expect(gate.plan(playing(oldState, 2_400_000)).persist).toBe(false);
    // A fresh engine state for the new item is written.
    expect(gate.plan(playing({}, 3000)).persist).toBe(true);
  });

  it("never writes position 0", () => {
    const gate = createProgressGate();
    expect(gate.plan(playing({}, 0)).persist).toBe(false);
    const paused = { ...playing({}, 0), state: "paused" };
    expect(gate.plan(paused).persist).toBe(false);
  });

  it("flushes on pause and marks completion near the end", () => {
    const gate = createProgressGate();
    gate.plan(playing({}, 1000));
    const plan = gate.plan({ ...playing({}, 3_300_000), state: "paused" });
    expect(plan).toEqual({ persist: true, completed: true });
  });
});

describe("isPermanentProgressFailure", () => {
  it.each([
    [404, true],
    [400, true],
    [422, true],
    [401, false],
    [403, false],
    [408, false],
    [429, false],
    [500, false],
    [503, false],
  ])("status %i -> %s", (status, expected) => {
    expect(isPermanentProgressFailure({ status })).toBe(expected);
  });
  it("treats network errors as transient", () => {
    expect(isPermanentProgressFailure(new TypeError("Failed to fetch"))).toBe(false);
  });
});

describe("offline progress queue flusher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const item = (id: string) => ({ id, serverUrl: "https://s.example" });

  it("does not run two flushes at once", async () => {
    let release!: () => void;
    const send = vi.fn(
      () => new Promise<void>((resolve) => (release = resolve))
    );
    const flush = createProgressQueueFlusher({
      list: async () => [item("a")],
      send,
      remove: async () => undefined,
      serverUrl: "https://s.example",
      isCancelled: () => false,
    });
    const first = flush();
    const second = flush();
    await vi.advanceTimersByTimeAsync(15_000);
    release();
    await Promise.all([first, second]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("drops poison mutations and keeps transient failures", async () => {
    const removed: string[] = [];
    const flush = createProgressQueueFlusher({
      list: async () => [item("gone"), item("flaky"), item("ok")],
      send: async (m) => {
        if (m.id === "gone") throw { status: 404 };
        if (m.id === "flaky") throw { status: 503 };
      },
      remove: async (id) => {
        removed.push(id);
      },
      serverUrl: "https://s.example",
      isCancelled: () => false,
    });
    await flush();
    expect(removed).toEqual(["gone", "ok"]);
  });

  it("never rejects when storage fails", async () => {
    const flush = createProgressQueueFlusher({
      list: async () => {
        throw new Error("IndexedDB unavailable");
      },
      send: async () => undefined,
      remove: async () => undefined,
      serverUrl: "x",
      isCancelled: () => false,
    });
    await expect(flush()).resolves.toBeUndefined();
  });

  it("allows a new flush after the previous one finished", async () => {
    const list = vi.fn(async () => []);
    const flush = createProgressQueueFlusher({
      list,
      send: async () => undefined,
      remove: async () => undefined,
      serverUrl: "x",
      isCancelled: () => false,
    });
    await flush();
    await flush();
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe("safePlay", () => {
  it("swallows a rejected play() promise", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    safePlay(Promise.reject(new DOMException("interrupted", "AbortError")));
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
  it("accepts a missing engine", () => {
    expect(() => safePlay(undefined)).not.toThrow();
  });
});
