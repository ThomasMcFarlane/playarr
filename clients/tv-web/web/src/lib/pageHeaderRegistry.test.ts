import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PAGE_HEADER_COVERAGE } from "./pageHeaderRegistry";
import { COMPLETE_CLIENT_SHELL_ROUTES } from "./productSurfaces";

const here = dirname(fileURLToPath(import.meta.url));
const pagesDir = join(here, "../pages");

function pageFiles(dir = pagesDir, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return pageFiles(join(dir, entry.name), `${prefix}${entry.name}/`);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [`${prefix}${entry.name}`] : [];
  });
}

describe("shared page header coverage", () => {
  it("registers every page file", () => {
    const registered = new Set(PAGE_HEADER_COVERAGE.map((page) => page.file));
    // Settings sections render inside settings/Index (which owns the header).
    const sectionPages = pageFiles().filter(
      (file) => file.startsWith("settings/") && file !== "settings/Index.tsx"
    );
    const unregistered = pageFiles().filter((file) => !registered.has(file) && !sectionPages.includes(file));
    expect(unregistered, "add new pages to pageHeaderRegistry.ts").toEqual([]);
  });

  it("renders every header page through the shared PageHeader", () => {
    for (const page of PAGE_HEADER_COVERAGE.filter((entry) => entry.mode === "header")) {
      const source = readFileSync(join(pagesDir, page.file), "utf8");
      const usesShell = /<(PageHeader|PageShell|TvDetailHeading)\b/.test(source);
      expect(usesShell, `${page.file} must render <PageShell>, <PageHeader> or <TvDetailHeading>`).toBe(true);
      expect(source, `${page.file} must not hand-roll the heading`).not.toMatch(/className=["'`]tv-library-heading/);
      expect(source, `${page.file} must not hand-roll a back button`).not.toMatch(/className=["'`]tv-page-back/);
    }
  });

  it("gives every shelled route an owner, and exempt pages a reason", () => {
    const owned = new Set(PAGE_HEADER_COVERAGE.flatMap((page) => page.routes));
    const settingsOwned = (id: string) => id.startsWith("settings-");
    const orphaned = COMPLETE_CLIENT_SHELL_ROUTES.filter(
      (route) => !owned.has(route.id) && !settingsOwned(route.id)
    ).map((route) => route.id);
    expect(orphaned).toEqual([]);
    for (const page of PAGE_HEADER_COVERAGE) {
      if (page.mode === "exempt") expect(page.reason.length).toBeGreaterThan(10);
    }
  });

  it("renders Filters only through the header's shared filters slot", () => {
    for (const file of ["Library.tsx", "Playlists.tsx", "Calendar.tsx"]) {
      const source = readFileSync(join(pagesDir, file), "utf8");
      expect(source, `${file} must pass filters={{...}} to the page header`).toMatch(/\bfilters=\{/);
      expect(source, `${file} must not render FiltersButton/PanelButton itself`).not.toMatch(/<(FiltersButton|PanelButton)\b/);
      expect(source, `${file} must not hand-roll page-filters-button`).not.toMatch(/page-filters-button/);
    }
  });

  it("keeps Filters on the right of the header through the shared FiltersButton", () => {
    for (const file of ["Library.tsx", "Playlists.tsx", "Calendar.tsx"]) {
      const source = readFileSync(join(pagesDir, file), "utf8");
      expect(source, `${file} must open filters via FiltersDrawer`).toMatch(/<FiltersDrawer\b/);
      expect(source, `${file} must not use the retired floating launcher`).not.toMatch(/tv-filter-launcher/);
    }
  });
});
