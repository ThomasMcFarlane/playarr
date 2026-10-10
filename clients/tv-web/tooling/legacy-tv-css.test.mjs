import assert from "node:assert/strict";
import test from "node:test";
import { addLegacyTvCssFallbacks, colorMixToChannels, legacyTvCssPlugin } from "./legacy-tv-css.mjs";

test("expands inset while preserving the modern shorthand", () => {
  const css = addLegacyTvCssFallbacks(".overlay { position: fixed; inset: 0 auto 2rem; }");
  assert.match(css, /top: 0/);
  assert.match(css, /right: auto/);
  assert.match(css, /bottom: 2rem/);
  assert.match(css, /left: auto/);
  assert.match(css, /inset: 0 auto 2rem/);
});

test("rewrites color-mix over tokens as rgba() of token channels and keeps color-mix behind @supports", () => {
  const css = addLegacyTvCssFallbacks(`
    :root { --surface: #1b181b; --line: rgba(223, 220, 221, 0.11); }
    .panel {
      background: linear-gradient(color-mix(in srgb, var(--surface) 72%, transparent), transparent);
      border-color: color-mix(in srgb, #cf3157 62%, var(--line));
    }
  `);
  assert.match(css, /--lc-surface-r: 27;/);
  assert.match(css, /--lc-line-a: 0\.11;/);
  assert.match(
    css,
    /background: linear-gradient\(rgba\(calc\(var\(--lc-surface-r\)\), calc\(var\(--lc-surface-g\)\), calc\(var\(--lc-surface-b\)\), calc\(var\(--lc-surface-a\) \* 0\.72\)\), transparent\)/
  );
  const legacyRule = css.slice(0, css.indexOf("@supports"));
  assert.ok(!legacyRule.includes("color-mix("));
  const modern = css.slice(css.indexOf("@supports (color: color-mix(in srgb, red 50%, blue))"));
  assert.match(modern, /\.panel \{/);
  assert.equal((modern.match(/color-mix\(in srgb, var\(--surface\) 72%, transparent\)/g) ?? []).length, 1);
  assert.equal((modern.match(/color-mix\(in srgb, #cf3157 62%, var\(--line\)\)/g) ?? []).length, 1);
});

test("colorMixToChannels matches the CSS Color 5 premultiplied srgb mix for literals", () => {
  // 50% opaque red with 50% transparent: red at half alpha (premultiplied, not darkened).
  assert.equal(colorMixToChannels("color-mix(in srgb, #ff0000 50%, transparent)"), "rgba(255, 0, 0, 0.5)");
  assert.equal(colorMixToChannels("color-mix(in srgb, #000 25%, white)"), "rgba(191.25, 191.25, 191.25, 1)");
  // Weights below 100% in total scale the alpha.
  assert.equal(colorMixToChannels("color-mix(in srgb, #000 20%, white 30%)"), "rgba(153, 153, 153, 0.5)");
  assert.equal(colorMixToChannels("color-mix(in oklab, red, blue)"), undefined);
});

test("derived tokens publish channels from their own definition", () => {
  const css = addLegacyTvCssFallbacks(`.rails { --frost: color-mix(in srgb, var(--a) 40%, var(--b)); --tone: var(--ink); }`);
  assert.match(css, /--lc-frost-a: calc\(\(var\(--lc-a-a\) \* 0\.4\) \+ \(var\(--lc-b-a\) \* 0\.6\)\)/);
  assert.match(css, /--lc-tone-r: calc\(var\(--lc-ink-r\)\)/);
});

test("color-mix in keyframes keeps the solid fallback", () => {
  const css = addLegacyTvCssFallbacks(`@keyframes glow { to { color: color-mix(in srgb, var(--brand) 50%, transparent); } }`);
  assert.match(css, /color: var\(--brand\);\s*color: color-mix/);
  assert.ok(!css.includes("@supports"));
});

test("Vite plugin transforms CSS only", () => {
  const plugin = legacyTvCssPlugin();
  assert.equal(plugin.transform("const inset = 0", "/src/app.ts"), null);
  const result = plugin.transform(".x { inset: 0; }", "/src/app.css?direct");
  assert.match(result.code, /top: 0/);
});
