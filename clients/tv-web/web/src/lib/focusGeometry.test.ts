import { describe, expect, it } from "vitest";
import {
  detectEqualRowColumns,
  focusCentre,
  hasHorizontalNeighbourToRight,
  isRoughlyForward,
  pickBestDirectionalTarget,
  scoreDirectionalCandidate,
  libraryExpandMountedEnd,
  libraryGridWindow,
  libraryWindowContains,
  titleGridNeighbourIndex,
  type FocusRect,
} from "./focusGeometry";

function rect(
  left: number,
  top: number,
  width: number,
  height: number
): FocusRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

describe("scoreDirectionalCandidate", () => {
  it("prefers the nearest forward neighbour on the same row", () => {
    const from = rect(100, 100, 80, 120);
    const nearRight = rect(200, 100, 80, 120);
    const farRight = rect(400, 100, 80, 120);
    const nearScore = scoreDirectionalCandidate(from, nearRight, "right");
    const farScore = scoreDirectionalCandidate(from, farRight, "right");
    expect(nearScore).not.toBeNull();
    expect(farScore).not.toBeNull();
    expect(nearScore!).toBeLessThan(farScore!);
  });

  it("rejects candidates outside the directional cone", () => {
    const from = rect(100, 100, 80, 120);
    const diagonal = rect(500, 140, 80, 120);
    expect(scoreDirectionalCandidate(from, diagonal, "down")).toBeNull();
  });

  it("rejects targets that are not forward", () => {
    const from = rect(100, 100, 80, 120);
    const above = rect(100, 0, 80, 120);
    expect(scoreDirectionalCandidate(from, above, "down")).toBeNull();
  });
});

describe("pickBestDirectionalTarget", () => {
  it("returns the lowest-scoring forward candidate without sorting the rest", () => {
    const from = rect(0, 0, 100, 100);
    const candidates = [
      { item: "far", rect: rect(0, 600, 100, 100) },
      { item: "near", rect: rect(0, 150, 100, 100) },
      { item: "mid", rect: rect(0, 300, 100, 100) },
      { item: "side", rect: rect(800, 160, 100, 100) },
    ];
    expect(pickBestDirectionalTarget(from, candidates, "down")).toBe("near");
  });

  it("scales to dense 4K-style grids without changing geometric winners", () => {
    // 24 columns × 30 rows ≈ 720 cards (dense library under 4K).
    const columns = 24;
    const rows = 30;
    const cardW = 160;
    const cardH = 220;
    const gap = 16;
    const fromCol = 5;
    const fromRow = 8;
    const from = rect(
      fromCol * (cardW + gap),
      fromRow * (cardH + gap),
      cardW,
      cardH
    );

    const candidates: { item: string; rect: FocusRect }[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < columns; col += 1) {
        if (row === fromRow && col === fromCol) continue;
        candidates.push({
          item: `${row}:${col}`,
          rect: rect(col * (cardW + gap), row * (cardH + gap), cardW, cardH),
        });
      }
    }

    const started = performance.now();
    const down = pickBestDirectionalTarget(from, candidates, "down");
    const right = pickBestDirectionalTarget(from, candidates, "right");
    const up = pickBestDirectionalTarget(from, candidates, "up");
    const left = pickBestDirectionalTarget(from, candidates, "left");
    const elapsed = performance.now() - started;

    expect(down).toBe(`${fromRow + 1}:${fromCol}`);
    expect(right).toBe(`${fromRow}:${fromCol + 1}`);
    expect(up).toBe(`${fromRow - 1}:${fromCol}`);
    expect(left).toBe(`${fromRow}:${fromCol - 1}`);
    // Pure scoring of ~720 candidates four ways must stay well under a frame
    // even without browser layout. 16ms is a soft budget for unit CI.
    expect(elapsed).toBeLessThan(16);
  });
});

describe("isRoughlyForward / hasHorizontalNeighbourToRight", () => {
  it("matches the dead-zone used by scoring", () => {
    const a = focusCentre(rect(0, 0, 100, 100));
    const slightlyDown = focusCentre(rect(0, 1, 100, 100));
    expect(isRoughlyForward(a, slightlyDown, "down")).toBe(false);
    const clearlyDown = focusCentre(rect(0, 20, 100, 100));
    expect(isRoughlyForward(a, clearlyDown, "down")).toBe(true);
  });

  it("detects a same-row neighbour to the right", () => {
    const from = rect(0, 0, 100, 100);
    const sameRow = rect(120, 10, 100, 100);
    const nextRow = rect(0, 140, 100, 100);
    expect(hasHorizontalNeighbourToRight(from, [sameRow, nextRow])).toBe(true);
    expect(hasHorizontalNeighbourToRight(from, [nextRow])).toBe(false);
  });
});

describe("title grid index navigation", () => {
  it("detects columns from equal row tops", () => {
    expect(detectEqualRowColumns([0, 0, 0, 0, 120, 120])).toBe(4);
    expect(detectEqualRowColumns([0])).toBe(1);
  });

  it("steps within a dense row-major grid without leaving edges", () => {
    // 4 columns × 3 rows
    const columns = 4;
    const length = 12;
    expect(titleGridNeighbourIndex(5, length, columns, "left")).toBe(4);
    expect(titleGridNeighbourIndex(5, length, columns, "right")).toBe(6);
    expect(titleGridNeighbourIndex(5, length, columns, "up")).toBe(1);
    expect(titleGridNeighbourIndex(5, length, columns, "down")).toBe(9);
    expect(titleGridNeighbourIndex(4, length, columns, "left")).toBeNull();
    expect(titleGridNeighbourIndex(7, length, columns, "right")).toBeNull();
    expect(titleGridNeighbourIndex(2, length, columns, "up")).toBeNull();
    // Incomplete last row: down from row 1 col 3 lands on final card
    expect(titleGridNeighbourIndex(7, 10, columns, "down")).toBe(9);
  });

  it("derives a stable library window from a single anchor index", () => {
    expect(libraryGridWindow(0, 0, 5)).toEqual({ start: 0, end: 0 });
    // defaults: behind 2, ahead 12, min 6 rows → end max(61, 30) = 61
    expect(libraryGridWindow(0, 200, 5)).toEqual({ start: 0, end: 61 });
    expect(libraryGridWindow(50, 200, 5).start).toBe(40);
    expect(libraryGridWindow(50, 200, 5).end).toBe(111);
    expect(libraryWindowContains({ start: 0, end: 48 }, 47)).toBe(true);
    expect(libraryWindowContains({ start: 0, end: 48 }, 48)).toBe(false);
  });

  it("expands mounted end only when focus leaves the prefix", () => {
    expect(libraryExpandMountedEnd(40, 20, 200, 5)).toBe(40);
    expect(libraryExpandMountedEnd(40, 40, 200, 5)).toBe(111);
    expect(libraryExpandMountedEnd(40, 190, 200, 5)).toBe(200);
  });
});
