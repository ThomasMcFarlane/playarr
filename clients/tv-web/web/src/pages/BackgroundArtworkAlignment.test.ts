import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function declarationsFor(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escapedSelector}\\s*\\{(?<declarations>[^}]*)\\}`))?.groups
    ?.declarations ?? "";
}

describe("background artwork alignment", () => {
  it("aligns detail artwork with the directory background", () => {
    const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");
    const directoryArtwork = declarationsFor(css, ".tv-directory .tv-key-art img");
    const detailArtwork = declarationsFor(css, ".tv-detail .tv-key-art img");

    expect(directoryArtwork).toContain("margin-left: 4%");
    expect(detailArtwork).toContain("margin-left: 4%");
  });
});
