import { describe, expect, it } from "vitest";
import { createDoubleTapDetector } from "./doubleTapSeek";

describe("createDoubleTapDetector", () => {
  it("seeks back on a double tap on the left half and forward on the right", () => {
    const d = createDoubleTapDetector();
    expect(d.tap(50, 400, 0)).toBeNull();
    expect(d.tap(60, 400, 150)).toBe("backward");
    expect(d.tap(300, 400, 1000)).toBeNull();
    expect(d.tap(310, 400, 1100)).toBe("forward");
  });

  it("ignores taps outside the window or on different halves", () => {
    const d = createDoubleTapDetector();
    expect(d.tap(50, 400, 0)).toBeNull();
    expect(d.tap(60, 400, 500)).toBeNull();
    expect(d.tap(300, 400, 600)).toBeNull();
  });

  it("a triple tap is one double tap then a fresh first tap", () => {
    const d = createDoubleTapDetector();
    d.tap(50, 400, 0);
    expect(d.tap(50, 400, 100)).toBe("backward");
    expect(d.tap(50, 400, 200)).toBeNull();
  });
});
