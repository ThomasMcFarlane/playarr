import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");

/** Rules of the phone media query that also moves the stage-chrome logo to the mobile top inset. */
function phoneBlock(): string {
  const anchor = css.indexOf(".tv-stage-chrome-logo {\n    top: var(--mobile-top-inset, 14px);");
  expect(anchor).toBeGreaterThan(0);
  const start = css.lastIndexOf("@media", anchor);
  return css.slice(start, anchor + 1200);
}

describe("profiles page chrome on a phone", () => {
  it("puts the theme and language selectors in the logo row, above the heading", () => {
    const block = phoneBlock();
    expect(block).toMatch(/\.tv-stage-chrome-controls \{\s*top: var\(--mobile-top-inset, 14px\);/);
  });

  it("starts the heading below the selector row", () => {
    // Selectors end at inset + 42px; the heading starts at inset + 58px.
    expect(css).toMatch(/\.profiles-heading \{\s*top: calc\(var\(--mobile-top-inset\) \+ 58px\);/);
  });
});
