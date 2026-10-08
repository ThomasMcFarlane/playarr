import { useEffect } from "react";
import type { ApiClient, Work } from "@playarr-tv/api-client";
import { prefetchHomeRails, prefetchWorkDetail } from "@playarr-tv/api-client/react";
import { prefetchWorkArtwork } from "./artwork";
import { useApiClient } from "./ApiClientProvider";
import {
  libraryFirstPageKey,
  libraryFirstPageParams,
  parseLibraryView,
  storedLibraryView,
  type LibraryKind,
} from "./libraryView";

/** How long a card must hold focus before its detail and hero art are fetched ahead of a click. */
export const DWELL_PREFETCH_MS = 200;

/** Fetches what opening `work` will need: its detail and its full-screen backdrop. */
export function prefetchWorkOpen(client: ApiClient, work: Pick<Work, "id" | "images">): void {
  if (!client.queries.enabled) return;
  prefetchWorkDetail(client, work.id);
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

const LIBRARY_ROUTES: Record<string, LibraryKind> = {
  "/movies": "movie",
  "/series": "series",
  "/music": "artist",
  "/sites": "site",
};

/** Prefetches the data a top-level route shows first (nav hover or focus). */
export function prefetchRoute(client: ApiClient, path: string, language: string): void {
  const queries = client.queries;
  if (!queries.enabled) return;
  if (path === "/") {
    prefetchHomeRails(client, { lang: language });
    return;
  }
  const kind = LIBRARY_ROUTES[path];
  if (!kind) return;
  // The screen's own defaults for a bare URL: the last view chosen for this kind.
  const { sort, order } = parseLibraryView(new URLSearchParams(), kind, storedLibraryView(kind));
  const params = libraryFirstPageParams(kind, sort, order);
  void queries
    .fetch(libraryFirstPageKey(params), () => client.browseCatalog(params), { tags: ["catalog"], ttlMs: 15_000 })
    .catch(() => undefined);
}
