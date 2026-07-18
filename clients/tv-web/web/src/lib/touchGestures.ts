export interface TouchPoint {
  x: number;
  y: number;
}

/** Returns the Cover Flow step represented by a deliberate horizontal swipe. */
export function horizontalSwipeStep(
  start: TouchPoint,
  end: TouchPoint,
  minimumDistance = 36
): -1 | 0 | 1 {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;

  if (
    Math.abs(deltaX) < minimumDistance ||
    Math.abs(deltaX) <= Math.abs(deltaY)
  ) {
    return 0;
  }

  return deltaX < 0 ? 1 : -1;
}
