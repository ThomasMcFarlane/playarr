import { describe, expect, it } from "vitest";
import {
  circularOffset,
  coverflowDepth,
  coverflowPosition,
  gridOffset,
  nextClientIndex,
} from "./coverflow";

describe("gridOffset", () => {
  it("arranges 11 items into a 4-4-3 pyramid, centred as a whole", () => {
    // 4 columns (ceil(sqrt(11))), 3 rows (ceil(11/4)).
    expect(gridOffset(0, 11)).toEqual({ x: -1.5, y: -1 });
    expect(gridOffset(3, 11)).toEqual({ x: 1.5, y: -1 });
    expect(gridOffset(4, 11)).toEqual({ x: -1.5, y: 0 });
    expect(gridOffset(7, 11)).toEqual({ x: 1.5, y: 0 });
  });

  it("centres an incomplete last row on its own, not left-aligned", () => {
    // Row 2 only has 3 items (indices 8-10) -- centred is -1, 0, 1, not the
    // ragged -1.5, -0.5, 0.5 a left-aligned row would give.
    expect(gridOffset(8, 11)).toEqual({ x: -1, y: 1 });
    expect(gridOffset(9, 11)).toEqual({ x: 0, y: 1 });
    expect(gridOffset(10, 11)).toEqual({ x: 1, y: 1 });
  });

  it("returns the origin for a non-positive total", () => {
    expect(gridOffset(0, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe("nextClientIndex", () => {
  it("steps forward and backward within the track", () => {
    expect(nextClientIndex(4, 1, 11)).toBe(5);
    expect(nextClientIndex(4, -1, 11)).toBe(3);
  });

  it("wraps from the last item to the first going forward", () => {
    expect(nextClientIndex(10, 1, 11)).toBe(0);
  });

  it("wraps from the first item to the last going backward", () => {
    expect(nextClientIndex(0, -1, 11)).toBe(10);
  });

  it("returns zero for a non-positive total", () => {
    expect(nextClientIndex(0, 1, 0)).toBe(0);
  });
});

describe("circularOffset", () => {
  it("is zero for the selected item itself", () => {
    expect(circularOffset(4, 4, 11)).toBe(0);
  });

  it("returns small positive offsets for items ahead of the selection", () => {
    expect(circularOffset(5, 4, 11)).toBe(1);
    expect(circularOffset(6, 4, 11)).toBe(2);
  });

  it("returns small negative offsets for items behind the selection", () => {
    expect(circularOffset(3, 4, 11)).toBe(-1);
    expect(circularOffset(2, 4, 11)).toBe(-2);
  });

  it("wraps forward past the end of the track", () => {
    // 11 items, index 0..10. Selecting the last item (10), the first item
    // (0) is one step further round, not ten steps back.
    expect(circularOffset(0, 10, 11)).toBe(1);
  });

  it("wraps backward past the start of the track", () => {
    // Selecting the first item (0), the last item (10) is one step behind,
    // not ten steps ahead.
    expect(circularOffset(10, 0, 11)).toBe(-1);
  });

  it("picks the shorter side for items roughly opposite the selection", () => {
    // 11 items: index 9 is 5 away going forward, 6 the other way -- the
    // signed shortest path is +5, not -6.
    expect(circularOffset(9, 4, 11)).toBe(5);
  });

  it("breaks an exact half-track tie towards the positive side", () => {
    // 10 items: index 5 is exactly 5 away from index 0 in both directions.
    expect(circularOffset(5, 0, 10)).toBe(5);
  });

  it("returns zero for a non-positive total", () => {
    expect(circularOffset(0, 0, 0)).toBe(0);
  });
});

describe("coverflowPosition", () => {
  it("is zero at centre", () => {
    expect(coverflowPosition(0)).toBe(0);
  });

  it("gives the nearest neighbour a full step, mirrored either side", () => {
    expect(coverflowPosition(1)).toBe(1);
    expect(coverflowPosition(-1)).toBe(-1);
  });

  it("is symmetric for every magnitude, not just the nearest neighbour", () => {
    expect(coverflowPosition(2)).toBe(-coverflowPosition(-2));
    expect(coverflowPosition(5)).toBe(-coverflowPosition(-5));
  });

  it("keeps growing further from centre", () => {
    expect(coverflowPosition(2)).toBeGreaterThan(coverflowPosition(1));
    expect(coverflowPosition(3)).toBeGreaterThan(coverflowPosition(2));
    expect(coverflowPosition(4)).toBeGreaterThan(coverflowPosition(3));
  });

  it("packs distant tiles into a tighter stack than nearby ones -- each step out adds less than the last", () => {
    const nearStep = coverflowPosition(2) - coverflowPosition(1);
    const farStep = coverflowPosition(5) - coverflowPosition(4);

    expect(farStep).toBeLessThan(nearStep);
  });

  it("converges instead of spreading out forever", () => {
    expect(coverflowPosition(20) - coverflowPosition(19)).toBeLessThan(0.01);
  });
});

describe("coverflowDepth", () => {
  it("is on top at the centre, and clearly bigger than even its nearest neighbour", () => {
    expect(coverflowDepth(0).zIndex).toBe(50);
    expect(coverflowDepth(0).scale).toBeGreaterThan(coverflowDepth(1).scale);
    // Not just the top of the same shrink curve the neighbours sit on --
    // a deliberate step up of its own.
    expect(coverflowDepth(0).scale).toBeGreaterThan(1);
  });

  it("shrinks and recedes with distance from centre, symmetrically", () => {
    expect(coverflowDepth(1)).toEqual(coverflowDepth(-1));
    expect(coverflowDepth(2)).toEqual(coverflowDepth(-2));
    expect(coverflowDepth(1).scale).toBeGreaterThan(coverflowDepth(2).scale);
    expect(coverflowDepth(1).zIndex).toBeGreaterThan(coverflowDepth(2).zIndex);
  });

  it("never shrinks below a legible floor, no matter how far from centre", () => {
    expect(coverflowDepth(5).scale).toBeGreaterThan(0);
    expect(coverflowDepth(50).scale).toBeGreaterThan(0);
    expect(coverflowDepth(50).scale).toBe(coverflowDepth(5).scale);
  });

  it("never goes below a z-index of zero", () => {
    expect(coverflowDepth(50).zIndex).toBe(0);
  });
});
