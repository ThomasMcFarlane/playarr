/**
 * In-memory, per-session query cache for the API client: stale-while-revalidate reads and request
 * de-duplication.
 *
 * Privacy first. The cache belongs to one `ApiClient`, and every entry lives under a *scope* (the
 * signed-in account and profile). `setScope` with a different scope drops everything, and with
 * `undefined` (signed out, or the account is not known yet) turns the cache off, so data fetched
 * for one user or profile can never be handed to another. A request that started under an older
 * scope never stores its result.
 *
 * Freshness: a hit is only ever the first paint. Callers revalidate in the background (see
 * `useAsyncData`), and any mutation the client sends invalidates the entries that depend on it
 * (`invalidate`), so a watch-state change is never hidden behind an old copy.
 */

export type QueryTag =
  | "catalog"
  | "progress"
  | "playlists"
  | "watchlist"
  | "calendar"
  | "household"
  | "views";

export interface QueryCacheOptions {
  /** Most entries kept; the least recently used is dropped first. */
  maxEntries?: number;
  now?: () => number;
}

interface Entry {
  data: unknown;
  at: number;
  tags: readonly QueryTag[];
}

export interface FetchQueryOptions {
  tags?: readonly QueryTag[];
  /** A stored value younger than this is returned without any request. */
  ttlMs?: number;
}

export class QueryCache {
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private scope: string | undefined;
  /** Bumped by every invalidation and scope change: older in-flight results are not stored. */
  private epoch = 0;

  constructor(options: QueryCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 120;
    this.now = options.now ?? (() => Date.now());
  }

  /** `undefined` disables the cache; a different scope discards everything held for the old one. */
  setScope(scope: string | undefined): void {
    if (scope === this.scope) return;
    this.scope = scope;
    this.clear();
  }

  get enabled(): boolean {
    return this.scope !== undefined && this.scope !== "";
  }

  get size(): number {
    return this.entries.size;
  }

  private scoped(key: string): string {
    return `${this.scope}\u0000${key}`;
  }

  /** The stored value and when it was stored, or `undefined`. Marks the entry recently used. */
  peek<T>(key: string): { data: T; at: number } | undefined {
    if (!this.enabled) return undefined;
    const id = this.scoped(key);
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    this.entries.delete(id);
    this.entries.set(id, entry);
    return { data: entry.data as T, at: entry.at };
  }

  private store(key: string, data: unknown, tags: readonly QueryTag[]): void {
    const id = this.scoped(key);
    this.entries.delete(id);
    this.entries.set(id, { data, at: this.now(), tags });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /**
   * Runs `loader` unless a request for `key` is already in flight (then everyone shares it), or a
   * value younger than `ttlMs` is stored. A successful result is stored unless the scope changed
   * or something was invalidated while it was loading.
   */
  fetch<T>(key: string, loader: () => Promise<T>, options: FetchQueryOptions = {}): Promise<T> {
    if (!this.enabled) return loader();
    const id = this.scoped(key);
    if (options.ttlMs !== undefined) {
      const hit = this.entries.get(id);
      if (hit && this.now() - hit.at < options.ttlMs) return Promise.resolve(hit.data as T);
    }
    const running = this.inflight.get(id);
    if (running) return running as Promise<T>;
    const startedEpoch = this.epoch;
    const promise = loader().then(
      (data) => {
        if (this.inflight.get(id) === promise) this.inflight.delete(id);
        if (this.epoch === startedEpoch) this.store(key, data, options.tags ?? []);
        return data;
      },
      (error: unknown) => {
        if (this.inflight.get(id) === promise) this.inflight.delete(id);
        throw error;
      }
    );
    this.inflight.set(id, promise);
    return promise;
  }

  /** Stores a value directly (for example one a list response already carries). */
  set(key: string, data: unknown, tags: readonly QueryTag[] = []): void {
    if (this.enabled) this.store(key, data, tags);
  }

  /** Drops the entries carrying any of `tags` (all entries when none are given). */
  invalidate(tags?: readonly QueryTag[]): void {
    this.epoch += 1;
    if (!tags || tags.length === 0) {
      this.entries.clear();
      this.inflight.clear();
      return;
    }
    for (const [id, entry] of this.entries) {
      if (entry.tags.some((tag) => tags.includes(tag))) this.entries.delete(id);
    }
    this.inflight.clear();
  }

  clear(): void {
    this.epoch += 1;
    this.entries.clear();
    this.inflight.clear();
  }
}

/**
 * What a successful non-GET request to `path` makes stale: the tags to drop, an empty list when it
 * cannot affect any stored data (sign-in, token refresh, device pairing, remote-control traffic),
 * or `undefined` for "unknown, drop everything".
 */
export function tagsForMutation(path: string): readonly QueryTag[] | undefined {
  const rest = path.replace(/^\/api\/v1\//, "");
  const first = rest.split("/")[0] ?? "";
  switch (first) {
    case "auth":
    case "oauth":
    case "remote":
    case "push":
    case "discover":
    case "downloads":
    case "transfer":
      return [];
    case "catalog":
    case "media":
    case "requests":
      return ["catalog"];
    case "calendar":
      return ["calendar", "catalog"];
    case "home":
      return ["catalog", "progress", "watchlist"];
    case "playback":
    case "resume":
      return ["progress"];
    case "watchlist":
      return ["watchlist", "progress"];
    case "playlists":
      return ["playlists", "progress"];
    case "views":
      return ["views", "catalog"];
    case "household":
      return ["household", "catalog"];
    default:
      // Admin, peer, account and unknown writes: forget everything rather than risk a stale copy.
      return undefined;
  }
}
