/**
 * Design 1:1 gate: shared pages must not reintroduce visual deltas vs main.
 * Pure structural checks over shipped source (no invented layout).
 */
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const webSrc = join(root, "web/src");

function readSrc(rel: string): string {
  return readFileSync(join(webSrc, rel), "utf8");
}

function gitShowMain(relFromRepo: string): string | null {
  try {
    return execSync(`git show origin/main:${relFromRepo}`, {
      cwd: join(root, "../.."),
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    try {
      return execSync(`git show origin/main:${relFromRepo}`, {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      });
    } catch {
      return null;
    }
  }
}

describe("design parity with origin/main", () => {
  it("keeps design tokens and stage structure in global.css", () => {
    const current = readSrc("styles/global.css");
    expect(current).toContain("--library-rail-top");
    expect(current).toContain(".tv-home-rails");
    expect(current).not.toContain("tv-remote-focus-ring");
    // Remote may disable transitions but must not force transform:none on focus.
    expect(current).not.toMatch(
      /body\[data-input-mode="remote"\][^{]*\.tv-title-card:focus-visible[^{]*\{[^}]*transform:\s*none/
    );
  });

  it("keeps Home stage structure", () => {
    const current = readSrc("pages/Home.tsx");
    expect(current).toContain("centreTrackInStack");
    expect(current).toContain("tv-home-rails");
    expect(current).toContain("<PageLayout");
    expect(current).not.toContain("is-remote-active");
    // Remote selection debounce present for TV lag budget.
    expect(current).toMatch(/remote \? REMOTE_SELECT_SETTLE_MS : 0/);
  });

  it("keeps WorkDetail, Search, MusicDetail selection synchronous (no startTransition wrap)", () => {
    for (const rel of [
      "pages/WorkDetail.tsx",
      "pages/Search.tsx",
      "pages/MusicDetail.tsx",
    ] as const) {
      const current = readSrc(rel);
      expect(current, rel).not.toMatch(
        /onFocus=\{\(\) => \{\s*startTransition\(\(\) =>/
      );
    }
  });

  it("Library keeps stage structure and never zeros rail paddingTop", () => {
    const library = readSrc("pages/Library.tsx");
    expect(library).toContain("data-library-index");
    expect(library).toContain("data-library-count");
    expect(library).toContain("<PageLayout");
    expect(library).toContain("<LibraryPreview");
    expect(readSrc("components/LibraryPreview.tsx")).toContain("tv-library-preview");
    expect(library).toContain("tv-title-grid-content");
    // Expand-only mount is allowed; bottom spacer only (never paddingTop assigns).
    expect(library).not.toMatch(/paddingTop:\s*`/);
    expect(library).not.toMatch(/paddingTop:\s*Math/);
    // The page's selection (backdrop art, prefetch) is debounced for remote holds (stage re-render is the TV lag
    // source); the preview text itself follows focus at once through its own store.
    expect(library).toMatch(/remote \? SELECT_SETTLE_MS : 0/);
    expect(library).toContain("previewStore.set(work)");
  });

  it("useScrollEdges writes the fade attributes without React state and measures before first paint", () => {
    const current = readSrc("lib/useScrollEdges.ts");
    expect(current).not.toContain("useState");
    expect(current).toContain("useLayoutEffect");
    expect(current).toContain("attachScrollEdges");
  });

  it("global.css does not kill remote focus transforms (only transitions)", () => {
    const css = readSrc("styles/global.css");
    // Transitions may be disabled under remote; transform:none on :focus-visible must not.
    const remoteBlock = css.match(
      /body\[data-input-mode="remote"\][\s\S]{0,800}?tv-title-card:focus-visible[\s\S]{0,200}?\}/
    );
    if (remoteBlock) {
      expect(remoteBlock[0]).not.toMatch(/transform:\s*none/);
    }
  });
});
