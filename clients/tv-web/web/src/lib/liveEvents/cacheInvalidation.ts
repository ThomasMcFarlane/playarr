import type { QueryCache, QueryTag } from "@playarr-tv/api-client";
import type { Invalidation, LiveArea } from "./mapping";
import type { LiveRegistry } from "./registry";

/**
 * Which stored query copies each live area makes stale (the tags set where entries are stored: see
 * `QueryTag` in the api-client). `null` means nothing cached shows the area; `"all"` means the change
 * can alter anything the catalogue returns (policy and library access), so everything goes.
 */
const TAGS_BY_AREA: Record<LiveArea, readonly QueryTag[] | "all"> = {
  progress: ["progress"],
  catalog: ["catalog"],
  calendar: ["calendar"],
  playlists: ["playlists"],
  watchlist: ["watchlist"],
  household: ["household"],
  account: "all",
  // Not stored in the query cache (read fresh each time).
  downloads: [],
  serverGroup: [],
  admin: [],
};

/** The tags to drop for `invalidations`, `[]` for none, or `undefined` for every entry. */
export function queryTagsForInvalidations(invalidations: readonly Invalidation[]): readonly QueryTag[] | undefined {
  const tags = new Set<QueryTag>();
  for (const { area } of invalidations) {
    const mapped = TAGS_BY_AREA[area];
    if (mapped === "all") return undefined;
    for (const tag of mapped) tags.add(tag);
  }
  return [...tags];
}

/**
 * Wraps the live registry so a change frame empties the stored copies it touches the moment it
 * arrives, not only when a mounted screen's debounced refetch runs. Without this a prefetched or
 * parked screen (a work opened from a card, a Back target, Home) would paint an old copy first, and
 * a short-lived entry could be served instead of a refetch. `invalidate` also bumps the cache epoch,
 * so a read that started before the event never stores its stale result. Resyncs, reconnect gaps
 * and fallback polls (`refetchAll`) cannot say what moved, so they drop everything.
 */
export function withQueryCacheInvalidation(registry: LiveRegistry, queries: QueryCache): LiveRegistry {
  return {
    ...registry,
    invalidate(invalidations, atClientMs) {
      const tags = queryTagsForInvalidations(invalidations);
      if (tags === undefined) queries.invalidate();
      else if (tags.length > 0) queries.invalidate(tags);
      registry.invalidate(invalidations, atClientMs);
    },
    refetchAll() {
      queries.invalidate();
      registry.refetchAll();
    },
  };
}
