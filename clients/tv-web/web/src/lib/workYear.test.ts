import { describe, expect, it } from "vitest";
import { labelWithYear, releaseYear } from "./workYear";

describe("workYear", () => {
  it("extracts the UTC year", () => {
    expect(releaseYear({ release_date: "2019-12-31T23:00:00Z" })).toBe(2019);
  });
  it("returns null when missing or invalid", () => {
    expect(releaseYear({ release_date: null })).toBeNull();
    expect(releaseYear({})).toBeNull();
    expect(releaseYear({ release_date: "nope" })).toBeNull();
  });
  it("appends the year to a label", () => {
    expect(labelWithYear("Movie", { release_date: "2019-01-01T00:00:00Z" })).toBe("Movie · 2019");
    expect(labelWithYear("Movie", {})).toBe("Movie");
  });
});
