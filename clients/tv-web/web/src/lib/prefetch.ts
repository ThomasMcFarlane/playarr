import { useEffect } from "react";
import type { ApiClient, Work } from "@playarr-tv/api-client";
import { prefetchCalendar, prefetchHomeRails } from "@playarr-tv/api-client/react";
import { focusedDetailsFor } from "./focusedDetails";
import { prefetchWorkArtwork } from "./artwork";
import { useApiClient } from "./ApiClientProvider";
import { IS_TV } from "./clientPlatform";
import { localeTagFor } from "./i18n/languages";
import { anchorForView, defaultCalendarView, fetchWindow, localDayOf, visibleRange, weekStartsOn } from "./calendar";
import { prefetchPlaylists } from "./playlistsData";
import { prefetchWatchlist } from "./watchlistData";
import {
  libraryFirstPageKey,
  libraryFirstPageParams,
  libraryImageKinds,
  parseLibraryView,
  storedLibraryView,
  type LibraryKind,
} from "./libraryView";

/** How long a card must hold focus before its detail and hero art are fetched ahead of a click. */
export const DWELL_PREFETCH_MS = 200;

/** How long a nav item must hold focus before its page's first-screen data is fetched. */
export const NAV_DWELL_PREFETCH_MS = 150;

/**
 * Fetches what opening `work` will need: its detail (as the current, high-priority request, which supersedes
 * the previous one: see `FocusedDetails`) and its full-screen backdrop.
 */
export function prefetchWorkOpen(client: ApiClient, work: Pick<Work, "id" | "images">): void {
  if (!client.queries.enabled) return;
  focusedDetailsFor(client).focus(work.id);
  prefetchWorkArtwork(client, work, ["backdrop", "poster"], 1920);
}

/**
 * Prefetches `work` once it has been `active` (focused or selected) for the dwell time. Moving
 * focus on sooner cancels it, so holding a D-pad key across a rail fetches nothing.
 */
export function useDwellPrefetch(work: Pick<Work, "id" | "images">, active: boolean): void {
  const client = useApiClient();
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => prefetchWorkOpen(client, work), DWELL_PREFETCH_MS);
    return () => window.clearTimeout(timer);
  }, [active, client, work]);
}

/** How many artwork images of a prefetched page are fetched ahead (about one screen row on a TV). */
export const ROUTE_ARTWORK_PREFETCH = 12;

const LIBRARY_ROUTES: Record<string, LibraryKind> = {
  "/movies": "movie",
  "/series": "series",
  "/music": "artist",
  "/sites": "site",
};

/** The sections warmed at idle once Home has loaded, most likely first. A fixed list is the bound. */
export const IDLE_WARM_ROUTES: readonly string[] = ["/movies", "/series", "/music", "/calendar", "/watchlist", "/playlists"];
/** Pause between two idle warm-ups, so the sections never queue up behind each other or a click. */
export const IDLE_WARM_GAP_MS = 800;

function calendarFirstWindow(language: string): { start: string; end: string } {
  const view = defaultCalendarView({
    isTv: IS_TV,
    matches: (query) =>
      typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false,
  });
  const anchor = anchorForView(view, localDayOf(new Date()));
  return fetchWindow(visibleRange(view, anchor, weekStartsOn(localeTagFor(language))));
}

/**
 * Prefetches the data a top-level route shows first: the same requests the page makes on mount, under the
 * same query-cache keys, at low priority. The returned function cancels it (focus moved on). Routes with no
 * first-screen data (Search opens idle) do nothing.
 */
export function prefetchRoute(client: ApiClient, path: string, language: string): () => void {
  const queries = client.queries;
  if (!queries.enabled) return () => undefined;
  const controller = new AbortController();
  const { signal } = controller;
  const cancel = () => controller.abort();
  if (path === "/") {
    prefetchHomeRails(client, { lang: language }, signal);
  } else if (path === "/calendar") {
    prefetchCalendar(client, calendarFirstWindow(language), signal);
  } else if (path === "/playlists") {
    prefetchPlaylists(client, signal);
  } else if (path === "/watchlist") {
    prefetchWatchlist(client, signal);
  } else if (LIBRARY_ROUTES[path]) {
    const kind = LIBRARY_ROUTES[path]!;
    // The screen's own defaults for a bare URL: the last view chosen for this kind.
    const { sort, order, view } = parseLibraryView(new URLSearchParams(), kind, storedLibraryView(kind));
    const params = libraryFirstPageParams(kind, sort, order);
    void queries
      .fetch(libraryFirstPageKey(params), (flight) => client.browseCatalog(params, { signal: flight, priority: "low" }), {
        tags: ["catalog"],
        ttlMs: 15_000,
        signal,
      })
      .then((page) => {
        // The screen's first visible row: have its artwork decoded and cached before it mounts.
        for (const work of page.items.slice(0, ROUTE_ARTWORK_PREFETCH)) {
          prefetchWorkArtwork(client, work, libraryImageKinds(view));
        }
      })
      .catch(() => undefined);
  }
  return cancel;
}

/**
 * Once Home has painted, warms the likeliest next sections one after another while the browser is idle.
 * Bounded by `IDLE_WARM_ROUTES`; skipped when the user asked to save data. Returns the cancel function.
 */
export function warmSectionsAtIdle(
  client: ApiClient,
  language: string,
  routes: readonly string[] = IDLE_WARM_ROUTES
): () => void {
  if (!client.queries.enabled) return () => undefined;
  const connection = (navigator as { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return () => undefined;
  let stopped = false;
  let timer = 0;
  let idleHandle = 0;
  let cancelCurrent: () => void = () => undefined;
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  const cancelIdle = (globalThis as { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback;
  const step = (index: number) => {
    if (stopped || index >= routes.length) return;
    cancelCurrent = prefetchRoute(client, routes[index]!, language);
    timer = window.setTimeout(() => schedule(index + 1), IDLE_WARM_GAP_MS);
  };
  const schedule = (index: number) => {
    if (stopped || index >= routes.length) return;
    if (idle) idleHandle = idle(() => step(index), { timeout: 4000 });
    else step(index);
  };
  timer = window.setTimeout(() => schedule(0), IDLE_WARM_GAP_MS);
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    if (idleHandle && cancelIdle) cancelIdle(idleHandle);
    // Never abort a warm-up that finished: the shared flight is only dropped when nobody else waits on it.
    cancelCurrent();
  };
}
