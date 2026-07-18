import { describe, expect, it } from "vitest";
import { horizontalDragOffset, horizontalSwipeStep } from "./touchGestures";

describe("horizontalDragOffset", () => {
  it("starts a bounded live drag for a deliberate horizontal gesture", () => {
    expect(horizontalDragOffset({ x: 120, y: 50 }, { x: 94, y: 54 })).toBe(-26);
    expect(horizontalDragOffset({ x: 120, y: 50 }, { x: -40, y: 54 })).toBe(-96);
  });

  it("releases vertical movement and initial touch jitter", () => {
    expect(horizontalDragOffset({ x: 80, y: 40 }, { x: 86, y: 42 })).toBeNull();
    expect(horizontalDragOffset({ x: 80, y: 40 }, { x: 92, y: 90 })).toBeNull();
  });
});

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
