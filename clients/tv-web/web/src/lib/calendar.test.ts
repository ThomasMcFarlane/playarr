import type { CalendarEntry, CalendarSourceStatus } from "@playarr-tv/api-client";
import { describe, expect, it } from "vitest";
import {
  AGENDA_DAYS,
  MAX_RANGE_DAYS,
  addDays,
  addMonths,
  anchorForView,
  buildMonthGrid,
  buildWeekDays,
  defaultCalendarView,
  diffDays,
  entryLocalDay,
  entryAvailable,
  entryState,
  itemAvailability,
  episodeCode,
  failedSources,
  fetchWindow,
  filterByKinds,
  formatHumanDuration,
  groupByLocalDay,
  humanDuration,
  localDayOf,
  shiftAnchor,
  startOfWeek,
  visibleRange,
  workRouteForEntry,
} from "./calendar";

function entry(overrides: Partial<CalendarEntry> = {}): CalendarEntry {
  return {
    id: "e1",
    media_kind: "episode",
    release_type: "air",
    title: "Show",
    date: "2026-10-04",
    monitored: true,
    has_file: false,
    sources: [],
    ...overrides,
  };
}

describe("day arithmetic", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("is unaffected by daylight-saving transitions", () => {
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(diffDays("2026-03-01", "2026-04-01")).toBe(31);
  });

  it("clamps the day when adding months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  });

  it("finds the start of the week for Monday and Sunday locales", () => {
    expect(startOfWeek("2026-10-04", 1)).toBe("2026-09-28"); // Sunday 4 Oct
    expect(startOfWeek("2026-10-04", 0)).toBe("2026-10-04");
    expect(startOfWeek("2026-10-07", 1)).toBe("2026-10-05");
  });
});

describe("visible range and fetch window", () => {
  it("covers whole weeks for a month", () => {
    const range = visibleRange("month", "2026-10-15", 1);
    expect(range).toEqual({ start: "2026-09-28", end: "2026-11-01" });
    expect(diffDays(range.start, range.end) + 1).toBe(35);
  });

  it("never exceeds six weeks for a month", () => {
    for (let m = 0; m < 24; m += 1) {
      const anchor = addMonths("2026-01-01", m);
      for (const first of [0, 1, 6]) {
        const range = visibleRange("month", anchor, first);
        expect(diffDays(range.start, range.end) + 1).toBeLessThanOrEqual(42);
      }
    }
  });

  it("shows seven days for a week and thirty for the agenda", () => {
    expect(visibleRange("week", "2026-10-07", 1)).toEqual({ start: "2026-10-05", end: "2026-10-11" });
    const agenda = visibleRange("agenda", "2026-10-04", 1);
    expect(diffDays(agenda.start, agenda.end) + 1).toBe(AGENDA_DAYS);
  });

  it("pads the fetch window by a day and stays within the server limit", () => {
    const range = visibleRange("month", "2026-10-15", 1);
    const window = fetchWindow(range);
    expect(window).toEqual({ start: "2026-09-27", end: "2026-11-02" });
    for (const view of ["month", "week", "agenda"] as const) {
      const w = fetchWindow(visibleRange(view, "2026-10-04", 0));
      expect(diffDays(w.start, w.end) + 1).toBeLessThanOrEqual(MAX_RANGE_DAYS);
    }
  });

  it("shifts and snaps the anchor per view", () => {
    expect(shiftAnchor("month", "2026-10-15", 1)).toBe("2026-11-01");
    expect(shiftAnchor("month", "2026-01-15", -1)).toBe("2025-12-01");
    expect(shiftAnchor("week", "2026-10-04", -1)).toBe("2026-09-27");
    expect(shiftAnchor("agenda", "2026-10-04", 1)).toBe("2026-11-03");
    expect(anchorForView("month", "2026-10-15")).toBe("2026-10-01");
    expect(anchorForView("week", "2026-10-15")).toBe("2026-10-15");
  });
});

