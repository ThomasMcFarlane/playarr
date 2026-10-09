import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * One focus style system (docs/design/page-layout.md, section 5; owner rulings Q2, Q11, Q13).
 *
 *  - Controls (buttons, pills, inputs, chips, selects, the profile chip, Back) show the single theme ring
 *    (`--page-focus-ring`: white in dark theme, the ink in light theme) with no fill, no glow and no scale.
 *  - Media cards (`.media-card`) show a soft shadow, an animated lift and a subtle red/pink glow ring (owner 2026-10-09) on FOCUS
 *    (`:focus-visible` and the virtual remote marker), never an outline or a fill. The pinned values come from commit de371253.
 *
 * Every rule below fails on the next stray ring, fill or ringed card.
 */
const src = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(src, path), "utf8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function stylesheets(): string[] {
  return ["styles", "pages"].flatMap((dir) =>
    readdirSync(join(src, dir))
      .filter((name) => name.endsWith(".css"))
      .map((name) => `${dir}/${name}`)
  );
}

type Rule = { file: string; selector: string; body: string };

/** Every style rule (any at-rule depth), comments removed, selector lists split on top-level commas. */
function rules(): Rule[] {
  const found: Rule[] = [];
  for (const file of stylesheets()) {
    const text = strip(read(file));
    let start = 0;
    let prelude = "";
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (char === "{") {
        prelude = text.slice(start, i).trim();
        start = i + 1;
        if (!prelude.startsWith("@")) {
          const end = text.indexOf("}", i);
          const body = text.slice(i + 1, end);
          let depth = 0;
          let current = "";
          for (const ch of prelude) {
            if (ch === "(" || ch === "[") depth += 1;
            if (ch === ")" || ch === "]") depth -= 1;
            if (ch === "," && depth === 0) {
              found.push({ file, selector: current.trim().replace(/\s+/g, " "), body });
              current = "";
            } else current += ch;
          }
          found.push({ file, selector: current.trim().replace(/\s+/g, " "), body });
          i = end;
          start = end + 1;
        }
      } else if (char === "}" || char === ";") start = i + 1;
    }
  }
  return found;
}

const FOCUS = /:focus-visible|:focus(?![\w-])/;
const MEDIA_CARD =
  /\.(media-card|tv-title-card|tv-home-card|tv-episode-card|tv-search-result|folders-card|calendar-entry|calendar-chip|tv-music-album-card|end-screen-tile|tv-download-row)\b/;

/**
 * Focus rules that are not controls and stay as they are. Each entry says why. The list may only shrink.
 *  - nav rail and logo: owned by the navigation work (it keeps its label expansion);
 *  - the scrubber and the mini player draw their own ring-and-thumb marker inside the player;
 */
const NON_CONTROL_FOCUS = [
  /\.app-nav-link/,
  /\.app-logo/,
  /\.player-seek-track/,
  /\.mini-player-hit-target/,
  /\.tv-filter-launcher/,
  /\.tv-alphabet button\.is-active/,
  /\.app-user-identity-cluster/,
  /\.tv-download-row-copy/,
  /\.tv-discovery-item/,
  /\.player-video/,
];

