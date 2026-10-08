import { afterEach, describe, expect, it, vi } from "vitest";
import { registerPageBack, runPageBack } from "./pageBack";

describe("page back handler", () => {
  afterEach(() => {
    registerPageBack(null)?.();
  });

  it("returns false with nothing registered", () => {
    expect(runPageBack()).toBe(false);
  });

  it("runs the registered handler and reports it handled", () => {
    const handler = vi.fn(() => true);
    registerPageBack(handler);
    expect(runPageBack()).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("lets the default route run when the handler declines", () => {
    registerPageBack(() => false);
    expect(runPageBack()).toBe(false);
  });

  it("unregisters only its own handler", () => {
    const first = registerPageBack(() => true);
    const second = registerPageBack(() => false);
    first?.();
    expect(runPageBack()).toBe(false);
    second?.();
    expect(runPageBack()).toBe(false);
  });
});
