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

/**
 * Opt-in motion for a scroller whose content is a function of its live scroll
 * position (the library cover flow). A profile swaps the engine's ease for a
 * velocity-preserving one: a retarget continues from the current position AND
 * the current speed (a cubic Hermite segment that ends at rest), so rapid or
 * held presses never restart or jump. `onFrame` runs right after each write so
 * dependants (cover poses) move in the same frame as the scroll itself.
 */
export interface ScrollProfile {
  /** Duration of a glide that starts from rest. */
  freshMs: number;
  /** Duration of a retarget mid-glide. */
  retargetMs: number;
  /** Duration when presses repeat inside `repeatWindowMs` (a held key). */
  repeatMs: number;
  repeatWindowMs: number;
  /** Start speed, as a multiple of travel/duration, for a glide from rest (2 = ease-out). */
  restSlope: number;
  onFrame?: (value: number) => void;
}

interface Animation {
  profile?: ScrollProfile;
  /** Start speed in px/ms (profile glides only). */
  v0: number;
  from: number;
  to: number;
  start: number;
  duration: number;
  lastWritten: number;
  retargetedAt: number;
  raf: number;
}

const active = new WeakMap<HTMLElement, Partial<Record<Axis, Animation>>>();
/** Scrollers whose horizontal glide belongs to one component (see `ownHorizontalScroll`). */
const owned = new WeakSet<HTMLElement>();

/**
 * Claim `el`'s horizontal eased scroll for a component that drives it with its own `ScrollProfile` (the library
 * cover flow). Generic focus reveals (`smoothScrollIntoView`, the rail reveal) then leave that axis alone: they judge
 * the target from a card's transformed bounding box, which would pull a glide off the owner's target and restart it
 * on the stock ease. Instant jumps still apply. Returns the release function.
 */
export function ownHorizontalScroll(el: HTMLElement): () => void {
  owned.add(el);
  return () => {
    owned.delete(el);
  };
}

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
  // A frame timestamp can predate the call that started the glide (input handled just before the frame): never negative.
  const t = Math.max(0, (now - animation.start) / animation.duration);
  const value = t >= 1 ? animation.to : glideValue(animation, t);
  write(el, axis, value);
  animation.profile?.onFrame?.(value);
  // No read-back here: it would force a layout straight after the write. The
  // next frame's read (layout clean at rAF start) checks for interference.
  animation.lastWritten = value;
  if (t >= 1) {
    cancelAxis(el, axis);
    return;
  }
  animation.raf = window.requestAnimationFrame((time) => step(el, axis, time));
}

/** Normalised start slope of a Hermite glide, clamped so it never overshoots (<= 3 is monotonic). */
function hermiteSlope(v0: number, duration: number, travel: number): number {
  return Math.max(-1.5, Math.min(3, (v0 * duration) / travel));
}

function glideValue(a: Animation, t: number): number {
  if (!a.profile) return a.from + (a.to - a.from) * easeOutCubic(t);
  const travel = a.to - a.from;
  const slope = hermiteSlope(a.v0, a.duration, travel);
  const t2 = t * t;
  const t3 = t2 * t;
  return a.from + travel * ((-2 * t3 + 3 * t2) + slope * (t3 - 2 * t2 + t));
}

/** Current speed in px/ms of a profile glide (0 for the stock engine, which restarts from rest). */
function glideVelocity(a: Animation, now: number): number {
  if (!a.profile) return 0;
  const t = Math.min(1, Math.max(0, (now - a.start) / a.duration));
  const travel = a.to - a.from;
  const slope = hermiteSlope(a.v0, a.duration, travel);
  const d = -6 * t * t + 6 * t + slope * (3 * t * t - 4 * t + 1);
  return (travel * d) / a.duration;
}

function animateAxis(
  el: HTMLElement,
  axis: Axis,
  target: number,
  profile?: ScrollProfile,
  fixedDuration?: number
): void {
  if (!profile && axis === "left" && owned.has(el)) return;
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
    profile?.onFrame?.(target);
    return;
  }
  const now = performance.now();
  const velocity = running ? glideVelocity(running, now) : 0;
  if (running) window.cancelAnimationFrame(running.raf);
  const state = active.get(el) ?? {};
  active.set(el, state);
  // Programmatic writes must not be re-animated by `scroll-behavior: smooth`.
  el.style.setProperty("scroll-behavior", "auto");
  const sinceLast = running ? now - running.retargetedAt : Infinity;
  const duration = profile
    ? !running
      ? profile.freshMs
      : sinceLast < profile.repeatWindowMs
        ? profile.repeatMs
        : profile.retargetMs
    : running
      ? // A caller-chosen duration shortens a fresh glide; a retarget is never slower than the repeat rules.
        Math.min(fixedDuration ?? Infinity, retargetDuration(sinceLast))
      : (fixedDuration ?? durationForDistance(target - current));
  const travel = target - current;
  // From rest the glide opens at `restSlope`; mid-glide it keeps the speed it had, so a retarget never jolts. A
  // same-direction retarget never opens slower than linear, so a held key is not left trailing the focus.
  const v0 = !profile
    ? 0
    : running && Math.abs(velocity) > 1e-6
      ? velocity * travel >= 0
        ? Math.max(velocity, ((travel > 0 ? 1 : -1) * Math.abs(travel)) / duration)
        : velocity
      : (profile.restSlope * travel) / duration;
  const animation: Animation = {
    profile,
    v0,
    from: current,
    to: target,
    start: now,
    duration,
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
  target: { left?: number; top?: number },
  profile?: ScrollProfile,
  options: { duration?: number } = {}
): void {
  if (target.left !== undefined) animateAxis(el, "left", target.left, profile, options.duration);
  if (target.top !== undefined) animateAxis(el, "top", target.top, profile, options.duration);
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
