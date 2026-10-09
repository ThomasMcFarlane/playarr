import { useCallback, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { ownHorizontalScroll, type ScrollProfile } from "./smoothScroll";

/**
 * Library cover flow motion (owner feedback 9 October 2026: "a little too fast / jolty").
 *
 * The scroller glides with one velocity-preserving curve (see `ScrollProfile` in `smoothScroll.ts`) and every cover's
 * pose is a continuous function of the live scroll position, written in the same frame as the scroll. Rotation,
 * scale, depth and dimming therefore interpolate with the glide instead of snapping to a per-selection class and
 * transitioning on their own clock. Only `transform`, `transform-origin` and `z-index` are written, never a
 * layout property. At rest every pose equals the static class pose in `global.css`, so the settled state is unchanged.
 */

/** Motion tokens. The glide is a Hermite segment: from rest it is cubic-bezier(1/3, 2/3, 2/3, 1), an ease-out. */
export const COVERFLOW_MOTION = {
  /** One step from rest (was a 200 to 280 ms scroll plus an unrelated 440 ms pose transition). */
  freshMs: 380,
  /** A press that lands mid-glide. */
  retargetMs: 320,
  /** Presses closer than `repeatWindowMs` (a held key) shorten further so the flow never trails the input. */
  repeatMs: 240,
  repeatWindowMs: 160,
  /** Opening speed from rest, as a multiple of travel/duration. 2 is a quadratic-out start with no overshoot. */
  restSlope: 2,
} as const;

/** Covers further than this from centre keep the static far pose (a stacked wall). */
export const COVERFLOW_WINDOW = 5;

interface Knot {
  rotate: number;
  shift: number;
  scale: number;
  z: number;
}

/** Poses by distance from centre: 0 centred, 1 first neighbour, 2, then 3 and beyond (matches the CSS classes). */
const KNOTS: readonly Knot[] = [
  { rotate: 0, shift: 0, scale: 1, z: 24 },
  { rotate: 48, shift: 12, scale: 0.88, z: 16 },
  { rotate: 54, shift: 15, scale: 0.83, z: 12 },
  { rotate: 58, shift: 18, scale: 0.79, z: 8 },
  { rotate: 58, shift: 18, scale: 0.79, z: 4 },
];
const FAR_KNOT: Knot = { rotate: 58, shift: 18, scale: 0.79, z: 4 };
const knot = (index: number): Knot => KNOTS[index] ?? FAR_KNOT;

export interface CoverflowPose {
  transform: string;
  origin: string;
  zIndex: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const round = (value: number, digits = 4) => Number(value.toFixed(digits));

/** Pose of a cover `offset` positions from centre (negative: before the centre). Continuous in `offset`. */
export function coverflowPose(offset: number): CoverflowPose {
  const distance = Math.min(Math.abs(offset), KNOTS.length - 1);
  const lower = Math.min(KNOTS.length - 2, Math.floor(distance));
  const t = distance - lower;
  const a = knot(lower);
  const b = knot(lower + 1);
  const sign = offset < 0 ? 1 : offset > 0 ? -1 : 0;
  const rotate = round(sign * lerp(a.rotate, b.rotate, t));
  const shift = round(sign * lerp(a.shift, b.shift, t));
  const scale = round(lerp(a.scale, b.scale, t));
  // Before-centre covers pivot on their right edge, after-centre ones on their left, the centre on its middle.
  const origin = round(50 + sign * 50 * Math.min(1, Math.abs(offset)), 2);
  return {
    transform: `perspective(1000px) rotateY(${rotate}deg) translateX(${shift}%) scale(${scale})`,
    origin: `${origin}% 50%`,
    // Stacking order is the one discrete part: a z-index change on a flex item re-lays out its parent, so it is only
    // written when the nearest slot changes (see `paint`), not interpolated.
    zIndex: knot(Math.round(distance)).z,
  };
}

export interface CoverflowGeometry {
  /** Scroll offset that centres card 0 (negative when the first card cannot reach the centre). */
  first: number;
  /** Distance between neighbouring cards' centres. */
  pitch: number;
  count: number;
  /** Largest reachable scroll offset. */
  maxScroll: number;
}

/**
 * Fractional position (in cards) of the viewport centre for a scroll offset: 0 is card 0 centred, 1 is card 1, and
 * so on. Linear between cards, except that the first and last card rest where the scroller actually stops (which can
 * be short of exactly centred), so a card at an end settles in the flat centre pose, as the stylesheet draws it.
 */
export function coverflowPosition(scrollLeft: number, geometry: CoverflowGeometry): number {
  const { first, pitch, count, maxScroll } = geometry;
  if (pitch <= 0 || count <= 0) return 0;
  const centred = (i: number) => first + i * pitch;
  const restFirst = Math.max(0, Math.min(maxScroll, centred(0)));
  const restLast = Math.max(0, Math.min(maxScroll, centred(count - 1)));
  let position = (scrollLeft - first) / pitch;
  if (count > 1 && scrollLeft < centred(1) && centred(1) - restFirst > 0.5) {
    position = (scrollLeft - restFirst) / (centred(1) - restFirst);
  } else if (count > 1 && scrollLeft > centred(count - 2) && restLast - centred(count - 2) > 0.5) {
    position = count - 2 + (scrollLeft - centred(count - 2)) / (restLast - centred(count - 2));
  }
  // Within a pixel of a card's rest: snap, so a settled cover is exactly the stylesheet's pose (scroll offsets are rounded).
  const nearest = Math.round(position);
  if (Math.abs(position - nearest) * pitch < 1) position = nearest;
  return Math.max(0, Math.min(count - 1, position));
}

/**
 * Drives the cover poses from the scroller's live position. Returns the scroll profile to hand to `smoothScrollTo`;
 * its `onFrame` keeps poses in lock-step with the glide, and a passive scroll listener covers wheel, touch and
 * restored positions.
 */
export function useCoverflowMotion(
  gridRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  contentKey: string
): ScrollProfile {
  const state = useRef({
    cards: [] as HTMLElement[],
    geometry: { first: 0, pitch: 0, count: 0, maxScroll: 0 } as CoverflowGeometry,
    lo: 0,
    hi: -1,
    written: [] as Array<string | undefined>,
    origins: [] as Array<string | undefined>,
  });

  const paint = useCallback((scrollLeft: number) => {
    const s = state.current;
    if (s.cards.length === 0 || s.geometry.pitch <= 0) return;
    const position = coverflowPosition(scrollLeft, s.geometry);
    const lo = Math.max(0, Math.floor(position) - COVERFLOW_WINDOW);
    const hi = Math.min(s.cards.length - 1, Math.ceil(position) + COVERFLOW_WINDOW);
    for (let i = Math.min(s.lo, lo); i <= Math.max(s.hi, hi); i += 1) {
      const card = s.cards[i];
      if (!card) continue;
      if (i < lo || i > hi) {
        // Left the window: hand back to the static far pose from the stylesheet.
        card.style.removeProperty("transform");
        card.style.removeProperty("transform-origin");
        card.style.removeProperty("z-index");
        s.written[i] = undefined;
        s.origins[i] = undefined;
        continue;
      }
      const pose = coverflowPose(i - position);
      // Far covers hold one pose: writing the same value again still invalidates style, so only changes go through.
      if (s.written[i] !== pose.transform) {
        s.written[i] = pose.transform;
        card.style.transform = pose.transform;
      }
      if (s.origins[i] !== pose.origin) {
        s.origins[i] = pose.origin;
        card.style.transformOrigin = pose.origin;
      }
      const z = String(pose.zIndex);
      if (card.style.zIndex !== z) card.style.zIndex = z;
    }
    s.lo = lo;
    s.hi = hi;
  }, []);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!enabled || !grid) return undefined;
    const s = state.current;
    const measure = () => {
      s.cards = Array.from(grid.querySelectorAll<HTMLElement>(".tv-title-card"));
      const first = s.cards[0];
      const last = s.cards[s.cards.length - 1];
      s.geometry = {
        first: first ? first.offsetLeft + first.offsetWidth / 2 - grid.clientWidth / 2 : 0,
        // Whole-track average: `offsetLeft` is rounded, so one neighbour gap would drift by half a pixel per card.
        pitch: first && last && last !== first ? (last.offsetLeft - first.offsetLeft) / (s.cards.length - 1) : 0,
        count: s.cards.length,
        maxScroll: Math.max(0, grid.scrollWidth - grid.clientWidth),
      };
      s.lo = 0;
      s.hi = s.cards.length - 1;
      s.written = [];
      s.origins = [];
      paint(grid.scrollLeft);
    };
    measure();
    const release = ownHorizontalScroll(grid);
    const onScroll = () => paint(grid.scrollLeft);
    grid.addEventListener("scroll", onScroll, { passive: true });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(grid);
    return () => {
      grid.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      release();
      for (const card of s.cards) {
        card.style.removeProperty("transform");
        card.style.removeProperty("transform-origin");
        card.style.removeProperty("z-index");
      }
      s.cards = [];
    };
  }, [enabled, gridRef, paint, contentKey]);

  return useMemo<ScrollProfile>(
    () => ({ ...COVERFLOW_MOTION, onFrame: paint }),
    [paint]
  );
}
