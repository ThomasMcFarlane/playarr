import { readFileSync, readdirSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./PageHeader";

const noop = () => undefined;
const filters = (label: string) => ({ kind: "filters" as const, label, open: false, onToggle: noop, controls: "x-filters" });
const back = { label: "Back", to: "/" };
const subscription = { kind: "panel" as const, id: "subscription", label: "Calendar subscription", icon: "bell" as const, open: false, onToggle: noop, controls: "sub" };

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

function filterButton(markup: string): string {
  const match = /<button[^>]*data-filters-button[^>]*>/.exec(markup);
  expect(match, "Filters button rendered").not.toBeNull();
  // Strip per-page ids so only component identity and style classes are compared.
  return match![0].replace(/aria-controls="[^"]*"/, "");
}

describe("PageHeader filters slot", () => {
  it("renders the identical Filters button for Movies-style and Calendar-style headers", () => {
    const movies = render(<PageHeader title="Movies" back={back} actions={[filters("Filters")]} />);
    const calendar = render(
      <PageHeader title="Release Calendar" back={back} actions={[subscription, filters("Filters")]} />
    );
    expect(filterButton(calendar)).toBe(filterButton(movies));
    expect(movies).toContain("btn btn-secondary ui-btn ui-btn--secondary ui-btn--md action-pill");
  });

  it("puts panel buttons in the same style directly before Filters (Playlists pattern)", () => {
    const markup = render(
      <PageHeader title="Release Calendar" back={back} actions={[subscription, filters("Filters")]} />
    );
    const panel = markup.indexOf("data-panel-button");
    const filter = markup.indexOf("data-filters-button");
    expect(panel).toBeGreaterThan(-1);
    expect(panel).toBeLessThan(filter);
    const classes = (attr: string) => new RegExp(`<button[^>]*class="([^"]*)"[^>]*${attr}`).exec(markup)?.[1];
    expect(classes("data-panel-button")).toBe(classes("data-filters-button"));
    expect(markup).toContain('class="page-header-stack"');
  });

  it("styles every header button through the one .action-pill rule in page-layout.css, with no per-page override", () => {
    const read = (path: string) =>
      readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const layout = read("../../styles/page-layout.css");
    expect(layout).toMatch(/\.ui-btn\.action-pill\s*\{/);
    for (const other of ["../../styles/global.css", "../../pages/Calendar.css", "../../pages/Folders.css"]) {
      expect(read(other), `${other} must not style the shared header buttons`).not.toMatch(/action-pill|page-filters-button/);
    }
    for (const page of ["Calendar.css", "Calendar.tsx"]) {
      const source = readFileSync(new URL(`../../pages/${page}`, import.meta.url), "utf8");
      expect(source, `${page} must not restyle the shared header buttons`).not.toMatch(/page-filters-button|action-pill/);
    }
  });

  it("renders the side-panel buttons outside the header row (the shell action column owns them)", () => {
    const markup = render(<PageHeader title="Movies" back={back} actions={[filters("Filters")]} />);
    const header = /<header[\s\S]*?<\/header>/.exec(markup)?.[0] ?? "";
    expect(header).not.toContain("data-filters-button");
    expect(markup).toContain("data-filters-button");
  });

  it("keeps side-panel and action buttons out of pages: only the shell column places them", () => {
    const pagesDir = new URL("../../pages/", import.meta.url);
    const css = readFileSync(new URL("../../styles/page-layout.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const column = /\.shell-action-column \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(column).toContain("position: absolute");
    expect(column).toContain("var(--directory-controls-edge)");
    expect(column).toContain("var(--shell-action-column-top)");
    const walk = (dir: URL): URL[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(new URL(`${e.name}/`, dir)) : /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [new URL(e.name, dir)] : [],
      );
    for (const file of walk(pagesDir)) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file.pathname} renders a side-panel button itself`).not.toMatch(/<(FiltersButton|PanelButton)\b|page-filters-button|tv-filter-launcher/);
    }
  });
});
