import { describe, expect, it, vi } from "vitest";
import { QueryCache } from "@playarr-tv/api-client";
import { withQueryCacheInvalidation, queryTagsForInvalidations } from "./cacheInvalidation";
import { createLiveRegistry } from "./registry";
import { mapChangeToInvalidations } from "./mapping";

function filled() {
  const cache = new QueryCache();
  cache.setScope("user:profile");
  cache.set("home", 1, ["catalog", "progress", "watchlist"]);
  cache.set("library", 2, ["catalog"]);
  cache.set("progress", 3, ["progress"]);
  cache.set("playlists", 4, ["playlists"]);
  cache.set("calendar", 5, ["calendar"]);
  cache.set("household", 6, ["household"]);
  cache.set("untagged", 7);
  return cache;
}

const KEYS = ["home", "library", "progress", "playlists", "calendar", "household", "untagged"];
/** The entries still fresh: a live event marks what it touches stale but keeps the copy for the next paint. */
const kept = (cache: QueryCache) => KEYS.filter((key) => cache.peek(key)?.stale === false);
const held = (cache: QueryCache) => KEYS.filter((key) => cache.peek(key) !== undefined);

describe("queryTagsForInvalidations", () => {
  it("maps each live area to the cache tags that show it", () => {
    expect(queryTagsForInvalidations([{ area: "progress" }])).toEqual(["progress"]);
    expect(queryTagsForInvalidations([{ area: "catalog", key: "w1" }])).toEqual(["catalog"]);
    expect(queryTagsForInvalidations([{ area: "playlists" }, { area: "watchlist" }])).toEqual(["playlists", "watchlist"]);
    expect(queryTagsForInvalidations([{ area: "calendar" }])).toEqual(["calendar"]);
    expect(queryTagsForInvalidations([{ area: "household" }])).toEqual(["household"]);
  });

  it("caches nothing for downloads and admin, and drops everything for account changes", () => {
    expect(queryTagsForInvalidations([{ area: "downloads" }, { area: "admin" }])).toEqual([]);
    expect(queryTagsForInvalidations([{ area: "account" }])).toBeUndefined();
  });
});

describe("withQueryCacheInvalidation", () => {
  it("marks stored copies stale at once, before the debounced refetch runs, and keeps them for the next paint", () => {
    vi.useFakeTimers();
    const cache = filled();
    const registry = createLiveRegistry({ debounceMs: 200 });
    const refetch = vi.fn();
    registry.register({ areas: ["progress"] }, refetch);
    const live = withQueryCacheInvalidation(registry, cache);

    live.invalidate(mapChangeToInvalidations({ type: "watch", entity: "work", id: "w1", changed: ["progress"] }));

    expect(kept(cache)).toEqual(["library", "playlists", "calendar", "household", "untagged"]);
    expect(held(cache)).toEqual(KEYS);
    expect(refetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(refetch).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("an account change marks every stored copy stale", () => {
    const cache = filled();
    const live = withQueryCacheInvalidation(createLiveRegistry(), cache);
    live.invalidate(mapChangeToInvalidations({ type: "account", entity: "profile", id: "u1", changed: ["policy"] }));
    expect(kept(cache)).toEqual([]);
  });

  it("resync, gap and fallback polls (refetchAll) mark every stored copy stale", () => {
    const cache = filled();
    const registry = createLiveRegistry();
    const refetch = vi.fn();
    registry.register({ areas: ["catalog"] }, refetch);
    const live = withQueryCacheInvalidation(registry, cache);
    live.refetchAll();
    expect(kept(cache)).toEqual([]);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("an in-flight read that started before the event is not stored afterwards", async () => {
    const cache = filled();
    let release!: (value: number) => void;
    const pending = cache.fetch("late", () => new Promise<number>((resolve) => (release = resolve)), { tags: ["catalog"] });
    withQueryCacheInvalidation(createLiveRegistry(), cache).invalidate([{ area: "catalog", key: "w1" }]);
    release(9);
    await pending;
    expect(cache.peek("late")).toBeUndefined();
  });

  it("leaves an event for an uncached area alone", () => {
    const cache = filled();
    const live = withQueryCacheInvalidation(createLiveRegistry(), cache);
    live.invalidate([{ area: "downloads", key: "t1" }]);
    expect(kept(cache)).toHaveLength(7);
  });
});
