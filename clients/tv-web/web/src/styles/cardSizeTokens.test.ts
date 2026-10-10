import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./global.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("./page-layout.css", import.meta.url), "utf8");
const rule = (selector: string) => {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
};

/** Owner request 2026-10-10: every poster card is the Library grid card. One token set, defined once. */
describe("poster card size tokens", () => {
  it("defines the card size once, from the stage scale", () => {
    expect(layout.match(/^\s*--card-w:/gm)).toHaveLength(1);
    expect(layout).toMatch(/--card-w:\s*calc\([^;]*var\(--vw\)/s);
    expect(css).not.toMatch(/^\s*--card-w:/m);
  });

  it("sizes the Library grid and every rail and grid from the token", () => {
    expect(rule(".tv-title-grid-content")).toContain("repeat(var(--card-cols), var(--card-w))");
    expect(rule(".tv-title-card")).toContain("flex: 0 0 var(--card-w)");
    expect(rule(".tv-home-card")).toContain("flex: 0 0 var(--card-w)");
    expect(rule(".tv-search-results-grid")).toContain("repeat(var(--card-cols), var(--card-w))");
    expect(layout).toMatch(/\.skeleton-rail-row > \.skeleton-card\s*\{[^}]*var\(--card-w\)/);
  });

  it("gives every poster card the same art ratio, radius and caption", () => {
    for (const art of [".tv-title-card-art", ".tv-home-card-art", ".tv-search-result-art"]) {
      const body = rule(art);
      expect(body, art).toMatch(/aspect-ratio:\s*var\(--card-art-ratio\)/);
      expect(body, art).toContain("border-radius: var(--card-radius)");
    }
    expect(rule(".tv-home-card > strong")).toContain("font-size: var(--card-title-size)");
    expect(rule(".tv-title-card-copy strong")).toContain("font-size: var(--card-title-size)");
    expect(rule(".tv-search-result-copy strong")).toContain("font-size: var(--card-title-size)");
  });

  it("keeps no per-page poster card width", () => {
    expect(css).not.toMatch(/\.tv-home-card\s*\{[^}]*flex:\s*0 0 clamp/);
    expect(css).not.toMatch(/\.tv-search-results-grid\s*\{[^}]*minmax\(0, 1fr\)/);
  });
});
