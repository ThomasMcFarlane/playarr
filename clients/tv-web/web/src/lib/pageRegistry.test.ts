import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_UNMIGRATED, PAGE_REGISTRY } from "./pageRegistry";
import { COMPLETE_CLIENT_SHELL_ROUTES } from "./productSurfaces";

const here = dirname(fileURLToPath(import.meta.url));
const pagesDir = join(here, "../pages");

function pageFiles(dir = pagesDir, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return pageFiles(join(dir, entry.name), `${prefix}${entry.name}/`);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [`${prefix}${entry.name}`] : [];
  });
}

const source = (file: string) => readFileSync(join(pagesDir, file), "utf8");
const usesLegacyFrame = (text: string) => /<PageHeader\b/.test(text);

describe("page registry", () => {
  it("registers every page file", () => {
    const registered = new Set(PAGE_REGISTRY.map((page) => page.file));
    // Settings sections render inside settings/Index (which owns the header).
    const sectionPages = pageFiles().filter((file) => file.startsWith("settings/") && file !== "settings/Index.tsx");
    const unregistered = pageFiles().filter((file) => !registered.has(file) && !sectionPages.includes(file));
    expect(unregistered, "add new pages to pageRegistry.ts (layout, or exempt with evidence)").toEqual([]);
  });

  it("renders every layout page through <PageLayout> with its own pageId, and nothing legacy", () => {
    for (const page of PAGE_REGISTRY.filter((entry) => entry.mode === "layout")) {
      const text = source(page.file);
      expect(text, `${page.file} must render <PageLayout pageId="${page.pageId}">`).toMatch(
        new RegExp(`<PageLayout[^>]*pageId=["{]+${page.pageId}`, "s")
      );
      expect(usesLegacyFrame(text), `${page.file} still renders a legacy frame or header`).toBe(false);
      expect(text, `${page.file} must not hand-roll the heading`).not.toMatch(/className=["'`]tv-library-heading/);
      expect(text, `${page.file} must not hand-roll a back button`).not.toMatch(/className=["'`]tv-page-back/);
    }
  });

  it("ratchets the unmigrated list: it only shrinks, and a listed page may not already use PageLayout", () => {
    const unmigrated = PAGE_REGISTRY.filter((entry) => entry.mode === "unmigrated");
    expect(unmigrated.length, "the unmigrated list may only shrink; lower MAX_UNMIGRATED").toBeLessThanOrEqual(MAX_UNMIGRATED);
    expect(unmigrated.length, "a page migrated: lower MAX_UNMIGRATED to the new length").toBe(MAX_UNMIGRATED);
    for (const page of unmigrated) {
      const text = source(page.file);
      expect(text, `${page.file} already renders <PageLayout>: move it to mode "layout" in pageRegistry.ts`).not.toMatch(/<PageLayout\b/);
      expect(usesLegacyFrame(text), `${page.file} is listed as unmigrated but renders no legacy frame: it is exempt or migrated`).toBe(true);
    }
  });

  it("gives every shelled route an owner, and checks each exempt reason against the source", () => {
    const owned = new Set(PAGE_REGISTRY.flatMap((page) => page.routes));
    const settingsOwned = (id: string) => id.startsWith("settings-");
    const orphaned = COMPLETE_CLIENT_SHELL_ROUTES.filter((route) => !owned.has(route.id) && !settingsOwned(route.id)).map((route) => route.id);
    expect(orphaned).toEqual([]);
    for (const page of PAGE_REGISTRY) {
      if (page.mode !== "exempt") continue;
      expect(page.reason.length).toBeGreaterThan(10);
      expect(source(page.file), `${page.file} is exempt ("${page.reason}") but its source no longer contains ${page.evidence}`).toContain(page.evidence);
    }
  });

  it("renders Filters only through the header's actions", () => {
    for (const file of ["Library.tsx", "Playlists.tsx", "Calendar.tsx"]) {
      const text = source(file);
      expect(text, `${file} must pass filters to the page header`).toMatch(/\bfilters[:=]\s*\{|\bkind: "filters"/);
      expect(text, `${file} must not render FiltersButton/PanelButton itself`).not.toMatch(/<(FiltersButton|PanelButton|ActionPill)\b/);
      expect(text, `${file} must open filters via FiltersDrawer`).toMatch(/<FiltersDrawer\b/);
      expect(text, `${file} must not use the retired floating launcher`).not.toMatch(/tv-filter-launcher/);
    }
  });
});
