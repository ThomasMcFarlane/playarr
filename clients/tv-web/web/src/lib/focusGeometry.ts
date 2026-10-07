/**
 * Pure directional focus geometry for TV remote navigation.
 * Kept free of DOM I/O so scoring stays cheap to unit-test and reuse.
 */

export type Direction = "up" | "down" | "left" | "right";

export interface FocusRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface FocusCentre {
  x: number;
  y: number;
}

export function focusCentre(rect: FocusRect): FocusCentre {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Cheap forward-axis check used to discard most candidates before the full score.
 * Matches the ±2px dead-zone of `scoreDirectionalCandidate`.
 */
export function isRoughlyForward(
  from: FocusCentre,
  to: FocusCentre,
  direction: Direction
): boolean {
  switch (direction) {
    case "up":
      return to.y < from.y - 2;
    case "down":
      return to.y > from.y + 2;
    case "left":
      return to.x < from.x - 2;
    case "right":
      return to.x > from.x + 2;
  }
}

/**
 * Scores a candidate for geometric remote navigation. Lower is better.
 * Returns null when the candidate is not in the forward cone.
 */
export function scoreDirectionalCandidate(
  from: FocusRect,
  to: FocusRect,
  direction: Direction
): number | null {
  const a = focusCentre(from);
  const b = focusCentre(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const isVertical = direction === "up" || direction === "down";
  const forward =
    direction === "up"
      ? dy < -2
      : direction === "down"
        ? dy > 2
        : direction === "left"
          ? dx < -2
          : dx > 2;
  if (!forward) return null;

  const primary = Math.abs(isVertical ? dy : dx);
  const lateral = Math.abs(isVertical ? dx : dy);
  const overlap = isVertical
    ? Math.max(0, Math.min(from.right, to.right) - Math.max(from.left, to.left))
    : Math.max(0, Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top));

  // A directional press must remain primarily directional. Without this
  // cone, an element far to the right but a few pixels lower can win an
  // ArrowDown search simply because no perfectly aligned item is nearby.
  // Cross-axis overlap identifies the same visual row/column; otherwise
  // reject targets whose diagonal drift is larger than their forward move.
  const crossAxisSize = isVertical
    ? Math.min(from.width, to.width)
    : Math.min(from.height, to.height);
  const coneAllowance = primary * 0.85 + crossAxisSize * 0.2;
  if (overlap <= 0 && lateral > coneAllowance) return null;

  return primary + lateral * 4 - Math.min(overlap, 180) * 0.55;
}

export interface ScoredFocusCandidate<T> {
  item: T;
  rect: FocusRect;
}

/**
 * Picks the best directional target in a single O(n) pass (no sort).
 * Candidates that fail a cheap forward pre-filter are never fully scored.
 */
export function pickBestDirectionalTarget<T>(
  from: FocusRect,
  candidates: readonly ScoredFocusCandidate<T>[],
  direction: Direction
): T | undefined {
  const origin = focusCentre(from);
  let best: T | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const centre = focusCentre(candidate.rect);
    if (!isRoughlyForward(origin, centre, direction)) continue;
    const score = scoreDirectionalCandidate(from, candidate.rect, direction);
    if (score === null || score >= bestScore) continue;
    bestScore = score;
    best = candidate.item;
  }

  return best;
}

/**
 * True when some candidate sits to the right of `from` on roughly the same row
 * (shared with alphabet-edge escape on library grids).
 */
export function hasHorizontalNeighbourToRight(
  from: FocusRect,
  candidates: readonly FocusRect[]
): boolean {
  const fromCentre = focusCentre(from);
  for (const rect of candidates) {
    const verticalOverlap = Math.max(
      0,
      Math.min(from.bottom, rect.bottom) - Math.max(from.top, rect.top)
    );
    if (
      focusCentre(rect).x > fromCentre.x + 2 &&
      verticalOverlap >= Math.min(from.height, rect.height) * 0.45
    ) {
      return true;
    }
  }
  return false;
}

/** Copy a live DOMRect into a plain object (cheap to retain across a keypress). */
export function focusRectFromDOMRect(rect: DOMRectReadOnly): FocusRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * How many columns a dense CSS-grid / flow of equal-height cards uses.
 * Cards must be in DOM order (row-major). Pure helper so unit tests can pin it.
 */
