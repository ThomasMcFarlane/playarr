import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * WCAG 2.2 AAA contrast for the design tokens (owner requirement, 9 October 2026): every text token reaches 7:1
 * (1.4.6 Contrast Enhanced) against every surface token it is drawn on, in both themes. The pairs below are the
 * ones the audit (scripts/a11y-aaa.mjs, scripts/a11y-aaa-pages.mjs) found in use. Add a pair here when a new
 * text-on-surface combination appears; a token that is not listed fails the "every text token is covered" test.
 */
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "global.css"), "utf8");

function block(marker: string): Record<string, string> {
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`no ${marker} block`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const tokens: Record<string, string> = {};
  for (const m of body.matchAll(/^\s*(--[a-z-]+):\s*(#[0-9a-f]{6});/gm)) tokens[m[1]] = m[2];
  return tokens;
}

const light = block(":root {");
const dark = { ...light, ...block(':root[data-theme="dark"],') };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ["--bg", "--surface", "--surface-strong", "--surface-soft"];
/** Text tokens and the surfaces each one sits on. Body ink, secondary and muted text sit on all four. */
const TEXT_ON: Record<string, string[]> = {
  "--ink": SURFACES,
  "--ink-soft": SURFACES,
  "--ink-muted": SURFACES,
  "--accent": SURFACES,
  "--brand-ink": SURFACES,
  "--danger": [...SURFACES, "--danger-soft"],
  "--success": SURFACES,
  "--on-accent": ["--accent"],
  "--on-brand": ["--brand-strong"],
};

describe("design tokens meet WCAG AAA contrast (1.4.6, 7:1)", () => {
  for (const [theme, tokens] of [["light", light], ["dark", dark]] as const) {
    const resolved: Record<string, string> = { ...tokens, "--on-brand": "#ffffff" };
    for (const [text, surfaces] of Object.entries(TEXT_ON)) {
      for (const surface of surfaces) {
        it(`${theme}: ${text} on ${surface}`, () => {
          expect(resolved[text], `${text} is a hex token`).toMatch(/^#[0-9a-f]{6}$/);
          expect(resolved[surface], `${surface} is a hex token`).toMatch(/^#[0-9a-f]{6}$/);
          expect(contrast(resolved[text], resolved[surface])).toBeGreaterThanOrEqual(7);
        });
      }
    }
  }

  it("covers every text token the stylesheet defines", () => {
    const text = Object.keys(light).filter((name) => /^--(ink|ink-soft|ink-muted|brand-ink|danger|success|accent|on-accent)$/.test(name));
    expect(text.filter((name) => !(name in TEXT_ON)), "add the new text token to TEXT_ON").toEqual([]);
  });

  it("keeps the focus ring at 3:1 or more against every surface (2.4.13)", () => {
    const ring = { light: light["--ink"], dark: "#ffffff" };
    for (const [theme, tokens] of [["light", light], ["dark", dark]] as const) {
      for (const surface of SURFACES) expect(contrast(ring[theme], tokens[surface]), `${theme} ring on ${surface}`).toBeGreaterThanOrEqual(3);
    }
  });
});
