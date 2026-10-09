/**
 * Priority scheduler for the focused-item detail requests.
 *
 * Moving a remote across a rail must never leave a backlog of detail calls behind it, and must never let a
 * background warm-up delay the card the viewer is on. So there are two lanes:
 *
 * - **current**: one job, the focused item's. It starts at once and is never queued behind anything. When
 *   the focus moves on, the job is aborted, so a held key never has more than one current request in flight.
 * - **background**: neighbour prefetch and idle warm-up, at most `backgroundConcurrency` (2) in flight, in
 *   rank order. A new focus replaces the wanted set: queued jobs it no longer wants are dropped and running
 *   ones are aborted. While paused (fast navigation) nothing new starts.
 *
 * Every job gets its own `AbortSignal`. The scheduler knows nothing about HTTP or React, so it is unit
 * tested on its own.
 */

export type DetailsRun<T> = (signal: AbortSignal) => Promise<T>;

interface Job {
  key: string;
  run: DetailsRun<unknown>;
  controller: AbortController;
  rank: number;
  settle: { resolve: (value: unknown) => void; reject: (error: unknown) => void };
  promise: Promise<unknown>;
}

export interface DetailsSchedulerStats {
  /** 0 or 1. */
  current: number;
  /** Background requests in flight (at most the concurrency). */
  running: number;
  queued: number;
}

export interface DetailsSchedulerOptions {
  backgroundConcurrency?: number;
}

export const BACKGROUND_CONCURRENCY = 2;

export function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

function makeAbortError(): Error {
  return typeof DOMException === "function"
    ? new DOMException("Superseded by newer focus", "AbortError")
    : Object.assign(new Error("Superseded by newer focus"), { name: "AbortError" });
}

export class DetailsScheduler {
  private readonly concurrency: number;
  private currentJob: Job | undefined;
  private readonly running = new Map<string, Job>();
  private queue: Job[] = [];
  private paused = false;
  /** Peak counters, read by tests and the e2e through `window.__detailsStats`. */
  peak = { current: 0, running: 0, total: 0 };

  constructor(options: DetailsSchedulerOptions = {}) {
    this.concurrency = Math.max(1, options.backgroundConcurrency ?? BACKGROUND_CONCURRENCY);
  }

  /** True while `key` is current, queued or running. */
  has(key: string): boolean {
    return this.currentJob?.key === key || this.running.has(key) || this.queue.some((job) => job.key === key);
  }

  stats(): DetailsSchedulerStats {
    return { current: this.currentJob ? 1 : 0, running: this.running.size, queued: this.queue.length };
  }

  private make<T>(key: string, run: DetailsRun<T>, rank: number): Job {
    let settle!: Job["settle"];
    const promise = new Promise<unknown>((resolve, reject) => (settle = { resolve, reject }));
    // A superseded job rejects with an AbortError nobody awaits: that is expected, not an unhandled error.
    promise.catch(() => undefined);
    return { key, run: run as DetailsRun<unknown>, controller: new AbortController(), rank, settle, promise };
  }

  private start(job: Job): void {
    this.peak.total += 1;
    let result: Promise<unknown>;
    try {
      result = job.run(job.controller.signal);
    } catch (error) {
      result = Promise.reject(error);
    }
    result.then(job.settle.resolve, job.settle.reject);
  }

  /**
   * Makes `key` the one current job, aborting the previous one. A repeat for the same key joins the running
   * job. A queued or running background job for the same key is promoted: it keeps going, as the current one.
   */
  current<T>(key: string, run: DetailsRun<T>): Promise<T> {
    if (this.currentJob?.key === key) return this.currentJob.promise as Promise<T>;
    this.abortCurrent();
    const queuedAt = this.queue.findIndex((job) => job.key === key);
    if (queuedAt >= 0) this.queue.splice(queuedAt, 1)[0]!.controller.abort();
    const backgrounded = this.running.get(key);
    let job: Job;
    if (backgrounded) {
      // Already on the wire: adopt it rather than abort and restart (its result is the same).
      this.running.delete(key);
      job = backgrounded;
    } else {
      job = this.make(key, run, 0);
      this.start(job);
    }
    this.currentJob = job;
    this.peak.current = Math.max(this.peak.current, 1);
    const clear = () => {
      if (this.currentJob === job) this.currentJob = undefined;
      this.pump();
    };
    job.promise.then(clear, clear);
    this.pump();
    return job.promise as Promise<T>;
  }

  /** Aborts the current job (the focus left the item and nothing wants its result). */
  abortCurrent(): void {
    const job = this.currentJob;
    if (!job) return;
    this.currentJob = undefined;
    job.controller.abort();
    job.settle.reject(makeAbortError());
  }

  /**
   * Queues `key` behind the current job. Lower `rank` goes first (nearest neighbour first). A key already
   * queued, running or current is not duplicated.
   */
  background<T>(key: string, run: DetailsRun<T>, rank = 0): Promise<T> {
    const existing =
      this.queue.find((job) => job.key === key) ?? this.running.get(key) ?? (this.currentJob?.key === key ? this.currentJob : undefined);
    if (existing) {
      if (this.queue.includes(existing) && rank < existing.rank) {
        existing.rank = rank;
        this.sortQueue();
      }
      return existing.promise as Promise<T>;
    }
    const job = this.make(key, run, rank);
    this.queue.push(job);
    this.sortQueue();
    this.pump();
    return job.promise as Promise<T>;
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => a.rank - b.rank);
  }

  /**
   * Narrows the background lane to `wanted`: queued jobs outside it are dropped, running ones are aborted.
   * Without an argument the lane is emptied.
   */
  retainBackground(wanted?: ReadonlySet<string>): void {
    const keep = (job: Job) => wanted?.has(job.key) === true;
    for (const job of this.queue.filter((candidate) => !keep(candidate))) {
      job.controller.abort();
      job.settle.reject(makeAbortError());
    }
    this.queue = this.queue.filter(keep);
    for (const [key, job] of [...this.running]) {
      if (keep(job)) continue;
      this.running.delete(key);
      job.controller.abort();
      job.settle.reject(makeAbortError());
    }
  }

  /** While paused no queued job starts (running ones finish). Resuming starts the queue. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (!paused) this.pump();
  }

  private pump(): void {
    if (this.paused) return;
    while (this.running.size < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.running.set(job.key, job);
      this.peak.running = Math.max(this.peak.running, this.running.size);
      const done = () => {
        if (this.running.get(job.key) === job) this.running.delete(job.key);
        this.pump();
      };
      job.promise.then(done, done);
      this.start(job);
    }
  }
}
