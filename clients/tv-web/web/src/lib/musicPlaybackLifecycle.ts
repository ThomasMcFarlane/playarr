export interface MusicPlaybackLifecycle {
  mediaFileId: string;
  hasPlayed: boolean;
}

export function advanceMusicPlaybackLifecycle(
  lifecycle: MusicPlaybackLifecycle,
  mediaFileId: string,
  playbackState: string,
  isMusicPlayback: boolean
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
      isMusicPlayback &&
      nextLifecycle.hasPlayed &&
      playbackState === "paused",
  };
}
