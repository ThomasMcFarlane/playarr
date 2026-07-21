import { describe, expect, it } from "vitest";
import { findClosestItemInNextTrack } from "./trackNavigation";

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
