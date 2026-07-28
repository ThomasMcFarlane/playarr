import { describe, expect, it, vi } from "vitest";
import type { PlaybackEventKind } from "@playarr-tv/api-client";
import { ProgressReporter, type ProgressReporterClient } from "./progress";

/** A hand-rolled fake interval timer: records scheduled callbacks and lets the test fire them manually. */
function makeFakeIntervalScheduler() {
  let nextHandle = 1;
  const scheduled = new Map<number, { handler: () => void; intervalMs: number }>();
  return {
    setIntervalFn: vi.fn((handler: () => void, intervalMs: number) => {
      const handle = nextHandle++;
      scheduled.set(handle, { handler, intervalMs });
      return handle as unknown as ReturnType<typeof setInterval>;
    }),
    clearIntervalFn: vi.fn((handle: ReturnType<typeof setInterval>) => {
      scheduled.delete(handle as unknown as number);
    }),
    fire(times = 1): void {
      for (let i = 0; i < times; i++) {
        for (const { handler } of scheduled.values()) handler();
      }
    },
    activeCount(): number {
      return scheduled.size;
    },
  };
}

function makeFakeClient(): { client: ProgressReporterClient; recordPlaybackEvent: ReturnType<typeof vi.fn> } {
  const recordPlaybackEvent = vi.fn(async (_sessionId: string, _event: PlaybackEventKind) => undefined);
  return { client: { recordPlaybackEvent }, recordPlaybackEvent };
}

describe("ProgressReporter position math", () => {
  it("positionMs is always engineTimeMs + sourceOffsetMs, never raw engine time", () => {
    const { client } = makeFakeClient();
    const reporter = new ProgressReporter(client);
    reporter.setSession("session-1", 30_000);
    reporter.setEngineTimeMs(5_000);
    expect(reporter.positionMs).toBe(35_000);
  });

  it("clamps to a non-negative, rounded integer", () => {
    const { client } = makeFakeClient();
    const reporter = new ProgressReporter(client);
    reporter.setSession("session-1", -10);
    reporter.setEngineTimeMs(2.4);
    expect(reporter.positionMs).toBe(0);

    reporter.setSession("session-1", 100.6);
    reporter.setEngineTimeMs(0.5);
    expect(reporter.positionMs).toBe(101);
  });

  it("defaults to position 0 before any session is set", () => {
    const { client } = makeFakeClient();
    const reporter = new ProgressReporter(client);
    expect(reporter.positionMs).toBe(0);
    expect(reporter.activeSessionId).toBeNull();
  });
});

describe("ProgressReporter heartbeat", () => {
  it("starts a heartbeat on 'playing' and 'buffering', and it reports position", async () => {
    const { client, recordPlaybackEvent } = makeFakeClient();
    const scheduler = makeFakeIntervalScheduler();
    const reporter = new ProgressReporter(client, { heartbeatIntervalMs: 10_000, ...scheduler });
    reporter.setSession("session-1", 1_000);
    reporter.setEngineTimeMs(2_000);

    reporter.onStateChange("playing");
    expect(scheduler.setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 10_000);
    expect(scheduler.activeCount()).toBe(1);

    scheduler.fire();
    await Promise.resolve();
    await Promise.resolve();

    expect(recordPlaybackEvent).toHaveBeenCalledWith("session-1", {
      kind: "heartbeat",
      position_ms: 3_000,
    });
  });

  it("does not start a second heartbeat if already running", () => {
    const { client } = makeFakeClient();
    const scheduler = makeFakeIntervalScheduler();
    const reporter = new ProgressReporter(client, scheduler);
    reporter.onStateChange("playing");
    reporter.onStateChange("buffering");
    expect(scheduler.setIntervalFn).toHaveBeenCalledTimes(1);
  });

  it("stops the heartbeat on paused/idle", () => {
    const { client } = makeFakeClient();
    const scheduler = makeFakeIntervalScheduler();
    const reporter = new ProgressReporter(client, scheduler);
    reporter.onStateChange("playing");
    expect(scheduler.activeCount()).toBe(1);

    reporter.onStateChange("paused");
    expect(scheduler.clearIntervalFn).toHaveBeenCalledTimes(1);
    expect(scheduler.activeCount()).toBe(0);
  });

  it("a failing heartbeat request never throws", async () => {
    const recordPlaybackEvent = vi.fn(async () => {
      throw new Error("network error");
    });
    const scheduler = makeFakeIntervalScheduler();
    const reporter = new ProgressReporter({ recordPlaybackEvent }, scheduler);
    reporter.setSession("session-1", 0);
    reporter.onStateChange("playing");

    scheduler.fire();
    await Promise.resolve();
    await Promise.resolve();

    expect(recordPlaybackEvent).toHaveBeenCalledTimes(1);
  });

  it("a heartbeat with no active session is a no-op", async () => {
    const { client, recordPlaybackEvent } = makeFakeClient();
    const scheduler = makeFakeIntervalScheduler();
    const reporter = new ProgressReporter(client, scheduler);
    reporter.onStateChange("playing");

    scheduler.fire();
    await Promise.resolve();

    expect(recordPlaybackEvent).not.toHaveBeenCalled();
  });
});