export function detectEqualRowColumns(
  tops: readonly number[],
  tolerance = 2
): number {
  if (tops.length < 2) return Math.max(1, tops.length);
  const firstTop = tops[0]!;
  let columns = 1;
  for (let index = 1; index < tops.length; index += 1) {
    if (tops[index]! > firstTop + tolerance) break;
    columns += 1;
  }
  return columns;
}

/**
 * Next card index for remote navigation on a dense equal-row title grid.
 * Returns null when the press should leave the grid (edge / unhandled).
 */
export function titleGridNeighbourIndex(
  index: number,
  length: number,
  columns: number,
  direction: Direction
): number | null {
  if (index < 0 || index >= length || columns < 1 || length === 0) return null;
  const col = index % columns;
  switch (direction) {
    case "left":
      return col > 0 ? index - 1 : null;
    case "right":
      return col < columns - 1 && index + 1 < length ? index + 1 : null;
    case "up":
      return index - columns >= 0 ? index - columns : null;
    case "down": {
      const candidate = index + columns;
      if (candidate < length) return candidate;
      // Incomplete last row: land on the final card when it is still below.
      if (length - 1 > index) return length - 1;
      return null;
    }
  }
}

/**
 * Derive a row-major virtualisation window from a single anchor index.
 * One source of truth (focused / scrolled index) — do not keep a separate
 * `{start,end}` state that is synced from effects.
 *
 * Defaults stay tight so remote holds do not mount a full catalogue page.
 */
export function libraryGridWindow(
  anchorIndex: number,
  total: number,
  columns: number,
  options?: { behindRows?: number; aheadRows?: number; minRows?: number }
): { start: number; end: number } {
  if (total <= 0) return { start: 0, end: 0 };
  const cols = Math.max(1, columns);
  const behindRows = options?.behindRows ?? 2;
  const aheadRows = options?.aheadRows ?? 12;
  const minRows = options?.minRows ?? 6;
  const clamped = Math.max(0, Math.min(total - 1, anchorIndex));
  const start = Math.max(0, clamped - behindRows * cols);
  const end = Math.min(
    total,
    Math.max(clamped + aheadRows * cols + 1, start + minRows * cols)
  );
  return { start, end };
}

/**
 * Expand-only end index for remote navigation. Grows when focus leaves the
 * mounted prefix; never shrinks mid-session (avoids remount thrash / flushSync
 * on every edge cross of a sliding window).
 */
export function libraryExpandMountedEnd(
  currentEnd: number,
  focusIndex: number,
  total: number,
  columns: number,
  aheadRows = 14
): number {
  if (total <= 0) return 0;
  if (focusIndex < currentEnd) return currentEnd;
  const cols = Math.max(1, columns);
  return Math.min(total, Math.max(currentEnd, focusIndex + aheadRows * cols + 1));
}

/** True when `index` is already covered by a derived library window. */
export function libraryWindowContains(
  window: { start: number; end: number },
  index: number
): boolean {
  return index >= window.start && index < window.end;
}

/**
 * The candidate whose rectangle is closest to `from` (edge to edge, 0 when they overlap on an axis), ties broken
 * towards the top and then the left. Used when a control sits beside the content rather than above it (the shell
 * action column), so DOWN and LEFT find the nearest content item instead of stopping.
 */
export function pickNearestByEdgeDistance<T>(
  from: FocusRect,
  candidates: ReadonlyArray<{ item: T; rect: FocusRect }>
): T | null {
  let best: { item: T; rect: FocusRect; distance: number } | null = null;
  for (const candidate of candidates) {
    const dx = Math.max(0, candidate.rect.left - from.right, from.left - candidate.rect.right);
    const dy = Math.max(0, candidate.rect.top - from.bottom, from.top - candidate.rect.bottom);
    const distance = Math.hypot(dx, dy);
    if (
      !best ||
      distance < best.distance - 0.5 ||
      (Math.abs(distance - best.distance) <= 0.5 &&
        (candidate.rect.top < best.rect.top || (candidate.rect.top === best.rect.top && candidate.rect.left < best.rect.left)))
    ) {
      best = { ...candidate, distance };
    }
  }
  return best ? best.item : null;
}
