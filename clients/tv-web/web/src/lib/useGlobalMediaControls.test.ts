import { describe, expect, it, vi } from "vitest";
import {
  globalMediaControlActionForKeystroke,
  installMediaSessionActionHandlers,
} from "./useGlobalMediaControls";

describe("globalMediaControlActionForKeystroke", () => {
  it.each([
    ["MediaPlay", "play"],
    ["MediaPause", "pause"],
    ["MediaPlayPause", "toggle-playback"],
    ["MediaStop", "stop"],
    ["MediaRewind", "seek-backward"],
    ["MediaFastForward", "seek-forward"],
    ["MediaTrackPrevious", "previous-track"],
    ["MediaTrackNext", "next-track"],
  ] as const)("maps %s to %s", (key, action) => {
    expect(
      globalMediaControlActionForKeystroke({
        key,
        typingTarget: true,
      })
    ).toBe(action);
  });

  it("supports Space and K across every non-typing focus target", () => {
    expect(globalMediaControlActionForKeystroke({ key: " " })).toBe(
      "toggle-playback"
    );
    expect(globalMediaControlActionForKeystroke({ key: "k" })).toBe(
      "toggle-playback"
    );
  });

  it("does not steal shortcuts while typing, with modifiers, or when held", () => {
    expect(
      globalMediaControlActionForKeystroke({
        key: " ",
        typingTarget: true,
      })
    ).toBeNull();
    expect(
      globalMediaControlActionForKeystroke({ key: "k", ctrlKey: true })
    ).toBeNull();
    expect(
      globalMediaControlActionForKeystroke({
        key: "MediaTrackNext",
        repeat: true,
      })
    ).toBeNull();
  });
});

describe("installMediaSessionActionHandlers", () => {
  it("registers and removes browser playback actions", () => {
    const handlers = new Map<
      MediaSessionAction,
      MediaSessionActionHandler | null
    >();
    const mediaSession = {
      playbackState: "none" as MediaSessionPlaybackState,
      setActionHandler: vi.fn(
        (
          action: MediaSessionAction,
          handler: MediaSessionActionHandler | null
        ) => handlers.set(action, handler)
      ),
    };
    const callbacks = {
      onPlay: vi.fn(),
      onPause: vi.fn(),
      onTogglePlay: vi.fn(),
      onPrevious: vi.fn(),
      onNext: vi.fn(),
    };

    const removeHandlers = installMediaSessionActionHandlers(
      mediaSession,
      callbacks
    );

    handlers.get("play")?.({ action: "play" });
    handlers.get("pause")?.({ action: "pause" });
    handlers.get("previoustrack")?.({ action: "previoustrack" });
    handlers.get("nexttrack")?.({ action: "nexttrack" });
    expect(callbacks.onPlay).toHaveBeenCalledOnce();
    expect(callbacks.onPause).toHaveBeenCalledOnce();
    expect(callbacks.onPrevious).toHaveBeenCalledOnce();
    expect(callbacks.onNext).toHaveBeenCalledOnce();

    removeHandlers();
    expect(mediaSession.setActionHandler).toHaveBeenCalledTimes(8);
    expect(Array.from(handlers.values())).toEqual([null, null, null, null]);
  });
});
