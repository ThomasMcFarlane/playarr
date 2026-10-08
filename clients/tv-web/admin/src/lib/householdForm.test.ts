import { describe, expect, it } from "vitest";
import type { HouseholdSettings } from "@playarr-tv/api-client";
import {
  emptyHouseholdForm,
  formToSettings,
  minutesToTime,
  settingsToForm,
  summariseHousehold,
  timeToMinutes,
} from "./householdForm";

const saved: HouseholdSettings = {
  max_rating: "PG-13",
  blocked_tags: ["horror"],
  allowed_tags: [],
  blocked_folders: [],
  access_schedule: [
    { weekday: "saturday", time_range: { start_minute_of_day: 480, end_minute_of_day: 1200 } },
  ],
  household: {
    unrated: "allow",
    timezone: "Europe/London",
    daily_budget_minutes: 90,
    guardian_user_ids: ["g-1"],
    approval_required: ["content"],
    offline_ttl_hours: 12,
  },
};

describe("household form", () => {
  it("round-trips saved settings", () => {
    const result = formToSettings(settingsToForm(saved));
    expect(result).toEqual({ ok: true, settings: saved });
  });

  it("treats no schedule, an empty schedule and a schedule differently", () => {
    const none = emptyHouseholdForm();
    expect(formToSettings(none)).toMatchObject({ ok: true, settings: { access_schedule: null } });
    const lockout = { ...emptyHouseholdForm(), scheduleEnabled: true };
    expect(formToSettings(lockout)).toMatchObject({ ok: true, settings: { access_schedule: [] } });
    expect(summariseHousehold({ ...saved, access_schedule: [] })).toContain("locked out");
  });

  it("rejects bad budgets, offline hours and inverted windows", () => {
    const base = emptyHouseholdForm();
    expect(formToSettings({ ...base, budgetMinutes: "0" }).ok).toBe(false);
    expect(formToSettings({ ...base, budgetMinutes: "1.5" }).ok).toBe(false);
    expect(formToSettings({ ...base, budgetMinutes: "1441" }).ok).toBe(false);
    expect(formToSettings({ ...base, offlineTtlHours: "100" }).ok).toBe(false);
    const inverted = {
      ...base,
      scheduleEnabled: true,
      days: { ...base.days, monday: { enabled: true, start: "20:00", end: "08:00" } },
    };
    expect(formToSettings(inverted)).toMatchObject({ ok: false });
  });

  it("parses times including end of day", () => {
    expect(timeToMinutes("08:30")).toBe(510);
    expect(timeToMinutes("24:00")).toBe(1440);
    expect(timeToMinutes("25:00")).toBeNull();
    expect(timeToMinutes("8:75")).toBeNull();
    expect(minutesToTime(1440)).toBe("24:00");
    expect(minutesToTime(65)).toBe("01:05");
  });

  it("summarises restrictions for the account card", () => {
    expect(summariseHousehold(saved)).toBe("up to PG-13, 90 min/day, scheduled, guardian approval");
    expect(
      summariseHousehold({
        ...saved,
        max_rating: null,
        access_schedule: null,
        household: { ...saved.household, daily_budget_minutes: null, guardian_user_ids: [] },
      })
    ).toBeNull();
  });
});
