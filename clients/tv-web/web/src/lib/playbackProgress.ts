/**
 * Decides when playback progress is written to the server, and guards the
 * two ways a write can go to the wrong place: a stale engine state left over
 * from the previous item (playlist or queue advance), and a position of 0.
 */
export const PROGRESS_HEARTBEAT_MS = 10_000;

export interface ProgressPlanInput {
  /** The engine state object this render sees; compared by identity. */
  engineStateToken: unknown;
  state: string;
  positionMs: number;
  durationMs: number;
  nowMs: number;
}

export interface ProgressPlan {
  persist: boolean;
  completed: boolean;
}

const NO_WRITE: ProgressPlan = { persist: false, completed: false };

export function createProgressGate() {
  let lastWriteAtMs = 0;
  let previousState = "idle";
  let staleToken: unknown = undefined;
  let hasStaleToken = false;

  return {
    /**
     * The media file changed. Engine state seen before the engine emits a
     * fresh one belongs to the previous item and must not be written.
     */
    reset(currentEngineStateToken: unknown, idleState = "idle") {
      lastWriteAtMs = 0;
      previousState = idleState;
      staleToken = currentEngineStateToken;
      hasStaleToken = true;
    },
    /** True while `token` is the engine state left over from the previous item. */
    isStale(token: unknown): boolean {
      return hasStaleToken && token === staleToken;
    },
    markWritten(nowMs: number) {
      lastWriteAtMs = nowMs;
    },
    plan(input: ProgressPlanInput): ProgressPlan {
      if (hasStaleToken && input.engineStateToken === staleToken) return NO_WRITE;
      hasStaleToken = false;
      const stateChanged = previousState !== input.state;
      previousState = input.state;
      const completed =
        input.state === "ended" ||
        (input.durationMs > 0 && input.positionMs * 10 >= input.durationMs * 9);
      const flushTransition =
        stateChanged && ["paused", "ended", "error"].includes(input.state);
      const heartbeat =
        ["playing", "buffering"].includes(input.state) &&
        input.nowMs - lastWriteAtMs >= PROGRESS_HEARTBEAT_MS;
      if (!(flushTransition || heartbeat)) return NO_WRITE;
      // Never write position 0: it would wipe a real resume point.
      if (input.positionMs <= 0) return NO_WRITE;
      return { persist: true, completed };
    },
  };
}

/** A 4xx (other than auth or retryable ones) will never succeed on retry. */
export function isPermanentProgressFailure(error: unknown): boolean {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status)
      : NaN;
  if (!Number.isFinite(status)) return false;
  if (status < 400 || status >= 500) return false;
  return ![401, 403, 408, 425, 429].includes(status);
}

/**
 * `play()` rejects with AbortError when a load interrupts it and
 * NotAllowedError when autoplay is blocked. Both are reported through the
 * engine state, so the rejection is swallowed rather than left unhandled.
 */
export function safePlay(result: PromiseLike<unknown> | void | undefined): void {
  if (result && typeof result.then === "function") {
    result.then(undefined, () => undefined);
  }
}
