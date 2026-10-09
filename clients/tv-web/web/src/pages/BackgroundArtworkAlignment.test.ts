import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("background artwork alignment", () => {
  it("uses one complete left-aligned artwork treatment on every stage", () => {
    const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");
    const artworkRule = css.match(
      /\.tv-key-art img\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;
    const tintRule = css.match(
      /\.tv-key-art::after\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;
    const washRule = css.match(
      /\.tv-stage-wash\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;

    expect(artworkRule).toContain("width: 52%");
    expect(artworkRule).toContain("height: 106%");
    expect(artworkRule).toContain("margin-left: 0");
    expect(artworkRule).toContain("opacity: 0.24");
    expect(artworkRule).toContain(
      "-webkit-mask-image: linear-gradient(90deg, #000 0%, #000 72%, transparent 100%)"
    );
    expect(artworkRule).toContain(
      "mask-image: linear-gradient(90deg, #000 0%, #000 72%, transparent 100%)"
    );
    expect(tintRule).toContain("transparent 22%, transparent 100%");
    expect(tintRule).toContain("transparent 22%, transparent 82%");
    expect(washRule).toContain("var(--surface) 94%");
    expect(washRule).toContain("var(--surface) 50%");
    for (const surface of ["home", "directory", "detail", "search"]) {
      expect(css.match(new RegExp(`\\.tv-${surface} \\.tv-key-art img`, "g"))).toHaveLength(1);
      expect(css.match(new RegExp(`\\.tv-${surface} \\.tv-key-art::after`, "g"))).toHaveLength(1);
      expect(css.match(new RegExp(`\\.tv-${surface} \\.tv-stage-wash`, "g"))).toHaveLength(1);
    }
  });
});
