import type { CalendarEntry } from "@playarr-tv/api-client";
import { describe, expect, it } from "vitest";
import { formatEpisodeCodes, groupSeriesEpisodes } from "./calendar";
import {
  activeFilterCount,
  applyCalendarFilters,
  EMPTY_CALENDAR_FILTERS,
  parseCalendarFilters,
  parseCalendarUrl,
  writeCalendarFilters,
  writeCalendarUrl,
} from "./calendarFilters";

function entry(over: Partial<CalendarEntry>): CalendarEntry {
  return {
    id: "e1",
    media_kind: "episode",
    release_type: "air",
    title: "The Show",
    season_number: 2,
    episode_number: 1,
    date: "2026-10-10",
    release_at: "2026-10-10T12:00:00Z",
    monitored: true,
    has_file: false,
    work_id: "w1",
    sources: [{ source_instance_id: "s1", source_name: "Source A", source_kind: "sonarr", arr_id: 1 }],
    ...over,
  };
}

describe("calendar filter URL round trip", () => {
  it("parses and writes every filter, preserving unrelated params", () => {
    const params = new URLSearchParams("view=month&type=tv,movie&source=s2,s1&status=missing&from=2026-10-01&to=2026-10-31&monitored=1");
    const filters = parseCalendarFilters(params);
    expect([...filters.types]).toEqual(["tv", "movie"]);
    expect(filters.from).toBe("2026-10-01");
    expect(filters.monitoredOnly).toBe(true);
    expect(activeFilterCount(filters)).toBe(5);
    const out = writeCalendarFilters(params, filters);
    expect(out.get("view")).toBe("month");
    expect(out.get("type")).toBe("tv,movie");
    expect(out.get("source")).toBe("s1,s2");
    expect(out.get("to")).toBe("2026-10-31");
  });

  it("ignores junk, swaps inverted ranges and drops cleared filters", () => {
    const filters = parseCalendarFilters(new URLSearchParams("type=tv,bogus&from=2026-11-05&to=2026-11-01&status=nope"));
    expect([...filters.types]).toEqual(["tv"]);
    expect(filters.statuses.size).toBe(0);
    expect([filters.from, filters.to]).toEqual(["2026-11-01", "2026-11-05"]);
    expect(parseCalendarFilters(new URLSearchParams("from=2026-13-40")).from).toBeNull();
    const cleared = writeCalendarFilters(new URLSearchParams("type=tv&monitored=1"), EMPTY_CALENDAR_FILTERS);
    expect(cleared.toString()).toBe("");
  });
});

describe("applyCalendarFilters", () => {
  const today = "2026-10-05";
  const entries = [
    entry({ id: "past-missing", date: "2026-10-01", release_at: null }),
    entry({ id: "past-file", date: "2026-10-02", release_at: null, has_file: true }),
    entry({ id: "future", date: "2026-10-09", release_at: null, monitored: false }),
    entry({ id: "movie", media_kind: "movie", season_number: null, episode_number: null, date: "2026-10-09", release_at: null, sources: [{ source_instance_id: "s2", source_name: "Source B", source_kind: "radarr", arr_id: 2 }] }),
  ];
  const ids = (filters: string) => applyCalendarFilters(entries, parseCalendarFilters(new URLSearchParams(filters)), today).map((e) => e.id);

  it("filters by type, source, status, monitored and range", () => {
    expect(ids("type=movie")).toEqual(["movie"]);
    expect(ids("source=s2")).toEqual(["movie"]);
    expect(ids("status=missing")).toEqual(["past-missing"]);
    expect(ids("status=upcoming")).toEqual(["future", "movie"]);
    expect(ids("status=downloaded")).toEqual(["past-file"]);
    expect(ids("monitored=1")).toEqual(["past-missing", "past-file", "movie"]);
    expect(ids("from=2026-10-02&to=2026-10-09&type=tv")).toEqual(["past-file", "future"]);
    expect(ids("")).toHaveLength(4);
  });
});

describe("series episode grouping", () => {
  const ep = (n: number, over: Partial<CalendarEntry> = {}) => entry({ id: `ep${n}`, episode_number: n, ...over });

  it("formats contiguous, gapped and multi-season codes", () => {
    expect(formatEpisodeCodes([ep(4), ep(5), ep(6)])).toBe("S02E04–E06");
    expect(formatEpisodeCodes([ep(1), ep(3), ep(5)])).toBe("S02E01, E03, E05");
    expect(formatEpisodeCodes([ep(1), ep(2), ep(4)])).toBe("S02E01–E02, E04");
    expect(formatEpisodeCodes([ep(10, { season_number: 1 }), ep(1)])).toBe("S01E10, S02E01");
  });

  it("groups same-series same-time episodes, leaves movies and lone episodes alone", () => {
    const items = groupSeriesEpisodes([
      ep(6),
      ep(4),
      ep(5),
      entry({ id: "other", title: "Other Show", work_id: "w2" }),
      entry({ id: "movie", media_kind: "movie", season_number: null, episode_number: null }),
      entry({ id: "late", episode_number: 7, release_at: "2026-10-10T20:00:00Z" }),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["series", "single", "single", "single"]);
    const group = items[0]!;
    expect(group.kind === "series" && group.codes).toBe("S02E04–E06");
    expect(group.kind === "series" && group.entries.map((e) => e.id)).toEqual(["ep4", "ep5", "ep6"]);
  });
});

describe("calendar URL state", () => {
  const url = "view=agenda&date=2026-10-04&type=tv,movie&status=upcoming&selected=series:w1:2026-10-10:12:00&panel=link&from=2026-10-01";

  it("round-trips view, date, selection, panel and filters through one query string", () => {
    const params = new URLSearchParams(url);
    const state = parseCalendarUrl(params);
    expect(state).toEqual({
      view: "agenda",
      date: "2026-10-04",
      selected: "series:w1:2026-10-10:12:00",
      panel: "link",
    });
    const rebuilt = writeCalendarUrl(writeCalendarFilters(new URLSearchParams(), parseCalendarFilters(params)), state);
    expect(parseCalendarUrl(rebuilt)).toEqual(state);
    expect(parseCalendarFilters(rebuilt)).toEqual(parseCalendarFilters(params));
  });

  it("still accepts the old panel=subscription spelling", () => {
    expect(parseCalendarUrl(new URLSearchParams("panel=subscription")).panel).toBe("link");
  });

  it("ignores junk and clears values when set to null", () => {
    const state = parseCalendarUrl(new URLSearchParams("view=year&date=nope&panel=x"));
    expect(state).toEqual({ view: null, date: null, selected: null, panel: null });
    const cleared = writeCalendarUrl(new URLSearchParams(url), { selected: null, panel: null });
    expect(cleared.has("selected")).toBe(false);
    expect(cleared.get("view")).toBe("agenda");
    expect(cleared.get("type")).toBe("tv,movie");
  });
});
