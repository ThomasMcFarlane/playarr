import { describe, expect, it } from "vitest";
import { easeOutCubic } from "./smoothScroll";

describe("easeOutCubic", () => {
  it("is anchored and monotonic", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(easeOutCubic(2)).toBe(1);
  });
});
