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

/** The legacy `btn` class (not `player-btn`, the player's own transport-control class). */
const RAW_BTN = /(?<![-\w])btn( |-|"|`)/;

describe("button style audit", () => {
  it("keeps raw btn styling out of everything but the Button family", () => {
    const offenders = sources().filter(
      (file) => file !== "components/ui/Button.tsx" && RAW_BTN.test(readFileSync(join(src, file), "utf8"))
    );
    expect(offenders, "use <Button>/<ButtonLink> from components/ui instead of raw btn classes").toEqual([]);
  });

  it("never renders a bare <button> carrying a btn class", () => {
    const offenders = sources().filter((file) => /<button[^>]*className="[^"]*(?<![-\w])btn(?![-\w])/s.test(readFileSync(join(src, file), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("shared shell and calendar surfaces render buttons only through the family", () => {
    for (const file of ["components/shell/PageHeader.tsx", "components/shell/FiltersDrawer.tsx", "pages/Calendar.tsx", "components/CalendarLink.tsx"]) {
      const text = readFileSync(join(src, file), "utf8");
      expect(text, `${file} must import from components/ui`).toMatch(/from "\.\.?\/(\.\.\/)?(components\/)?ui"/);
    }
  });
});
