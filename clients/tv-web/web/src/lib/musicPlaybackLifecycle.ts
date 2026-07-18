export interface MusicPlaybackLifecycle {
  mediaFileId: string;
  hasPlayed: boolean;
}

export function advanceMusicPlaybackLifecycle(
  lifecycle: MusicPlaybackLifecycle,
  mediaFileId: string,
  playbackState: string,
  shouldStopOnPause: boolean
): {
  lifecycle: MusicPlaybackLifecycle;
  shouldStop: boolean;
} {
  const nextLifecycle =
    lifecycle.mediaFileId === mediaFileId
      ? { ...lifecycle }
      : { mediaFileId, hasPlayed: false };

  if (playbackState === "playing") {
    nextLifecycle.hasPlayed = true;
  }

  return {
    lifecycle: nextLifecycle,
    shouldStop:
      shouldStopOnPause &&
      nextLifecycle.hasPlayed &&
      playbackState === "paused",
  };
}
