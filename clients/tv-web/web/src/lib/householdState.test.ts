import { describe, expect, it } from "vitest";
import type { HouseholdStatus } from "@playarr-tv/api-client";
import { approvalSubjectFor, householdBlockFromStatus, remainingMinutes } from "./householdState";

const base: HouseholdStatus = {
  restricted: true,
  state: "allowed",
  server_time: "2026-10-03T12:00:00Z",
  offline_valid_until: "2026-10-04T12:00:00Z",
  guardian_for: [],
};

describe("household state", () => {
  it("reports a block only for outside-schedule and spent budgets", () => {
    expect(householdBlockFromStatus(null)).toBeNull();
    expect(householdBlockFromStatus(base)).toBeNull();
    expect(householdBlockFromStatus({ ...base, state: "unrestricted" })).toBeNull();
    expect(
      householdBlockFromStatus({ ...base, state: "outside_schedule", next_start_at: "2026-10-04T07:00:00Z" })
    ).toEqual({ kind: "outside_schedule", until: "2026-10-04T07:00:00Z" });
    expect(
      householdBlockFromStatus({ ...base, state: "budget_exhausted", resets_at: "2026-10-04T00:00:00Z" })
    ).toEqual({ kind: "budget_exhausted", until: "2026-10-04T00:00:00Z" });
  });

  it("warns only in the last hour and uses the nearer limit", () => {
    const now = new Date("2026-10-03T12:00:00Z");
    expect(remainingMinutes({ ...base, remaining_seconds: 7200 }, now)).toBeNull();
    expect(remainingMinutes({ ...base, remaining_seconds: 1500 }, now)).toBe(25);
    expect(
      remainingMinutes(
        { ...base, remaining_seconds: 3000, window_ends_at: "2026-10-03T12:10:00Z" },
        now
      )
    ).toBe(10);
    expect(remainingMinutes({ ...base, state: "unrestricted" }, now)).toBeNull();
    expect(remainingMinutes(base, now)).toBeNull();
  });

  it("asks for the matching kind of extra time", () => {
    expect(approvalSubjectFor("outside_schedule")).toBe("schedule");
    expect(approvalSubjectFor("budget_exhausted")).toBe("budget");
  });
});
