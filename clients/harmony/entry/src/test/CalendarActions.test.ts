// entry/src/test/CalendarActions.test.ts: core/CalendarActions.ts against web lib/calendarActions.ts.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { planCalendarActions, planItemActions } from "../main/ets/core/CalendarActions";
import { groupSeriesEpisodes } from "../main/ets/core/CalendarAgenda";
import type { CalendarEntry } from "../main/ets/core/Types/Calendar";

function entry(over: Partial<CalendarEntry>): CalendarEntry {
  return { id: "e", media_kind: "episode", release_type: "air", title: "Sample Series 1", date: "2026-10-12",
    monitored: true, has_file: false, work_id: "w", ...over };
}

test("only server actions are offered", () => {
  const none = planCalendarActions(entry({ actions: [] }));
  assert.equal(none.openWorkId, null);
  assert.equal(none.play, null);
  assert.equal(none.watchlist, null);
  const plan = planCalendarActions(entry({ actions: [
    { action: "open", enabled: true, work_id: "w" },
    { action: "watchlist", enabled: true, active: true },
  ] }));
  assert.equal(plan.openWorkId, "w");
  assert.deepEqual(plan.watchlist, { enabled: true, listed: true });
});

test("resume wins over play; disabled play is ignored", () => {
  const plan = planCalendarActions(entry({ actions: [
    { action: "play", enabled: true, media_file_id: "m1", work_id: "w" },
    { action: "resume", enabled: true, media_file_id: "m2", work_id: "w", position_ms: 1000 },
  ] }));
  assert.equal(plan.play?.mediaFileId, "m2");
  assert.equal(plan.play?.resume, true);
  assert.equal(plan.openWorkId, "w");
  const off = planCalendarActions(entry({ actions: [{ action: "play", enabled: false, media_file_id: "m1" }] }));
  assert.equal(off.play, null);
});

test("a group acts on the playable episode", () => {
  const a = entry({ id: "a", season_number: 1, episode_number: 1, actions: [] });
  const b = entry({ id: "b", season_number: 1, episode_number: 2,
    actions: [{ action: "play", enabled: true, media_file_id: "m", work_id: "w" }] });
  const item = groupSeriesEpisodes([a, b])[0];
  assert.equal(planItemActions(item).play?.mediaFileId, "m");
});
