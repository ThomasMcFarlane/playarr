import {
  assembleChunks,
  clearChunks,
  highestStoredChunkIndex,
  putChunk,
  storedChunkBytes,
  type DownloadRecord,
  type DownloadStorageKind,
} from "./downloadsDb";

/**
 * Chunked, resumable download engine for offline media downloads.
 *
 * Storage backend: Origin Private File System (OPFS) is primary --
 * `navigator.storage.getDirectory()` + `FileSystemWritableFileStream`,
 * position-addressed writes so out-of-order/retried chunks land at the
 * right offset. A single `FileSystemWritableFileStream` is opened once per
 * download *session* (one continuous run from wherever it last left off
 * until pause/completion/error) with `createWritable({keepExistingData:
 * true})` -- that flag is what stops the open from truncating bytes a
 * previous session already wrote; opening once per session rather than
 * once per chunk avoids that call's swap-file copy cost scaling with the
 * whole file on every single chunk. TV browsers vary in OPFS support, so
 * there's a feature-detected fallback to chunked IndexedDB-Blob storage
 * (one row per chunk in `downloadsDb`'s `downloadChunks` store, reassembled
 * on read) and a hard-disabled state if neither is available.
 *
 * Resume authority: rather than trusting the persisted
 * `lastCompletedByteOffset` blindly (an ungraceful tab kill can leave it
 * ahead of what OPFS actually committed, since only `close()` commits an
 * OPFS swap file), each `runDownload` call re-derives the true resume
 * offset from the storage backend itself -- the committed OPFS file's own
 * size, or the IndexedDB-Blob store's actual stored byte total (each chunk
 * there commits on its own transaction, so it's always accurate). This
 * makes resume self-correcting regardless of when/how the previous session
 * ended.
 */

const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB
const MAX_RETRIES = 5;
const OPFS_PROBE_NAME = "__playarr_opfs_probe__";

class DownloadCancelledError extends Error {
  constructor() {
    super("Download canceled");
    this.name = "DownloadCancelledError";
  }
}

export interface DownloadEngineSource {
  id: string;
  fileUrl: string;
  /** `null` when the size isn't known up front -- the engine keeps requesting chunks until a short read signals EOF. */
  totalBytes: number | null;
  storage: DownloadStorageKind;
  mimeType: string;
  getAccessToken: () => Promise<string | undefined>;
}

export interface DownloadEngineCallbacks {
  onProgress: (bytesDownloaded: number, totalBytes: number | null) => void;
  onStatusChange: (
    status: "ready" | "failed" | "canceled",
    errorMessage?: string
  ) => void;
}

const activeControllers = new Map<string, AbortController>();

function opfsFileName(downloadId: string): string {
  return `download-${downloadId}`;
}

function hasIndexedDbSupport(): boolean {
  try {
    return typeof indexedDB !== "undefined";
  } catch {
    return false;
  }
}

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (
      typeof navigator === "undefined" ||
      !("storage" in navigator) ||
      typeof navigator.storage.getDirectory !== "function"
    ) {
      return null;
    }
    return await navigator.storage.getDirectory();
  } catch {
    return null;
  }
}

async function opfsAvailable(): Promise<boolean> {
  const root = await getOpfsRoot();
  if (!root) return false;
  try {
    const handle = await root.getFileHandle(OPFS_PROBE_NAME, { create: true });
    const writable = await handle.createWritable();
    await writable.close();
    await root.removeEntry(OPFS_PROBE_NAME);
    return true;
  } catch {
    return false;
  }
}

