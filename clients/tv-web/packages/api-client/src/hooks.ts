/**
 * @playarr-tv/api-client/react
 *
 * Shared React data-fetching hooks over `ApiClient`. Kept in a separate
 * subpath export (rather than the package root) so consumers that don't
 * need React (e.g. `@playarr-tv/device-auth`) never pull it in.
 *
 * These hooks are the single implementation of "loading / empty / error"
 * state handling reused by every screen that renders catalog or playback
 * data: the three TV app shells (via `@playarr-tv/ui-tv`'s screen
 * containers) and the standalone web app's pages both call these directly,
 * so the async-state semantics (and their meaning: `"idle"` before a fetch
 * is even eligible to start, `"loading"` in flight, `"empty"` a successful
 * response with nothing to show, `"error"` a rejected fetch, `"ready"` data
 * in hand) are identical everywhere rather than reimplemented per surface.
 */
import { useEffect, useRef, useState } from "react";
import type { QueryCache, QueryTag } from "./queryCache";
import type {
  ApiClient,
  BrowseCatalogParams,
  CatalogPage,
  HomeRailsResponse,
  PlaybackInfo,
  WorkDetail,
} from "./index";

export type AsyncState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "ready"; data: T };

export interface UseAsyncDataOptions<T> {
  /** When false, skips fetching entirely and reports `{status: "idle"}` -- useful while a required id is unknown. */
  enabled?: boolean;
  isEmpty?: (data: T) => boolean;
  /**
   * Live refresh hook-up: called with a `refresh` function, returns an unsubscribe.
   * `refresh` refetches in place -- the current data stays on screen (no "loading"
   * flash, no remount) and is replaced only when the new data arrives; a failed
   * background refetch keeps the old data. Pass a stable function (memoise it).
   */
  subscribe?: (refresh: () => void) => () => void;
  /**
   * Stale-while-revalidate: with a cache and a `key`, a stored copy renders at once (no loading
   * state) while a fresh one is fetched in the background and swapped in only when it differs.
   * Requests for the same key share one fetch. The cache itself decides whether it is on (it is
   * off until a signed-in account scope is set, and per account and profile after that).
   */
  cache?: { store: QueryCache; key: string; tags?: readonly QueryTag[] };
  /** Bump to run the primary fetch again (the page's Retry button): the state returns to loading. */
  retryKey?: number;
}

/**
 * Generic "fetch on mount / on dep change" hook with a shared loading/empty/error/ready
 * state shape. `deps` should be primitive/stable values (ids, stringified query objects) --
 * it is passed straight through to `useEffect`'s dependency array.
 */
export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  options: UseAsyncDataOptions<T> = {}
): AsyncState<T> {
  const { enabled = true, isEmpty, subscribe, cache, retryKey = 0 } = options;
  const stateFor = (data: T): AsyncState<T> => (isEmpty?.(data) ? { status: "empty" } : { status: "ready", data });
  const [state, setState] = useState<AsyncState<T>>(() => {
    if (!enabled) return { status: "idle" };
    const hit = cache?.store.peek<T>(cache.key);
    return hit ? stateFor(hit.data) : { status: "loading" };
  });
  // Latest closures, so a background refresh uses current params without re-subscribing.
  const latest = useRef({ fetcher, isEmpty, cache });
  latest.current = { fetcher, isEmpty, cache };
  // Bumped whenever the primary effect restarts, so an older background refresh never wins.
  const generation = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setState({ status: "idle" });
      return;
    }

    let cancelled = false;
    generation.current += 1;
    const hit = cache?.store.peek<T>(cache.key);
    if (hit) {
      // Show the stored copy now; the fetch below revalidates it.
      const stored = stateFor(hit.data);
      setState((current) => (sameAsyncState(current, stored) ? current : stored));
    } else {
      setState({ status: "loading" });
    }

    const load = cache
      ? cache.store.fetch(cache.key, fetcher, { tags: cache.tags })
      : fetcher();
    load
      .then((data) => {
        if (cancelled) return;
        const next = stateFor(data);
        setState((current) => (hit && sameAsyncState(current, next) ? current : next));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // A failed revalidation keeps the stored copy on screen.
        if (hit) return;
        setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });

    return () => {
      cancelled = true;
    };
    // `deps` is an intentionally caller-controlled dependency array (ids / stringified params),
    // not `fetcher`/`isEmpty` themselves, so callers don't need to memoize closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cache?.key, retryKey, ...deps]);

  useEffect(() => {
    if (!enabled || !subscribe) return;
    return subscribe(() => {
      const started = generation.current;
      // A live change makes any stored copy stale: drop what depends on it, then refetch (shared).
      const { cache: liveCache, fetcher: liveFetcher } = latest.current;
      if (liveCache) liveCache.store.invalidate(liveCache.tags);
      (liveCache ? liveCache.store.fetch(liveCache.key, liveFetcher, { tags: liveCache.tags }) : liveFetcher())
        .then((data) => {
          if (generation.current !== started) return;
          const next: AsyncState<T> = latest.current.isEmpty?.(data) ? { status: "empty" } : { status: "ready", data };
          setState((current) => (sameAsyncState(current, next) ? current : next));
        })
        .catch(() => undefined);
    });
  }, [enabled, subscribe]);

  return state;
}

