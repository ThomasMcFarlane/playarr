import { describe, expect, it } from "vitest";
import { labelWithYear, releaseYear, yearOfDate } from "./workYear";

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

describe("title years are release years", () => {
  it("never fall back to the library added date", () => {
    const work = { release_date: null, added_at: "2026-03-01T00:00:00Z" };
    expect(releaseYear(work)).toBeNull();
    expect(labelWithYear("Movie", work)).toBe("Movie");
  });
  it("prefer the release year when both dates exist", () => {
    const work = { release_date: "1999-03-31T00:00:00Z", added_at: "2026-03-01T00:00:00Z" };
    expect(releaseYear(work)).toBe(1999);
    expect(labelWithYear("Movie", work)).toBe("Movie · 1999");
  });
});

describe("yearOfDate", () => {
  it("reads the UTC year, so a date-only value does not shift with the time zone", () => {
    expect(yearOfDate("2020-01-01")).toBe(2020);
    expect(yearOfDate("2019-12-31T23:30:00Z")).toBe(2019);
    expect(yearOfDate(null)).toBeNull();
  });
});
