// entry/src/test/WatchProgressSort.test.ts
//
// Pure Node unit tests for core/WatchProgressSort.ts (brief section 4.12 /
// section 9, Slice 2 acceptance: "Continue-watching ordering, dedupe and
// cap"). This file imports only the plain-TypeScript core module below and
// node's own test/assert builtins -- no ArkUI, no @kit.*/@ohos.* imports,
// no decorators.
//
// Covers:
//   - filtering to state === "part_watched" only
//   - sort by updated_at descending (most recently watched first)
//   - dedupe by work_id, keeping the most recent row per work
//   - cap at maxCount entries
//   - the empty-result case is a legitimate policy outcome, not a bug

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { selectContinueWatching } from "../main/ets/core/WatchProgressSort";
import { WatchProgress, WatchProgressState } from "../main/ets/core/Types/Playback";

function makeProgress(
  mediaFileId: string,
  workId: string,
  state: WatchProgressState,
  updatedAt: string | null
): WatchProgress {
  const progress: WatchProgress = {
    media_file_id: mediaFileId,
    work_id: workId,
    position_ms: 1000,
    duration_ms: 100000,
    state: state,
    updated_at: updatedAt
  };
  return progress;
}

describe("selectContinueWatching: ordering", () => {
  it("sorts part_watched rows by updated_at descending (most recent first)", () => {
    const oldest: WatchProgress = makeProgress("mf-1", "work-1", "part_watched", "2026-01-01T00:00:00.000Z");
    const middle: WatchProgress = makeProgress("mf-2", "work-2", "part_watched", "2026-06-01T00:00:00.000Z");
    const newest: WatchProgress = makeProgress("mf-3", "work-3", "part_watched", "2026-07-01T00:00:00.000Z");

    const result: WatchProgress[] = selectContinueWatching([oldest, newest, middle], 10);

    assert.equal(result.length, 3);
    assert.equal(result[0].work_id, "work-3");
    assert.equal(result[1].work_id, "work-2");
    assert.equal(result[2].work_id, "work-1");
  });

  it("filters out unseen and watched rows, keeping only part_watched", () => {
    const unseen: WatchProgress = makeProgress("mf-1", "work-1", "unseen", null);
    const watched: WatchProgress = makeProgress("mf-2", "work-2", "watched", "2026-07-01T00:00:00.000Z");
    const inProgress: WatchProgress = makeProgress("mf-3", "work-3", "part_watched", "2026-06-01T00:00:00.000Z");

    const result: WatchProgress[] = selectContinueWatching([unseen, watched, inProgress], 10);

    assert.equal(result.length, 1);
    assert.equal(result[0].work_id, "work-3");
  });

  it("returns an empty array when nothing is part_watched -- a legitimate outcome, not a bug", () => {
    const unseen: WatchProgress = makeProgress("mf-1", "work-1", "unseen", null);
    const watched: WatchProgress = makeProgress("mf-2", "work-2", "watched", "2026-07-01T00:00:00.000Z");

    const result: WatchProgress[] = selectContinueWatching([unseen, watched], 10);

    assert.deepStrictEqual(result, []);
  });

  it("treats a null updated_at as the oldest possible timestamp", () => {
    const noTimestamp: WatchProgress = makeProgress("mf-1", "work-1", "part_watched", null);
    const withTimestamp: WatchProgress = makeProgress("mf-2", "work-2", "part_watched", "2020-01-01T00:00:00.000Z");

    const result: WatchProgress[] = selectContinueWatching([noTimestamp, withTimestamp], 10);

    assert.equal(result[0].work_id, "work-2");
    assert.equal(result[1].work_id, "work-1");
  });
});

describe("selectContinueWatching: dedupe by work_id", () => {
  it("keeps only the most recently updated row per work_id", () => {
    const olderRowSameWork: WatchProgress = makeProgress(
      "mf-old", "work-1", "part_watched", "2026-01-01T00:00:00.000Z"
    );
    const newerRowSameWork: WatchProgress = makeProgress(
      "mf-new", "work-1", "part_watched", "2026-07-01T00:00:00.000Z"
    );
    const otherWork: WatchProgress = makeProgress(
      "mf-other", "work-2", "part_watched", "2026-04-01T00:00:00.000Z"
    );

    const result: WatchProgress[] = selectContinueWatching(
      [olderRowSameWork, newerRowSameWork, otherWork], 10
    );

    assert.equal(result.length, 2);
    assert.equal(result[0].media_file_id, "mf-new");
    assert.equal(result[0].work_id, "work-1");
    assert.equal(result[1].media_file_id, "mf-other");
  });

  it("does not dedupe rows that share a media_file_id-adjacent but distinct work_id", () => {
    const workA: WatchProgress = makeProgress("mf-1", "work-a", "part_watched", "2026-07-01T00:00:00.000Z");
    const workB: WatchProgress = makeProgress("mf-2", "work-b", "part_watched", "2026-06-01T00:00:00.000Z");

    const result: WatchProgress[] = selectContinueWatching([workA, workB], 10);

    assert.equal(result.length, 2);
  });
});

describe("selectContinueWatching: cap", () => {
  it("caps the result at maxCount entries, keeping the most recent ones", () => {
    const items: WatchProgress[] = [
      makeProgress("mf-0", "work-0", "part_watched", "2026-01-01T00:00:00.000Z"),
      makeProgress("mf-1", "work-1", "part_watched", "2026-02-01T00:00:00.000Z"),
      makeProgress("mf-2", "work-2", "part_watched", "2026-03-01T00:00:00.000Z"),
      makeProgress("mf-3", "work-3", "part_watched", "2026-04-01T00:00:00.000Z"),
      makeProgress("mf-4", "work-4", "part_watched", "2026-05-01T00:00:00.000Z")
    ];

    const result: WatchProgress[] = selectContinueWatching(items, 3);

    assert.equal(result.length, 3);
    assert.equal(result[0].work_id, "work-4");
    assert.equal(result[1].work_id, "work-3");
    assert.equal(result[2].work_id, "work-2");
  });

  it("returns an empty array when maxCount is zero", () => {
    const item: WatchProgress = makeProgress("mf-1", "work-1", "part_watched", "2026-07-01T00:00:00.000Z");
    const result: WatchProgress[] = selectContinueWatching([item], 0);
    assert.deepStrictEqual(result, []);
  });

  it("returns an empty array when maxCount is negative", () => {
    const item: WatchProgress = makeProgress("mf-1", "work-1", "part_watched", "2026-07-01T00:00:00.000Z");
    const result: WatchProgress[] = selectContinueWatching([item], -1);
    assert.deepStrictEqual(result, []);
  });

  it("returns every row unchanged in order when maxCount exceeds the row count", () => {
    const first: WatchProgress = makeProgress("mf-1", "work-1", "part_watched", "2026-07-01T00:00:00.000Z");
    const second: WatchProgress = makeProgress("mf-2", "work-2", "part_watched", "2026-06-01T00:00:00.000Z");
    const result: WatchProgress[] = selectContinueWatching([first, second], 100);
    assert.equal(result.length, 2);
  });
});
