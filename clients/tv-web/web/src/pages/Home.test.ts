import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Home layout", () => {
  it("aligns feature copy with movie and series detail copy", () => {
    const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");
    const homeFeatureRule = css.match(
      /\.tv-home-feature\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;
    const detailCopyRule = css.match(
      /\.tv-detail-copy\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;

    expect(homeFeatureRule).toContain("top: 24%");
    expect(detailCopyRule).toContain("top: 24%");
  });
});
