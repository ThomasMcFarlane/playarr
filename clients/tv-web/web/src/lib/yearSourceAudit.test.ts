import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir = src): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [relative(src, path)] : [];
  });
}

// Owner ruling (8 Oct 2026): every title year is the RELEASE year, never the year the title was added to the
// library. Years come from `releaseYear()` in lib/workYear.ts; `added_at` is for sorting and "date added" only.
describe("year audit", () => {
  it("never derives a year from added_at", () => {
    const offenders = sources().filter((file) => {
      const text = readFileSync(join(src, file), "utf8");
      return (
        /added_at[^;\n]*\.get(UTC)?FullYear/.test(text) ||
        /new Date\([^)]*added_at[^)]*\)\s*\.get(UTC)?FullYear/.test(text) ||
        /(release_date|releaseDate)\s*\?\?[^;\n]*added_at[\s\S]{0,120}FullYear/.test(text)
      );
    });
    expect(offenders, "use releaseYear() from lib/workYear.ts").toEqual([]);
  });

  it("keeps one year helper: no local copies of releaseYear", () => {
    const offenders = sources().filter(
      (file) => file !== "lib/workYear.ts" && /function (releaseYear|workReleaseYear)\b/.test(readFileSync(join(src, file), "utf8"))
    );
    expect(offenders, "import releaseYear/yearOfDate from lib/workYear.ts").toEqual([]);
  });

  it("builds title years from release_date through the shared helper", () => {
    for (const file of ["pages/Library.tsx", "pages/Search.tsx", "pages/Downloads.tsx"]) {
      expect(readFileSync(join(src, file), "utf8"), file).toMatch(/releaseYear\(/);
    }
  });
});
