/**
 * The one scroll engine for focus-driven motion (owner ruling, 8 October 2026).
 *
 * Every programmatic scroll that follows remote, D-pad or keyboard focus goes
 * through here: eased, 200 to 300 ms, cancelable and retargeting. Nothing else
 * in the app may write `scrollTop` / `scrollLeft` or ask for
 * `behavior: "instant"` (`scrollMotionAudit.test.ts` enforces it).
 *
 * CSS `scroll-behavior: smooth` is deliberately not used for remote input: each
 * programmatic write restarts a native animation from the mid-flight position,
 * so under a held key the viewport trails the focus by thousands of pixels.
 * Here every element owns at most one animation per axis. A new target replaces
 * the old one (coalescing held-key repeats to the latest target) and restarts
 * the ease from the *current* position with a shorter duration, so nothing
 * queues, nothing overshoots (the ease is monotonic) and the scroll always
 * converges on the newest focus. Under a fast repeat the duration shrinks
 * further so the viewport keeps up with the focus.
 */

/** Base duration range for a fresh animation; longer travel takes longer. */
export const MIN_DURATION_MS = 200;
export const MAX_DURATION_MS = 280;
/** A retarget mid-flight is shorter, and shorter again when keys repeat fast. */
export const RETARGET_DURATION_MS = 150;
export const REPEAT_DURATION_MS = 110;
/** Retargets closer together than this count as a held key. */
export const REPEAT_WINDOW_MS = 90;
/** User wheel/touch drags the scroller away from where we wrote it: yield. */
const INTERFERENCE_PX = 3;

type Axis = "left" | "top";

interface Animation {
  from: number;
  to: number;
  start: number;
  duration: number;
  lastWritten: number;
  retargetedAt: number;
  raf: number;
}

const active = new WeakMap<HTMLElement, Partial<Record<Axis, Animation>>>();

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function easeOutCubic(t: number): number {
  const p = 1 - Math.min(1, Math.max(0, t));
  return 1 - p * p * p;
}

/** Duration of a fresh animation over `distance` pixels (200 to 280 ms). */
export function durationForDistance(distance: number): number {
  return Math.min(MAX_DURATION_MS, MIN_DURATION_MS + Math.abs(distance) * 0.08);
}

/** Duration of a retarget; `sinceLast` is the time since the previous retarget. */
export function retargetDuration(sinceLast: number): number {
  return sinceLast < REPEAT_WINDOW_MS ? REPEAT_DURATION_MS : RETARGET_DURATION_MS;
}

function read(el: HTMLElement, axis: Axis): number {
  return axis === "left" ? el.scrollLeft : el.scrollTop;
}

function write(el: HTMLElement, axis: Axis, value: number): void {
  if (axis === "left") el.scrollLeft = value;
  else el.scrollTop = value;
}

function release(el: HTMLElement): void {
  const state = active.get(el);
  if (state && (state.left || state.top)) return;
  active.delete(el);
  el.style.removeProperty("scroll-behavior");
}

function cancelAxis(el: HTMLElement, axis: Axis): void {
  const animation = active.get(el)?.[axis];
  if (!animation) return;
  window.cancelAnimationFrame(animation.raf);
  delete active.get(el)![axis];
  release(el);
}

function step(el: HTMLElement, axis: Axis, now: number): void {
  const animation = active.get(el)?.[axis];
  if (!animation) return;
  if (!el.isConnected || Math.abs(read(el, axis) - animation.lastWritten) > INTERFERENCE_PX) {
    cancelAxis(el, axis);
    return;
  }
  const t = (now - animation.start) / animation.duration;
  const value =
    t >= 1 ? animation.to : animation.from + (animation.to - animation.from) * easeOutCubic(t);
  write(el, axis, value);
  // No read-back here: it would force a layout straight after the write. The
  // next frame's read (layout clean at rAF start) checks for interference.
  animation.lastWritten = value;
  if (t >= 1) {
    cancelAxis(el, axis);
    return;
  }
  animation.raf = window.requestAnimationFrame((time) => step(el, axis, time));
}

function animateAxis(el: HTMLElement, axis: Axis, target: number): void {
  const current = read(el, axis);
  const running = active.get(el)?.[axis];
  // Same destination as the glide already under way: leave it be.
  if (running && Math.abs(running.to - target) < 0.5) return;
  if (Math.abs(target - current) < 0.5) {
    if (!running) return;
    // Already at the newest target: let the old animation finish settling.
    running.to = target;
    return;
  }
  if (prefersReducedMotion()) {
    cancelAxis(el, axis);
    write(el, axis, target);
    return;
  }
  const now = performance.now();
  if (running) window.cancelAnimationFrame(running.raf);
  const state = active.get(el) ?? {};
  active.set(el, state);
  // Programmatic writes must not be re-animated by `scroll-behavior: smooth`.
  el.style.setProperty("scroll-behavior", "auto");
  const animation: Animation = {
    from: current,
    to: target,
    start: now,
    duration: running
      ? retargetDuration(now - running.retargetedAt)
      : durationForDistance(target - current),
    lastWritten: current,
    retargetedAt: now,
    raf: 0,
  };
  state[axis] = animation;
  animation.raf = window.requestAnimationFrame((time) => step(el, axis, time));
}

/** Ease `el` to the given scroll offsets; omitted axes are left alone. */
export function smoothScrollTo(
  el: HTMLElement,
  target: { left?: number; top?: number }
): void {
  if (target.left !== undefined) animateAxis(el, "left", target.left);
  if (target.top !== undefined) animateAxis(el, "top", target.top);
}

