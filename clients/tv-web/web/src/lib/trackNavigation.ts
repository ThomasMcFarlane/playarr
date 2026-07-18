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