describe("local day bucketing", () => {
  it("uses the UTC date for all-day entries", () => {
    expect(entryLocalDay(entry({ date: "2026-10-04" }))).toBe("2026-10-04");
  });

  it("derives the local day from release_at when present", () => {
    const at = "2026-10-04T23:30:00Z";
    expect(entryLocalDay(entry({ release_at: at, date: "2026-10-04" }))).toBe(
      localDayOf(new Date(at))
    );
  });

  it("falls back to the date on an unparseable release_at", () => {
    expect(entryLocalDay(entry({ release_at: "nonsense", date: "2026-10-05" }))).toBe("2026-10-05");
  });

  it("groups, sorts and range-limits entries", () => {
    const entries = [
      entry({ id: "b", title: "B", date: "2026-10-05" }),
      entry({ id: "a", title: "A", date: "2026-10-05" }),
      entry({ id: "c", title: "C", date: "2026-10-01" }),
      entry({ id: "z", title: "Out", date: "2026-12-01" }),
    ];
    const groups = groupByLocalDay(entries, { start: "2026-10-01", end: "2026-10-31" });
    expect(groups.map((g) => g.day)).toEqual(["2026-10-01", "2026-10-05"]);
    expect(groups[1]!.entries.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("puts all-day entries before timed ones within a day", () => {
    const at = new Date(2026, 9, 5, 9, 0).toISOString();
    const timed = entry({ id: "t", title: "A", release_at: at, date: at.slice(0, 10) });
    const allDay = entry({ id: "d", title: "Z", date: localDayOf(new Date(at)) });
    const [group] = groupByLocalDay([timed, allDay]);
    expect(group!.entries.map((e) => e.id)).toEqual(["d", "t"]);
  });
});

describe("filters and grids", () => {
  it("filters by media kind and treats an empty set as all", () => {
    const entries = [entry({ id: "1" }), entry({ id: "2", media_kind: "movie" })];
    expect(filterByKinds(entries, new Set(["movie"])).map((e) => e.id)).toEqual(["2"]);
    expect(filterByKinds(entries, new Set())).toHaveLength(2);
  });

  it("builds month rows of seven with today and out-of-month flags", () => {
    const groups = groupByLocalDay([entry({ date: "2026-10-04" })]);
    const grid = buildMonthGrid("2026-10-01", 1, groups, "2026-10-04");
    expect(grid.every((week) => week.length === 7)).toBe(true);
    const flat = grid.flat();
    expect(flat[0]!.day).toBe("2026-09-28");
    expect(flat[0]!.inMonth).toBe(false);
    const today = flat.find((cell) => cell.isToday)!;
    expect(today.day).toBe("2026-10-04");
    expect(today.entries).toHaveLength(1);
  });

  it("builds seven week days including empty ones", () => {
    const days = buildWeekDays("2026-10-07", 1, [], "2026-10-07");
    expect(days.map((d) => d.day)[0]).toBe("2026-10-05");
    expect(days).toHaveLength(7);
    expect(days[2]!.isToday).toBe(true);
  });
});

describe("entry view model", () => {
  it("maps library state", () => {
    expect(entryState({ has_file: true, monitored: false })).toBe("inLibrary");
    expect(entryState({ has_file: false, monitored: true })).toBe("monitored");
    expect(entryState({ has_file: false, monitored: false })).toBe("notMonitored");
  });

  it("formats episode codes", () => {
    expect(episodeCode(entry({ season_number: 1, episode_number: 2 }))).toBe("S01E02");
    expect(episodeCode(entry())).toBeNull();
  });

  it("routes entries with a work to the right detail page", () => {
    expect(workRouteForEntry(entry({ work_id: "w" }))).toBe("/series/w");
    expect(workRouteForEntry(entry({ media_kind: "movie", work_id: "w" }))).toBe("/movies/w");
    expect(workRouteForEntry(entry({ media_kind: "album", work_id: "w" }))).toBe("/music/w");
    expect(workRouteForEntry(entry({ media_kind: "book", work_id: "w" }))).toBe("/library/w");
    expect(workRouteForEntry(entry())).toBeNull();
  });

  it("reports every non-ok source", () => {
    const sources: CalendarSourceStatus[] = [
      { source_instance_id: "1", name: "A", kind: "sonarr", status: "ok", entry_count: 3 },
      { source_instance_id: "2", name: "B", kind: "radarr", status: "unreachable", error: "timeout", entry_count: 0 },
      { source_instance_id: "3", name: "C", kind: "lidarr", status: "rejected", entry_count: 0 },
    ];
    expect(failedSources(sources).map((s) => s.name)).toEqual(["B", "C"]);
  });

  it("chooses agenda for TV, touch and narrow screens and month otherwise", () => {
    const never = () => false;
    expect(defaultCalendarView({ isTv: true, matches: never })).toBe("agenda");
    expect(defaultCalendarView({ isTv: false, matches: (q) => q.includes("coarse") })).toBe("agenda");
    expect(defaultCalendarView({ isTv: false, matches: (q) => q.includes("max-width") })).toBe("agenda");
    expect(defaultCalendarView({ isTv: false, matches: never })).toBe("month");
  });
});

describe("human duration", () => {
  it("picks a natural unit", () => {
    expect(humanDuration(30)).toEqual({ value: 1, unit: "minute" });
    expect(humanDuration(45 * 60)).toEqual({ value: 45, unit: "minute" });
    expect(humanDuration(3 * 3600)).toEqual({ value: 3, unit: "hour" });
    expect(humanDuration(2.5 * 3600)).toEqual({ value: 2.5, unit: "hour" });
    expect(humanDuration(36 * 3600)).toEqual({ value: 36, unit: "hour" });
    expect(humanDuration(3 * 86400)).toEqual({ value: 3, unit: "day" });
    expect(humanDuration(-5)).toEqual({ value: 1, unit: "minute" });
  });

  it("formats with Intl", () => {
    expect(formatHumanDuration(3 * 3600, "en-GB")).toBe("3 hours");
    expect(formatHumanDuration(3 * 86400, "en-GB")).toBe("3 days");
  });
});

describe("entry availability (left border colour)", () => {
  const play = { action: "play", enabled: true } as const;
  it("is available only when a file exists and the viewer can play it", () => {
    expect(entryAvailable(entry({ has_file: false }))).toBe(false);
    expect(entryAvailable(entry({ has_file: true }))).toBe(true);
    expect(entryAvailable(entry({ has_file: true, actions: [{ ...play }] as CalendarEntry["actions"] }))).toBe(true);
    expect(entryAvailable(entry({ has_file: true, actions: [{ action: "resume", enabled: true }] as CalendarEntry["actions"] }))).toBe(true);
    expect(entryAvailable(entry({ has_file: true, actions: [{ action: "play", enabled: false }] as CalendarEntry["actions"] }))).toBe(false);
    expect(entryAvailable(entry({ has_file: true, actions: [{ action: "open", enabled: true }] as CalendarEntry["actions"] }))).toBe(false);
  });

  it("never depends on the media kind or the source library", () => {
    for (const media_kind of ["episode", "movie", "album", "book"] as const) {
      expect(entryAvailable(entry({ media_kind, has_file: true }))).toBe(true);
      expect(entryAvailable(entry({ media_kind, has_file: false }))).toBe(false);
    }
  });

  it("a series group is available only when every folded episode is", () => {
    const a = entry({ id: "a", has_file: true });
    const b = entry({ id: "b", has_file: false });
    expect(itemAvailability({ kind: "series", key: "k", title: "S", entries: [a, a], codes: "S01E01" } as never)).toBe("available");
    expect(itemAvailability({ kind: "series", key: "k", title: "S", entries: [a, b], codes: "S01E01" } as never)).toBe("unavailable");
  });
});
