import { describe, expect, it } from "vitest";
import { advanceMusicPlaybackLifecycle } from "./musicPlaybackLifecycle";

describe("advanceMusicPlaybackLifecycle", () => {
  it("stops music after playing passes through buffering before pause", () => {
    let lifecycle = { mediaFileId: "track-1", hasPlayed: false };

    ({ lifecycle } = advanceMusicPlaybackLifecycle(
      lifecycle,
      "track-1",
      "playing",
      true
    ));
    ({ lifecycle } = advanceMusicPlaybackLifecycle(
      lifecycle,
      "track-1",
      "buffering",
      true
    ));
    const paused = advanceMusicPlaybackLifecycle(
      lifecycle,
      "track-1",
      "paused",
      true
    );

    expect(paused.shouldStop).toBe(true);
  });

  it("does not stop video or music that has not started", () => {
    const lifecycle = { mediaFileId: "track-1", hasPlayed: false };

    expect(
      advanceMusicPlaybackLifecycle(
        lifecycle,
        "track-1",
        "paused",
        true
      ).shouldStop
    ).toBe(false);
    expect(
      advanceMusicPlaybackLifecycle(
        { mediaFileId: "track-1", hasPlayed: true },
        "track-1",
        "paused",
        false
      ).shouldStop
    ).toBe(false);
  });

  it("keeps an inline music session mounted when playback pauses", () => {
    const paused = advanceMusicPlaybackLifecycle(
      { mediaFileId: "track-1", hasPlayed: true },
      "track-1",
      "paused",
      false
    );

    expect(paused.shouldStop).toBe(false);
  });

  it("resets playback history when the track changes", () => {
    const result = advanceMusicPlaybackLifecycle(
      { mediaFileId: "track-1", hasPlayed: true },
      "track-2",
      "paused",
      true
    );

    expect(result).toEqual({
      lifecycle: { mediaFileId: "track-2", hasPlayed: false },
      shouldStop: false,
    });
  });
});
