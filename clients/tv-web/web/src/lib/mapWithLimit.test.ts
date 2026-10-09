import { describe, expect, it } from "vitest";
import { mapWithLimit } from "./mapWithLimit";

describe("mapWithLimit", () => {
  it("keeps input order and never exceeds the limit", async () => {
    let active = 0;
    let peak = 0;
    const results = await mapWithLimit([1, 2, 3, 4, 5, 6, 7], 3, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5 - (value % 3)));
      active -= 1;
      return value * 2;
    });
    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBe(3);
  });

  it("handles an empty list", async () => {
    expect(await mapWithLimit([], 4, async () => 1)).toEqual([]);
  });

  it("stops starting new work once asked to", async () => {
    let started = 0;
    let stop = false;
    await mapWithLimit(
      [1, 2, 3, 4, 5, 6],
      1,
      async () => {
        started += 1;
        stop = true;
        return 0;
      },
      () => stop
    );
    expect(started).toBe(1);
  });

  it("rejects when a call rejects", async () => {
    await expect(
      mapWithLimit([1, 2], 2, async (value) => {
        if (value === 2) throw new Error("boom");
        return value;
      })
    ).rejects.toThrow("boom");
  });
});
