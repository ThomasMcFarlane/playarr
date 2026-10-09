import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./global.css", import.meta.url), "utf8");
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
};

describe("cast and crew card", () => {
  it("is a 1:1 circle sized on the stage scale", () => {
    expect(rule(".tv-person-card")).toMatch(/--tv-person-size: clamp\([^)]*var\(--vw\)/);
    const art = rule(".tv-person-card .tv-person-art");
    expect(art).toContain("aspect-ratio: 1 / 1");
    expect(art).toContain("border-radius: 50%");
  });

  it("crops portrait headshots to the top so faces stay in the circle", () => {
    const img = rule(".tv-person-art img");
    expect(img).toContain("object-fit: cover");
    expect(img).toContain("object-position: 50% 20%");
  });

  it("centres name and role on at most two lines", () => {
    expect(rule(".tv-person-copy")).toContain("text-align: center");
    expect(rule(".tv-person-copy strong,\n.tv-person-copy small")).toContain("-webkit-line-clamp: 2");
  });
});
