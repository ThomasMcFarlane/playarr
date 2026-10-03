import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NAVIGATION_QUIET_MS,
  isNavigating,
  noteNavigationKey,
  whenNavigationIdle,
} from "./navigationActivity";

describe("navigationActivity", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
    vi.setSystemTime(1_000_000);
    // Let any previous test's key age out.
    vi.advanceTimersByTime(10 * NAVIGATION_QUIET_MS);
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it("runs work immediately when the user is not navigating", () => {
    const job = vi.fn();
    whenNavigationIdle(job);
    expect(job).toHaveBeenCalledTimes(1);
  });

  it("defers work while keys are arriving and runs it after the quiet period", () => {
    const job = vi.fn();
    noteNavigationKey();
    expect(isNavigating()).toBe(true);
    whenNavigationIdle(job);
    expect(job).not.toHaveBeenCalled();

    // Keys keep arriving: still deferred.
    vi.advanceTimersByTime(NAVIGATION_QUIET_MS - 10);
    noteNavigationKey();
    vi.advanceTimersByTime(NAVIGATION_QUIET_MS - 10);
    expect(job).not.toHaveBeenCalled();

    vi.advanceTimersByTime(NAVIGATION_QUIET_MS + 50);
    expect(job).toHaveBeenCalledTimes(1);
    expect(isNavigating()).toBe(false);
  });

  it("starts one deferred job per task so a backlog never forms one long task", () => {
    noteNavigationKey();
    const jobs = Array.from({ length: 6 }, () => vi.fn());
    for (const job of jobs) whenNavigationIdle(job);

    const started = () => jobs.filter((job) => job.mock.calls.length > 0).length;
    vi.advanceTimersToNextTimer();
    expect(started()).toBe(1);
    vi.advanceTimersToNextTimer();
    expect(started()).toBe(2);
    for (let i = 0; i < 4; i += 1) vi.advanceTimersToNextTimer();
    expect(jobs.every((job) => job.mock.calls.length === 1)).toBe(true);
  });

  it("does not run cancelled work", () => {
    noteNavigationKey();
    const job = vi.fn();
    const cancel = whenNavigationIdle(job);
    cancel();
    vi.advanceTimersByTime(5 * NAVIGATION_QUIET_MS);
    expect(job).not.toHaveBeenCalled();
  });

  it("keeps deferring while the browser reports input waiting to be delivered", () => {
    let pending = true;
    vi.stubGlobal("navigator", { scheduling: { isInputPending: () => pending } });
    try {
      const job = vi.fn();
      whenNavigationIdle(job);
      expect(job).not.toHaveBeenCalled();
      vi.advanceTimersByTime(4 * NAVIGATION_QUIET_MS);
      expect(job).not.toHaveBeenCalled();
      pending = false;
      vi.advanceTimersByTime(NAVIGATION_QUIET_MS);
      expect(job).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps FIFO order for deferred work", () => {
    noteNavigationKey();
    const order: number[] = [];
    whenNavigationIdle(() => order.push(1));
    whenNavigationIdle(() => order.push(2));
    vi.advanceTimersByTime(NAVIGATION_QUIET_MS + 5);
    expect(order).toEqual([1, 2]);
  });
});
