/**
 * Remote-navigation activity gate.
 *
 * While a remote button is held (or tapped repeatedly) the main thread must do
 * nothing but move focus: starting artwork fetches, creating object URLs or
 * mounting images each cost milliseconds that a TV-class CPU multiplies by
 * 4-10x. Callers hand that deferrable work to `whenNavigationIdle`; it runs
 * immediately when the user is not navigating, otherwise after a short quiet
 * period, a couple of jobs per task so the first frame after a hold is cheap.
 */

/**
 * Quiet time after the last remote key before deferred work resumes. It must
 * exceed the longest main-thread stall a key can sit behind: a handler that
 * runs late stamps `lastKeyAt` late, so a shorter window lets background work
 * start in the gap between two queued keys.
 */
export const NAVIGATION_QUIET_MS = 350;
/** Deferred jobs started per task once idle, so a backlog never forms one long task. */
const JOBS_PER_SLICE = 1;

let lastKeyAt = Number.NEGATIVE_INFINITY;
const waiting: Array<() => void> = [];
let timer: ReturnType<typeof setTimeout> | 0 = 0;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * True while the browser holds an input event it has not delivered yet (a key
 * queued behind the current task). `lastKeyAt` only records keys that already
 * ran, so on a saturated main thread this is the only way to see that the user
 * is still pressing.
 */
function inputPending(): boolean {
  const scheduling = (
    globalThis as { navigator?: { scheduling?: { isInputPending?: () => boolean } } }
  ).navigator?.scheduling;
  try {
    return scheduling?.isInputPending?.() === true;
  } catch {
    return false;
  }
}

/** Call from the remote key handler on every directional key. */
export function noteNavigationKey(): void {
  lastKeyAt = now();
}

export function isNavigating(): boolean {
  return now() - lastKeyAt < NAVIGATION_QUIET_MS || inputPending();
}

function pump(): void {
  timer = 0;
  if (waiting.length === 0) return;
  const sinceKey = now() - lastKeyAt;
  if (sinceKey < NAVIGATION_QUIET_MS) {
    timer = setTimeout(pump, NAVIGATION_QUIET_MS - sinceKey);
    return;
  }
  if (inputPending()) {
    timer = setTimeout(pump, 16);
    return;
  }
  for (let i = 0; i < JOBS_PER_SLICE && waiting.length > 0; i += 1) {
    waiting.shift()!();
    if (inputPending()) break;
  }
  if (waiting.length > 0) timer = setTimeout(pump, 0);
}

/** Runs `job` once the user is not navigating; returns a canceller. */
export function whenNavigationIdle(job: () => void): () => void {
  if (!isNavigating() && waiting.length === 0) {
    job();
    return () => undefined;
  }
  const entry = () => job();
  waiting.push(entry);
  if (!timer) timer = setTimeout(pump, NAVIGATION_QUIET_MS);
  return () => {
    const index = waiting.indexOf(entry);
    if (index >= 0) waiting.splice(index, 1);
  };
}
