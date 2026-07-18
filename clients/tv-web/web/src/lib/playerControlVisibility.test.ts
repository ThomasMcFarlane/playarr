import { describe, expect, it } from "vitest";
import { shouldAutoHidePlayerControls } from "./playerControlVisibility";

describe("shouldAutoHidePlayerControls", () => {
  it("keeps inline music controls visible during playback", () => {
    expect(
      shouldAutoHidePlayerControls({
        inlineMusic: true,
        minimised: true,
        playbackState: "playing",
        interactionPinned: false,
      })
    ).toBe(false);
  });

  it("auto-hides unpinned fullscreen controls during playback", () => {
    expect(
      shouldAutoHidePlayerControls({
        inlineMusic: false,
        minimised: false,
        playbackState: "playing",
        interactionPinned: false,
      })
    ).toBe(true);
  });
});
