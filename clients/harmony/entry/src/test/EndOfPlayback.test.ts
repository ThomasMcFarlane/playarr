// entry/src/test/EndOfPlayback.test.ts
//
// Pure Node unit tests for core/EndOfPlayback.ts (end-of-playback spec,
// sections 1-5 and 11).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  EndOfPlaybackMachine,
  buildSeriesQueue,
  buildAlbumQueue,
  pickSuggestions,
  normaliseResumeMs,
  END_SCREEN_COUNTDOWN_SECONDS
} from "../main/ets/core/EndOfPlayback";
import type { Work } from "../main/ets/core/Types/Work";
import type { SeasonDetail } from "../main/ets/core/Types/WorkDetail";

function season(number: number, eps: Array<[number, string | null]>): SeasonDetail {
  return {
    season: { id: "s" + number, series_work_id: "w", season_number: number, monitored: true, availability: "available" },
    episodes: eps.map(([n, file]) => ({
      episode: { id: "e" + number + "-" + n, season_id: "s" + number, episode_number: n, title: "Ep " + n, images: [], monitored: true, availability: "available" },
      media_file_id: file
    }))
  } as SeasonDetail;
}

function work(id: string): Work {
  return { id: id } as Work;
}

describe("EndOfPlaybackMachine", () => {
  it("shows the ended card when nothing follows", () => {
    const m = new EndOfPlaybackMachine(false);
    m.onEnded();
    assert.equal(m.phase, "endCard");
    assert.equal(m.playNow(), "none");
    assert.equal(m.tick(), "none");
  });

  it("counts down 10 seconds then plays next", () => {
    const m = new EndOfPlaybackMachine(true);
    m.onEnded();
    assert.equal(m.phase, "upNext");
    assert.equal(m.secondsRemaining, END_SCREEN_COUNTDOWN_SECONDS);
    for (let i = 0; i < END_SCREEN_COUNTDOWN_SECONDS - 1; i++) {
      assert.equal(m.tick(), "none");
    }
    assert.equal(m.tick(), "playNext");
    assert.equal(m.secondsRemaining, 0);
  });

  it("play now skips the countdown", () => {
    const m = new EndOfPlaybackMachine(true);
    m.onEnded();
    assert.equal(m.playNow(), "playNext");
  });

  it("cancel is sticky and keeps play next on the ended card", () => {
    const m = new EndOfPlaybackMachine(true, true, 5);
    m.onEnded();
    m.cancelCountdown();
    assert.equal(m.phase, "endCard");
    assert.equal(m.countdownCancelled, true);
    assert.equal(m.tick(), "none");
    m.onEnded();
    assert.equal(m.phase, "endCard");
    assert.equal(m.playNow(), "playNext");
  });

  it("replay returns to playing and can end again", () => {
    const m = new EndOfPlaybackMachine(false);
    m.onEnded();
    assert.equal(m.replay(), "replay");
    assert.equal(m.phase, "playing");
    m.onEnded();
    assert.equal(m.phase, "endCard");
  });

  it("exit only acts once the end UI is shown", () => {
    const m = new EndOfPlaybackMachine(true);
    assert.equal(m.exit(), "none");
    m.onEnded();
    assert.equal(m.exit(), "exit");
  });

  it("autoplay off shows up next without a running countdown", () => {
    const m = new EndOfPlaybackMachine(true, false, 3);
    m.onEnded();
    assert.equal(m.phase, "upNext");
    assert.equal(m.countdownRunning(), false);
    assert.equal(m.tick(), "none");
    assert.equal(m.secondsRemaining, 3);
    assert.equal(m.playNow(), "playNext");
  });

  it("a paused countdown holds its second", () => {
    const m = new EndOfPlaybackMachine(true, true, 3);
    m.onEnded();
    m.paused = true;
    m.tick();
    assert.equal(m.secondsRemaining, 3);
    m.paused = false;
    m.tick();
    assert.equal(m.secondsRemaining, 2);
  });
});

describe("immediate (audio) chaining", () => {
  it("chains to the next track without showing a card", () => {
    const m = new EndOfPlaybackMachine(true, true, 10, true);
    assert.equal(m.onEnded(), "playNext");
    assert.equal(m.phase, "playing");
  });

  it("shows the ended card once the last track finishes", () => {
    const m = new EndOfPlaybackMachine(false, true, 10, true);
    assert.equal(m.onEnded(), "none");
    assert.equal(m.phase, "endCard");
  });

  it("queues playable tracks after the current one in disc and track order", () => {
    const track = (id: string, disc: number, n: number, file: string | null) => ({
      track: { id: id, album_id: "a", disc_number: disc, track_number: n, title: "T" + id, availability: "available" },
      media_file_id: file
    });
    const albums = [{ album: { id: "a" }, tracks: [track("3", 1, 3, "f3"), track("1", 1, 1, "f1"), track("2", 1, 2, null), track("4", 2, 1, "f4")] }];
    const queue = buildAlbumQueue("w", albums as never, "f1");
    assert.deepEqual(queue.map((q) => q.mediaFileId), ["f3", "f4"]);
    assert.equal(queue[0].immediate, true);
  });
});

describe("buildSeriesQueue", () => {
  it("queues playable episodes after the current one across seasons", () => {
    const s1 = season(1, [[1, "f1"], [2, "f2"], [3, null], [4, "f4"]]);
    const s2 = season(2, [[1, "g1"]]);
    const queue = buildSeriesQueue("w", "Show", [s2, s1], "f2");
    assert.deepEqual(queue.map((q) => q.mediaFileId), ["f4", "g1"]);
    assert.equal(queue[0].title, "Show S1:E4 Ep 4");
    assert.equal(queue[0].workId, "w");
    assert.equal(queue[0].immediate, false);
  });

  it("is empty for the last episode or an unknown file", () => {
    const s1 = season(1, [[1, "f1"]]);
    assert.equal(buildSeriesQueue("w", "Show", [s1], "f1").length, 0);
    assert.equal(buildSeriesQueue("w", "Show", [s1], "nope").length, 0);
  });
});

describe("pickSuggestions", () => {
  it("drops the finished work and duplicates and caps the row", () => {
    const list = [work("cur"), work("a"), work("a"), work("b"), work("c")];
    const result = pickSuggestions(list, "cur", 2);
    assert.deepEqual(result.map((w) => w.id), ["a", "b"]);
  });
});

describe("normaliseResumeMs", () => {
  it("replays from 0 within 5 s of the end", () => {
    assert.equal(normaliseResumeMs(0, 100000), 0);
    assert.equal(normaliseResumeMs(50000, 100000), 50000);
    assert.equal(normaliseResumeMs(94999, 100000), 94999);
    assert.equal(normaliseResumeMs(95000, 100000), 0);
    assert.equal(normaliseResumeMs(5000, 0), 5000);
  });
});
