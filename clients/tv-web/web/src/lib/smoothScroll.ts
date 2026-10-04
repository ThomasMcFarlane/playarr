/**
 * rAF-driven eased scrolling for remote / keyboard navigation.
 *
 * CSS `scroll-behavior: smooth` is deliberately not used for remote input: each
 * programmatic write restarts a native animation from the mid-flight position,
 * so under a held key the viewport trails the focus by thousands of pixels.
 * Here every element owns at most one animation per axis. A new target replaces
 * the old one (coalescing held-key repeats to the latest target), restarting
 * the ease from the *current* position with a shorter duration, so nothing
 * queues and the scroll always converges on the newest focus.
 */

const DURATION_MS = 240;
const RETARGET_DURATION_MS = 170;
/** User wheel/touch drags the scroller away from where we wrote it: yield. */
const INTERFERENCE_PX = 3;

type Axis = "left" | "top";

interface Animation {
  from: number;
  to: number;
  start: number;
  duration: number;
  lastWritten: number;
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

function cancel(el: HTMLElement, axis: Axis): void {
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
      cancel(el, axis);
    return;
  }
  const t = (now - animation.start) / animation.duration;
  const value =
    t >= 1
      ? animation.to
      : animation.from + (animation.to - animation.from) * easeOutCubic(t);
  write(el, axis, value);
  animation.lastWritten = read(el, axis);
  if (t >= 1) {
    cancel(el, axis);
    return;
  }
  animation.raf = window.requestAnimationFrame((time) => step(el, axis, time));
}

function animateAxis(el: HTMLElement, axis: Axis, target: number): void {
  const current = read(el, axis);
  const running = active.get(el)?.[axis];
  if (Math.abs(target - current) < 0.5) {
    if (!running) return;
    // Already at the newest target: let the old animation finish settling.
    running.to = target;
    return;
  }
  if (prefersReducedMotion()) {
    cancel(el, axis);
    write(el, axis, target);
    return;
  }
  if (running) window.cancelAnimationFrame(running.raf);
  const state = active.get(el) ?? {};
  active.set(el, state);
  // Programmatic writes must not be re-animated by `scroll-behavior: smooth`.
  el.style.setProperty("scroll-behavior", "auto");
  const animation: Animation = {
    from: current,
    to: target,
    start: performance.now(),
    duration: running ? RETARGET_DURATION_MS : DURATION_MS,
    lastWritten: current,
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

/** True while an eased scroll is in flight on `el`. */
export function isSmoothScrolling(el: HTMLElement): boolean {
  const state = active.get(el);
  return Boolean(state?.left || state?.top);
}
