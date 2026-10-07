import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The header and clock rules live in page-layout.css; the rest of the page frame is still in global.css.
const css = [readFileSync(new URL("./global.css", import.meta.url), "utf8"), readFileSync(new URL("./page-layout.css", import.meta.url), "utf8")].join("\n");
const calendarCss = readFileSync(new URL("../pages/Calendar.css", import.meta.url), "utf8");

// The browser check is scripts/tablet-layout.mjs (820x1180 plus a 600 to 1100 px sweep). These guard its causes:
// proportional left offsets (7.5vw, 8vw) shrink faster than the fixed-width navigation rail, so they must be
// floored to the rail's right edge.
describe("tablet widths: content clears the navigation rail", () => {
  it("defines the rail clearance from the rail's own size tokens", () => {
    expect(css).toMatch(
      /--tv-nav-clearance:\s*calc\(\s*var\(--tv-nav-edge\) \+ var\(--tv-nav-item-size\) \+ \(2 \* var\(--tv-nav-padding-inline\)\) \+ 2px \+ 12px\s*\)/
    );
  });

  it("floors every proportional left offset of titles and the page frame to it", () => {
    expect(css).not.toMatch(/left:\s*(?:calc\(7\.5 \* var\(--vw\)\)|clamp\(102px, calc\(8 \* var\(--vw\)\), 160px\));/);
    expect(css.match(/max\(calc\(7\.5 \* var\(--vw\)\), var\(--tv-nav-clearance\)\)/g)?.length).toBe(4);
    expect(css.match(/max\(clamp\(102px, calc\(8 \* var\(--vw\)\), 160px\), var\(--tv-nav-clearance\)\)/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("keeps the settings list label-wide and the detail panel out of it", () => {
    expect(css).toContain("minmax(calc(var(--tv-nav-clearance) + 320px), 35fr)");
    expect(css).toContain("minmax(calc(var(--tv-nav-clearance) + 320px), 34fr)");
    expect(css).toMatch(/\.tv-library-grid-panel\.settings-detail-panel\s*\{\s*width:\s*min\(65%, calc\(100% - var\(--tv-nav-clearance\) - 320px\)\)/);
  });

  it("hides the clock between the phone and wide-tablet breakpoints, where it collides with long titles", () => {
    expect(css).toMatch(
      /@media \(min-width: 761px\) and \(max-width: 1100px\) \{\s*\.app-shell:has\(\.page-header\) \.app-clock \{\s*display: none;/
    );
  });

  it("lets the calendar month fit beside the rail instead of cutting off Sunday, without touching phones", () => {
    expect(calendarCss).toMatch(/\.calendar-month \{[^}]*min-width: 720px;/);
    expect(calendarCss).toMatch(/@media \(min-width: 761px\) \{\s*\.calendar-month \{\s*min-width: 0;/);
  });
});
