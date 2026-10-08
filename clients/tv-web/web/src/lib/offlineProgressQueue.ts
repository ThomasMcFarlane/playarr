import { isPermanentProgressFailure } from "./playbackProgress";

export interface QueuedProgress {
  id: string;
  serverUrl: string;
}

export interface ProgressQueueDeps<T extends QueuedProgress> {
  list: () => Promise<T[]>;
  send: (mutation: T) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
  serverUrl: string;
  isCancelled: () => boolean;
}

/**
 * Builds a flush function for the offline watch-progress queue. Overlapping
 * calls collapse into the running one (a slow server must not see the same
 * mutation twice), mutations the server rejects for good are dropped instead
 * of being retried forever, and nothing can reject.
 */
export function createProgressQueueFlusher<T extends QueuedProgress>(
  deps: ProgressQueueDeps<T>
): () => Promise<void> {
  let running: Promise<void> | null = null;

  const run = async () => {
    try {
      const mutations = await deps.list();
      for (const mutation of mutations) {
        if (deps.isCancelled()) return;
        if (mutation.serverUrl !== deps.serverUrl) continue;
        try {
          await deps.send(mutation);
        } catch (error) {
          if (!isPermanentProgressFailure(error)) continue;
          // Poison message: fall through and delete it.
        }
        try {
          await deps.remove(mutation.id);
        } catch {
          // Left queued; the next flush retries the delete.
        }
      }
    } catch {
      // IndexedDB unavailable or over quota: try again on the next tick.
    }
  };

  return () => {
    if (running) return running;
    running = run().finally(() => {
      running = null;
    });
    return running;
  };
}