/** Picks (and feature-detects) the storage backend a new download should use. `null` means downloads are hard-disabled in this browser. */
export async function detectDownloadStorage(): Promise<DownloadStorageKind | null> {
  if (await opfsAvailable()) return "opfs";
  if (hasIndexedDbSupport()) return "idb-blob";
  return null;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DownloadCancelledError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function committedBytes(
  source: DownloadEngineSource
): Promise<number> {
  if (source.storage === "opfs") {
    const root = await getOpfsRoot();
    if (!root) return 0;
    try {
      const handle = await root.getFileHandle(opfsFileName(source.id), { create: true });
      const file = await handle.getFile();
      return file.size;
    } catch {
      return 0;
    }
  }
  return storedChunkBytes(source.id);
}

async function fetchChunkWithRetry(
  source: DownloadEngineSource,
  start: number,
  end: number,
  signal: AbortSignal
): Promise<ArrayBuffer> {
  let attempt = 0;
  for (;;) {
    if (signal.aborted) throw new DownloadCancelledError();
    try {
      const token = await source.getAccessToken();
      const headers: Record<string, string> = { Range: `bytes=${start}-${end}` };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(source.fileUrl, { headers, signal });
      if (response.status === 409) {
        throw new Error("This download isn't ready to fetch yet.");
      }
      if (response.status === 410) {
        throw new Error("This download has expired or was canceled.");
      }
      if (!response.ok) {
        throw new Error(`Download request failed (${response.status}).`);
      }
      return await response.arrayBuffer();
    } catch (error) {
      if (signal.aborted || error instanceof DownloadCancelledError) {
        throw new DownloadCancelledError();
      }
      attempt += 1;
      if (attempt > MAX_RETRIES) throw error;
      const delayMs = Math.min(30_000, 1_000 * 2 ** (attempt - 1));
      await sleep(delayMs, signal);
    }
  }
}

/** Cancels an in-flight `runDownload` for this id, if any. Its `onStatusChange` callback fires with `"canceled"`. */
export function abortDownload(id: string): void {
  activeControllers.get(id)?.abort();
  activeControllers.delete(id);
}

/**
 * Runs (or resumes) one download session: fetches `8MB` `Range`-chunked
 * requests against `source.fileUrl` starting from wherever the storage
 * backend says bytes were actually committed, writing each chunk to the
 * chosen backend, and reporting progress as it goes. Resolves once the
 * whole file is stored, canceled, or permanently failed (`onStatusChange`
 * reports which) -- callers don't need to inspect the resolved value.
 */
export async function runDownload(
  source: DownloadEngineSource,
  callbacks: DownloadEngineCallbacks
): Promise<void> {
  const controller = new AbortController();
  activeControllers.set(source.id, controller);

  let opfsWritable: FileSystemWritableFileStream | null = null;
  try {
    const resumeOffset = await committedBytes(source);
    callbacks.onProgress(resumeOffset, source.totalBytes);

    if (source.storage === "opfs") {
      const root = await getOpfsRoot();
      if (!root) throw new Error("Local storage is unavailable in this browser.");
      const handle = await root.getFileHandle(opfsFileName(source.id), { create: true });
      opfsWritable = await handle.createWritable({ keepExistingData: true });
    }

    let chunkIndex =
      source.storage === "idb-blob" ? (await highestStoredChunkIndex(source.id)) + 1 : 0;
    let offset = resumeOffset;

    while (source.totalBytes === null || offset < source.totalBytes) {
      if (controller.signal.aborted) throw new DownloadCancelledError();
      const rangeEnd =
        source.totalBytes !== null
          ? Math.min(offset + CHUNK_SIZE, source.totalBytes) - 1
          : offset + CHUNK_SIZE - 1;
      const requestedLength = rangeEnd - offset + 1;
      const chunk = await fetchChunkWithRetry(source, offset, rangeEnd, controller.signal);
      if (chunk.byteLength === 0) break;

      if (source.storage === "opfs" && opfsWritable) {
        await opfsWritable.write({ type: "write", position: offset, data: chunk });
      } else {
        await putChunk(source.id, chunkIndex, new Blob([chunk], { type: source.mimeType }));
        chunkIndex += 1;
      }

      offset += chunk.byteLength;
      callbacks.onProgress(offset, source.totalBytes ?? offset);

      // A short read (less than the requested range) means the server hit
      // EOF -- the authoritative signal for sources with an unknown total
      // length, and a normal way for the final chunk of a known-length
      // source to end too.
      if (chunk.byteLength < requestedLength) break;
    }

    callbacks.onStatusChange("ready");
  } catch (error) {
    if (error instanceof DownloadCancelledError) {
      callbacks.onStatusChange("canceled");
    } else {
      callbacks.onStatusChange(
        "failed",
        error instanceof Error ? error.message : String(error)
      );
    }
  } finally {
    if (opfsWritable) {
      await opfsWritable.close().catch(() => undefined);
    }
    activeControllers.delete(source.id);
  }
}

/** A completed download's bytes as a `Blob`, from whichever backend stored it. `null` if the file is missing/unreadable. */
export async function getPlaybackBlob(record: DownloadRecord): Promise<Blob | null> {
  if (record.storage === "opfs") {
    const root = await getOpfsRoot();
    if (!root) return null;
    try {
      const handle = await root.getFileHandle(opfsFileName(record.id));
      return await handle.getFile();
    } catch {
      return null;
    }
  }
  if (record.storage === "idb-blob") {
    return assembleChunks(record.id, record.mimeType);
  }
  return null;
}

/** Removes only the physical bytes for a download (OPFS file or IndexedDB chunk rows) -- callers also remove the `downloads` row itself via `downloadsDb.deleteDownload`. */
export async function deleteStoredBytes(record: DownloadRecord): Promise<void> {
  abortDownload(record.id);
  if (record.storage === "opfs") {
    const root = await getOpfsRoot();
    if (root) {
      await root.removeEntry(opfsFileName(record.id)).catch(() => undefined);
    }
  }
  if (record.storage === "idb-blob") {
    await clearChunks(record.id);
  }
}
