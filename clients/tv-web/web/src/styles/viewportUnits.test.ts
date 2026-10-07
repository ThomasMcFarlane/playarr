import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalCss = readFileSync(new URL("./global.css", import.meta.url), "utf8");
const clientsCss = readFileSync(new URL("../pages/Clients.css", import.meta.url), "utf8");
const calendarCss = readFileSync(new URL("../pages/Calendar.css", import.meta.url), "utf8");
describe("viewport-relative TV layout", () => {
  it("routes vertical viewport sizing through the WebView-safe unit", () => {
    expect(globalCss).toContain("--viewport-unit: 1vh");
    expect(globalCss).toContain("@supports (height: 1dvh)");
    expect(globalCss).toContain("--viewport-unit: max(1vh, 1dvh)");
    expect(globalCss.indexOf("--viewport-unit: 1vh")).toBeLessThan(
      globalCss.indexOf("@supports (height: 1dvh)")
    );
    const declarations = `${globalCss}\n${clientsCss}`
      .replace("--viewport-unit: 1vh", "")
      .replace("@supports (height: 1dvh)", "")
      .replace("--viewport-unit: max(1vh, 1dvh)", "");

    expect(declarations).not.toMatch(/-?\d+(?:\.\d+)?(?:d|s|l)?vh\b/);
  });

  it("routes horizontal viewport sizing through the stage-scaled --vw variable", () => {
    const declarations = `${globalCss}\n${clientsCss}\n${calendarCss}`.replace("--vw: 1vw", "");
    expect(globalCss).toContain("--vw: 1vw");
    expect(declarations).not.toMatch(/-?\d+(?:\.\d+)?vw\b/);
  });
});
