import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryCache, type ApiClient, type WorkDetail } from "@playarr-tv/api-client";
import { CURRENT_START_DELAY_MS, FocusedDetails, NEIGHBOUR_DWELL_MS } from "./focusedDetails";

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
            resolve({ id } as unknown as WorkDetail);
          },
        });
      }),
  } as unknown as ApiClient;
  return { client, queries, calls, inflight, peak: () => peak };
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
    expect(details.peek("a")?.data).toEqual({ id: "a" });
    expect(seen).toHaveBeenCalled();
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