describe("ProgressReporter terminal flush", () => {
  it("flushes a 'stop'/'completed' event on ended, and stops the heartbeat", () => {
    const { client, recordPlaybackEvent } = makeFakeClient();
    const scheduler = makeFakeIntervalScheduler();
    const reporter = new ProgressReporter(client, scheduler);
    reporter.setSession("session-1", 10_000);
    reporter.setEngineTimeMs(50_000);
    reporter.onStateChange("playing");

    reporter.onStateChange("ended");

    expect(recordPlaybackEvent).toHaveBeenCalledWith("session-1", {
      kind: "stop",
      reason: "completed",
      position_ms: 60_000,
    });
    expect(scheduler.activeCount()).toBe(0);
  });

  it("flushes an 'error' event on error", () => {
    const { client, recordPlaybackEvent } = makeFakeClient();
    const reporter = new ProgressReporter(client);
    reporter.setSession("session-1", 0);

    reporter.onStateChange("error");

    expect(recordPlaybackEvent).toHaveBeenCalledWith("session-1", {
      kind: "error",
      message: "Player entered a terminal error state",
    });
  });

  it("deduplicates terminal flushes per session id -- a flush never double-fires", async () => {
    const { client, recordPlaybackEvent } = makeFakeClient();
    const reporter = new ProgressReporter(client);
    reporter.setSession("session-1", 0);
    reporter.setEngineTimeMs(1_000);

    await reporter.flushTerminal({ kind: "stop", reason: "completed" });
    await reporter.flushTerminal({ kind: "stop", reason: "completed" });
    reporter.onStateChange("ended");
    reporter.onStateChange("error");

    expect(recordPlaybackEvent).toHaveBeenCalledTimes(1);
  });

  it("a second, different session's terminal flush is not suppressed by the first", async () => {
    const { client, recordPlaybackEvent } = makeFakeClient();
    const reporter = new ProgressReporter(client);

    reporter.setSession("session-1", 0);
    await reporter.flushTerminal({ kind: "stop", reason: "completed" });

    reporter.setSession("session-2", 0);
    await reporter.flushTerminal({ kind: "stop", reason: "user_stopped" });

    expect(recordPlaybackEvent).toHaveBeenCalledTimes(2);
    expect(recordPlaybackEvent).toHaveBeenNthCalledWith(2, "session-2", {
      kind: "stop",
      reason: "user_stopped",
      position_ms: 0,
    });
  });

  it("flushTerminal without any active session is a no-op", async () => {
    const { client, recordPlaybackEvent } = makeFakeClient();
    const reporter = new ProgressReporter(client);
    await reporter.flushTerminal({ kind: "stop", reason: "user_stopped" });
    expect(recordPlaybackEvent).not.toHaveBeenCalled();
  });
});

describe("ProgressReporter dispose", () => {
  it("stops any running heartbeat", () => {
    const { client } = makeFakeClient();
    const scheduler = makeFakeIntervalScheduler();
    const reporter = new ProgressReporter(client, scheduler);
    reporter.onStateChange("playing");
    reporter.dispose();
    expect(scheduler.activeCount()).toBe(0);
  });
});
