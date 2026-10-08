import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

describe("BACK key detection", () => {
  it("lives only in lib/backKey.ts", () => {
    const offenders = walk(join(__dirname, ".."))
      .filter((file) => !file.endsWith(join("lib", "backKey.ts")))
      .filter((file) => /"BrowserBack"|\b10009\b|keyCode\s*===?\s*461/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
