import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { playerVideoAccessibilityProps } from "./PlayerSurface";

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
