import { describe, expect, it } from "vitest";
import { horizontalSwipeStep } from "./touchGestures";

describe("horizontalSwipeStep", () => {
  it("moves forwards for a left swipe and backwards for a right swipe", () => {
    expect(horizontalSwipeStep({ x: 120, y: 50 }, { x: 60, y: 54 })).toBe(1);
    expect(horizontalSwipeStep({ x: 60, y: 50 }, { x: 120, y: 46 })).toBe(-1);
  });

  it("releases vertical and short gestures to native scrolling and taps", () => {
    expect(horizontalSwipeStep({ x: 80, y: 40 }, { x: 90, y: 120 })).toBe(0);
    expect(horizontalSwipeStep({ x: 80, y: 40 }, { x: 105, y: 42 })).toBe(0);
  });
});
