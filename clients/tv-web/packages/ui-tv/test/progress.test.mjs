import assert from "node:assert/strict";
import test from "node:test";
import { fetchResumeSeconds, ProgressReporter } from "../dist/lib/progress.js";

function fakeEngine() {
  let state = { state: "idle", currentTimeSeconds: 0, durationSeconds: 100 };
  let listener = () => {};
  return {
    getState: () => state,
    onStateChange: (l) => ((listener = l), () => {}),
    emit(patch) {
      state = { ...state, ...patch };
      listener(state);
    },
  };
}
function fakeClient() {
  const writes = [];
  return {
    writes,
    getWatchProgress: async () => ({ state: "part_watched", position_ms: 42000 }),
    updateWatchProgress: async (id, u) => void writes.push(u),
  };
}

test("resume point comes from part_watched server progress", async () => {
  assert.equal(await fetchResumeSeconds(fakeClient(), "m"), 42);
  assert.equal(
    await fetchResumeSeconds({ getWatchProgress: async () => ({ state: "unseen", position_ms: 0 }) }, "m"),
    undefined
  );
  assert.equal(
    await fetchResumeSeconds({ getWatchProgress: async () => { throw new Error("x"); } }, "m"),
    undefined
  );
});

test("nothing is written before playback started, even with a resume position loaded", async () => {
  const e = fakeEngine(), c = fakeClient();
  const r = new ProgressReporter(c, "m", e);
  r.start();
  e.emit({ state: "loading", currentTimeSeconds: 42 });
  await r.flush();
  e.emit({ state: "paused", currentTimeSeconds: 0 });
  await r.flush();
  assert.equal(c.writes.length, 0);
});

test("heartbeat every interval while playing, flush on pause and exit", async () => {
  let t = 0;
  const e = fakeEngine(), c = fakeClient();
  const r = new ProgressReporter(c, "m", e, () => t, 10_000);
  r.start();
  t = 10_000;
  e.emit({ state: "playing", currentTimeSeconds: 10 });
  assert.equal(c.writes.length, 1);
  t = 12_000;
  e.emit({ state: "playing", currentTimeSeconds: 12 });
  assert.equal(c.writes.length, 1);
  e.emit({ state: "paused", currentTimeSeconds: 13 });
  assert.equal(c.writes.length, 2);
  await r.flush();
  assert.deepEqual(c.writes[2], { positionMs: 13000, durationMs: 100000, completed: false });
});

test("end of playback writes completed", async () => {
  let t = 0;
  const e = fakeEngine(), c = fakeClient();
  const r = new ProgressReporter(c, "m", e, () => t);
  r.start();
  t = 20_000;
  e.emit({ state: "playing", currentTimeSeconds: 99 });
  e.emit({ state: "ended", currentTimeSeconds: 100 });
  assert.equal(c.writes.at(-1).completed, true);
});
