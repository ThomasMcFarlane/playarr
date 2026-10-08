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

const DRAWER = "components/shell/Drawer.tsx";

describe("drawer audit", () => {
  it("keeps tv-filter-drawer markup inside the shared Drawer", () => {
    const offenders = sources().filter(
      (file) => file !== DRAWER && /className=[^>]*tv-filter-drawer/.test(readFileSync(join(src, file), "utf8"))
    );
    expect(offenders, "render pop-outs with <Drawer> from components/shell").toEqual([]);
  });

  it("permits no hand-written dialog <aside> panels outside the shared Drawer", () => {
    const offenders = sources().filter((file) => {
      if (file === DRAWER) return false;
      const text = readFileSync(join(src, file), "utf8");
      return /<aside/.test(text) && /role="dialog"/.test(text);
    });
    expect(offenders, "use <Drawer> instead of a hand-written <aside role=dialog>").toEqual([]);
  });

  it("gives every Drawer the shared icon-button close", () => {
    const text = readFileSync(join(src, DRAWER), "utf8");
    expect(text).toMatch(/<Button[^>]*variant="icon"[^>]*drawer-close/s);
    expect(text).toMatch(/isBackKey/);
    expect(text).toMatch(/Tab/);
  });

  it("drives page drawers from the URL panel state", () => {
    for (const file of ["pages/Library.tsx", "pages/Playlists.tsx"]) {
      expect(readFileSync(join(src, file), "utf8"), `${file} must use usePanelParam`).toMatch(/usePanelParam/);
    }
    expect(readFileSync(join(src, "pages/Calendar.tsx"), "utf8")).toMatch(/panel/);
  });
});
