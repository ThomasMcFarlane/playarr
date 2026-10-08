import { describe, expect, it } from "vitest";
import { releaseYear } from "./releaseYear";

describe("releaseYear", () => {
  it("uses the release date in UTC", () => {
    expect(releaseYear("2019-12-31T23:00:00Z")).toBe("2019");
  });
  it("is null without a release date, so no year is shown", () => {
    expect(releaseYear(null)).toBeNull();
    expect(releaseYear(undefined)).toBeNull();
    expect(releaseYear("not a date")).toBeNull();
  });
});
