/**
 * Locks `colour`'s harvested values against the actual CSS they were read
 * from, the same technique
 * clients/tv-web/web/src/components/tv/TvStage.test.tsx uses for its own
 * CSS-derived assertions (design doc §4.7/build-order step 4): read the
 * real file at test time and regex out the declarations, rather than
 * trusting that a value copied into this file by hand still matches the
 * CSS a future edit might have moved on without it. That test uses
 * `import.meta.url` (it runs under Vitest/ESM); this one uses `__dirname`
 * instead, because Jest here runs each file through Babel's CommonJS
 * transform, where `import.meta` is not available.
 *
 * Only the values sourced from global.css's `:root[data-theme="dark"]`
 * block and the `.tv-provider`/`.tv-detail-kicker` rule are checked here.
 * `colour.focusRing`/`colour.navAccent` are deliberately NOT --
 * `tokens.ts`'s own comment explains why they come from
 * `@playarr-tv/design-tokens` instead, and asserting they equal the very
 * same import this file re-exports them from would only be testing that
 * `=` works.
 */
import {readFileSync} from 'node:fs';
import * as path from 'node:path';
import {colour} from './tokens';

const GLOBAL_CSS_PATH = path.resolve(__dirname, '../../../tv-web/web/src/styles/global.css');

function readGlobalCss(): string {
  return readFileSync(GLOBAL_CSS_PATH, 'utf8');
}

function extractDarkThemeDeclarations(css: string): string {
  const match = css.match(/:root\[data-theme="dark"\]\s*\{(?<declarations>[^}]*)\}/);
  const declarations = match?.groups?.declarations;
  if (!declarations) {
    throw new Error(
      'Could not find :root[data-theme="dark"] { … } in global.css -- has the selector changed?'
    );
  }
  return declarations;
}

function customProperty(declarations: string, name: string): string {
  const propertyMatch = declarations.match(new RegExp(`--${name}:\\s*([^;]+);`));
  const value = propertyMatch?.[1];
  if (!value) {
    throw new Error(`global.css's dark theme block has no --${name} declaration.`);
  }
  return value.trim();
}

describe('theme/tokens colour', () => {
  const declarations = extractDarkThemeDeclarations(readGlobalCss());

  const cssPropertyByColourKey: Record<
    Exclude<keyof typeof colour, 'focusRing' | 'navAccent' | 'stageKicker'>,
    string
  > = {
    bg: 'bg',
    surface: 'surface',
    surfaceStrong: 'surface-strong',
    surfaceSoft: 'surface-soft',
    ink: 'ink',
    inkSoft: 'ink-soft',
    inkMuted: 'ink-muted',
    line: 'line',
    lineStrong: 'line-strong',
    accent: 'accent',
    accentSoft: 'accent-soft',
    onAccent: 'on-accent',
    danger: 'danger',
    dangerSoft: 'danger-soft',
    success: 'success',
    focusOutline: 'focus-outline',
  };

  it.each(Object.entries(cssPropertyByColourKey))(
    'colour.%s matches global.css\'s --%s',
    (colourKey, cssPropertyName) => {
      const expected = customProperty(declarations, cssPropertyName);
      expect(colour[colourKey as keyof typeof cssPropertyByColourKey]).toBe(expected);
    }
  );

  it("colour.stageKicker matches .tv-provider/.tv-detail-kicker's shared colour declaration", () => {
    const css = readGlobalCss();
    const ruleMatch = css.match(
      /\.tv-provider,\s*\.tv-detail-kicker\s*\{(?<declarations>[^}]*)\}/
    );
    const ruleDeclarations = ruleMatch?.groups?.declarations;
    if (!ruleDeclarations) {
      throw new Error('Could not find the .tv-provider, .tv-detail-kicker rule in global.css.');
    }
    const colorMatch = ruleDeclarations.match(/color:\s*([^;]+);/);
    expect(colorMatch?.[1]?.trim()).toBe(colour.stageKicker);
  });

  it.each(Object.entries(colour))('colour.%s is not a leftover placeholder value', (_key, value) => {
    // Jest's expect() has no Jasmine/Chai-style second "message" argument --
    // the per-key test name from it.each above is what makes a failure here
    // identify which colour it was, not a custom assertion message.
    expect(value).not.toMatch(/^#(\.\.\.|000000|fff(?:fff)?)$/i);
  });
});