describe("focus ring tokens", () => {
  it("defines the ring once, in page-layout.css: ink in light theme, white in dark theme, 3px at a 2px offset", () => {
    const layout = strip(read("styles/page-layout.css"));
    expect(layout).toMatch(/:root \{[^}]*--focus-ring-color: var\(--ink\);/);
    expect(layout).toMatch(/:root\[data-theme="dark"\] \{[^}]*--focus-ring-color: #ffffff;/);
    expect(layout).toMatch(/--page-focus-ring-width: 3px;/);
    expect(layout).toMatch(/--page-focus-ring-offset: 2px;/);
    expect(layout).toMatch(/--page-focus-ring: var\(--page-focus-ring-width\) solid var\(--focus-ring-color\);/);
  });

  it("has no second ring token or ring colour in global.css", () => {
    const global = strip(read("styles/global.css"));
    expect(global).not.toMatch(/--focus-ring-color:/);
    expect(global).not.toMatch(/--focus-outline/);
    expect(global).toMatch(/:focus-visible \{\s*outline: var\(--page-focus-ring\);\s*outline-offset: var\(--page-focus-ring-offset\);\s*\}/);
  });

  it("keeps the always-dark surfaces white in light theme by recomputing the token, not by a literal ring", () => {
    const layout = strip(read("styles/page-layout.css"));
    const scope = layout.match(/(\.player-page,[^{]*)\{([^}]*)\}/);
    expect(scope?.[1]).toContain(".end-screen");
    expect(scope?.[2]).toContain("--focus-ring-color: #ffffff;");
    expect(scope?.[2]).toContain("--page-focus-ring: var(--page-focus-ring-width) solid var(--focus-ring-color);");
  });

  it("never paints a literal outline on a focus rule (the ring is the token, or the card has none)", () => {
    const stray = rules()
      .filter((rule) => FOCUS.test(rule.selector))
      .filter((rule) => /(^|;|\s)outline(-color)?:\s*[^;]*(solid|#|rgb|currentColor)/.test(rule.body))
      .filter((rule) => !/outline:\s*var\(--page-focus-ring\)/.test(rule.body))
      .map((rule) => `${rule.file}: ${rule.selector}`);
    expect(stray).toEqual([]);
  });
});

describe("controls: ring only", () => {
  it("gives no control a fill, glow or scale on focus", () => {
    const offenders = rules()
      .filter((rule) => FOCUS.test(rule.selector))
      .filter((rule) => !MEDIA_CARD.test(rule.selector))
      .filter((rule) => !NON_CONTROL_FOCUS.some((pattern) => pattern.test(rule.selector)))
      .filter((rule) => /(^|[;\s])(background(-color)?|box-shadow|filter):/.test(rule.body) || /transform:[^;]*scale/.test(rule.body))
      // `:focus-within` and descendants of an unfocused wrapper are not control focus.
      .filter((rule) => !/:focus-within/.test(rule.selector))
      .map((rule) => `${rule.file}: ${rule.selector}`);
    expect(offenders).toEqual([]);
  });

  it("lets no base rule turn the ring off for a control by `outline: 0`", () => {
    const base = rules()
      .filter((rule) => !FOCUS.test(rule.selector) && !/:hover/.test(rule.selector))
      .filter((rule) => /(^|[;\s])outline:\s*(0|none)\b/.test(rule.body))
      .filter((rule) => !MEDIA_CARD.test(rule.selector))
      .filter((rule) => !NON_CONTROL_FOCUS.some((pattern) => pattern.test(rule.selector)))
      .map((rule) => `${rule.file}: ${rule.selector}`);
    // The search input hides its own outline because its pill carries the ring (see global.css).
    expect(base.filter((entry) => !entry.endsWith(".tv-search-form input"))).toEqual([]);
  });

  it("has no page stylesheet that overrides the ring for a whole page", () => {
    const stray = rules()
      .filter((rule) => rule.file.startsWith("pages/"))
      .filter((rule) => /^\.[\w-]+(-page|-view) (button|input|a)\b/.test(rule.selector) && FOCUS.test(rule.selector))
      .map((rule) => `${rule.file}: ${rule.selector}`);
    expect(stray).toEqual([]);
  });
});

describe("media cards: shadow, lift and glow ring, no outline", () => {
  const sources = (): { file: string; text: string }[] => {
    const out: { file: string; text: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(src, dir), { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push({ file: path, text: read(path) });
      }
    };
    walk("pages");
    walk("components");
    return out;
  };

  it("puts the shared `media-card` class on every focusable card", () => {
    const missing: string[] = [];
    const CARD_TOKENS =
      /\b(tv-title-card|tv-home-card|tv-episode-card|tv-search-result|folders-card|calendar-entry|calendar-chip|tv-music-album-card|end-screen-tile|tv-download-row)(?![\w-])/;
    for (const { file, text } of sources()) {
      if (/NavPerfHarness|WorkCard\.tsx/.test(file)) continue; // dev harness and dead component
      for (const [index, line] of text.split("\n").entries()) {
        if (!/className=/.test(line)) continue;
        if (/skeleton/i.test(line)) continue;
        const names = line.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/);
        const value = names?.[1] ?? names?.[2] ?? "";
        if (!CARD_TOKENS.test(value)) continue;
        // `tv-title-card-art`, `-copy`, `-stack-badge` and similar are parts, not cards (the lookahead drops them).
        if (!/\bmedia-card\b/.test(value)) missing.push(`${file}:${index + 1}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("gives `.media-card` no outline on focus and the shared lift from the tokens", () => {
    const layout = strip(read("styles/page-layout.css"));
    expect(layout).toMatch(/\.media-card:focus-visible,\s*\.media-card\[data-remote-active\] \{\s*outline: 0;/);
    expect(layout).toMatch(/:where\(\.media-card\):is\(:focus-visible, \[data-remote-active\]\) \{\s*transform: translateY\(var\(--card-lift\)\);/);
    expect(layout).toMatch(/:where\(\.media-card-solid\):is\(:focus-visible, \[data-remote-active\]\),\s*:where\(\.media-card-row\):focus-within \{\s*box-shadow: var\(--card-shadow-focus\);/);
  });

  it("pins the card-focus values (commit de371253, Q13)", () => {
    const layout = strip(read("styles/page-layout.css"));
    expect(layout).toContain("--card-lift: -7px;");
    expect(layout).toContain("--card-lift-duration: 260ms;");
    expect(layout).toContain("--card-lift-ease: cubic-bezier(0.2, 0.8, 0.2, 1);");
    expect(layout).toContain("--card-art-scale: 1.025;");
    expect(layout).toContain("--card-art-duration: 240ms;");
    expect(layout).toContain("--card-shadow-rest: 0 10px 20px rgba(56, 38, 33, 0.14), 0 3px 8px rgba(56, 38, 33, 0.1);");
    expect(layout).toContain("--card-shadow-focus: 0 24px 48px rgba(56, 38, 33, 0.3), 0 10px 20px rgba(56, 38, 33, 0.2), var(--card-glow);");
    // Owner 2026-10-09: a subtle red/pink glow ring on card focus (WCAG 2.4.13), brand-strong in light, brand-ink in dark.
    expect(layout).toContain("--card-glow-color: var(--brand-strong);");
    expect(layout).toContain("--card-glow-color: var(--brand-ink);");
    expect(layout).toMatch(/--card-glow: 0 0 0 3px var\(--card-glow-color\), 0 0 20px 4px/);
    const global = strip(read("styles/global.css")).replace(/\s+/g, " ");
    // Library grid, home and search variants.
    expect(global).toContain("transform: translateY(-5px) scale(1.015);");
    expect(global).toContain("transform: translateY(-6px);");
    expect(global).toContain("transform: translateY(-6px) scale(1.015);");
    expect(global).toContain("box-shadow: 0 26px 52px rgba(56, 38, 33, 0.32), 0 11px 22px rgba(56, 38, 33, 0.22);");
    expect(global).toContain("box-shadow: 0 22px 52px rgba(31, 14, 20, 0.28);");
  });

  it("never gives a media card a ring or a fill on focus", () => {
    const offenders = rules()
      .filter((rule) => FOCUS.test(rule.selector) || /\[data-remote-active\]/.test(rule.selector))
      .filter((rule) => MEDIA_CARD.test(rule.selector))
      .filter((rule) => /outline:\s*[^;]*(solid|var\(--page-focus-ring\))/.test(rule.body) || /(^|[;\s])background(-color)?:/.test(rule.body))
      // The calendar and folder cards are boxes with their own fill; the rule above is about focus rules only.
      .map((rule) => `${rule.file}: ${rule.selector}`);
    expect(offenders).toEqual([]);
  });

  it("lets a settled native focus lift its card: the remote-marker neutralisation needs a live marker", () => {
    const global = strip(read("styles/global.css"));
    for (const selector of [
      `body[data-input-mode="remote"][data-remote-marker] :is(.tv-title-card, .tv-search-result):not([data-remote-active])`,
      `body[data-input-mode="remote"][data-remote-marker] .tv-title-card:not([data-remote-active]) .tv-title-card-art`,
      `body[data-input-mode="remote"][data-remote-marker] .tv-home-card:not([data-remote-active]) .tv-home-card-art`,
    ]) {
      expect(global).toContain(selector);
    }
    expect(global).not.toMatch(/body\[data-input-mode="remote"\] :is\(\.tv-title-card, \.tv-search-result\):not\(\[data-remote-active\]\)/);
  });
});
