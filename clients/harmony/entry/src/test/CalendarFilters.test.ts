// entry/src/test/CalendarFilters.test.ts: core/CalendarFilters.ts against web lib/calendarFilters.ts.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { activeFilterCount, applyCalendarFilters, typeForKind } from "../main/ets/core/CalendarFilters";
import type { CalendarFilters } from "../main/ets/core/CalendarFilters";
import type { CalendarEntry } from "../main/ets/core/Types/Calendar";

function entry(over: Partial<CalendarEntry>): CalendarEntry {
  return { id: "e", media_kind: "episode", release_type: "air", title: "Sample", date: "2026-10-12",
    monitored: true, has_file: false, ...over };
}

const NONE: CalendarFilters = { types: [], statuses: [], monitoredOnly: false };
const TODAY = "2026-10-11";
const ids = (list: CalendarEntry[]): string[] => list.map((e) => e.id);

const entries = [
  entry({ id: "ep-aired-missing", date: "2026-10-10" }),
  entry({ id: "ep-aired-file", date: "2026-10-10", has_file: true }),
  entry({ id: "movie-upcoming", media_kind: "movie", date: "2026-10-20" }),
  entry({ id: "album-unmonitored", media_kind: "album", date: "2026-10-11", monitored: false }),
];

test("no filters keeps everything", () => {
  assert.deepEqual(ids(applyCalendarFilters(entries, NONE, TODAY)), ids(entries));
  assert.equal(activeFilterCount(NONE), 0);
});

test("types map to media kinds and OR within the filter", () => {
  assert.equal(typeForKind("episode"), "tv");
  assert.equal(typeForKind("album"), "music");
  assert.deepEqual(ids(applyCalendarFilters(entries, { ...NONE, types: ["movie", "music"] }, TODAY)),
    ["movie-upcoming", "album-unmonitored"]);
});

test("statuses: aired is on or before today; missing is aired without a file", () => {
  assert.deepEqual(ids(applyCalendarFilters(entries, { ...NONE, statuses: ["upcoming"] }, TODAY)), ["movie-upcoming"]);
  assert.deepEqual(ids(applyCalendarFilters(entries, { ...NONE, statuses: ["missing"] }, TODAY)),
    ["ep-aired-missing", "album-unmonitored"]);
  assert.deepEqual(ids(applyCalendarFilters(entries, { ...NONE, statuses: ["downloaded"] }, TODAY)), ["ep-aired-file"]);
});

test("different filters AND together, and count once each", () => {
  const filters: CalendarFilters = { types: ["tv", "music"], statuses: ["missing"], monitoredOnly: true };
  assert.deepEqual(ids(applyCalendarFilters(entries, filters, TODAY)), ["ep-aired-missing"]);
  assert.equal(activeFilterCount(filters), 3);
});
