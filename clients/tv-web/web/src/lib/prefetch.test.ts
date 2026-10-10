import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryCache, type ApiClient } from "@playarr-tv/api-client";
import {
  IDLE_WARM_ROUTES,
  WARM_MAX_PASSES,
  WARM_RETRY_MS,
  WARM_STAGGER_MS,
  WARM_START_DELAY_MS,
  isRouteWarm,
  prefetchRoute,
  warmSections,
} from "./prefetch";
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

describe("warmSections", () => {
  const settle = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
  };

  it("asks for every section within a second, overlapping, and survives its caller (Home) going away", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const { client, api } = fakeClient();
    warmSections(client, "en");
    expect(api.browseCatalog).not.toHaveBeenCalled();
    await settle(WARM_START_DELAY_MS + WARM_STAGGER_MS * IDLE_WARM_ROUTES.length);
    expect(api.browseCatalog).toHaveBeenCalledTimes(3);
    expect(api.listWatchlist).toHaveBeenCalledTimes(1);
    expect(api.listPlaylists).toHaveBeenCalledTimes(1);
    expect(api.getCalendar).toHaveBeenCalledTimes(1);
    for (const path of IDLE_WARM_ROUTES) expect(isRouteWarm(client, path, "en")).toBe(true);
  });

  it("runs once per scope and language, and again for another profile", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const { client, api, queries } = fakeClient();
    warmSections(client, "en");
    warmSections(client, "en");
    await settle(WARM_START_DELAY_MS + WARM_STAGGER_MS * 10);
    expect(api.listWatchlist).toHaveBeenCalledTimes(1);
    queries.setScope("other profile");
    warmSections(client, "en");
    await settle(WARM_START_DELAY_MS + WARM_STAGGER_MS * 10);
    expect(api.listWatchlist).toHaveBeenCalledTimes(2);
  });

  it("asks again for a section whose result a live resync dropped mid-flight", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const { client, api, queries } = fakeClient();
    let release: (value: { items: never[] }) => void = () => undefined;
    api.listWatchlist.mockImplementationOnce((() => new Promise((resolve) => (release = resolve as typeof release))) as never);
    warmSections(client, "en", ["/watchlist"]);
    await settle(WARM_START_DELAY_MS + 1);
    expect(api.listWatchlist).toHaveBeenCalledTimes(1);
    // The resync lands while the read is in flight: its answer must not be stored.
    queries.invalidate();
    release({ items: [] });
    await settle(1);
    expect(isRouteWarm(client, "/watchlist", "en")).toBe(false);
    await settle(WARM_RETRY_MS + WARM_STAGGER_MS);
    expect(api.listWatchlist).toHaveBeenCalledTimes(2);
    expect(isRouteWarm(client, "/watchlist", "en")).toBe(true);
  });

  it("is bounded: a section that never loads is asked for at most WARM_MAX_PASSES times", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const { client, api } = fakeClient();
    api.listWatchlist.mockRejectedValue(new Error("down") as never);
    warmSections(client, "en", ["/watchlist"]);
    await settle((WARM_RETRY_MS + WARM_STAGGER_MS) * (WARM_MAX_PASSES + 3));
    expect(api.listWatchlist).toHaveBeenCalledTimes(WARM_MAX_PASSES);
  });

  it("does nothing under save-data, and stops when told", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("navigator", { connection: { saveData: true } });
    const saving = fakeClient();
    warmSections(saving.client, "en");
    await settle(WARM_START_DELAY_MS + 5000);
    expect(saving.api.listWatchlist).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.stubGlobal("window", globalThis);
    const { client, api } = fakeClient();
    const stop = warmSections(client, "en");
    stop();
    await settle(WARM_START_DELAY_MS + 5000);
    expect(api.listWatchlist).not.toHaveBeenCalled();
  });
});
