import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  MUSIC_VISUALISER_BAR_COUNT,
  MUSIC_VISUALISER_BAR_COUNT_TEN_FOOT,
  musicVisualiserBarCount,
  playerVideoAccessibilityProps,
} from "./PlayerSurface";

describe("playerVideoAccessibilityProps", () => {
  it("makes the minimised video inert instead of hiding retained focus", () => {
    const markup = renderToStaticMarkup(
      <video {...playerVideoAccessibilityProps(true, "Video playback")} />
    );

    expect(markup).toContain('inert=""');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).not.toContain("aria-hidden");
    expect(markup).not.toContain("aria-label");
  });

  it("restores the accessible video surface when maximised", () => {
    const markup = renderToStaticMarkup(
      <video {...playerVideoAccessibilityProps(false, "Video playback")} />
    );

    expect(markup).not.toContain("inert");
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('aria-label="Video playback"');
  });
});

describe("musicVisualiserBarCount", () => {
  it("uses full density on desktop web", () => {
    expect(musicVisualiserBarCount("web")).toBe(MUSIC_VISUALISER_BAR_COUNT);
  });

  it("uses ten-foot density for tv-vidaa and android-tv (parity)", () => {
    expect(musicVisualiserBarCount("tv-vidaa")).toBe(
      MUSIC_VISUALISER_BAR_COUNT_TEN_FOOT
    );
    expect(musicVisualiserBarCount("android-tv")).toBe(
      MUSIC_VISUALISER_BAR_COUNT_TEN_FOOT
    );
  });
});
