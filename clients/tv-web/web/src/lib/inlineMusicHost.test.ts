import { afterEach, describe, expect, it, vi } from "vitest";
import { watchInlineMusicHost } from "./inlineMusicHost";

const originalDocument = globalThis.document;
const originalMutationObserver = globalThis.MutationObserver;

afterEach(() => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: originalDocument,
  });
  Object.defineProperty(globalThis, "MutationObserver", {
    configurable: true,
    value: originalMutationObserver,
  });
});

describe("watchInlineMusicHost", () => {
  it("moves restored playback into a host that mounts after the player", () => {
    let host: HTMLElement | null = null;
    const mutationCallbacks: MutationCallback[] = [];
    const observe = vi.fn();
    const disconnect = vi.fn();
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const onHostChange = vi.fn();

    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        body: {},
        getElementById: vi.fn(() => host),
      },
    });
    Object.defineProperty(globalThis, "MutationObserver", {
      configurable: true,
      value: class {
        constructor(callback: MutationCallback) {
          mutationCallbacks.push(callback);
        }

        observe = observe;
        disconnect = disconnect;
      },
    });

    const stopWatching = watchInlineMusicHost(
      {
        matches: true,
        addEventListener,
        removeEventListener,
      } as unknown as MediaQueryList,
      onHostChange
    );

    expect(onHostChange).toHaveBeenLastCalledWith(null);
    host = {} as HTMLElement;
    mutationCallbacks[0]?.([], {} as MutationObserver);
    expect(onHostChange).toHaveBeenLastCalledWith(host);

    stopWatching();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });
});
