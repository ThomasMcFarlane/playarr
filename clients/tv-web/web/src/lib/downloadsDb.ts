/**
 * Small hand-rolled IndexedDB wrapper backing the offline downloads feature
 * -- `package.json` has no idb/Dexie dependency, and this app's existing
 * house style for small persisted-cache modules (see `catalogKindsCache.ts`)
 * is a thin, defensive, try/catch-silent-degrade wrapper rather than a
 * generic library. IndexedDB is inherently async (unlike `localStorage`), so
 * every export here returns a `Promise` and resolves to a safe empty/`null`
 * value instead of throwing when the browser has no IndexedDB, a private-
 * browsing quota rejects the open, or a transaction fails for any other
 * reason -- the rest of the downloads feature (`DownloadsProvider`,
 * `downloadEngine`) is written to degrade the same way `catalogKindsCache`'s
 * callers do: keep working with an empty/absent cache rather than crash.
 *
 * Three object stores, one database:
 *  - `downloads`: one row per download (queue entry + manifest), keyed by
 *    the server's `DownloadTicket.id`. Indexed on `userId` and `status` so
 *    the provider/page can list "my active downloads" etc. without a full
 *    table scan.
 *  - `downloadChunks`: the IndexedDB-Blob fallback storage engine
 *    (`downloadEngine.ts`) uses when OPFS isn't available. One row per
 *    downloaded chunk, keyed by `${downloadId}#${chunkIndex}` so chunks can
 *    be reassembled in order and deleted together by `downloadId` prefix.
 *  - `watchMutations`: offline-buffered watch-progress updates queued while
 *    the app is offline, flushed through the normal API client once back
 *    online (see `DownloadsProvider`'s flush loop).
 */

const DB_NAME = "playarr-downloads";
const DB_VERSION = 1;
const DOWNLOADS_STORE = "downloads";
const CHUNKS_STORE = "downloadChunks";
const WATCH_MUTATIONS_STORE = "watchMutations";

export type DownloadRecordStatus =
  | "queued"
  | "processing"
  | "downloading"
  | "paused"
  | "ready"
  | "failed"
  | "canceled"
  | "expired";

export type DownloadStorageKind = "opfs" | "idb-blob";

export type DownloadKeepUntilPolicy =
  | { type: "forever" }
  | { type: "date"; date: string }
  | { type: "after-watched"; amount: number; unit: "days" | "weeks" };

export interface DownloadRecord {
  /** The server `DownloadTicket.id` -- this record only exists once that ticket does. */
  id: string;
  workId: string;
  mediaFileId: string;
  /** Scopes a record to one signed-in profile on one server -- see `recordScope`. */
  userId: string;
  serverUrl: string;
  title: string;
  subtitle: string | null;
  qualityId: string;
  qualityLabel: string;
  container: string;
  totalBytes: number | null;
  bytesDownloaded: number;
  /** Highest contiguous byte offset durably written -- resume point after a reload/crash. */
  lastCompletedByteOffset: number;
  status: DownloadRecordStatus;
  keepUntil: DownloadKeepUntilPolicy;
  /** First-observed moment this media reached `WatchState.watched`, for an `"after-watched"` keep-until policy. `null` until then. */
  watchedAt: string | null;
  errorMessage: string | null;
  requestedAt: string;
  readyAt: string | null;
  /** `null` until the engine has picked a storage backend for this download. */
  storage: DownloadStorageKind | null;
  /** Runtime, for player integration (`usePlaybackEngine`'s synthetic "Downloaded" source). */
  runtimeMs: number;
  mimeType: string;
}

export interface QueuedWatchMutation {
  id: string;
  userId: string;
  serverUrl: string;
  mediaFileId: string;
  positionMs: number;
  durationMs: number;
  completed?: boolean;
  /** Captured when the mutation was made, replayed as `UpdateWatchProgressRequest.occurred_at`. */
  occurredAt: string;
}

interface StoredChunk {
  key: string;
  downloadId: string;
  chunkIndex: number;
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase | null> | undefined;

function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== "undefined";
  } catch {
    return false;
  }
}

function openDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DOWNLOADS_STORE)) {
          const store = db.createObjectStore(DOWNLOADS_STORE, { keyPath: "id" });
          store.createIndex("byUserId", "userId", { unique: false });
          store.createIndex("byStatus", "status", { unique: false });
        }
        if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
          const store = db.createObjectStore(CHUNKS_STORE, { keyPath: "key" });
          store.createIndex("byDownloadId", "downloadId", { unique: false });
        }
        if (!db.objectStoreNames.contains(WATCH_MUTATIONS_STORE)) {
          const store = db.createObjectStore(WATCH_MUTATIONS_STORE, { keyPath: "id" });
          store.createIndex("byUserId", "userId", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function runTransaction<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction) => void,
  collect: () => T
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const transaction = db.transaction(storeNames, mode);
          transaction.oncomplete = () => resolve(collect());
          transaction.onerror = () => resolve(null);
          transaction.onabort = () => resolve(null);
          run(transaction);
        } catch {
          resolve(null);
        }
      })
  );
}

function requestToVoid(request: IDBRequest): void {
  request.onerror = () => {
    // Left to the owning transaction's onerror/onabort; nothing more to do here.
  };
}

/** Scopes downloads/watch-mutations to one signed-in profile on one server, same idea as `catalogKindsCache`'s cache scope. */
export function recordScope(userId: string, serverUrl: string): string {
  return `${serverUrl}::${userId}`;
}

export async function listDownloads(userId: string): Promise<DownloadRecord[]> {
  const results: DownloadRecord[] = [];
  const outcome = await runTransaction(
    DOWNLOADS_STORE,
    "readonly",
    (transaction) => {
      const index = transaction.objectStore(DOWNLOADS_STORE).index("byUserId");
      const request = index.openCursor(IDBKeyRange.only(userId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        results.push(cursor.value as DownloadRecord);
        cursor.continue();
      };
    },
    () => results
  );
  return outcome ?? [];
}

export async function getDownload(id: string): Promise<DownloadRecord | null> {
  let result: DownloadRecord | null = null;
  await runTransaction(
    DOWNLOADS_STORE,
    "readonly",
    (transaction) => {
      const request = transaction.objectStore(DOWNLOADS_STORE).get(id);
      request.onsuccess = () => {
        result = (request.result as DownloadRecord | undefined) ?? null;
      };
    },
    () => undefined
  );
  return result;
}

export async function putDownload(record: DownloadRecord): Promise<boolean> {
  const outcome = await runTransaction(
    DOWNLOADS_STORE,
    "readwrite",
    (transaction) => {
      requestToVoid(transaction.objectStore(DOWNLOADS_STORE).put(record));
    },
    () => true
  );
  return outcome ?? false;
}

/** Removes only the stored chunk bytes for a download, leaving its `downloads` row untouched (used when the engine restarts a download from scratch, e.g. after a storage-backend switch). */
export async function clearChunks(downloadId: string): Promise<void> {
  await runTransaction(
    CHUNKS_STORE,
    "readwrite",
    (transaction) => {
      const chunkIndex = transaction.objectStore(CHUNKS_STORE).index("byDownloadId");
      const cursorRequest = chunkIndex.openKeyCursor(IDBKeyRange.only(downloadId));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        requestToVoid(transaction.objectStore(CHUNKS_STORE).delete(cursor.primaryKey));
        cursor.continue();
      };
    },
    () => undefined
  );
}

export async function deleteDownload(id: string): Promise<void> {
  await runTransaction(
    [DOWNLOADS_STORE, CHUNKS_STORE],
    "readwrite",
    (transaction) => {
      requestToVoid(transaction.objectStore(DOWNLOADS_STORE).delete(id));
      const chunkIndex = transaction.objectStore(CHUNKS_STORE).index("byDownloadId");
      const cursorRequest = chunkIndex.openKeyCursor(IDBKeyRange.only(id));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        requestToVoid(transaction.objectStore(CHUNKS_STORE).delete(cursor.primaryKey));
        cursor.continue();
      };
    },
    () => undefined
  );
}

