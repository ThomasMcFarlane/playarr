import { describe, expect, it } from "vitest";
import { byDistance, gridNeighbours, railNeighbours, railsByDistance } from "./detailNeighbours";

const list = (n: number, prefix = "w") => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));

describe("gridNeighbours", () => {
  it("takes three either side on the row, then the rows above and below, nearest first", () => {
    const ids = gridNeighbours(list(30), 12, 6);
    // Row 2 holds w12..w17; the focus is column 0.
    expect(ids[0]).toBe("w13");
    expect(ids.slice(0, 5)).toContain("w14");
    expect(ids).toContain("w6");
    expect(ids).toContain("w18");
    expect(ids).not.toContain("w12");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("stays inside the grid at the edges and for short lists", () => {
    expect(gridNeighbours(list(2), 0, 5)).toEqual(["w1"]);
    expect(gridNeighbours(list(10), 9, 5).every((id) => id.startsWith("w"))).toBe(true);
  });

  it("returns nothing for an empty list", () => {
    expect(gridNeighbours([], 0, 4)).toEqual([]);
  });
});

describe("railNeighbours", () => {
  const rails = [
    { id: "r0", items: list(12, "a") },
    { id: "r1", items: list(12, "b") },
    { id: "r2", items: list(12, "c") },
  ];

  it("prefetches three either side, then the visible cards of the rails above and below", () => {
    const ids = railNeighbours(rails, "r1", "b5", { visible: 4 });
    expect(ids.slice(0, 6)).toEqual(["b6", "b4", "b7", "b3", "b8", "b2"]);
    expect(ids.filter((id) => id.startsWith("c"))).toHaveLength(4);
    expect(ids.filter((id) => id.startsWith("a"))).toHaveLength(4);
    expect(ids).not.toContain("b5");
  });

  it("copes with the first and last rail and unknown ids", () => {
    expect(railNeighbours(rails, "r0", "a0", { visible: 2 }).filter((id) => id.startsWith("a"))).toEqual(["a1", "a2", "a3"]);
    expect(railNeighbours(rails, "nope", "a0")).toEqual([]);
    expect(railNeighbours(rails, "r0", "nope")).toEqual([]);
  });
});

describe("warm-up order", () => {
  it("orders a list by distance from the focus", () => {
    expect(byDistance(list(5), 2).slice(0, 3)).toEqual(["w2", "w1", "w3"]);
  });

  it("starts with the focused rail and spreads outwards, never repeating the focused item", () => {
    const rails = [
      { id: "r0", items: list(3, "a") },
      { id: "r1", items: list(3, "b") },
      { id: "r2", items: list(3, "c") },
    ];
    const ids = railsByDistance(rails, "r1", "b1");
    expect(ids[0]).toBe("b0");
    expect(ids).not.toContain("b1");
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
  });
});
