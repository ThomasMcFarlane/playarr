import type { ApiClient, WatchlistEntry } from "@playarr-tv/api-client";

const WATCHLIST_KEY = "watchlist:list";
const WATCHLIST_TAGS = ["watchlist"] as const;

/** The watchlist as the query cache holds it (stale copies included), or `undefined`. */
export function peekWatchlist(client: ApiClient): WatchlistEntry[] | undefined {
  return client.queries.peek<WatchlistEntry[]>(WATCHLIST_KEY)?.data;
}

/** Reads the watchlist through the query cache; the screen revalidates, the prefetch only warms. */
export function loadWatchlist(
  client: ApiClient,
  options: { ttlMs?: number; signal?: AbortSignal; priority?: "high" | "low" | "auto"; keep?: boolean } = {}
): Promise<WatchlistEntry[]> {
  const { ttlMs, signal, priority, keep } = options;
  return client.queries.fetch(
    WATCHLIST_KEY,
    async (flight) => (await client.listWatchlist({ signal: flight, priority })).items,
    { tags: WATCHLIST_TAGS, ttlMs, signal, keep }
  );
}

/** Warms the watchlist so the page paints its rows from the cache. Cancel through `signal`. */
export function prefetchWatchlist(client: ApiClient, signal?: AbortSignal): void {
  if (!client.queries.enabled) return;
  void loadWatchlist(client, { ttlMs: 15_000, signal, priority: "low", keep: true }).catch(() => undefined);
}
