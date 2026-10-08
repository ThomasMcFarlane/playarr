import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = join(__dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(css|tsx?)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
const read = (path: string) => readFileSync(path, "utf8");

describe("the one scroll edge fade", () => {
  it("is a mask on the scroller, defined once in page-layout.css", () => {
    const layout = read(join(src, "styles/page-layout.css"));
    expect(layout).toMatch(/\[data-fade-axis="x"\]:is\(\[data-fade-start\], \[data-fade-end\]\)\s*\{[^}]*mask-image:/s);
    expect(layout).toMatch(/\[data-fade-axis="y"\]:is\(\[data-fade-start\], \[data-fade-end\]\)\s*\{[^}]*mask-image:/s);
    // The prefixed mask comes first: Chrome 111 (VIDAA) has no unprefixed mask-image.
    expect(layout.indexOf("-webkit-mask-image")).toBeGreaterThan(-1);
    // Content stays visible going off screen: a floor, never a fade to nothing, on the end side.
    expect(layout).toMatch(/--page-edge-fade-floor:\s*0\.[1-5]/);
  });

  it("has no other fade implementation (no overlay box, no per-area scrim)", () => {
    const offenders: string[] = [];
    for (const file of files(src)) {
      const text = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
      if (/\.(css)$/.test(file)) {
        if (/(edge-window|media-track-window|scroll-area|library-grid-panel)[^{]*::(before|after)/.test(text)) offenders.push(`${file}: pseudo-element fade`);
        if (/can-scroll-(up|down|left|right|start|end)/.test(text)) offenders.push(`${file}: can-scroll-* class`);
        if (/edge-scrim|tv-scroll-edge-window|calendar-edge-window-x/.test(text)) offenders.push(`${file}: legacy fade`);
        if (!file.endsWith("page-layout.css") && /mask-image:[^;]*(linear|radial)-gradient/.test(text) && /scroll|track|rail|grid|edge/.test(text.match(/[^{}]*\{[^}]*mask-image[^}]*\}/)?.[0] ?? "")) {
          offenders.push(`${file}: a scroller mask outside page-layout.css`);
        }
      } else if (/can-scroll-(up|down|left|right|start|end)|tv-scroll-edge-window|calendar-edge-window-x/.test(text)) {
        offenders.push(`${file}: legacy fade class`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("measures before the first paint, without React state", () => {
    const hook = read(join(src, "lib/useScrollEdges.ts"));
    expect(hook).toContain("useLayoutEffect");
    expect(hook).not.toContain("useState");
    const core = read(join(src, "lib/scrollEdgeFade.ts"));
    expect(core).toContain("measure();");
  });

  it("gives rails vertical headroom inside the scroller, never clipping the focused card", () => {
    const css = read(join(src, "styles/global.css"));
    const windowRule = css.match(/^\.tv-media-track-window\s*\{[^}]*\}/m)?.[0] ?? "";
    expect(windowRule).not.toMatch(/overflow/);
    const scroller = css.match(/^\.tv-media-track-scroll\s*\{[^}]*\}/m)?.[0] ?? "";
    expect(scroller).toContain("--tv-track-shadow-top");
    expect(scroller).toContain("--tv-track-shadow-bottom");
  });
});
