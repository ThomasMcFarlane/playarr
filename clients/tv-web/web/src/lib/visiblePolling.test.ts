import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startVisiblePolling } from "./visiblePolling";

function fakeDocument(initial: "visible" | "hidden") {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: initial as DocumentVisibilityState,
    addEventListener: (_type: string, listener: () => void) => void listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => void listeners.delete(listener),
  };
  return {
    doc,
    set(state: "visible" | "hidden") {
      doc.visibilityState = state;
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
}

describe("startVisiblePolling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs at once and then on every interval while visible", async () => {
    const run = vi.fn(async () => undefined);
    const { doc } = fakeDocument("visible");
    const stop = startVisiblePolling(run, 1_000, doc as never);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(run).toHaveBeenCalledTimes(3);
    stop();
  });

  it("pauses while hidden and catches up when the page is visible again", async () => {
    const run = vi.fn(async () => undefined);
    const page = fakeDocument("hidden");
    const stop = startVisiblePolling(run, 1_000, page.doc as never);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run).not.toHaveBeenCalled();
    page.set("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    stop();
  });

  it("never starts a run while the previous one is still in flight", async () => {
    let release: () => void = () => undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const { doc } = fakeDocument("visible");
    const stop = startVisiblePolling(run, 1_000, doc as never);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stops the timer and the visibility listener", async () => {
    const run = vi.fn(async () => undefined);
    const page = fakeDocument("visible");
    const stop = startVisiblePolling(run, 1_000, page.doc as never);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    expect(page.listenerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("survives a failing run", async () => {
    const run = vi.fn(async () => {
      throw new Error("offline");
    });
    const { doc } = fakeDocument("visible");
    const stop = startVisiblePolling(run, 1_000, doc as never);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
    stop();
  });
});
