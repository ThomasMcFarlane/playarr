import { describe, expect, it, vi } from "vitest";
import { QueryCache, type ApiClient } from "./index";
import { CALENDAR_QUERY_TAGS, calendarCacheKey, prefetchCalendar } from "./hooks";

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

  it("a calendar live event marks the stored window stale", async () => {
    const queries = new QueryCache();
    queries.setScope("profile");
    const getCalendar = vi.fn(async () => ({ entries: [], sources: [] }));
    prefetchCalendar(fakeClient(queries, getCalendar as unknown as ApiClient["getCalendar"]), {
      start: "2026-11-01",
      end: "2026-11-30",
    });
    await vi.waitFor(() => expect(queries.peek(calendarCacheKey("2026-11-01", "2026-11-30"))).toBeDefined());
    queries.invalidate(["calendar"]);
    expect(queries.peek(calendarCacheKey("2026-11-01", "2026-11-30"))?.stale).toBe(true);
  });
});

describe("an abandoned calendar prefetch", () => {
  const WINDOW = { start: "2026-11-01", end: "2026-11-30" };
  const RESPONSE = { start: WINDOW.start, end: WINDOW.end, entries: [], sources: [] };

  /** Like `fetch`: answers after `ms`, rejects with an AbortError the moment its signal aborts. */
  function slowCalendar(ms: number) {
    return vi.fn(async (_params: unknown, options?: { signal?: AbortSignal }) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        options?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
      return RESPONSE;
    });
  }
  const screenFetch = (queries: QueryCache, getCalendar: ReturnType<typeof slowCalendar>) =>
    queries.fetch(calendarCacheKey(WINDOW.start, WINDOW.end), () => getCalendar(WINDOW) as Promise<typeof RESPONSE>, {
      tags: CALENDAR_QUERY_TAGS,
    });

  it("opening the page right after the prefetch was cancelled loads", async () => {
    const queries = new QueryCache();
    queries.setScope("profile");
    const getCalendar = slowCalendar(20);
    const controller = new AbortController();
    prefetchCalendar(fakeClient(queries, getCalendar as unknown as ApiClient["getCalendar"]), WINDOW, controller.signal);
    controller.abort();
    await expect(screenFetch(queries, getCalendar)).resolves.toEqual(RESPONSE);
    expect(queries.peek(calendarCacheKey(WINDOW.start, WINDOW.end))?.data).toEqual(RESPONSE);
  });

  it("a page that joined the prefetch keeps it alive when the prefetch is cancelled", async () => {
    const queries = new QueryCache();
    queries.setScope("profile");
    const getCalendar = slowCalendar(20);
    const controller = new AbortController();
    prefetchCalendar(fakeClient(queries, getCalendar as unknown as ApiClient["getCalendar"]), WINDOW, controller.signal);
    const page = screenFetch(queries, getCalendar);
    controller.abort();
    await expect(page).resolves.toEqual(RESPONSE);
  });

  it("a cancelled prefetch stores nothing and the next fetch starts clean", async () => {
    const queries = new QueryCache();
    queries.setScope("profile");
    const getCalendar = slowCalendar(20);
    const controller = new AbortController();
    prefetchCalendar(fakeClient(queries, getCalendar as unknown as ApiClient["getCalendar"]), WINDOW, controller.signal);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(queries.peek(calendarCacheKey(WINDOW.start, WINDOW.end))).toBeUndefined();
    await expect(screenFetch(queries, getCalendar)).resolves.toEqual(RESPONSE);
  });
});
