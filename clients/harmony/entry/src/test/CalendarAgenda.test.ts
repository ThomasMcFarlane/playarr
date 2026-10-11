// entry/src/test/CalendarAgenda.test.ts: core/CalendarAgenda.ts against web lib/calendar.ts and Calendar.tsx.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  addDays, agendaRangeLabel, compareEntries, dayHeading, entryAvailable, entryPillTone, entrySubtitle,
  entryTimeLabel, groupByLocalDay, pillLabel, releaseInstant, entryWhenLabel,
} from "../main/ets/core/CalendarAgenda";
import type { CalendarEntry } from "../main/ets/core/Types/Calendar";

function entry(over: Partial<CalendarEntry>): CalendarEntry {
  return { id: "e", media_kind: "episode", release_type: "air", title: "Sample Series 1", date: "2026-10-12",
    monitored: true, has_file: false, ...over };
}

test("day arithmetic crosses months", () => {
  assert.equal(addDays("2026-10-11", 29), "2026-11-09");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("midnight UTC is all day; other instants are timed", () => {
  assert.equal(releaseInstant(entry({ release_at: "2026-10-12T00:00:00Z" })), null);
  assert.notEqual(releaseInstant(entry({ release_at: "2026-10-12T08:00:00Z" })), null);
  assert.equal(entryTimeLabel(entry({ release_at: null })), "All day");
});

test("all-day entries sort first, then by title", () => {
  const timed = entry({ id: "a", title: "Alpha", release_at: "2026-10-12T08:00:00Z" });
  const allDay = entry({ id: "b", title: "Zulu" });
  assert.ok(compareEntries(allDay, timed) < 0);
  assert.ok(compareEntries(entry({ title: "A" }), entry({ title: "B" })) < 0);
});

test("groups by day within the range, ascending", () => {
  const groups = groupByLocalDay([entry({ id: "1", date: "2026-10-13" }), entry({ id: "2", date: "2026-10-12" }),
    entry({ id: "3", date: "2026-12-01" })], "2026-10-11", "2026-11-09");
  assert.deepEqual(groups.map((g) => g.day), ["2026-10-12", "2026-10-13"]);
});

test("pill tone and border availability follow web", () => {
  assert.equal(entryPillTone(entry({ has_file: true }), "2026-10-11"), "available");
  assert.equal(entryPillTone(entry({ date: "2026-10-12" }), "2026-10-11"), "upcoming");
  assert.equal(entryPillTone(entry({ date: "2026-10-11" }), "2026-10-11"), "missing");
  assert.equal(entryPillTone(entry({ date: "2026-10-10", monitored: false }), "2026-10-11"), "neutral");
  assert.equal(pillLabel("neutral"), "Not tracked");
  assert.equal(entryAvailable(entry({ has_file: true })), true);
  assert.equal(entryAvailable(entry({ has_file: true, actions: [{ action: "play", enabled: false }] })), false);
  assert.equal(entryAvailable(entry({ has_file: false })), false);
});

test("labels match web", () => {
  assert.equal(entrySubtitle(entry({ season_number: 2, episode_number: 13, subtitle: "TBA" })), "S02E13 · TBA");
  assert.equal(dayHeading("2026-10-11"), "Sunday 11 October");
  assert.equal(agendaRangeLabel("2026-10-11"), "11 Oct – 9 Nov");
  assert.equal(agendaRangeLabel("2026-10-01"), "1 – 30 Oct");
  assert.equal(entryWhenLabel(entry({ date: "2026-10-11" })), "Sunday, 11 October 2026");
});

import {
  buildMonthGrid, buildWeekDays, rangeLabel, shiftAnchor, startOfWeek, visibleRange,
} from "../main/ets/core/CalendarAgenda";

test("weeks start on Monday", () => {
  assert.equal(startOfWeek("2026-10-11", 1), "2026-10-05");
  assert.equal(startOfWeek("2026-10-05", 1), "2026-10-05");
});

test("view ranges and paging match web", () => {
  assert.deepEqual(visibleRange("week", "2026-10-11"), { start: "2026-10-05", end: "2026-10-11" });
  assert.deepEqual(visibleRange("month", "2026-10-11"), { start: "2026-09-28", end: "2026-11-01" });
  assert.equal(shiftAnchor("month", "2026-10-11", 1), "2026-11-01");
  assert.equal(shiftAnchor("week", "2026-10-11", -1), "2026-10-04");
  assert.equal(rangeLabel("week", "2026-10-11"), "5 – 11 Oct");
  assert.equal(rangeLabel("month", "2026-10-11"), "Oct 2026");
  assert.equal(rangeLabel("agenda", "2026-10-11"), "11 Oct – 9 Nov");
});

test("month grid is whole weeks; week has seven days", () => {
  const grid = buildMonthGrid("2026-10-11", [], "2026-10-11");
  assert.equal(grid.length, 5);
  assert.equal(grid[0][0].day, "2026-09-28");
  assert.equal(grid[0][0].inMonth, false);
  assert.equal(grid[1][6].isToday, true);
  assert.equal(buildWeekDays("2026-10-11", [], "2026-10-11").length, 7);
});
