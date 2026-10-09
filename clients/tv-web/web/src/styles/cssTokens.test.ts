import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string): string =>
  readFileSync(new URL(name, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const globalCss = read("./global.css");
const layoutCss = read("./page-layout.css");

describe("stylesheet clean-up (web TV audit S7-S10, P16)", () => {
  it("declares the shell clock once (S7)", () => {
    expect(layoutCss.match(/^\.app-clock \{/gm)).toHaveLength(1);
    expect(layoutCss.match(/^\.app-clock-time \{/gm)).toHaveLength(1);
    expect(layoutCss.match(/^\.app-clock-date \{/gm)).toHaveLength(1);
  });

  it("hides the tablet clock through the shell's data-page-header mark, not :has() (S7)", () => {
    expect(layoutCss).not.toMatch(/:has\([^)]*page-header[^)]*\)[^{]*\.app-clock/);
    expect(layoutCss).toMatch(/\.app-shell\[data-page-header\] \.app-clock \{\s*display: none;/);
  });

  it("keeps stacking layers on the --z-* scale above 17 (S8, P16)", () => {
    const raw = [...(globalCss + layoutCss).matchAll(/z-index:\s*(\d+)\s*[;}\n]/g)]
      .map((match) => Number(match[1]))
      .filter((value) => value > 17);
    expect(raw).toEqual([]);
  });

  it("keeps the control height behind --page-control-height (S10)", () => {
    expect(globalCss).not.toContain("clamp(38px, calc(2.8 * var(--vw)), 50px)");
  });

  it("gives player rules tokens, not colour literals, for their text and error colours (P16)", () => {
    const literals = /#(?:ee9297|c5b8bd|776b71|a5969e|f2b2ba|dfdcdd)\b/i;
    const offenders = [...globalCss.matchAll(/([^{}]*player[^{}]*)\{([^{}]*)\}/g)]
      .filter((match) => literals.test(match[2] ?? ""))
      .map((match) => (match[1] ?? "").trim());
    expect(offenders).toEqual([]);
  });

  it("draws the scrubber focus with the shared ring and offset, not a bare shadow (P16)", () => {
    const rule = globalCss.match(/\.player-seek-track:focus-visible,\s*body\[data-input-mode="remote"\] \.player-seek-track:focus \{([^}]*)\}/);
    expect(rule?.[1]).toContain("outline: var(--page-focus-ring);");
    expect(rule?.[1]).toContain("outline-offset: var(--page-focus-ring-offset);");
  });

  it("drops the backdrop blur on the rail panel and action pills in remote mode (S11)", () => {
    expect(globalCss).toMatch(
      /body\[data-input-mode="remote"\] :is\([^)]*\.tv-rail-panel[^)]*\) \{\s*-webkit-backdrop-filter: none;\s*backdrop-filter: none;/
    );
    expect(layoutCss).toMatch(
      /body\[data-input-mode="remote"\] \.tv-page-back,\s*body\[data-input-mode="remote"\] \.action-pill \{\s*-webkit-backdrop-filter: none;\s*backdrop-filter: none;/
    );
  });
});
