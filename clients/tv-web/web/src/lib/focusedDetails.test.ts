import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryCache, type ApiClient, type WorkDetail } from "@playarr-tv/api-client";
import type { DetailsPersistence, StoredDetail } from "./detailsStore";
import { CURRENT_START_DELAY_MS, DETAIL_FRESH_MS, FocusedDetails, NEIGHBOUR_DWELL_MS } from "./focusedDetails";

interface Call {
  id: string;
  priority?: string;
  signal?: AbortSignal;
  resolve: () => void;
}

function fakeClient() {
  const queries = new QueryCache();
  queries.setScope("profile-a");
  const calls: Call[] = [];
  const planCalls: string[] = [];
  const inflight = new Set<string>();
  let peak = 0;
  const client = {
    queries,
    getWork: (id: string, options: { priority?: string; signal?: AbortSignal } = {}) =>
      new Promise<WorkDetail>((resolve, reject) => {
        inflight.add(id);
        peak = Math.max(peak, inflight.size);
        options.signal?.addEventListener("abort", () => {
          inflight.delete(id);
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
        calls.push({
          id,
          priority: options.priority,
          signal: options.signal,
          resolve: () => {
            inflight.delete(id);
            resolve({ id, work: { id, kind: id.startsWith("s") ? "series" : "movie" } } as unknown as WorkDetail);
          },
        });
      }),
    getResumePlan: (id: string) => {
      planCalls.push(id);
      return Promise.resolve({ series_work_id: id });
    },
  } as unknown as ApiClient;
  return { client, queries, calls, planCalls, inflight, peak: () => peak };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe("FocusedDetails", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("serves a stored detail in the same call, with no request", () => {
    const { client, queries, calls } = fakeClient();
    queries.set("work:a", { id: "a" }, ["catalog"]);
    const details = new FocusedDetails(client);
    details.focus("a");
    vi.advanceTimersByTime(1000);
    expect(details.peek("a")?.data).toEqual({ id: "a" });
    expect(calls).toHaveLength(0);
  });

  it("fetches an uncached focus as the high-priority current request, after the start delay", async () => {
    const { client, calls } = fakeClient();
    const details = new FocusedDetails(client);
    const seen = vi.fn();
    details.subscribe("a", seen);
    details.focus("a");
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(CURRENT_START_DELAY_MS);
    expect(calls.map((call) => [call.id, call.priority])).toEqual([["a", "high"]]);
    calls[0]!.resolve();
    await flush();
    expect(details.peek("a")?.data).toMatchObject({ id: "a" });
    expect(seen).toHaveBeenCalled();
  });

  it("warms a series' resume plan with its detail, so opening it paints the Resume button at once", async () => {
    const { client, queries, calls, planCalls } = fakeClient();
    const details = new FocusedDetails(client);
    details.focus("s1");
    vi.advanceTimersByTime(CURRENT_START_DELAY_MS);
    calls[0]!.resolve();
    await flush();
    expect(planCalls).toEqual(["s1"]);
    expect(queries.peek("resume-plan:s1")?.data).toEqual({ series_work_id: "s1" });
  });

  it("does not request a resume plan for a movie", async () => {
    const { client, calls, planCalls } = fakeClient();
    const details = new FocusedDetails(client);
    details.focus("m1");
    vi.advanceTimersByTime(CURRENT_START_DELAY_MS);
    calls[0]!.resolve();
    await flush();
    expect(planCalls).toEqual([]);
  });

  it("warms the plan of a series whose detail is already stored when focus rests on it", async () => {
    const { client, queries, planCalls } = fakeClient();
    queries.set("work:s2", { id: "s2", work: { id: "s2", kind: "series" } }, ["catalog"]);
    const details = new FocusedDetails(client);
    details.focus("s2");
    await flush();
    expect(planCalls).toEqual(["s2"]);
  });

  it("makes no request for cards a held key passes over", () => {
    const { client, calls } = fakeClient();
    const details = new FocusedDetails(client);
    for (let i = 0; i < 20; i += 1) {
      details.focus(`w${i}`);
      vi.advanceTimersByTime(30);
    }
    expect(calls.length).toBeLessThanOrEqual(1);
    expect(details.scheduler.stats().current).toBeLessThanOrEqual(1);
  });

  it("aborts the previous focus request when focus moves", () => {
    const { client, calls } = fakeClient();
    const details = new FocusedDetails(client);
    details.focus("a");
    vi.advanceTimersByTime(CURRENT_START_DELAY_MS);
    details.focus("b");
    expect(calls[0]!.signal?.aborted).toBe(true);
    vi.advanceTimersByTime(CURRENT_START_DELAY_MS);
    expect(calls.map((call) => call.id)).toEqual(["a", "b"]);
  });

  it("queues neighbours at low priority after the dwell, two at a time, behind the current", () => {
    const { client, calls, peak } = fakeClient();
    const details = new FocusedDetails(client);
    details.setNear(() => ["n1", "n2", "n3", "n4", "n5"]);
    details.focus("a");
    vi.advanceTimersByTime(CURRENT_START_DELAY_MS);
    expect(calls.map((call) => call.id)).toEqual(["a"]);
    vi.advanceTimersByTime(NEIGHBOUR_DWELL_MS);
    expect(calls.map((call) => [call.id, call.priority])).toEqual([
      ["a", "high"],
      ["n1", "low"],
      ["n2", "low"],
    ]);
    expect(peak()).toBe(3);
  });

  it("drops neighbours the next focus no longer wants and keeps the ones it still does", () => {
    const { client, calls } = fakeClient();
    const details = new FocusedDetails(client);
    details.setNear(() => ["n1", "n2", "n3"]);
    details.focus("a");
    vi.advanceTimersByTime(CURRENT_START_DELAY_MS + NEIGHBOUR_DWELL_MS);
    details.setNear(() => ["n2", "n9"]);
    details.focus("b");
    vi.advanceTimersByTime(NEIGHBOUR_DWELL_MS);
    const byId = Object.fromEntries(calls.filter((call) => call.priority === "low").map((call) => [call.id, call]));
    expect(byId.n1!.signal?.aborted).toBe(true);
    expect(byId.n2!.signal?.aborted).toBe(false);
    expect(byId.n9).toBeDefined();
  });

  it("does nothing while the query cache is off", () => {
    const { client, queries, calls } = fakeClient();
    queries.setScope(undefined);
    const details = new FocusedDetails(client);
    details.setNear(() => ["n1"]);
    details.focus("a");
    vi.advanceTimersByTime(2000);
    expect(calls).toHaveLength(0);
  });

  it("fetches the focus again after a live event dropped its stored copy", () => {
    const { client, queries, calls } = fakeClient();
    queries.set("work:a", { id: "a" }, ["catalog"]);
    const details = new FocusedDetails(client);
    details.focus("a");
    vi.advanceTimersByTime(CURRENT_START_DELAY_MS);
    expect(calls).toHaveLength(0);
    queries.invalidate(["catalog"]);
    vi.advanceTimersByTime(CURRENT_START_DELAY_MS);
    expect(calls.map((call) => call.id)).toEqual(["a"]);
  });

  it("idle warm-up does not re-request a stored copy because it grew old", () => {
    const { client, queries, calls } = fakeClient();
    queries.set("work:w1", { id: "w1" }, ["catalog"]);
    queries.set("work:w2", { id: "w2" }, ["catalog"]);
    const details = new FocusedDetails(client);
    details.setWarm(() => ["w1", "w2", "w3"]);
    // Well past the freshness window: the copies are old, not stale.
    vi.advanceTimersByTime(DETAIL_FRESH_MS * 3);
    expect(calls.map((call) => call.id)).toEqual(["w3"]);
  });

  it("release drops everything in flight and queued", () => {
    const { client, calls } = fakeClient();
    const details = new FocusedDetails(client);
    details.setNear(() => ["n1", "n2", "n3"]);
    details.focus("a");
    vi.advanceTimersByTime(CURRENT_START_DELAY_MS + NEIGHBOUR_DWELL_MS);
    details.release();
    expect(calls.every((call) => call.signal?.aborted)).toBe(true);
    expect(details.scheduler.stats()).toEqual({ current: 0, running: 0, queued: 0 });
  });
});

function fakeDisk(initial: Record<string, StoredDetail> = {}) {
  const rows = new Map<string, StoredDetail>(Object.entries(initial));
  const calls: string[] = [];
  const disk: DetailsPersistence = {
    get: async (scope, id) => {
      calls.push(`get ${scope} ${id}`);
      return rows.get(`${scope}/${id}`);
    },
    put: async (scope, id, data, _tags, at) => {
      calls.push(`put ${scope} ${id}`);
      rows.set(`${scope}/${id}`, { data, at });
    },
    invalidate: async (scope, tags) => {
      calls.push(`invalidate ${scope} ${tags ? tags.join("+") : "all"}`);
      rows.clear();
    },
    purgeExcept: async (scope) => {
      calls.push(`purgeExcept ${scope}`);
    },
  };
  return { disk, rows, calls };
}

describe("FocusedDetails persistence", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("paints a stored detail from disk as a first paint and revalidates it", async () => {
    const { client, calls } = fakeClient();
    const { disk } = fakeDisk({ "profile-a/a": { data: { id: "a", from: "disk" } as unknown as WorkDetail, at: Date.now() - 3_600_000 } });
    const details = new FocusedDetails(client, undefined, disk);
    const seen = vi.fn();
    details.subscribe("a", seen);
    details.focus("a");
    await flush();
    expect((details.peek("a")?.data as unknown as { from: string }).from).toBe("disk");
    expect(seen).toHaveBeenCalled();
    // The disk copy is an hour old: it is shown, and the network request still follows.
    vi.advanceTimersByTime(CURRENT_START_DELAY_MS);
    expect(calls.map((call) => call.id)).toEqual(["a"]);
  });

  it("does not fetch for a disk copy that is still fresh", async () => {
    const { client, calls } = fakeClient();
    const { disk } = fakeDisk({ "profile-a/a": { data: { id: "a" } as unknown as WorkDetail, at: Date.now() - 1000 } });
    const details = new FocusedDetails(client, undefined, disk);
    details.focus("a");
    await flush();
    vi.advanceTimersByTime(CURRENT_START_DELAY_MS);
    expect(calls).toHaveLength(0);
  });

  it("discards a disk read that a live event overtook", async () => {
    const { client, queries } = fakeClient();
    const { disk } = fakeDisk({ "profile-a/a": { data: { id: "a" } as unknown as WorkDetail, at: Date.now() - 3_600_000 } });
    const details = new FocusedDetails(client, undefined, disk);
    details.focus("a");
    queries.invalidate(["progress"]);
    await flush();
    expect(details.peek("a")).toBeUndefined();
  });

  it("writes a fetched detail through to disk", async () => {
    const { client, calls } = fakeClient();
    const { disk, rows } = fakeDisk();
    const details = new FocusedDetails(client, undefined, disk);
    details.focus("a");
    vi.advanceTimersByTime(CURRENT_START_DELAY_MS);
    calls[0]!.resolve();
    await flush();
    expect(rows.has("profile-a/a")).toBe(true);
  });

  it("drops the stored rows a live event touches, and other accounts' rows on a scope change", async () => {
    const { client, queries } = fakeClient();
    const { disk, calls } = fakeDisk();
    new FocusedDetails(client, undefined, disk);
    queries.invalidate(["watchlist"]);
    queries.invalidate();
    queries.setScope("profile-b");
    queries.setScope(undefined);
    expect(calls).toEqual([
      "invalidate profile-a watchlist",
      "invalidate profile-a all",
      "purgeExcept profile-b",
      "purgeExcept undefined",
    ]);
  });

  it("keeps working when the disk store fails", async () => {
    const { client, calls } = fakeClient();
    const broken: DetailsPersistence = {
      get: () => Promise.reject(new Error("blocked")),
      put: () => Promise.reject(new Error("full")),
      invalidate: () => Promise.reject(new Error("x")),
      purgeExcept: () => Promise.reject(new Error("x")),
    };
    const details = new FocusedDetails(client, undefined, broken);
    details.focus("a");
    vi.advanceTimersByTime(CURRENT_START_DELAY_MS);
    calls[0]!.resolve();
    await flush();
    expect(details.peek("a")?.data).toMatchObject({ id: "a" });
  });
});
