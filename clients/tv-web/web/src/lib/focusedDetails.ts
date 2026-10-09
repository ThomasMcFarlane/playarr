import type { ApiClient, WorkDetail } from "@playarr-tv/api-client";
import { DetailsScheduler, isAbortError } from "./detailsQueue";
import { isNavigating } from "./navigationActivity";

/** The tags a stored work detail depends on (same as `useWork` and `prefetchWorkDetail`). */
const DETAIL_TAGS = ["catalog", "progress", "watchlist"] as const;
/** A stored detail younger than this is shown and not requested again. */
export const DETAIL_FRESH_MS = 30_000;
/**
 * How long an uncached focus waits before its request starts. A key held across a rail moves on within a
 * frame or two, so no request is made for the cards it passes over; a key that has settled pays this once.
 */
export const CURRENT_START_DELAY_MS = 60;
/** Focus must rest this long before the neighbours are queued. */
export const NEIGHBOUR_DWELL_MS = 200;
/** Most details the idle warm-up queues for one page. */
export const WARM_LIMIT = 80;
/** Jobs the idle warm-up keeps queued at once, so a neighbour that appears never waits behind a long list. */
const WARM_BATCH = 2;
const WARM_RETRY_MS = 400;
/** Rank offset that keeps warm-up behind every neighbour. */
const WARM_RANK = 1000;

const keyOf = (id: string) => `work:${id}`;

type Listener = () => void;

/**
 * The data side of the focused-item details: one per signed-in `ApiClient`.
 *
 * - `peek(id)` is synchronous, so a cached item renders in the same frame as the key press.
 * - `focus(id)` makes the item's request the single current one (high priority, aborting the previous
 *   focus's) when the stored copy is missing or older than `DETAIL_FRESH_MS`; a stale copy is shown at once
 *   and revalidated.
 * - `setNear(resolve)` queues the neighbours (resolved after a short dwell) on the low-priority lane.
 * - `setWarm(resolve)` trickles the rest of the visible rails in on idle time, never during fast navigation.
 *
 * Nothing is requested while the query cache is off (signed out, joined multi-server client).
 */
export class FocusedDetails {
  readonly scheduler: DetailsScheduler;
  private focused: string | undefined;
  private startTimer: ReturnType<typeof setTimeout> | 0 = 0;
  private nearTimer: ReturnType<typeof setTimeout> | 0 = 0;
  private warmTimer: ReturnType<typeof setTimeout> | 0 = 0;
  private near = new Set<string>();
  private warm: string[] = [];
  private warmResolve: (() => readonly string[]) | undefined;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly offInvalidate: () => void;

  constructor(
    private readonly client: ApiClient,
    scheduler: DetailsScheduler = new DetailsScheduler()
  ) {
    this.scheduler = scheduler;
    this.offInvalidate = client.queries.onInvalidate(() => {
      // Stored copies are gone: whatever is focused is fetched again, and every viewer re-reads the cache.
      this.scheduler.retainBackground();
      const id = this.focused;
      this.focused = undefined;
      this.notifyAll();
      if (id) this.focus(id);
    });
  }

  dispose(): void {
    this.offInvalidate();
    this.clearTimers();
    this.scheduler.abortCurrent();
    this.scheduler.retainBackground();
    this.scheduler.setPaused(false);
  }

  /** A page is leaving: forget its resolvers and drop everything in flight or queued. */
  release(): void {
    this.resolveNear = undefined;
    this.warmResolve = undefined;
    this.focused = undefined;
    this.near = new Set();
    this.warm = [];
    this.clearTimers();
    this.scheduler.abortCurrent();
    this.scheduler.retainBackground();
    this.scheduler.setPaused(false);
  }

  get enabled(): boolean {
    return this.client.queries.enabled;
  }

  /** The stored detail for `id` (any age) and when it was stored. */
  peek(id: string): { data: WorkDetail; at: number; stale: boolean } | undefined {
    return this.client.queries.peek<WorkDetail>(keyOf(id));
  }

  private isFresh(id: string): boolean {
    const hit = this.peek(id);
    return hit !== undefined && !hit.stale && Date.now() - hit.at < DETAIL_FRESH_MS;
  }

  /**
   * Idle warm-up only fills what is missing or was invalidated. An old copy is not worth a request on
   * its own: a page opened from it paints it and revalidates then (see `focus`), so re-warming every
   * stored copy each `DETAIL_FRESH_MS` made a steady stream of requests (and re-renders) on an idle page.
   */
  private isWarm(id: string): boolean {
    const hit = this.peek(id);
    return hit !== undefined && !hit.stale;
  }

  subscribe(id: string, listener: Listener): () => void {
    let set = this.listeners.get(id);
    if (!set) this.listeners.set(id, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(id);
    };
  }

