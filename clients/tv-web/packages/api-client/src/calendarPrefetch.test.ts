import { describe, expect, it, vi } from "vitest";
import { QueryCache, type ApiClient } from "./index";
import { calendarCacheKey, prefetchCalendar } from "./hooks";

function fakeClient(queries: QueryCache, getCalendar: ApiClient["getCalendar"]): ApiClient {
  return { queries, getCalendar } as unknown as ApiClient;
}

describe("prefetchCalendar", () => {
  it("stores the window under the screen's key, once", async () => {
    const queries = new QueryCache();
    queries.setScope("profile");
    const getCalendar = vi.fn(async () => ({ start: "2026-11-01", end: "2026-11-30", entries: [], sources: [] }));
    const client = fakeClient(queries, getCalendar as unknown as ApiClient["getCalendar"]);
    prefetchCalendar(client, { start: "2026-11-01", end: "2026-11-30" });
    prefetchCalendar(client, { start: "2026-11-01", end: "2026-11-30" });
    await vi.waitFor(() => expect(queries.peek(calendarCacheKey("2026-11-01", "2026-11-30"))).toBeDefined());
    expect(getCalendar).toHaveBeenCalledTimes(1);
  });

  it("does nothing while the cache is off", () => {
    const queries = new QueryCache();
    const getCalendar = vi.fn();
    prefetchCalendar(fakeClient(queries, getCalendar as unknown as ApiClient["getCalendar"]), {
      start: "2026-11-01",
      end: "2026-11-30",
    });
    expect(getCalendar).not.toHaveBeenCalled();
  });

  it("a calendar live event drops the stored window", async () => {
    const queries = new QueryCache();
    queries.setScope("profile");
    const getCalendar = vi.fn(async () => ({ entries: [], sources: [] }));
    prefetchCalendar(fakeClient(queries, getCalendar as unknown as ApiClient["getCalendar"]), {
      start: "2026-11-01",
      end: "2026-11-30",
    });
    await vi.waitFor(() => expect(queries.peek(calendarCacheKey("2026-11-01", "2026-11-30"))).toBeDefined());
    queries.invalidate(["calendar"]);
    expect(queries.peek(calendarCacheKey("2026-11-01", "2026-11-30"))).toBeUndefined();
  });
});
