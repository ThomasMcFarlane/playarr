import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("detail title typography", () => {
  it("matches every detail title to the established library-preview style", () => {
    const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");
    const sharedTitleRule = css.match(
      /\.tv-home-feature h2,\s*\.tv-library-preview h2,\s*\.tv-detail > \.tv-detail-copy h1\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;

    expect(sharedTitleRule).toContain("max-width: 9ch");
    expect(sharedTitleRule).toContain("font-size: clamp(2.2rem, 3.6vw, 5rem)");
    expect(sharedTitleRule).toContain("font-weight: 560");
    expect(sharedTitleRule).toContain("letter-spacing: -0.072em");
    expect(sharedTitleRule).toContain("line-height: 0.9");
  });
});
