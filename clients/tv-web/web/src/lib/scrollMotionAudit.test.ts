import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Owner ruling, 8 October 2026: all focus-driven scrolling goes through the one
 * scroll engine (`smoothScroll.ts`). Nothing else may write scroll offsets
 * directly, scroll natively, or ask for `behavior: "instant"`.
 */
const SRC = fileURLToPath(new URL("..", import.meta.url));
const ENGINE = "lib/smoothScroll.ts";
const FORBIDDEN: Array<[string, RegExp]> = [
  ["a direct scrollTop/scrollLeft write", /\.scroll(Top|Left)\s*([-+*/]?=)(?!=)/],
  ["behavior: \"instant\"", /behavior\s*:\s*["']instant["']/],
  ["a native scrollIntoView call", /\.scrollIntoView\s*\(/],
  ["a native scrollTo/scrollBy call", /\.scroll(To|By)\s*\(/],
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("scroll motion audit", () => {
  it("keeps scroll writes inside the shared engine", () => {
    const offences: string[] = [];
    for (const file of sources(SRC)) {
      const relative = file.slice(SRC.length).replaceAll("\\", "/");
      if (relative === ENGINE) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
          for (const [label, pattern] of FORBIDDEN) {
            if (pattern.test(line)) offences.push(`${relative}:${index + 1} ${label}`);
          }
        });
    }
    expect(offences).toEqual([]);
  });
});
