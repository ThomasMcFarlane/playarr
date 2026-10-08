import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Loading is a skeleton, everywhere (owner ruling, 8 October 2026; docs/design/page-layout.md): no centred or full-page
 * loading screen, no "Preparing ..." interstitial. Pages load with the shared skeleton set inside the normal frame (header
 * and Back visible), built from the Calendar's shimmer block. The player stage keeps the black stage and the standard
 * spinner (its own rule), and small widget spinners (a drawer fetching options, the library's "loading more") are not
 * page loading.
 */
const here = new URL("./", import.meta.url);
const walk = (dir: URL): URL[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(new URL(`${entry.name}/`, dir)) : /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [new URL(entry.name, dir)] : []
  );
const sources = [...walk(new URL("../pages/", here)), ...walk(new URL("../components/", here))].map((file) => ({
  path: file.pathname.split("/src/")[1]!,
  text: readFileSync(file, "utf8"),
}));

/** Widget-level spinners that are not page loading, with the count each file may keep. */
const MINI_LOADER_ALLOWED: Record<string, number> = {
  "pages/Library.tsx": 2, // "updating the library" badge and "loading more titles" at the end of the grid
  "components/MediaContextMenu.tsx": 2,
  "components/DownloadQualityDrawer.tsx": 1,
  "pages/WorkDetail.tsx": 1, // the playback options drawer
};

describe("skeleton loading", () => {
  it("has no full-page or centred loading component", () => {
    const offenders = sources.filter((s) => /\bLoadingState\b|tv-orbit-loader|loading-state/.test(s.text)).map((s) => s.path);
    expect(offenders, "use the shared skeletons (components/shell/Skeletons.tsx)").toEqual([]);
  });

  it("every page loading state names its skeleton", () => {
    const offenders = sources
      .filter((s) => /kind:\s*"loading"/.test(s.text) && !s.path.startsWith("components/player"))
      .filter((s) => [...s.text.matchAll(/kind:\s*"loading"([^}]*)\}/g)].some((m) => !/skeleton:/.test(m[1]!)))
      .map((s) => s.path);
    expect(offenders).toEqual([]);
  });

  it("keeps small spinners to widgets, never a page", () => {
    const over = sources
      .map((s) => ({ path: s.path, count: (s.text.match(/tv-mini-loader/g) ?? []).length }))
      .filter((s) => s.count > (MINI_LOADER_ALLOWED[s.path] ?? 0));
    expect(over, "pages load with skeletons; add a widget to MINI_LOADER_ALLOWED only for a spinner inside a drawer or menu").toEqual([]);
  });

  it("has no \"Preparing\" page loading text", () => {
    const en = readFileSync(new URL("./i18n/translations/en.ts", here), "utf8");
    const offenders = [...en.matchAll(/"(pages\.[a-zA-Z.]*(?:preparing|loading)[A-Za-z]*)":\s*"([^"]*)"/g)].filter((m) => /^preparing/i.test(m[2]!));
    expect(offenders.map((m) => m[1])).toEqual([]);
  });

  it("ships the shared skeleton set, built on the Calendar's shimmer block", () => {
    const skeletons = readFileSync(new URL("../components/shell/Skeletons.tsx", here), "utf8");
    for (const name of ["SkeletonGrid", "SkeletonRails", "SkeletonDetail", "SkeletonRows", "SkeletonSettings", "SkeletonState"]) {
      expect(skeletons).toContain(`export function ${name}`);
    }
    expect(skeletons).toContain('from "./Skeleton"');
    const layout = readFileSync(new URL("../components/shell/PageLayout.tsx", here), "utf8");
    expect(layout).toMatch(/kind: "loading"; skeleton: SkeletonKind/);
  });
});
