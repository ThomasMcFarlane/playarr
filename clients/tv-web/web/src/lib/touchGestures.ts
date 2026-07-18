export interface TouchPoint {
  x: number;
  y: number;
}

/** Returns a bounded horizontal drag once the gesture is clearly horizontal. */
export function horizontalDragOffset(
  start: TouchPoint,
  current: TouchPoint,
  activationDistance = 8,
  maximumDistance = 96
): number | null {
  const deltaX = current.x - start.x;
  const deltaY = current.y - start.y;

  if (
    Math.abs(deltaX) < activationDistance ||
    Math.abs(deltaX) <= Math.abs(deltaY)
  ) {
    return null;
  }

  return Math.max(-maximumDistance, Math.min(maximumDistance, deltaX));
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
