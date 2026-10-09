import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Storybook coverage guard (row 9620). Every component file under `src/components` must be rendered by at least one
 * story, and every page under `src/pages` (settings sections included) must have a composition story at
 * `stories/pages/<Page>.stories.tsx`. A new component or page without a story fails here, so the Storybook stays
 * the complete place to check consistency (themes, layouts, states).
 *
 * `NOT_A_SURFACE` lists files that render nothing of their own. It may only shrink.
 */
const web = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NOT_A_SURFACE = new Set<string>([
  // Test harnesses that are mounted by end-to-end scripts only, never shipped to users.
  "pages/LayoutHarness.tsx",
  "pages/NavPerfHarness.tsx",
]);

function walk(dir: string, accept: (file: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full, accept);
    return accept(full) ? [full] : [];
  });
}

const isSource = (file: string) => file.endsWith(".tsx") && !/\.(test|stories)\.tsx$/.test(file);
const storyFiles = walk(join(web, "stories"), (file) => /\.stories\.tsx$/.test(file));
const corpus = [...storyFiles, join(web, "stories", "fixtures.tsx")]
  .filter(existsSync)
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

/** Exported, capitalised names: the components (and exported hooks-free helpers) a story can render. */
export function exportedComponents(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class)\s+([A-Z][A-Za-z0-9_]*)/g)) names.add(match[1]!);
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1]!.split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.replace(/^type\s+/, "").trim();
      if (name && /^[A-Z]/.test(name) && !part.trim().startsWith("type ")) names.add(name);
    }
  }
  return [...names];
}

describe("Storybook coverage", () => {
  const components = walk(join(web, "src", "components"), isSource).map((file) => relative(join(web, "src"), file));

  it("finds the component files", () => {
    expect(components.length).toBeGreaterThan(40);
  });

  it("has a story rendering every component file", () => {
    const missing = components
      .filter((file) => !NOT_A_SURFACE.has(file))
      .filter((file) => {
        const names = exportedComponents(readFileSync(join(web, "src", file), "utf8"));
        // A story that imports the module itself (a hook, or a namespace import) also counts.
        const module = file.replace(/\.tsx$/, "").replace(/^components\//, "");
        const imported = new RegExp(`from\\s+"[^"]*/components/${module}"`).test(corpus);
        return !imported && !names.some((name) => new RegExp(`\\b${name}\\b`).test(corpus));
      });
    expect(missing, `components without a story (add one under stories/): ${missing.join(", ")}`).toEqual([]);
  });

  const pages = walk(join(web, "src", "pages"), isSource).map((file) => relative(join(web, "src"), file));

  it("has a composition story for every page and settings section", () => {
    const missing = pages
      .filter((file) => !NOT_A_SURFACE.has(file))
      .filter((file) => {
        const rel = file.replace(/^pages\//, "").replace(/\.tsx$/, "");
        // The Library composition predates the pages folder and keeps its original file.
        const legacy = rel === "Library" ? existsSync(join(web, "stories", "Pages.stories.tsx")) : false;
        return !legacy && !existsSync(join(web, "stories", "pages", `${rel}.stories.tsx`));
      });
    expect(missing, `pages without stories/pages/<Page>.stories.tsx: ${missing.join(", ")}`).toEqual([]);
  });
});
