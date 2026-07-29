export interface CoverflowDepth {
  scale: number;
  zIndex: number;
}

/**
 * Signed shortest distance around a circular track of `total` items, e.g.
 * for 11 items the last item is offset -1 from the first, not +10. This is
 * what makes the coverflow "revolve" instead of jumping across the whole
 * track when it wraps.
 */
export function circularOffset(
  index: number,
  selectedIndex: number,
  total: number
): number {
  if (total <= 0) return 0;
  const raw = (index - selectedIndex) % total;
  const normalised = raw < 0 ? raw + total : raw;
  return normalised > total / 2 ? normalised - total : normalised;
}

/**
 * Index of the next item one step in `direction` from `currentIndex`,
 * wrapping from the last item to the first and vice versa.
 */
export function nextClientIndex(
  currentIndex: number,
  direction: 1 | -1,
  total: number
): number {
  if (total <= 0) return 0;
  return (currentIndex + direction + total) % total;
}

// Each step out from centre is this fraction of the previous one's size, so
// position keeps growing but by ever-smaller amounts.
const POSITION_STEP_DECAY = 0.55;

/**
 * Signed cumulative position for a tile `offset` steps from centre, using a
 * geometrically shrinking step size: the nearest neighbour gets a full step
 * of separation, but each step further out adds progressively less. Nearby
 * tiles stay clearly spread apart while distant ones converge into a tight
 * stack instead of spreading further and further across the screen.
 */
export function coverflowPosition(offset: number): number {
  const magnitude = Math.abs(offset);
  let position = 0;
  let step = 1;
  for (let i = 0; i < magnitude; i++) {
    position += step;
    step *= POSITION_STEP_DECAY;
  }
  return offset < 0 ? -position : position;
}

export interface GridOffset {
  x: number;
  y: number;
}

/**
 * Centred (x, y) offset, in grid-cell units, for `index` in a roughly
 * square grid of `total` items. An incomplete last row is centred on its
 * own rather than left-aligned, so the grid reads as a balanced cluster of
 * bubbles instead of a ragged one.
 */
export function gridOffset(index: number, total: number): GridOffset {
  if (total <= 0) return { x: 0, y: 0 };
  const columns = Math.ceil(Math.sqrt(total));
  const rows = Math.ceil(total / columns);
  const row = Math.floor(index / columns);
  const col = index % columns;
  const itemsInRow = Math.min(columns, total - row * columns);
  return {
    x: col - (itemsInRow - 1) / 2,
    y: row - (rows - 1) / 2,
  };
}

// The centred tile is a deliberate step up from the "first neighbour" size
// below, not just the top of a smooth shrink curve -- it's meant to read as
// clearly the largest, not just the least-shrunk.
const ACTIVE_SCALE = 1.22;
const NEIGHBOUR_SCALE = 0.87;
const SCALE_STEP_PER_DEPTH = 0.13;
const MIN_SCALE = 0.4;
const CENTRE_Z_INDEX = 50;
const Z_INDEX_STEP_PER_DEPTH = 10;

/**
 * Every item stays on screen (full opacity, a positive scale) -- distance
 * from the centre only shrinks a tile and tucks it behind nearer ones, it
 * never fades or hides it.
 */
export function coverflowDepth(offset: number): CoverflowDepth {
  const magnitude = Math.abs(offset);
  if (magnitude === 0) {
    return { scale: ACTIVE_SCALE, zIndex: CENTRE_Z_INDEX };
  }
  return {
    scale: Math.max(MIN_SCALE, NEIGHBOUR_SCALE - (magnitude - 1) * SCALE_STEP_PER_DEPTH),
    zIndex: Math.max(0, CENTRE_Z_INDEX - magnitude * Z_INDEX_STEP_PER_DEPTH),
  };
}
