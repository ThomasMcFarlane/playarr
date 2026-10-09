import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryCache, type ApiClient } from "@playarr-tv/api-client";
import { IDLE_WARM_GAP_MS, IDLE_WARM_ROUTES, prefetchRoute, warmSectionsAtIdle } from "./prefetch";
import { peekPlaylistTracks } from "./playlistsData";
import { peekWatchlist } from "./watchlistData";

function fakeClient() {
  const queries = new QueryCache();
  queries.setScope("profile");
  const api = {
    browseCatalog: vi.fn(async () => ({ items: [], total: 0 })),
    getHomeRails: vi.fn(async () => ({ rails: [] })),
    getCalendar: vi.fn(async () => ({ start: "", end: "", entries: [], sources: [] })),
    listWatchlist: vi.fn(async () => ({ items: [{ title: { title_key: "k" } }] })),
    listPlaylists: vi.fn(async () => [{ id: "p1", name: "A" }]),
    listPlaylistItems: vi.fn(async () => [{ id: "i1", work_id: "w1", position: 0, track_id: null }]),
    getWork: vi.fn(async () => ({ work: { id: "w1" }, children: "Movie" })),
  };
  return { client: { queries, ...api } as unknown as ApiClient, api, queries };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("prefetchRoute", () => {
  it("warms a page's first-screen data under the page's own keys, at low priority", async () => {
    const { client, api } = fakeClient();
    prefetchRoute(client, "/watchlist", "en");
    prefetchRoute(client, "/playlists", "en");
    prefetchRoute(client, "/calendar", "en");
    prefetchRoute(client, "/series", "en");
    await vi.waitFor(() => expect(peekPlaylistTracks(client)).toBeDefined());
    expect(peekWatchlist(client)).toHaveLength(1);
    expect(api.listWatchlist).toHaveBeenCalledWith(expect.objectContaining({ priority: "low" }));
    expect(api.getCalendar).toHaveBeenCalledTimes(1);
    expect(api.browseCatalog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ priority: "low" }));
  });

  it("does nothing for Search (it opens idle) and while the cache is off", () => {
    const { client, api, queries } = fakeClient();
    prefetchRoute(client, "/search", "en");
    queries.setScope(undefined);
    prefetchRoute(client, "/watchlist", "en");
    expect(api.listWatchlist).not.toHaveBeenCalled();
    expect(api.browseCatalog).not.toHaveBeenCalled();
  });

  it("cancels a request nobody else waits for", async () => {
    const { client, api } = fakeClient();
    let seen: AbortSignal | undefined;
    api.listWatchlist.mockImplementation(((options: { signal?: AbortSignal }) => {
      seen = options.signal;
      return new Promise(() => undefined);
    }) as never);
    const cancel = prefetchRoute(client, "/watchlist", "en");
    await vi.waitFor(() => expect(seen).toBeDefined());
    cancel();
    expect(seen?.aborted).toBe(true);
  });
});

describe("warmSectionsAtIdle", () => {
  it("warms a bounded list of sections one after another, and stops when cancelled", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const { client, api } = fakeClient();
    const stop = warmSectionsAtIdle(client, "en");
    expect(api.browseCatalog).not.toHaveBeenCalled();
    vi.advanceTimersByTime(IDLE_WARM_GAP_MS * (IDLE_WARM_ROUTES.length + 3));
    expect(api.browseCatalog).toHaveBeenCalledTimes(IDLE_WARM_ROUTES.length);
    stop();
    const again = warmSectionsAtIdle(client, "en");
    again();
    vi.advanceTimersByTime(IDLE_WARM_GAP_MS * 10);
    expect(api.browseCatalog).toHaveBeenCalledTimes(IDLE_WARM_ROUTES.length);
  });
});
