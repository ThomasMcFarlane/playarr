import { useEffect } from "react";
import type { ApiClient, Work } from "@playarr-tv/api-client";
import { calendarCacheKey, prefetchCalendar, prefetchHomeRails } from "@playarr-tv/api-client/react";
import { focusedDetailsFor } from "./focusedDetails";
import { prefetchWorkArtwork } from "./artwork";
import { useApiClient } from "./ApiClientProvider";
import { IS_TV } from "./clientPlatform";
import { localeTagFor } from "./i18n/languages";
import { anchorForView, defaultCalendarView, fetchWindow, localDayOf, visibleRange, weekStartsOn } from "./calendar";
import { peekPlaylistTracks, prefetchPlaylists } from "./playlistsData";
import { peekWatchlist, prefetchWatchlist } from "./watchlistData";
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

/** The sections warmed once Home has loaded, most likely first. A fixed list is the bound. */
export const IDLE_WARM_ROUTES: readonly string[] = ["/movies", "/series", "/music", "/calendar", "/watchlist", "/playlists"];
/** Wait after Home settles before the first section is asked for, so Home's own last reads go out first. */
export const WARM_START_DELAY_MS = 300;
/** Pause between two sections' first requests. Their requests then overlap: on a slow link they all land together. */
export const WARM_STAGGER_MS = 120;
/** How long after a pass a section that is still cold is asked for again (a pass can lose a result, see below). */
export const WARM_RETRY_MS = 2500;
/** Passes in all, the first included. The second and later ones only ask for sections still cold. */
export const WARM_MAX_PASSES = 4;

const LIBRARY_ROUTE_PARAMS = (path: string) => {
  const kind = LIBRARY_ROUTES[path];
  if (!kind) return undefined;
  // The screen's own defaults for a bare URL: the last view chosen for this kind.
  const { sort, order, view } = parseLibraryView(new URLSearchParams(), kind, storedLibraryView(kind));
  return { params: libraryFirstPageParams(kind, sort, order), view };
};

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
    prefetchHomeRails(client, { lang: language }, signal, { keep: true });
  } else if (path === "/calendar") {
    prefetchCalendar(client, calendarFirstWindow(language), signal, { keep: true });
  } else if (path === "/playlists") {
    prefetchPlaylists(client, signal);
  } else if (path === "/watchlist") {
    prefetchWatchlist(client, signal);
  } else if (LIBRARY_ROUTES[path]) {
    const { params, view } = LIBRARY_ROUTE_PARAMS(path)!;
    // `keep`: the copy waits for a first visit that may be minutes away, through a burst of small reads.
    void queries
      .fetch(libraryFirstPageKey(params), (flight) => client.browseCatalog(params, { signal: flight, priority: "low" }), {
        tags: ["catalog"],
        ttlMs: 15_000,
        signal,
        keep: true,
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
 * Whether the query cache already holds what `path` shows first (a stale copy counts: it paints the first frame).
 * Routes with nothing to warm count as warm.
 */
export function isRouteWarm(client: ApiClient, path: string, language: string): boolean {
  const queries = client.queries;
  if (!queries.enabled) return true;
  if (path === "/calendar") {
    const { start, end } = calendarFirstWindow(language);
    return queries.peek(calendarCacheKey(start, end)) !== undefined;
  }
  if (path === "/playlists") return peekPlaylistTracks(client) !== undefined;
  if (path === "/watchlist") return peekWatchlist(client) !== undefined;
  const library = LIBRARY_ROUTE_PARAMS(path);
  if (library) return queries.peek(libraryFirstPageKey(library.params)) !== undefined;
  return true;
}

/** The scope and language each client's sections were last warmed for, so Home mounting again does not start over. */
const warmedFor = new WeakMap<ApiClient, string>();

/**
 * Once Home has painted, warms the likeliest next sections so their first visit renders from the cache instead of a
 * skeleton. Every section is asked for within a second of the start and the requests overlap, because a visit can
 * come at any moment and a slow link answers in seconds. It is NOT tied to Home: leaving Home for another page does
 * not stop it (a user who goes straight to a section would otherwise find the rest never warmed). A result is lost
 * when a live resync or change drops what was in flight, so passes after the first ask again for what is still cold.
 * Runs once per signed-in scope and language, is bounded by `IDLE_WARM_ROUTES` and `WARM_MAX_PASSES`, and is skipped
 * when the user asked to save data. Returns a function that stops it (for tests; the app never calls it).
 */
export function warmSections(
  client: ApiClient,
  language: string,
  routes: readonly string[] = IDLE_WARM_ROUTES
): () => void {
  if (!client.queries.enabled) return () => undefined;
  const connection = (navigator as { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return () => undefined;
  const scope = client.queries.currentScope;
  const marker = `${scope}|${language}`;
  if (warmedFor.get(client) === marker) return () => undefined;
  warmedFor.set(client, marker);
  let stopped = false;
  const timers = new Set<number>();
  const later = (run: () => void, delayMs: number) => {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      run();
    }, delayMs);
    timers.add(timer);
  };
  const pass = (number: number) => {
    // Signed out, or another profile took over: its Home starts its own warm-up.
    if (stopped || client.queries.currentScope !== scope || !client.queries.enabled) return;
    const cold = routes.filter((path) => !isRouteWarm(client, path, language));
    if (cold.length === 0 || number > WARM_MAX_PASSES) return;
    cold.forEach((path, index) => later(() => prefetchRoute(client, path, language), index * WARM_STAGGER_MS));
    later(() => pass(number + 1), cold.length * WARM_STAGGER_MS + WARM_RETRY_MS);
  };
  later(() => pass(1), WARM_START_DELAY_MS);
  return () => {
    stopped = true;
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    warmedFor.delete(client);
  };
}
