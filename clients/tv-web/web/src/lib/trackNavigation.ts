export interface TrackNavigationItem<T> {
  value: T;
  centreX: number;
}

/**
 * Finds the horizontally closest item in the next non-empty track.
 * Track order determines vertical movement, even when no item overlaps the
 * current item's horizontal position.
 */
export function findClosestItemInNextTrack<T>(
  tracks: readonly (readonly TrackNavigationItem<T>[])[],
  currentTrackIndex: number,
  currentCentreX: number,
  direction: "up" | "down"
): T | undefined {
  const step = direction === "down" ? 1 : -1;

  for (
    let trackIndex = currentTrackIndex + step;
    trackIndex >= 0 && trackIndex < tracks.length;
    trackIndex += step
  ) {
    const items = tracks[trackIndex];
    if (!items?.length) continue;

    return items.reduce((closest, item) =>
      Math.abs(item.centreX - currentCentreX) <
      Math.abs(closest.centreX - currentCentreX)
        ? item
        : closest
    ).value;
  }

  return undefined;
}

/**
 * Picks the card in a rail whose on-screen horizontal centre is closest to
 * `centreX`. Cards that intersect the rail's visible span win over clipped-out
 * ones, so a shorter or differently scrolled rail yields its nearest visible
 * card; with nothing visible, every card is considered. Ties go to the earlier
 * card. Never uses an index or scroll offset.
 */
export function pickNearestCardByCentre<T>(
  cards: readonly { value: T; left: number; right: number }[],
  centreX: number,
  visibleLeft: number,
  visibleRight: number
): T | undefined {
  const visible = cards.filter(
    (card) => card.right > visibleLeft && card.left < visibleRight
  );
  const pool = visible.length > 0 ? visible : cards;
  let best: T | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const card of pool) {
    const distance = Math.abs((card.left + card.right) / 2 - centreX);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = card.value;
    }
  }
  return best;
}
