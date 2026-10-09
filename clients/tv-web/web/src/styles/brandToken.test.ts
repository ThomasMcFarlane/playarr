import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The brand red is one token (`--brand`), never a literal: a re-tint is a one-line change in global.css. */
const src = join(dirname(fileURLToPath(import.meta.url)), "..");

function files(dir: string): string[] {
  return readdirSync(join(src, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(`${dir}/${entry.name}`) : /\.(css|tsx?)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [`${dir}/${entry.name}`] : []
  );
}

describe("brand colour token", () => {
  it("defines --brand once in global.css", () => {
    const css = readFileSync(join(src, "styles/global.css"), "utf8");
    expect(css.match(/--brand:\s*#cf3157;/g)).toHaveLength(1);
  });

  it("is never written as a literal anywhere else", () => {
    const stray: string[] = [];
    for (const file of [...files("styles"), ...files("pages"), ...files("components")]) {
      const text = readFileSync(join(src, file), "utf8").replace(/--brand:\s*#cf3157;/g, "");
      if (/#cf3157/i.test(text) || /rgba\(\s*207\s*,\s*49\s*,\s*87/.test(text)) stray.push(file);
    }
    expect(stray, "use var(--brand) (or color-mix with it)").toEqual([]);
  });
});
