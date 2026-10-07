/**
 * Mobile double-tap seeking: a second tap within the window on the left half
 * seeks back, on the right half forward. The first tap of a pair is handled by
 * the caller (it defers its play/pause toggle by `DOUBLE_TAP_WINDOW_MS`).
 */
export const DOUBLE_TAP_WINDOW_MS = 300;

export type DoubleTapResult = "backward" | "forward" | null;

export interface DoubleTapDetector {
  tap(x: number, width: number, nowMs: number): DoubleTapResult;
  reset(): void;
}

export function createDoubleTapDetector(windowMs = DOUBLE_TAP_WINDOW_MS): DoubleTapDetector {
  let last: { half: "left" | "right"; at: number } | null = null;
  return {
    tap(x, width, nowMs) {
      const half = x < width / 2 ? "left" : "right";
      if (last && last.half === half && nowMs - last.at <= windowMs) {
        last = null;
        return half === "left" ? "backward" : "forward";
      }
      last = { half, at: nowMs };
      return null;
    },
    reset() {
      last = null;
    },
  };
}
