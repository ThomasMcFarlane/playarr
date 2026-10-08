import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Page layout CSS guard (docs/design/page-layout.md, section 7.1). Only `styles/page-layout.css` may style the page
 * chrome: the header, Back, the action pill, the shell clock, the scroll area and the states. A selector naming one of
 * these anywhere else fails, which is what makes "restyle Filters on one page" impossible.
 *
 * `BASELINE` lists the page-specific overrides that still exist (settings only); it may only shrink and is empty when the
 * migration is finished (W8).
 */
const src = join(dirname(fileURLToPath(import.meta.url)), "..");

const CHROME = /\.(page-header|tv-library-heading|action-pill|page-filters-button|tv-page-back|app-clock|scroll-area|page-layout|page-actions|loading-state|error-state)\b/;

function stylesheets(): string[] {
  return ["styles", "pages"].flatMap((dir) =>
    readdirSync(join(src, dir))
      .filter((name) => name.endsWith(".css"))
      .map((name) => `${dir}/${name}`)
  );
}

/** Every style rule's selector list (at any at-rule depth), comments removed. */
export function selectors(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "{") {
      const prelude = text.slice(start, i).trim();
      if (prelude && !prelude.startsWith("@")) found.push(prelude.replace(/\s+/g, " "));
      start = i + 1;
    } else if (char === "}" || char === ";") start = i + 1;
  }
  return found;
}

const BASELINE: Record<string, string[]> = {};

describe("page layout CSS", () => {
  it("styles the page chrome only in styles/page-layout.css", () => {
    const stray: string[] = [];
    const stale: string[] = [];
    for (const file of stylesheets().filter((name) => name !== "styles/page-layout.css")) {
      const hits = selectors(readFileSync(join(src, file), "utf8")).filter((selector) => CHROME.test(selector));
      const allowed = BASELINE[file] ?? [];
      for (const selector of hits) if (!allowed.includes(selector)) stray.push(`${file}: ${selector}`);
      for (const selector of allowed) if (!hits.includes(selector)) stale.push(`${file}: ${selector}`);
    }
    expect(stray, "move the rule into styles/page-layout.css (it needs an owner request, see page-layout.md)").toEqual([]);
    expect(stale, "the baseline only shrinks: remove these entries").toEqual([]);
  });

  it("defines the page chrome in page-layout.css, in light and dark, from theme tokens", () => {
    const layout = readFileSync(join(src, "styles/page-layout.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(layout).toMatch(/\.ui-btn\.action-pill\s*\{/);
    expect(layout).toMatch(/:root\[data-theme="dark"\]\s*\{[^}]*--focus-ring-color:\s*#ffffff/);
    // Colours come from theme tokens, never literals (the scrim and shadow rgba values are the one existing fade recipe).
    const literal = layout.match(/#[0-9a-fA-F]{3,8}\b/g)?.filter((value) => value.toLowerCase() !== "#ffffff") ?? [];
    expect(literal).toEqual([]);
  });
});
