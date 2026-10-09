import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRefreshRetry } from "./refreshRetry";

describe("createRefreshRetry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("retries a failed refresh with growing delays, then stops", async () => {
    const run = vi.fn().mockRejectedValue(new Error("offline"));
    createRefreshRetry(run, [100, 200]).start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(run).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("stops retrying after a success", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    createRefreshRetry(run, [100, 200]).start();
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("a newer refresh replaces the pending retry chain", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const retry = createRefreshRetry(run, [100]);
    retry.start();
    await vi.advanceTimersByTimeAsync(0);
    retry.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("cancel drops a pending retry", async () => {
    const run = vi.fn().mockRejectedValue(new Error("offline"));
    const retry = createRefreshRetry(run, [100]);
    retry.start();
    await vi.advanceTimersByTimeAsync(0);
    retry.cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
