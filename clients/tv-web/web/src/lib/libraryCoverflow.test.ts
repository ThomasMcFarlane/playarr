import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { COVERFLOW_MOTION, coverflowPose, coverflowPosition } from "./libraryCoverflow";

const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");

describe("coverflowPose", () => {
  it("is flat and unfiltered at centre", () => {
    expect(coverflowPose(0)).toEqual({
      transform: "perspective(1000px) rotateY(0deg) translateX(0%) scale(1)",
      origin: "50% 50%",
      zIndex: 24,
    });
  });

  it("settles on the stylesheet's static poses (settled state is unchanged)", () => {
    const rows: Array<[number, number, number, number]> = [
      [-1, 48, 12, 0.88],
      [-2, 54, 15, 0.83],
      [-3, 58, 18, 0.79],
      [-4, 58, 18, 0.79],
    ];
    for (const [offset, rotate, shift, scale] of rows) {
      const before = coverflowPose(offset);
      expect(before.transform).toBe(`perspective(1000px) rotateY(${rotate}deg) translateX(${shift}%) scale(${scale})`);
      expect(before.origin).toBe("100% 50%");
      const after = coverflowPose(-offset);
      expect(after.transform).toBe(`perspective(1000px) rotateY(${-rotate}deg) translateX(${-shift}%) scale(${scale})`);
      expect(after.origin).toBe("0% 50%");
      // The same numbers are in global.css (the far poses and the neighbour classes).
      expect(css).toContain(`rotateY(${rotate}deg) translateX(${shift}%) scale(${scale})`);
      expect(css).toContain(`rotateY(${-rotate}deg) translateX(${-shift}%) scale(${scale})`);
    }
  });

  it("interpolates continuously between neighbours", () => {
    let last = coverflowPose(-1).transform;
    const seen = new Set<string>();
    for (let o = -1; o <= 0.0001; o += 0.05) {
      const t = coverflowPose(o).transform;
      seen.add(t);
      last = t;
    }
    expect(seen.size).toBeGreaterThan(15);
    expect(last).toBe(coverflowPose(0).transform);
  });

  it("keeps the depth order the classes had at rest", () => {
    expect([0, 1, 2, 3, 4].map((o) => coverflowPose(o).zIndex)).toEqual([24, 16, 12, 8, 4]);
  });
});

describe("coverflowPosition", () => {
  const geometry = { first: -26, pitch: 151, count: 40, maxScroll: 6000 };

  it("maps each card's resting scroll to its index", () => {
    expect(coverflowPosition(0, geometry)).toBe(0);
    expect(coverflowPosition(125, geometry)).toBeCloseTo(1, 6);
    expect(coverflowPosition(125 + 151 * 10, geometry)).toBeCloseTo(11, 6);
  });

  it("is linear between interior cards and clamped at the ends", () => {
    expect(coverflowPosition(125 + 75.5, geometry)).toBeCloseTo(1.5, 6);
    expect(coverflowPosition(-50, geometry)).toBe(0);
    expect(coverflowPosition(1e6, geometry)).toBe(39);
  });
});

describe("motion tokens", () => {
  it("is slower than the old 200-280 ms scroll yet calm, and shortens while held", () => {
    expect(COVERFLOW_MOTION.freshMs).toBeGreaterThanOrEqual(320);
    expect(COVERFLOW_MOTION.freshMs).toBeLessThanOrEqual(420);
    expect(COVERFLOW_MOTION.repeatMs).toBeLessThan(COVERFLOW_MOTION.retargetMs);
    expect(COVERFLOW_MOTION.retargetMs).toBeLessThan(COVERFLOW_MOTION.freshMs);
  });
});

describe("coverflowPosition snapping", () => {
  it("snaps to the card when the rounded scroll offset is within a pixel", () => {
    const geometry = { first: -26, pitch: 214.62, count: 40, maxScroll: 9000 };
    expect(coverflowPosition(188.3, geometry)).toBe(1);
    expect(coverflowPosition(188.3 + 50, geometry)).not.toBe(1);
  });
});
