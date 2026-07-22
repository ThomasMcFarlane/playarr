import assert from "node:assert/strict";
import test from "node:test";
import { addLegacyTvCssFallbacks, legacyTvCssPlugin } from "./legacy-tv-css.mjs";

test("expands inset while preserving the modern shorthand", () => {
  const css = addLegacyTvCssFallbacks(".overlay { position: fixed; inset: 0 auto 2rem; }");
  assert.match(css, /top: 0/);
  assert.match(css, /right: auto/);
  assert.match(css, /bottom: 2rem/);
  assert.match(css, /left: auto/);
  assert.match(css, /inset: 0 auto 2rem/);
});

test("adds theme-aware fallbacks before color-mix declarations", () => {
  const css = addLegacyTvCssFallbacks(`
    .panel {
      background: linear-gradient(color-mix(in srgb, var(--surface) 72%, transparent), transparent);
      border-color: color-mix(in srgb, #cf3157 62%, var(--line));
    }
  `);
  assert.match(css, /background: linear-gradient\(var\(--surface\), transparent\)/);
  assert.match(css, /border-color: #cf3157/);
  assert.equal((css.match(/color-mix\(/g) ?? []).length, 2);
  assert.ok(css.indexOf("linear-gradient(var(--surface)") < css.indexOf("color-mix("));
});

test("Vite plugin transforms CSS only", () => {
  const plugin = legacyTvCssPlugin();
  assert.equal(plugin.transform("const inset = 0", "/src/app.ts"), null);
  const result = plugin.transform(".x { inset: 0; }", "/src/app.css?direct");
  assert.match(result.code, /top: 0/);
});
