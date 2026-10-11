// entry/src/test/WatchState.test.ts: core/WatchState.ts against web components/WatchStateOverlay.tsx.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { indexWatchProgressByWork, watchMarkFor } from "../main/ets/core/WatchState";
import type { WatchProgress, WatchProgressState } from "../main/ets/core/Types/Playback";

function row(workId: string, state: WatchProgressState, position = 0, duration = 100): WatchProgress {
  return { media_file_id: `${workId}-${state}`, work_id: workId, position_ms: position, duration_ms: duration, state, updated_at: null };
}

test("part watched beats watched beats unseen for one work", () => {
  const index = indexWatchProgressByWork([row("a", "unseen"), row("a", "watched"), row("a", "part_watched", 50), row("a", "watched")]);
  assert.equal(index.get("a")?.state, "part_watched");
  assert.equal(indexWatchProgressByWork([row("b", "unseen"), row("b", "watched")]).get("b")?.state, "watched");
});

test("part watched draws clamped progress", () => {
  assert.deepEqual(watchMarkFor(row("a", "part_watched", 25, 100), true), { unseen: false, progress: 0.25 });
  assert.deepEqual(watchMarkFor(row("a", "part_watched", 150, 100), true), { unseen: false, progress: 1 });
  assert.deepEqual(watchMarkFor(row("a", "part_watched", 10, 0), true), { unseen: false, progress: 0 });
});

test("unseen, or no row once loaded, draws the dot", () => {
  assert.deepEqual(watchMarkFor(row("a", "unseen"), false), { unseen: true, progress: -1 });
  assert.deepEqual(watchMarkFor(undefined, true), { unseen: true, progress: -1 });
});

test("watched, or no row before the list loads, draws nothing", () => {
  assert.deepEqual(watchMarkFor(row("a", "watched"), true), { unseen: false, progress: -1 });
  assert.deepEqual(watchMarkFor(undefined, false), { unseen: false, progress: -1 });
});
