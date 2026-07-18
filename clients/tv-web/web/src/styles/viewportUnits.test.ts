import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalCss = readFileSync(new URL("./global.css", import.meta.url), "utf8");
const clientsCss = readFileSync(new URL("../pages/Clients.css", import.meta.url), "utf8");
const androidHost = readFileSync(
  new URL(
    "../../../../tv-android/src/main/kotlin/io/streamarr/tv/ui/screens/WebAppScreen.kt",
    import.meta.url
  ),
  "utf8"
);

describe("viewport-relative TV layout", () => {
  it("routes vertical viewport sizing through the WebView-safe unit", () => {
    expect(globalCss).toContain("--viewport-unit: max(1vh, 1dvh)");
    const declarations = `${globalCss}\n${clientsCss}`.replace(
      "--viewport-unit: max(1vh, 1dvh)",
      ""
    );

    expect(declarations).not.toMatch(/-?\d+(?:\.\d+)?(?:d|s|l)?vh\b/);
  });

  it("sets the unit from the Android TV host's measured 1080p canvas", () => {
    expect(androidHost).toContain('"--viewport-unit"');
    expect(androidHost).toContain('"${TV_LAYOUT_HEIGHT_CSS_PX / 100f}px"');
  });
});
