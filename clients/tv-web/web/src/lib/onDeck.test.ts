import { describe, expect, it } from "vitest";
import type { ResumePlan, WatchProgress, Work } from "@playarr-tv/api-client";
import { loadOnDeck, type OnDeckClient, type OnDeckEntry } from "./onDeck";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const progress = {
  media_file_id: "f3",
  work_id: "w1",
  state: "part_watched",
  updated_at: "2026-10-05T00:00:00Z",
} as WatchProgress;

const stackedPlan = {
  series_work_id: "w1",
  needs_choice: true,
  target: { media_file_id: "f3" },
  options: [{ media_file_id: "f3" }, { media_file_id: "f2" }],
} as unknown as ResumePlan;

const series = {
  work: { id: "w1", kind: "series", title: "Test Series G" } as Work,
  children: {
    Series: [
      {
        season: { season_number: 1 },
        episodes: [{ media_file_id: "f3", episode: { episode_number: 3, title: "Test Episode" } }],
      },
    ],
  },
};

/** A client whose every call takes `rttMs` per round trip, like a ~200 ms link x many hops. */
function slowClient(rttMs: number): OnDeckClient {
  return {
    listResumePlans: async () => (await sleep(rttMs * 2), [stackedPlan]),
    listWatchProgress: async () => (await sleep(rttMs * 2), [progress]),
    getWork: async () => (await sleep(rttMs * 2), series as never),
  };
}

function collect() {
  const seen: { plans?: Map<string, ResumePlan>; entries?: OnDeckEntry[]; rows?: WatchProgress[] } = {};
  return {
    seen,
    sink: {
      isActive: () => true,
      onProgress: (rows: WatchProgress[]) => void (seen.rows = rows),
      onStackedPlans: (plans: Map<string, ResumePlan>) => void (seen.plans = plans),
      onEntries: (entries: OnDeckEntry[]) => void (seen.entries = entries),
    },
  };
}

describe("loadOnDeck on a slow link", () => {
  it("applies the stacked plan and On Deck entry even when they arrive long after Home's wait deadline", async () => {
    // Two sequential slow hops (progress, then detail): 400 + 400 ms here stands in for
    // several seconds on the real link; the loader must not care how late it is.
    const { seen, sink } = collect();
    await loadOnDeck(slowClient(200), sink);
    expect(seen.rows).toHaveLength(1);
    expect(seen.plans?.get("w1")?.options).toHaveLength(2);
    expect(seen.entries).toHaveLength(1);
    const entry = seen.entries?.[0];
    expect(entry?.work.title).toBe("Test Series G");
    expect(entry?.episode?.detail.episode.title).toBe("Test Episode");
  });

  it("reports progress and plans progressively, before the per-title detail calls finish", async () => {
    const { seen, sink } = collect();
    const done = loadOnDeck(slowClient(100), sink);
    await sleep(260);
    expect(seen.rows).toBeDefined();
    expect(seen.plans?.size).toBe(1);
    expect(seen.entries).toBeUndefined();
    await done;
    expect(seen.entries).toHaveLength(1);
  });

  it("delivers nothing once the caller is no longer active", async () => {
    const { seen, sink } = collect();
    let active = true;
    const done = loadOnDeck(slowClient(50), { ...sink, isActive: () => active });
    active = false;
    await done;
    expect(seen.entries).toBeUndefined();
  });

  it("still shows the plan when resume-plans fails outright", async () => {
    const { seen, sink } = collect();
    await loadOnDeck({ ...slowClient(5), listResumePlans: () => Promise.reject(new Error("x")) }, sink);
    expect(seen.plans?.size).toBe(0);
    expect(seen.entries).toHaveLength(1);
  });
});

describe("loadOnDeck critical path", () => {
  it("asks for the title details as soon as progress arrives, without waiting for the resume plans", async () => {
    const calls: string[] = [];
    const client: OnDeckClient = {
      listResumePlans: async () => (calls.push("plans:start"), await sleep(60), calls.push("plans:end"), [stackedPlan]),
      listWatchProgress: async () => (await sleep(5), [progress]),
      getWork: async () => (calls.push("detail:start"), series as never),
    };
    const { seen, sink } = collect();
    await loadOnDeck(client, sink);
    expect(calls.indexOf("detail:start")).toBeLessThan(calls.indexOf("plans:end"));
    // The plan still decides the lead episode.
    expect(seen.entries).toHaveLength(1);
    expect(seen.plans?.get("w1")).toBeDefined();
  });
});

describe("loadOnDeck bad rows", () => {
  it("drops only the row whose detail is malformed", async () => {
    const second = { ...progress, work_id: "w2", media_file_id: "g1", updated_at: "2026-10-04T00:00:00Z" } as WatchProgress;
    const client: OnDeckClient = {
      listResumePlans: async () => [],
      listWatchProgress: async () => [progress, second],
      // The first title's detail has no usable `work`; reading it throws.
      getWork: async (id) => (id === "w1" ? ({ work: null, children: {} } as never) : ({ work: { id: "w2", kind: "movie", title: "Test Movie A" }, children: {} } as never)),
    };
    const { seen, sink } = collect();
    await loadOnDeck(client, sink);
    expect(seen.entries?.map((e) => e.work.title)).toEqual(["Test Movie A"]);
  });
});
