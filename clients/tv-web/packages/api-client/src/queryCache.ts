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
  /**
   * Lets this caller walk away. Aborting rejects only this caller's promise with an `AbortError`; the shared
   * request itself is aborted only once every caller has left, and never while a caller without a signal
   * (a screen that needs the result) is waiting on it.
   */
  signal?: AbortSignal;
}

/** What made stored copies go: a write or live event (`tags`; `undefined` for everything) or a new scope. */
export interface QueryInvalidation {
  tags: readonly QueryTag[] | undefined;
  scopeChange: boolean;
}

interface Flight {
  promise: Promise<unknown>;
  controller: AbortController;
  /** Callers that passed a signal and are still waiting. */
  waiting: number;
  /** A caller without a signal needs this request to finish. */
  pinned: boolean;
}

function abortError(): Error {
  return typeof DOMException === "function"
    ? new DOMException("The query was aborted", "AbortError")
    : Object.assign(new Error("The query was aborted"), { name: "AbortError" });
}

export class QueryCache {
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Flight>();
  private readonly invalidationListeners = new Set<(event: QueryInvalidation) => void>();
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
    this.notify({ tags: undefined, scopeChange: true });
  }

  /** The scope the cache is filled under (`undefined` while it is off). */
  get currentScope(): string | undefined {
    return this.scope;
  }

  /** Called after stored copies are dropped (`invalidate`, scope change), so a persistent mirror can follow. */
  onInvalidate(listener: (event: QueryInvalidation) => void): () => void {
    this.invalidationListeners.add(listener);
    return () => {
      this.invalidationListeners.delete(listener);
    };
  }

  private notify(event: QueryInvalidation): void {
    for (const listener of [...this.invalidationListeners]) {
      try {
        listener(event);
      } catch {
        // A mirror failing must never break the cache.
      }
    }
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

  private store(key: string, data: unknown, tags: readonly QueryTag[], at: number = this.now()): void {
    const id = this.scoped(key);
    this.entries.delete(id);
    this.entries.set(id, { data, at, tags });
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
  fetch<T>(key: string, loader: (signal: AbortSignal) => Promise<T>, options: FetchQueryOptions = {}): Promise<T> {
    const { signal } = options;
    if (signal?.aborted) return Promise.reject(abortError());
    if (!this.enabled) return loader(signal ?? new AbortController().signal);
    const id = this.scoped(key);
    if (options.ttlMs !== undefined) {
      const hit = this.entries.get(id);
      if (hit && this.now() - hit.at < options.ttlMs) return Promise.resolve(hit.data as T);
    }
    const running = this.inflight.get(id);
    if (running) return this.join(running, signal) as Promise<T>;
    const startedEpoch = this.epoch;
    const controller = new AbortController();
    const flight: Flight = { promise: undefined as unknown as Promise<unknown>, controller, waiting: 0, pinned: false };
    flight.promise = loader(controller.signal).then(
      (data) => {
        if (this.inflight.get(id) === flight) this.inflight.delete(id);
        if (this.epoch === startedEpoch) this.store(key, data, options.tags ?? []);
        return data;
      },
      (error: unknown) => {
        if (this.inflight.get(id) === flight) this.inflight.delete(id);
        throw error;
      }
    );
    this.inflight.set(id, flight);
    return this.join(flight, signal) as Promise<T>;
  }

  private join(flight: Flight, signal: AbortSignal | undefined): Promise<unknown> {
    if (!signal) {
      flight.pinned = true;
      return flight.promise;
    }
    flight.waiting += 1;
    return new Promise((resolve, reject) => {
      let settled = false;
      const onAbort = () => {
        if (settled) return;
        settled = true;
        flight.waiting -= 1;
        if (!flight.pinned && flight.waiting <= 0) flight.controller.abort();
        reject(abortError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      flight.promise.then(
        (value) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", onAbort);
          reject(error);
        }
      );
    });
  }

  /**
   * Stores a value directly (for example one a list response already carries). `at` back-dates it, for a copy
   * restored from disk: callers that revalidate by age then see it as old.
   */
  set(key: string, data: unknown, tags: readonly QueryTag[] = [], at?: number): void {
    if (this.enabled) this.store(key, data, tags, at);
  }

  /** Changes on every invalidation and scope change: a value read before a change is not to be stored after it. */
  get generation(): number {
    return this.epoch;
  }

  /** Drops the entries carrying any of `tags` (all entries when none are given). */
  invalidate(tags?: readonly QueryTag[]): void {
    this.epoch += 1;
    if (!tags || tags.length === 0) {
      this.entries.clear();
      this.inflight.clear();
      this.notify({ tags: undefined, scopeChange: false });
      return;
    }
    for (const [id, entry] of this.entries) {
      if (entry.tags.some((tag) => tags.includes(tag))) this.entries.delete(id);
    }
    this.inflight.clear();
    this.notify({ tags, scopeChange: false });
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