  private notify(id: string): void {
    for (const listener of [...(this.listeners.get(id) ?? [])]) listener();
  }

  private notifyAll(): void {
    for (const id of [...this.listeners.keys()]) this.notify(id);
  }

  private load(id: string, priority: "high" | "low") {
    return (signal: AbortSignal) =>
      this.client.queries.fetch(keyOf(id), (s) => this.client.getWork(id, { signal: s, priority }), {
        tags: DETAIL_TAGS,
        signal,
      });
  }

  /** The remote is on `id` (or on nothing). Call on every focus move; it is cheap. */
  focus(id: string | undefined): void {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = 0;
    if (id === undefined || !this.enabled) {
      this.focused = id;
      this.scheduler.abortCurrent();
      return;
    }
    if (id === this.focused) return;
    this.focused = id;
    // Moving on: whatever was current is no longer wanted.
    this.scheduler.abortCurrent();
    // Background work waits for the dwell (the neighbours of the new focus replace the wanted set then).
    if (this.resolveNear) this.scheduler.setPaused(true);
    this.scheduleNear();
    if (this.isFresh(id)) return;
    const hadCopy = this.peek(id) !== undefined;
    this.startTimer = setTimeout(
      () => {
        this.startTimer = 0;
        void this.scheduler.current(id, this.load(id, "high")).then(
          () => this.notify(id),
          (error: unknown) => {
            if (!isAbortError(error)) this.notify(id);
          }
        );
      },
      hadCopy ? 0 : CURRENT_START_DELAY_MS
    );
  }

  /** The neighbours to prefetch once focus has rested. `resolve` runs after the dwell, off the key path. */
  setNear(resolve: () => readonly string[]): void {
    this.resolveNear = resolve;
    this.scheduleNear();
  }
  private resolveNear: (() => readonly string[]) | undefined;

  private scheduleNear(): void {
    if (this.nearTimer) clearTimeout(this.nearTimer);
    this.nearTimer = 0;
    if (!this.resolveNear || !this.enabled) return;
    this.nearTimer = setTimeout(() => {
      this.nearTimer = 0;
      const resolve = this.resolveNear;
      if (!resolve) return;
      const ids = resolve().filter((id) => id !== this.focused && !this.isFresh(id));
      this.near = new Set(ids);
      this.scheduler.retainBackground(new Set([...this.near, ...this.warm]));
      ids.forEach((id, index) => {
        void this.scheduler
          .background(id, this.load(id, "low"), index)
          .then(() => this.notify(id), () => undefined);
      });
      this.scheduler.setPaused(false);
      this.feedWarm();
    }, NEIGHBOUR_DWELL_MS);
  }

  /** The wider set to warm on idle time (everything visible on the page), nearest first. */
  setWarm(resolve: () => readonly string[]): void {
    this.warmResolve = resolve;
    this.scheduleWarm(0);
  }

  private scheduleWarm(delay: number): void {
    if (this.warmTimer || !this.warmResolve || !this.enabled) return;
    const run = () => {
      this.warmTimer = 0;
      this.feedWarm();
    };
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    this.warmTimer = setTimeout(() => (idle ? idle(run, { timeout: 2000 }) : run()), delay);
  }

  private feedWarm(): void {
    if (!this.warmResolve || !this.enabled) return;
    if (isNavigating() || this.nearTimer) {
      this.scheduleWarm(WARM_RETRY_MS);
      return;
    }
    this.warm = this.warmResolve()
      .slice(0, WARM_LIMIT)
      .filter((id) => id !== this.focused && !this.isWarm(id));
    const { queued, running } = this.scheduler.stats();
    const room = WARM_BATCH - queued - running;
    const fresh = this.warm.filter((id) => !this.scheduler.has(id));
    if (this.warm.length === 0) return;
    for (const id of fresh.slice(0, Math.max(0, room))) {
      void this.scheduler
        .background(id, this.load(id, "low"), WARM_RANK + this.warm.indexOf(id))
        .then(() => {
          this.notify(id);
          this.scheduleWarm(0);
        }, () => undefined);
    }
    if (room <= 0 || fresh.length > room) this.scheduleWarm(WARM_RETRY_MS);
  }

  private clearTimers(): void {
    for (const timer of [this.startTimer, this.nearTimer, this.warmTimer]) if (timer) clearTimeout(timer);
    this.startTimer = this.nearTimer = this.warmTimer = 0;
  }
}

const controllers = new WeakMap<ApiClient, FocusedDetails>();

/** The shared controller of `client`. */
export function focusedDetailsFor(client: ApiClient): FocusedDetails {
  let controller = controllers.get(client);
  if (!controller) controllers.set(client, (controller = new FocusedDetails(client)));
  return controller;
}
