import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./global.css", import.meta.url), "utf8");

describe("dead card styles (B5, B6)", () => {
  it("has no poster-* or editorial-* leftovers", () => {
    expect(css).not.toMatch(/\.poster-(card|grid|art|title|meta|placeholder)/);
    expect(css).not.toMatch(/\.editorial-/);
  });

  it("does not fill the discovery row on focus", () => {
    expect(css).not.toMatch(/\.tv-discovery-item:focus-within/);
  });
});
