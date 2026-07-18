import { describe, expect, it } from "vitest";
import {
  shouldAutoHidePlayerControls,
  shouldRenderPlayerControls,
} from "./playerControlVisibility";

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

  it("hides inline controls until playback is ready", () => {
    expect(
      shouldRenderPlayerControls({
        inlineMusic: true,
        minimised: true,
        playbackBusy: true,
      })
    ).toBe(false);
    expect(
      shouldRenderPlayerControls({
        inlineMusic: true,
        minimised: true,
        playbackBusy: false,
      })
    ).toBe(true);
  });
});
