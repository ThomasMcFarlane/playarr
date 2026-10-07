import type { PlaybackEngineState } from "@playarr-tv/player-core";

/** The slice of the API client the reporter needs (the same calls the web client uses). */
export interface ProgressClient {
  getWatchProgress(mediaFileId: string): Promise<{ state: string; position_ms: number }>;
  updateWatchProgress(
    mediaFileId: string,
    update: { positionMs: number; durationMs: number; completed?: boolean }
  ): Promise<unknown>;
}

export interface ProgressEngine {
  getState(): PlaybackEngineState;
  onStateChange(listener: (state: PlaybackEngineState) => void): () => void;
}

/** Same cadence as the web client's heartbeat. */
export const PROGRESS_INTERVAL_MS = 10_000;

/** Resume point in seconds from the server's saved progress, or undefined to start at 0. */
export async function fetchResumeSeconds(
  client: Pick<ProgressClient, "getWatchProgress">,
  mediaFileId: string
): Promise<number | undefined> {
  try {
    const progress = await client.getWatchProgress(mediaFileId);
    if (progress.state === "part_watched" && progress.position_ms > 0) {
      return progress.position_ms / 1000;
    }
  } catch {
    // Resume is best-effort: a failed lookup must never block playback.
  }
  return undefined;
}

/**
 * Reports watch progress while playing and flushes it on pause, end and exit.
 * Nothing is written until playback has actually started, so a stalled or
 * cancelled start can never overwrite the saved resume point with 0.
 */
export class ProgressReporter {
  private started = false;
  private lastWriteAt = 0;
  private lastState: string = "idle";
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly client: ProgressClient,
    private readonly mediaFileId: string,
    private readonly engine: ProgressEngine,
    private readonly now: () => number = Date.now,
    private readonly intervalMs: number = PROGRESS_INTERVAL_MS
  ) {}

  start(): void {
    this.unsubscribe = this.engine.onStateChange((state) => this.onState(state));
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Awaitable save of the current position; a no-op until playback has started. */
  async flush(): Promise<void> {
    const state = this.engine.getState();
    if (!this.started) return;
    const positionMs = Math.round(state.currentTimeSeconds * 1000);
    const durationMs = Math.round(state.durationSeconds * 1000);
    const completed =
      state.state === "ended" || (durationMs > 0 && positionMs * 10 >= durationMs * 9);
    if (positionMs <= 0 && !completed) return;
    this.lastWriteAt = this.now();
    try {
      await this.client.updateWatchProgress(this.mediaFileId, { positionMs, durationMs, completed });
    } catch {
      // Progress must never interrupt playback; the next write retries.
    }
  }

  private onState(state: PlaybackEngineState): void {
    if (state.state === "playing" && state.currentTimeSeconds > 0) this.started = true;
    const changed = state.state !== this.lastState;
    this.lastState = state.state;
    if (!this.started) return;
    const transition = changed && (state.state === "paused" || state.state === "ended");
    const heartbeat =
      (state.state === "playing" || state.state === "buffering") &&
      this.now() - this.lastWriteAt >= this.intervalMs;
    if (transition || heartbeat) void this.flush();
  }
}
