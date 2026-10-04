import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir = src): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [relative(src, path)] : [];
  });
}

/**
 * Bespoke side panels that predate the shared Drawer (dark player overlay panel
 * and the context action sheets). This list may only shrink; new pop-outs use
 * `Drawer` from `components/shell` (title + round icon close, body, footer
 * actions, focus trap, Esc/Back, `?panel=` URL state).
 */
const LEGACY_PANELS = new Set([
  "components/MediaContextMenu.tsx",
  "components/PlaylistContextMenu.tsx",
  "components/player/PlaybackHealthPanel.tsx",
]);

const DRAWER = "components/shell/Drawer.tsx";

describe("drawer audit", () => {
  it("keeps tv-filter-drawer markup inside the shared Drawer", () => {
    const offenders = sources().filter(
      (file) => file !== DRAWER && /className=[^>]*tv-filter-drawer/.test(readFileSync(join(src, file), "utf8"))
    );
    expect(offenders, "render pop-outs with <Drawer> from components/shell").toEqual([]);
  });

  it("allows hand-written dialog <aside> panels only in the shrinking legacy list", () => {
    const hasPanel = (file: string) => {
      const text = readFileSync(join(src, file), "utf8");
      return /<aside/.test(text) && /role="dialog"/.test(text);
    };
    const offenders = sources().filter((file) => file !== DRAWER && hasPanel(file) && !LEGACY_PANELS.has(file));
    expect(offenders, "use <Drawer> instead of a hand-written <aside role=dialog>").toEqual([]);
    const stale = [...LEGACY_PANELS].filter((file) => !hasPanel(file));
    expect(stale, "remove migrated files from LEGACY_PANELS").toEqual([]);
  });

  it("gives every Drawer the shared icon-button close", () => {
    const text = readFileSync(join(src, DRAWER), "utf8");
    expect(text).toMatch(/<Button[^>]*variant="icon"[^>]*drawer-close/s);
    expect(text).toMatch(/Escape/);
    expect(text).toMatch(/Tab/);
  });

  it("drives page drawers from the URL panel state", () => {
    for (const file of ["pages/Library.tsx", "pages/Playlists.tsx"]) {
      expect(readFileSync(join(src, file), "utf8"), `${file} must use usePanelParam`).toMatch(/usePanelParam/);
    }
    expect(readFileSync(join(src, "pages/Calendar.tsx"), "utf8")).toMatch(/panel/);
  });
});
