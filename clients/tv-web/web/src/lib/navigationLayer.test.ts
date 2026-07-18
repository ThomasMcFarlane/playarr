import { afterEach, describe, expect, it, vi } from "vitest";
import { maintainNavigationScrollRestore } from "./navigationLayer";

interface AnimationHarness {
  listeners: Map<string, EventListener>;
  pendingFrames: Map<number, FrameRequestCallback>;
  runNextFrame: (timestamp: number) => void;
}

function installAnimationHarness(activeElement: HTMLElement): AnimationHarness {
  const listeners = new Map<string, EventListener>();
  const pendingFrames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;

  vi.stubGlobal("document", { activeElement });
  vi.stubGlobal("window", {
    requestAnimationFrame(callback: FrameRequestCallback) {
      const id = nextFrame++;
      pendingFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id: number) {
      pendingFrames.delete(id);
    },
    addEventListener(name: string, listener: EventListener) {
      listeners.set(name, listener);
    },
    removeEventListener(name: string, listener: EventListener) {
      if (listeners.get(name) === listener) listeners.delete(name);
    },
  });

  return {
    listeners,
    pendingFrames,
    runNextFrame(timestamp) {
      const entry = pendingFrames.entries().next().value as
        | [number, FrameRequestCallback]
        | undefined;
      if (!entry) throw new Error("No animation frame is pending");
      pendingFrames.delete(entry[0]);
      entry[1](timestamp);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("maintainNavigationScrollRestore", () => {
  it("reasserts the captured position through the settling window", () => {
    const focusTarget = {} as HTMLElement;
    const harness = installAnimationHarness(focusTarget);
    const applyScroll = vi.fn();

    maintainNavigationScrollRestore(applyScroll, focusTarget, 32);
    harness.runNextFrame(0);
    harness.runNextFrame(16);
    harness.runNextFrame(32);

    expect(applyScroll).toHaveBeenCalledTimes(3);
    expect(harness.pendingFrames).toHaveLength(0);
    expect(harness.listeners).toHaveLength(0);
  });

  it("stops restoring as soon as focus moves elsewhere", () => {
    const focusTarget = {} as HTMLElement;
    const harness = installAnimationHarness(focusTarget);
    const applyScroll = vi.fn();

    maintainNavigationScrollRestore(applyScroll, focusTarget);
    harness.runNextFrame(0);
    (document as unknown as { activeElement: HTMLElement }).activeElement =
      {} as HTMLElement;
    harness.runNextFrame(16);

    expect(applyScroll).toHaveBeenCalledOnce();
    expect(harness.pendingFrames).toHaveLength(0);
    expect(harness.listeners).toHaveLength(0);
  });

  it("stops restoring when the viewer provides input", () => {
    const focusTarget = {} as HTMLElement;
    const harness = installAnimationHarness(focusTarget);
    const applyScroll = vi.fn();

    maintainNavigationScrollRestore(applyScroll, focusTarget);
    harness.runNextFrame(0);
    harness.listeners.get("keydown")?.({} as Event);

    expect(applyScroll).toHaveBeenCalledOnce();
    expect(harness.pendingFrames).toHaveLength(0);
    expect(harness.listeners).toHaveLength(0);
  });
});