function sameAsyncState<T>(a: AsyncState<T>, b: AsyncState<T>): boolean {
  if (a.status !== b.status) return false;
  if (a.status === "ready" && b.status === "ready") {
    try {
      return JSON.stringify(a.data) === JSON.stringify(b.data);
    } catch {
      return false;
    }
  }
  return a.status === "empty";
}

/** Browse the catalog (optionally filtered/sorted/paged); `{status: "empty"}` when the page has no items. */
export function useCatalogBrowse(
  client: ApiClient,
  params: BrowseCatalogParams = {},
  options: Pick<UseAsyncDataOptions<CatalogPage>, "subscribe" | "retryKey"> = {}
): AsyncState<CatalogPage> {
  const key = JSON.stringify(params);
  return useAsyncData(() => client.browseCatalog(params), [client, key], {
    isEmpty: (data) => data.items.length === 0,
    subscribe: options.subscribe,
    retryKey: options.retryKey,
    cache: { store: client.queries, key: `catalog:${key}`, tags: ["catalog"] },
  });
}

/** The caller's server-computed Home rails; `{status: "empty"}` when none have items. */
export function useHomeRails(
  client: ApiClient,
  params: { lang?: string; library?: "movie" | "series" | "artist" } = {},
  options: Pick<UseAsyncDataOptions<HomeRailsResponse>, "subscribe" | "retryKey"> = {}
): AsyncState<HomeRailsResponse> {
  const key = JSON.stringify(params);
  return useAsyncData(() => client.getHomeRails(params), [client, key], {
    isEmpty: (data) => data.rails.length === 0,
    subscribe: options.subscribe,
    retryKey: options.retryKey,
    cache: { store: client.queries, key: `home:${key}`, tags: ["catalog", "progress", "watchlist"] },
  });
}

/** Fetch a single work's full detail tree. Idle until `workId` is defined. */
export function useWorkDetail(
  client: ApiClient,
  workId: string | undefined,
  options: Pick<UseAsyncDataOptions<WorkDetail>, "subscribe" | "retryKey"> = {}
): AsyncState<WorkDetail> {
  return useAsyncData(() => client.getWork(workId as string), [client, workId], {
    enabled: Boolean(workId),
    subscribe: options.subscribe,
    retryKey: options.retryKey,
    cache: { store: client.queries, key: `work:${workId}`, tags: ["catalog", "progress", "watchlist"] },
  });
}

/**
 * Warms the query cache with a work's detail so opening it paints from the stored copy. A no-op
 * while the cache is off (signed out, or a joined multi-server client) and when one is stored or
 * already loading.
 */
export function prefetchWorkDetail(client: ApiClient, workId: string): void {
  const { queries } = client;
  if (!queries.enabled) return;
  void queries
    .fetch(`work:${workId}`, () => client.getWork(workId), { tags: ["catalog", "progress", "watchlist"], ttlMs: 30_000 })
    .catch(() => undefined);
}

/** Warms Home's rails (same key as `useHomeRails`). */
export function prefetchHomeRails(client: ApiClient, params: { lang?: string; library?: "movie" | "series" | "artist" } = {}): void {
  const { queries } = client;
  if (!queries.enabled) return;
  void queries
    .fetch(`home:${JSON.stringify(params)}`, () => client.getHomeRails(params), {
      tags: ["catalog", "progress", "watchlist"],
      ttlMs: 15_000,
    })
    .catch(() => undefined);
}

/** What the calendar shows depends on the library, the viewer's progress and watchlist, and releases. */
export const CALENDAR_QUERY_TAGS = ["calendar", "catalog", "progress", "watchlist"] as const;

/** The query-cache key of one calendar fetch window (shared by the screen and the prefetch). */
export function calendarCacheKey(start: string, end: string): string {
  return `calendar:${start}:${end}`;
}

/**
 * Warms the query cache with a calendar window (the neighbouring period) so stepping to it paints
 * from the stored copy. A no-op while the cache is off and when one is stored or already loading.
 */
export function prefetchCalendar(client: ApiClient, window: { start: string; end: string }): void {
  const { queries } = client;
  if (!queries.enabled) return;
  void queries
    .fetch(calendarCacheKey(window.start, window.end), () => client.getCalendar(window), {
      tags: CALENDAR_QUERY_TAGS,
      ttlMs: 60_000,
    })
    .catch(() => undefined);
}

export interface PlaybackCapabilities {
  containers?: string;
  videoCodecs?: string;
  audioCodecs?: string;
  maxBitrateBps?: number;
  profile?: string;
  /** Force the requested rendition instead of direct-playing the source (a quality chosen in the player). */
  forceTranscode?: boolean;
}

/** Negotiate playback for a MediaFile. Idle until `mediaFileId` is defined. */
export function usePlaybackInfo(
  client: ApiClient,
  mediaFileId: string | undefined,
  capabilities: PlaybackCapabilities = {}
): AsyncState<PlaybackInfo> {
  const key = JSON.stringify(capabilities);
  return useAsyncData(
    () => client.getPlaybackInfo(mediaFileId as string, capabilities),
    [client, mediaFileId, key],
    { enabled: Boolean(mediaFileId) }
  );
}
