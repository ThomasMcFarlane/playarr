import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("bundled design fonts", () => {
  it("leads the font stacks with the self-hosted families and keeps the platform fallbacks", () => {
    const css = read("./global.css");
    expect(css).toMatch(/--font:\s*"Nunito Sans",\s*"Avenir Next"/);
    expect(css).toMatch(/--mono:\s*"JetBrains Mono",\s*"SFMono-Regular"/);
  });

  it("declares every font file with font-display swap and ships it with its licence", () => {
    const fonts = read("./fonts.css");
    const files = [...fonts.matchAll(/url\("\.\.\/assets\/fonts\/([^"]+\.woff2)"\)/g)].map((m) => m[1]!);
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const file of files) {
      expect(existsSync(new URL(`../assets/fonts/${file}`, import.meta.url))).toBe(true);
    }
    expect(fonts.match(/font-display: swap;/g)?.length).toBe(files.length);
    expect(existsSync(new URL("../assets/fonts/OFL-NunitoSans.txt", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../assets/fonts/OFL-JetBrainsMono.txt", import.meta.url))).toBe(true);
  });

  it("loads the font declarations before the main stylesheet", () => {
    const main = read("../main.tsx");
    expect(main.indexOf('"./styles/fonts.css"')).toBeGreaterThan(-1);
    expect(main.indexOf('"./styles/fonts.css"')).toBeLessThan(main.indexOf('"./styles/global.css"'));
  });
});