/** Persists one chunk for the IndexedDB-Blob fallback storage engine. */
export async function putChunk(
  downloadId: string,
  chunkIndex: number,
  blob: Blob
): Promise<boolean> {
  const chunk: StoredChunk = { key: `${downloadId}#${chunkIndex}`, downloadId, chunkIndex, blob };
  const outcome = await runTransaction(
    CHUNKS_STORE,
    "readwrite",
    (transaction) => {
      requestToVoid(transaction.objectStore(CHUNKS_STORE).put(chunk));
    },
    () => true
  );
  return outcome ?? false;
}

/** Reassembles every stored chunk for a download, in order, into one Blob. `null` if any are missing or the store is unavailable. */
export async function assembleChunks(
  downloadId: string,
  mimeType: string
): Promise<Blob | null> {
  const chunks: StoredChunk[] = [];
  const outcome = await runTransaction(
    CHUNKS_STORE,
    "readonly",
    (transaction) => {
      const index = transaction.objectStore(CHUNKS_STORE).index("byDownloadId");
      const request = index.openCursor(IDBKeyRange.only(downloadId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        chunks.push(cursor.value as StoredChunk);
        cursor.continue();
      };
    },
    () => chunks
  );
  if (!outcome || outcome.length === 0) return null;
  outcome.sort((left, right) => left.chunkIndex - right.chunkIndex);
  return new Blob(
    outcome.map((chunk) => chunk.blob),
    { type: mimeType }
  );
}

/** Total bytes already durably stored for a download in the IndexedDB-Blob fallback -- the resume authority for that backend (each chunk commits on its own transaction, unlike OPFS's swap-file semantics). */
export async function storedChunkBytes(downloadId: string): Promise<number> {
  let total = 0;
  await runTransaction(
    CHUNKS_STORE,
    "readonly",
    (transaction) => {
      const index = transaction.objectStore(CHUNKS_STORE).index("byDownloadId");
      const request = index.openCursor(IDBKeyRange.only(downloadId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        total += (cursor.value as StoredChunk).blob.size;
        cursor.continue();
      };
    },
    () => undefined
  );
  return total;
}

export async function highestStoredChunkIndex(downloadId: string): Promise<number> {
  let highest = -1;
  await runTransaction(
    CHUNKS_STORE,
    "readonly",
    (transaction) => {
      const index = transaction.objectStore(CHUNKS_STORE).index("byDownloadId");
      const request = index.openCursor(IDBKeyRange.only(downloadId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const chunk = cursor.value as StoredChunk;
        if (chunk.chunkIndex > highest) highest = chunk.chunkIndex;
        cursor.continue();
      };
    },
    () => undefined
  );
  return highest;
}

export async function listQueuedWatchMutations(
  userId: string
): Promise<QueuedWatchMutation[]> {
  const results: QueuedWatchMutation[] = [];
  const outcome = await runTransaction(
    WATCH_MUTATIONS_STORE,
    "readonly",
    (transaction) => {
      const index = transaction.objectStore(WATCH_MUTATIONS_STORE).index("byUserId");
      const request = index.openCursor(IDBKeyRange.only(userId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        results.push(cursor.value as QueuedWatchMutation);
        cursor.continue();
      };
    },
    () => results
  );
  return outcome ?? [];
}

export async function putQueuedWatchMutation(
  mutation: QueuedWatchMutation
): Promise<boolean> {
  const outcome = await runTransaction(
    WATCH_MUTATIONS_STORE,
    "readwrite",
    (transaction) => {
      requestToVoid(transaction.objectStore(WATCH_MUTATIONS_STORE).put(mutation));
    },
    () => true
  );
  return outcome ?? false;
}

export async function deleteQueuedWatchMutation(id: string): Promise<void> {
  await runTransaction(
    WATCH_MUTATIONS_STORE,
    "readwrite",
    (transaction) => {
      requestToVoid(transaction.objectStore(WATCH_MUTATIONS_STORE).delete(id));
    },
    () => undefined
  );
}
