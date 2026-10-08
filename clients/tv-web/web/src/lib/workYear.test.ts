import { describe, expect, it } from "vitest";
import { labelWithYear, releaseYear, yearOfDate, yearRangeLabel } from "./workYear";

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

describe("series year range", () => {
  const series = { release_date: "2011-04-17T00:00:00Z", end_date: "2019-05-19T00:00:00Z" };
  it("shows start and end year for an ended series", () => {
    expect(yearRangeLabel(series)).toBe("2011\u20132019");
    expect(labelWithYear("Series", series)).toBe("Series \u00b7 2011\u20132019");
  });
  it("shows the bare start year while the series runs or has no end date", () => {
    expect(yearRangeLabel({ release_date: "2011-04-17T00:00:00Z", end_date: null })).toBe("2011");
    expect(yearRangeLabel({ release_date: "2011-04-17T00:00:00Z" })).toBe("2011");
  });
  it("collapses a series that ended in its first year", () => {
    expect(yearRangeLabel({ release_date: "2011-02-01T00:00:00Z", end_date: "2011-11-01T00:00:00Z" })).toBe("2011");
  });
  it("ignores an end date before the start or without a start year", () => {
    expect(yearRangeLabel({ release_date: "2011-02-01T00:00:00Z", end_date: "2009-01-01T00:00:00Z" })).toBe("2011");
    expect(yearRangeLabel({ release_date: null, end_date: "2019-05-19T00:00:00Z" })).toBeNull();
  });
});
