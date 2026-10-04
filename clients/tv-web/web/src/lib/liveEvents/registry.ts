import type { Invalidation, LiveArea } from "./mapping";

export interface LiveScope {
  areas: readonly LiveArea[];
  /**
   * Entity ids this consumer shows (a work page: its work id plus its episode
   * ids). Omit for list-style consumers that show many entities; they refetch
   * for any entity of their areas.
   */
  keys?: readonly string[];
}

export interface LiveRegistryOptions {
  /** Trailing debounce for bursts. */
  debounceMs?: number;
  /** A continuous stream of events still flushes at least this often. */
  maxWaitMs?: number;
  now?: () => number;
}

interface Registration {
  scope: LiveScope;
  refetch: () => void;
  /** Client-clock time the consumer's data was last fetched (or mounted). */
  fetchedAt: number;
}

export interface LiveRegistry {
  register(scope: LiveScope, refetch: () => void): () => void;
  /** Queue an invalidation; coalesced. `atClientMs` is the change time on the client clock. */
  invalidate(invalidations: readonly Invalidation[], atClientMs?: number): void;
  /** Refetch every mounted consumer now (resync, gap, fallback poll). */
  refetchAll(): void;
  /** Number of mounted consumers (diagnostics/tests). */
  size(): number;
  dispose(): void;
}

function matches(scope: LiveScope, inv: Invalidation): boolean {
  if (!scope.areas.includes(inv.area)) return false;
  if (inv.key === undefined || scope.keys === undefined) return true;
  return scope.keys.includes(inv.key);
}

export function createLiveRegistry(options: LiveRegistryOptions = {}): LiveRegistry {
  const debounceMs = options.debounceMs ?? 200;
  const maxWaitMs = options.maxWaitMs ?? 1000;
  const now = options.now ?? (() => Date.now());
  const registrations = new Set<Registration>();
  // area -> key -> newest `at`; key "" means the whole area.
  let pending = new Map<string, { inv: Invalidation; at: number | undefined }>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstQueuedAt = 0;

  const fire = (registration: Registration) => {
    registration.fetchedAt = now();
    try {
      registration.refetch();
    } catch {
      // A failing consumer must not block the others.
    }
  };

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = () => {
    clearTimer();
    const batch = [...pending.values()];
    pending = new Map();
    if (batch.length === 0) return;
    for (const registration of [...registrations]) {
      const due = batch.some(
        ({ inv, at }) => matches(registration.scope, inv) && (at === undefined || at > registration.fetchedAt)
      );
      if (due) fire(registration);
    }
  };

  return {
    register(scope, refetch) {
      const registration: Registration = { scope, refetch, fetchedAt: now() };
      registrations.add(registration);
      return () => {
        registrations.delete(registration);
      };
    },
    invalidate(invalidations, atClientMs) {
      if (invalidations.length === 0) return;
      for (const inv of invalidations) {
        const id = `${inv.area}\u0000${inv.key ?? ""}`;
        const previous = pending.get(id);
        const at =
          previous === undefined
            ? atClientMs
            : previous.at === undefined || atClientMs === undefined
              ? undefined
              : Math.max(previous.at, atClientMs);
        pending.set(id, { inv, at });
      }
      const current = now();
      if (timer === null) firstQueuedAt = current;
      else clearTimeout(timer);
      const wait = Math.max(0, Math.min(debounceMs, firstQueuedAt + maxWaitMs - current));
      timer = setTimeout(flush, wait);
    },
    refetchAll() {
      clearTimer();
      pending = new Map();
      for (const registration of [...registrations]) fire(registration);
    },
    size: () => registrations.size,
    dispose() {
      clearTimer();
      pending = new Map();
      registrations.clear();
    },
  };
}
