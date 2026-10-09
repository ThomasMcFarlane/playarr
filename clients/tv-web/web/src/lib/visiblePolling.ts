import { useEffect, useRef } from "react";

/**
 * Runs `run` now and then every `intervalMs`, but only while the page is visible and never while the
 * previous run is still in flight. When the page becomes visible again it runs once at once, so a tab
 * that was in the background catches up without waiting for the next tick. Returns the stop function.
 */
export function startVisiblePolling(
  run: () => Promise<unknown> | void,
  intervalMs: number,
  doc: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> = document
): () => void {
  let inFlight = false;
  let stopped = false;
  const tick = () => {
    if (stopped || inFlight || doc.visibilityState === "hidden") return;
    inFlight = true;
    Promise.resolve()
      .then(run)
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
      });
  };
  const timer = setInterval(tick, intervalMs);
  const onVisibility = () => {
    if (doc.visibilityState !== "hidden") tick();
  };
  doc.addEventListener("visibilitychange", onVisibility);
  tick();
  return () => {
    stopped = true;
    clearInterval(timer);
    doc.removeEventListener("visibilitychange", onVisibility);
  };
}

/** Hook form of `startVisiblePolling`; `run` may change between renders without restarting the timer. */
export function useVisiblePolling(run: () => Promise<unknown> | void, intervalMs: number): void {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => startVisiblePolling(() => latest.current(), intervalMs), [intervalMs]);
}
