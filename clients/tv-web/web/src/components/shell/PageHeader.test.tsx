import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./PageHeader";

const noop = () => undefined;
const filters = (label: string) => ({ label, open: false, onToggle: noop, controls: "x-filters" });

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
    const movies = render(<PageHeader title="Movies" backLabel="Back" filters={filters("Filters")} />);
    const calendar = render(
      <PageHeader
        title="Release Calendar"
        backLabel="Back"
        filters={filters("Filters")}
        panelButtons={[{ id: "subscription", label: "Calendar subscription", icon: null, open: false, onToggle: noop, controls: "sub" }]}
      />
    );
    expect(filterButton(calendar)).toBe(filterButton(movies));
    expect(movies).toContain("btn btn-secondary ui-btn ui-btn--secondary ui-btn--md page-filters-button");
  });

  it("puts panel buttons in the same style directly before Filters (Playlists pattern)", () => {
    const markup = render(
      <PageHeader
        title="Release Calendar"
        backLabel="Back"
        filters={filters("Filters")}
        panelButtons={[{ id: "subscription", label: "Calendar subscription", icon: null, open: false, onToggle: noop, controls: "sub" }]}
      />
    );
    const panel = markup.indexOf("data-panel-button");
    const filter = markup.indexOf("data-filters-button");
    expect(panel).toBeGreaterThan(-1);
    expect(panel).toBeLessThan(filter);
    const classes = (attr: string) => new RegExp(`<button[^>]*class="([^"]*)"[^>]*${attr}`).exec(markup)?.[1];
    expect(classes("data-panel-button")).toBe(classes("data-filters-button"));
    expect(markup).toContain('class="page-header-stack"');
  });

  it("styles every header button through the one .page-filters-button rule, with no per-page override", () => {
    const css = readFileSync(
      new URL("../../styles/global.css", import.meta.url),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [
      ...css.matchAll(/([^{}]*page-filters-button[^{}]*)\{/g),
    ].map((m) => m[1]!.trim());
    // Only the shared rule, its svg/state/count variants and the phone icon-only media rule may name it.
    const allowed =
      /^(\.(ui-btn|ui-btn--secondary)\.page-filters-button(:hover:not\(:disabled\)|:focus-visible|\.is-active|\s+svg|\s+span)?|\.page-filters-button\s+span|\.page-filters-count),?\s*$/;
    const stray = selectors
      .flatMap((sel) => sel.split(","))
      .map((sel) => sel.trim().replace(/\s+/g, " "))
      .filter((sel) => sel && !allowed.test(sel));
    expect(stray).toEqual([]);
    for (const page of ["Calendar.css", "Calendar.tsx"]) {
      const source = readFileSync(
        new URL(`../../pages/${page}`, import.meta.url),
        "utf8",
      );
      expect(
        source,
        `${page} must not restyle the shared header buttons`,
      ).not.toMatch(/page-filters-button/);
    }
  });
});