/**
 * Where `el` is heading on `axis`: the running animation's destination, else
 * its current offset. Reveal maths uses this so a key press that lands while a
 * glide is in flight is judged against where the viewport will settle.
 */
export function settledScrollOffset(el: HTMLElement, axis: Axis): number {
  return active.get(el)?.[axis]?.to ?? read(el, axis);
}

/** Stop any eased scroll on `el`, leaving it where it is. */
export function cancelSmoothScroll(el: HTMLElement): void {
  cancelAxis(el, "left");
  cancelAxis(el, "top");
}

/** True while an eased scroll is in flight on `el`. */
export function isSmoothScrolling(el: HTMLElement): boolean {
  const state = active.get(el);
  return Boolean(state?.left || state?.top);
}

/**
 * Jump without animation, for restoring a saved position, resetting a freshly
 * mounted page, or parity captures. Cancels any eased scroll on the axes set.
 */
export function setScrollInstant(
  el: HTMLElement,
  target: { left?: number; top?: number }
): void {
  if (target.left !== undefined) {
    cancelAxis(el, "left");
    write(el, "left", target.left);
  }
  if (target.top !== undefined) {
    cancelAxis(el, "top");
    write(el, "top", target.top);
  }
}

/**
 * Put `el` back at a position it already had (undoing an incidental browser
 * scroll). A no-op while an eased scroll is in flight there, so it never
 * cancels the glide it would otherwise interrupt.
 */
export function holdScroll(el: HTMLElement, target: { left?: number; top?: number }): void {
  if (isSmoothScrolling(el)) return;
  setScrollInstant(el, target);
}

function isScrollable(style: CSSStyleDeclaration, axis: Axis, el: HTMLElement): boolean {
  const overflow = axis === "top" ? style.overflowY : style.overflowX;
  if (overflow !== "auto" && overflow !== "scroll" && overflow !== "overlay") return false;
  return axis === "top" ? el.scrollHeight > el.clientHeight : el.scrollWidth > el.clientWidth;
}

function inset(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

/** Scroll delta that brings [start, end] inside [viewStart, viewEnd] (or centres it). */
export function revealDelta(
  start: number,
  end: number,
  viewStart: number,
  viewEnd: number,
  align: "nearest" | "center"
): number {
  if (align === "center") return (start + end) / 2 - (viewStart + viewEnd) / 2;
  if (end - start >= viewEnd - viewStart) return start - viewStart;
  if (start < viewStart) return start - viewStart;
  if (end > viewEnd) return end - viewEnd;
  return 0;
}

/**
 * Animated replacement for `scrollIntoView`: reveals `target` in every
 * scrollable ancestor (`nearest`, or `center` on the block axis), each through
 * the engine, honouring `scroll-padding`. Outer ancestors account for the
 * shift the inner ones will apply.
 */
export function smoothScrollIntoView(
  target: HTMLElement,
  options: {
    block?: "nearest" | "center";
    inline?: "nearest" | "center";
    /** Jump without animation (opening a list at its selection, restoring a view). */
    instant?: boolean;
  } = {}
): void {
  const block = options.block ?? "nearest";
  const inline = options.inline ?? "nearest";
  const rect = target.getBoundingClientRect();
  let top = rect.top;
  let bottom = rect.bottom;
  let left = rect.left;
  let right = rect.right;
  const root = document.scrollingElement as HTMLElement | null;
  for (let el = target.parentElement; el; el = el.parentElement) {
    const isRoot = el === root || el === document.documentElement || el === document.body;
    const style = window.getComputedStyle(el);
    const scrollsY = isRoot ? root!.scrollHeight > root!.clientHeight : isScrollable(style, "top", el);
    const scrollsX = isRoot ? root!.scrollWidth > root!.clientWidth : isScrollable(style, "left", el);
    if (!scrollsY && !scrollsX) continue;
    const scroller = isRoot ? root! : el;
    const box = isRoot
      ? { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth }
      : el.getBoundingClientRect();
    const next: { left?: number; top?: number } = {};
    // Judge against where this scroller will settle, not where it is mid-glide.
    const settledTop = settledScrollOffset(scroller, "top");
    const settledLeft = settledScrollOffset(scroller, "left");
    top += scroller.scrollTop - settledTop;
    bottom += scroller.scrollTop - settledTop;
    left += scroller.scrollLeft - settledLeft;
    right += scroller.scrollLeft - settledLeft;
    if (scrollsY) {
      const delta = revealDelta(
        top,
        bottom,
        box.top + inset(style.scrollPaddingTop),
        box.bottom - inset(style.scrollPaddingBottom),
        block
      );
      if (Math.abs(delta) >= 0.5) {
        const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const to = Math.max(0, Math.min(max, settledTop + delta));
        next.top = to;
        top -= to - settledTop;
        bottom -= to - settledTop;
      }
    }
    if (scrollsX) {
      const delta = revealDelta(
        left,
        right,
        box.left + inset(style.scrollPaddingLeft),
        box.right - inset(style.scrollPaddingRight),
        inline
      );
      if (Math.abs(delta) >= 0.5) {
        const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
        const to = Math.max(0, Math.min(max, settledLeft + delta));
        next.left = to;
        left -= to - settledLeft;
        right -= to - settledLeft;
      }
    }
    if (next.top !== undefined || next.left !== undefined) {
      if (options.instant) setScrollInstant(scroller, next);
      else smoothScrollTo(scroller, next);
    }
    if (isRoot) break;
  }
}
