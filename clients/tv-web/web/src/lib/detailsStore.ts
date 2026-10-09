import type { QueryTag, WorkDetail } from "@playarr-tv/api-client";

/**
 * Persistent copy of the work details the focus has seen, so the first visit of a session paints the left
 * panel from disk instead of waiting for the network (the in-memory query cache starts empty on every load).
 *
 * Rules:
 * - A hit is only ever a first paint: it is seeded into the query cache as already stale, so the controller
 *   revalidates it at once.
 * - Per account and profile: every row carries the query-cache scope it was stored under, other scopes are
 *   purged when the scope changes, and sign-out empties the store.
 * - Live events (`QueryCache.onInvalidate`) drop the rows whose tags they touch, the same tags the in-memory
 *   copies carry.
 * - A versioned LRU: at most `DETAILS_STORE_MAX` rows (least recently used go first), nothing older than
 *   `DETAILS_STORE_MAX_AGE_MS`, and a schema bump (`DETAILS_STORE_VERSION`) starts from empty.
 *
 * IndexedDB can be missing, blocked (private windows) or full; every call then resolves to "nothing stored"
 * and never throws, so the cache simply stays in memory.
 */

export const DETAILS_STORE_VERSION = 1;
export const DETAILS_STORE_MAX = 500;
/** Trimming goes a little under the cap so it does not run on every write. */
export const DETAILS_STORE_TRIM_TO = 450;
export const DETAILS_STORE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const DB_NAME = "playarr-details";
const STORE = "details";

export interface StoredDetail {
  data: WorkDetail;
  at: number;
}

/** What `FocusedDetails` needs from a persistent store (a fake in the unit tests). */
export interface DetailsPersistence {
  get(scope: string, id: string): Promise<StoredDetail | undefined>;
  put(scope: string, id: string, data: WorkDetail, tags: readonly QueryTag[], at: number): Promise<void>;
  /** Drops the rows of `scope` carrying any of `tags` (all of its rows when `tags` is `undefined`). */
  invalidate(scope: string, tags: readonly QueryTag[] | undefined): Promise<void>;
  /** Drops every row not stored under `scope` (all rows when `scope` is `undefined`). */
  purgeExcept(scope: string | undefined): Promise<void>;
  /** Opens the underlying database early (optional). */
  warm?(): void;
}

interface Row {
  k: string;
  scope: string;
  id: string;
  data: WorkDetail;
  at: number;
  used: number;
  tags: readonly QueryTag[];
}

/** The keys to delete so that at most `trimTo` of `rows` remain, least recently used first. */
export function planTrim(rows: ReadonlyArray<{ k: string; used: number }>, max: number, trimTo: number): string[] {
  if (rows.length <= max) return [];
  return [...rows]
    .sort((a, b) => a.used - b.used)
    .slice(0, rows.length - trimTo)
    .map((row) => row.k);
}

const rowKey = (scope: string, id: string) => `${scope}\u0000${id}`;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class IndexedDbDetailsStore implements DetailsPersistence {
  private db: Promise<IDBDatabase | null> | undefined;
  private writesSinceTrim = 0;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly limits = { max: DETAILS_STORE_MAX, trimTo: DETAILS_STORE_TRIM_TO, maxAgeMs: DETAILS_STORE_MAX_AGE_MS }
  ) {}

  private open(): Promise<IDBDatabase | null> {
    if (this.db) return this.db;
    this.db = new Promise<IDBDatabase | null>((resolve) => {
      if (typeof indexedDB === "undefined") return resolve(null);
      try {
        const opening = indexedDB.open(DB_NAME, DETAILS_STORE_VERSION);
        opening.onupgradeneeded = () => {
          const db = opening.result;
          // A new schema version starts from an empty store.
          if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
          const store = db.createObjectStore(STORE, { keyPath: "k" });
          store.createIndex("scope", "scope");
          store.createIndex("used", "used");
        };
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => resolve(null);
        opening.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.db;
  }

  private async run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, tx: IDBTransaction) => Promise<T> | T, fallback: T): Promise<T> {
    try {
      const db = await this.open();
      if (!db) return fallback;
      const tx = db.transaction(STORE, mode);
      const finished = done(tx);
      const result = await work(tx.objectStore(STORE), tx);
      await finished;
      return result;
    } catch {
      return fallback;
    }
  }

  /** Opens the database ahead of the first read, so that read does not pay for the open. */
  warm(): void {
    void this.open();
  }

  get(scope: string, id: string): Promise<StoredDetail | undefined> {
    return this.run<StoredDetail | undefined>(
      "readwrite",
      async (store) => {
        const row = (await request(store.get(rowKey(scope, id)))) as Row | undefined;
        if (!row) return undefined;
        if (this.now() - row.at > this.limits.maxAgeMs) {
          store.delete(row.k);
          return undefined;
        }
        // Recently used: the LRU order follows reads as well as writes.
        store.put({ ...row, used: this.now() });
        return { data: row.data, at: row.at };
      },
      undefined
    );
  }

  async put(scope: string, id: string, data: WorkDetail, tags: readonly QueryTag[], at: number): Promise<void> {
    await this.run(
      "readwrite",
      (store) => {
        const row: Row = { k: rowKey(scope, id), scope, id, data, at, used: this.now(), tags };
        store.put(row);
      },
      undefined
    );
    this.writesSinceTrim += 1;
    if (this.writesSinceTrim >= 25) {
      this.writesSinceTrim = 0;
      await this.trim();
    }
  }

  /** Enforces the row cap, least recently used first. */
  async trim(): Promise<void> {
    await this.run(
      "readwrite",
      async (store) => {
        if ((await request(store.count())) <= this.limits.max) return;
        const rows = (await request(store.getAll())) as Row[];
        for (const key of planTrim(rows, this.limits.max, this.limits.trimTo)) store.delete(key);
      },
      undefined
    );
  }

  invalidate(scope: string, tags: readonly QueryTag[] | undefined): Promise<void> {
    return this.run(
      "readwrite",
      async (store) => {
        const rows = (await request(store.index("scope").getAll(scope))) as Row[];
        for (const row of rows) {
          if (tags === undefined || row.tags.some((tag) => tags.includes(tag))) store.delete(row.k);
        }
      },
      undefined
    );
  }

  purgeExcept(scope: string | undefined): Promise<void> {
    return this.run(
      "readwrite",
      async (store) => {
        if (scope === undefined) {
          store.clear();
          return;
        }
        const rows = (await request(store.getAll())) as Row[];
        for (const row of rows) if (row.scope !== scope) store.delete(row.k);
      },
      undefined
    );
  }
}

let shared: DetailsPersistence | null | undefined;

/** The browser's store, or `null` where there is no IndexedDB. */
export function sharedDetailsStore(): DetailsPersistence | null {
  if (shared === undefined) shared = typeof indexedDB === "undefined" ? null : new IndexedDbDetailsStore();
  return shared;
}
