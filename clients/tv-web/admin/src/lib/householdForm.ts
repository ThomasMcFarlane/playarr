import type { HouseholdSettings } from "@playarr-tv/api-client";

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const RATING_OPTIONS = ["G", "PG", "PG-13", "R", "NC-17"] as const;
export const APPROVAL_KINDS = ["purchase", "install", "content", "time"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export interface DayWindow {
  enabled: boolean;
  /** `HH:MM`, 24-hour. */
  start: string;
  /** `HH:MM`, 24-hour; `24:00` means end of day. */
  end: string;
}

export interface HouseholdForm {
  maxRating: string;
  unrated: "block" | "allow";
  blockedTags: string;
  timezone: string;
  budgetMinutes: string;
  scheduleEnabled: boolean;
  days: Record<Weekday, DayWindow>;
  guardianIds: string[];
  approvalRequired: ApprovalKind[];
  offlineTtlHours: string;
}

export function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(1440, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** `HH:MM` to minutes since midnight, or `null` when malformed. */
export function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[2]) < 60 && minutes <= 1440 ? minutes : null;
}

function emptyDays(): Record<Weekday, DayWindow> {
  return Object.fromEntries(
    WEEKDAYS.map((day) => [day, { enabled: false, start: "08:00", end: "20:00" }])
  ) as Record<Weekday, DayWindow>;
}

export function emptyHouseholdForm(): HouseholdForm {
  return {
    maxRating: "",
    unrated: "block",
    blockedTags: "",
    timezone: "",
    budgetMinutes: "",
    scheduleEnabled: false,
    days: emptyDays(),
    guardianIds: [],
    approvalRequired: [],
    offlineTtlHours: "",
  };
}

/** `household` is omitted by the server's `serde(default)` for an unrestricted account. */
function controlsOf(settings: HouseholdSettings): NonNullable<HouseholdSettings["household"]> {
  return settings.household ?? {};
}

export function settingsToForm(settings: HouseholdSettings): HouseholdForm {
  const form = emptyHouseholdForm();
  const controls = controlsOf(settings);
  form.maxRating = settings.max_rating ?? "";
  form.unrated = controls.unrated === "allow" ? "allow" : "block";
  form.blockedTags = (settings.blocked_tags ?? []).join(", ");
  form.timezone = controls.timezone ?? "";
  form.budgetMinutes =
    controls.daily_budget_minutes != null
      ? String(controls.daily_budget_minutes)
      : "";
  form.guardianIds = [...(controls.guardian_user_ids ?? [])];
  form.approvalRequired = (controls.approval_required ?? []) as ApprovalKind[];
  form.offlineTtlHours =
    controls.offline_ttl_hours != null
      ? String(controls.offline_ttl_hours)
      : "";
  if (settings.access_schedule) {
    form.scheduleEnabled = true;
    for (const window of settings.access_schedule) {
      const day = window.weekday as Weekday;
      if (!(day in form.days)) continue;
      // The editor holds one window per day; a second window for the same
      // day (set through the API) is merged into its outer bounds.
      const start = minutesToTime(window.time_range.start_minute_of_day);
      const end = minutesToTime(window.time_range.end_minute_of_day);
      const current = form.days[day];
      form.days[day] = current.enabled
        ? {
            enabled: true,
            start: start < current.start ? start : current.start,
            end: end > current.end ? end : current.end,
          }
        : { enabled: true, start, end };
    }
  }
  return form;
}

export type FormResult =
  | { ok: true; settings: HouseholdSettings }
  | { ok: false; error: string };

export function formToSettings(form: HouseholdForm): FormResult {
  let budget: number | null = null;
  if (form.budgetMinutes.trim() !== "") {
    budget = Number(form.budgetMinutes);
    if (!Number.isInteger(budget) || budget < 1 || budget > 1440) {
      return { ok: false, error: "Daily watch time must be a whole number between 1 and 1440 minutes." };
    }
  }
  let offline: number | null = null;
  if (form.offlineTtlHours.trim() !== "") {
    offline = Number(form.offlineTtlHours);
    if (!Number.isInteger(offline) || offline < 1 || offline > 72) {
      return { ok: false, error: "Offline validity must be between 1 and 72 hours." };
    }
  }
  const schedule: NonNullable<HouseholdSettings["access_schedule"]> = [];
  if (form.scheduleEnabled) {
    for (const day of WEEKDAYS) {
      const window = form.days[day];
      if (!window.enabled) continue;
      const start = timeToMinutes(window.start);
      const end = timeToMinutes(window.end);
      if (start === null || end === null || start >= end) {
        return { ok: false, error: `Check ${day}: the start time must be before the end time.` };
      }
      schedule.push({
        weekday: day,
        time_range: { start_minute_of_day: start, end_minute_of_day: end },
      });
    }
  }
  const tags = form.blockedTags
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
  return {
    ok: true,
    settings: {
      max_rating: form.maxRating === "" ? null : form.maxRating,
      blocked_tags: tags,
      allowed_tags: [],
      blocked_folders: [],
      access_schedule: form.scheduleEnabled ? schedule : null,
      household: {
        unrated: form.unrated,
        timezone: form.timezone.trim() === "" ? null : form.timezone.trim(),
        daily_budget_minutes: budget,
        guardian_user_ids: form.guardianIds,
        approval_required: form.approvalRequired,
        offline_ttl_hours: offline,
      },
    },
  };
}

/** One-line description of the active restrictions, for the account card. */
export function summariseHousehold(settings: HouseholdSettings): string | null {
  const parts: string[] = [];
  if (settings.max_rating) parts.push(`up to ${settings.max_rating}`);
  if (controlsOf(settings).daily_budget_minutes != null) {
    parts.push(`${controlsOf(settings).daily_budget_minutes} min/day`);
  }
  if (settings.access_schedule) {
    parts.push(settings.access_schedule.length === 0 ? "locked out" : "scheduled");
  }
  if ((controlsOf(settings).guardian_user_ids ?? []).length > 0) parts.push("guardian approval");
  return parts.length > 0 ? parts.join(", ") : null;
}
