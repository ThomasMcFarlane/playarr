import { describe, expect, it } from "vitest";
import { findClosestItemInNextTrack, pickNearestCardByCentre } from "./trackNavigation";

describe("findClosestItemInNextTrack", () => {
  it("selects the closest item in the next track when none is directly below", () => {
    const target = findClosestItemInNextTrack(
      [
        [{ value: "current", centreX: 980 }],
        [
          { value: "first", centreX: 120 },
          { value: "middle", centreX: 340 },
          { value: "last", centreX: 560 },
        ],
      ],
      0,
      980,
      "down"
    );

    expect(target).toBe("last");
  });

  it("moves up by track order and skips empty tracks", () => {
    const target = findClosestItemInNextTrack(
      [
        [
          { value: "left", centreX: 140 },
          { value: "right", centreX: 620 },
        ],
        [],
        [{ value: "current", centreX: 570 }],
      ],
      2,
      570,
      "up"
    );

    expect(target).toBe("right");
  });

  it("stops at the first and last populated tracks", () => {
    const tracks = [
      [{ value: "first", centreX: 140 }],
      [],
      [{ value: "last", centreX: 570 }],
    ];

    expect(findClosestItemInNextTrack(tracks, 0, 140, "up")).toBeUndefined();
    expect(findClosestItemInNextTrack(tracks, 2, 570, "down")).toBeUndefined();
  });
});

const rail = (lefts: number[], width = 100) =>
  lefts.map((left, value) => ({ value, left, right: left + width }));

describe("pickNearestCardByCentre", () => {
  it("picks the card whose centre is closest, not the same index", () => {
    // Rail scrolled so card 0 starts off screen at -900; viewport 0..1000.
    const cards = rail([-900, -780, -660, -540, -420, -300, -180, -60, 60, 180, 300, 420, 540, 660, 780, 900]);
    // Previous focus centred at x=930 -> card 15 (index 15 centre 950) is nearest.
    expect(pickNearestCardByCentre(cards, 930, 0, 1000)).toBe(15);
  });
  it("uses the nearest visible card when the rail is shorter", () => {
    expect(pickNearestCardByCentre(rail([0, 120, 240]), 1800, 0, 1000)).toBe(2);
  });
  it("ignores clipped-out cards when a visible one exists", () => {
    const cards = rail([-500, 40]);
    expect(pickNearestCardByCentre(cards, -450, 0, 1000)).toBe(1);
  });
  it("falls back to all cards when none is visible", () => {
    expect(pickNearestCardByCentre(rail([2000, 2200]), 2290, 0, 1000)).toBe(1);
  });
  it("returns undefined for an empty rail", () => {
    expect(pickNearestCardByCentre([], 5, 0, 10)).toBeUndefined();
  });
});
