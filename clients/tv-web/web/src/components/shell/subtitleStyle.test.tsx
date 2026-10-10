import { readFileSync, readdirSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./PageHeader";

// Owner rule 2026-10-10: subtitles are only ever the small media-page subtitle, one shared variant.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const global = read("../../styles/global.css");
const layout = read("../../styles/page-layout.css");
const back = { label: "Back", to: "/" };
const html = (node: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)${escaped}(?:,[^{]*)?\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
}

describe("one small subtitle style", () => {
  it("renders every header subtitle, in every variant, with the shared class and nothing else", () => {
    for (const variant of ["page", "detail"] as const) {
      const markup = html(<PageHeader title="Title" detail="Subtitle" variant={variant} back={back} />);
      expect(markup).toContain('<span class="page-header-detail page-subtitle">Subtitle</span>');
      expect(markup).not.toMatch(/<(strong|small)\b/);
      expect(markup).not.toContain("is-section");
      expect(markup).not.toContain("tv-detail-heading-item");
    }
  });

  it("puts the subtitle in one place on every page: under the title, never beside it", () => {
    const markup = html(<PageHeader title="Preferences" detail="Appearance" back={back} />);
    expect(markup).toContain("has-subtitle");
    expect(markup).not.toContain("is-detail-wrapped");
    expect(html(<PageHeader title="Movies" back={back} />)).not.toContain("has-subtitle");
    const block = rule(layout, ".tv-library-heading.has-subtitle > .page-header-title-block");
    expect(block).toContain("flex-direction: column");
    expect(rule(layout, ".tv-library-heading.has-subtitle")).toContain("align-items: flex-start");
    expect(layout).not.toContain("is-detail-wrapped");
  });

  it("shares the media-page kicker declarations: one rule serves .page-subtitle, .tv-provider and .tv-detail-kicker", () => {
    const shared = /(?:^|\n)\.page-subtitle,\s*\.tv-provider,\s*\.tv-detail-kicker\s*\{([^}]*)\}/.exec(global)?.[1] ?? "";
    expect(shared).toContain("color: var(--brand-ink)");
    expect(shared).toMatch(/font-size:\s*clamp\(0\.58rem/);
    expect(shared).toContain("font-weight: 820");
    expect(shared).toContain("letter-spacing: 0.08em");
    expect(shared).toContain("text-transform: uppercase");
    expect(shared).toContain("margin-bottom");
  });

  it("keeps any other subtitle size or style out of the header and page stylesheets", () => {
    const typographic = /(?:^|[;{\s])(font-size|font-weight|font-style|letter-spacing|color|text-transform|line-height)\s*:/;
    const dir = new URL("../../pages/", import.meta.url);
    const sheets = [layout, ...readdirSync(dir).filter((n) => n.endsWith(".css")).map((n) => read(`../../pages/${n}`))];
    for (const css of sheets) {
      for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const selector = match[1]!;
        if (/page-header-detail|page-subtitle|tv-detail-heading-item|is-section/.test(selector)) {
          expect(match[2], `${selector.trim()} must not set typography`).not.toMatch(typographic);
        }
      }
    }
    expect(rule(layout, ".tv-library-heading > .page-header-title-block > .page-header-detail")).toContain("margin-bottom: 0");
  });

  it("never lets a page build its own header subtitle", () => {
    const pages = new URL("../../pages/", import.meta.url);
    const walk = (dir: URL): URL[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(new URL(`${e.name}/`, dir)) : /\.tsx$/.test(e.name) && !/\.test\./.test(e.name) ? [new URL(e.name, dir)] : [],
      );
    for (const file of walk(pages)) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file.pathname} must not render .page-header-detail itself`).not.toMatch(/page-header-detail|tv-detail-heading-item/);
      expect(source, `${file.pathname} passes a section object as the subtitle`).not.toMatch(/detail:\s*\{\s*title:/);
    }
  });
});
