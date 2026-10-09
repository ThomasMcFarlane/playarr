import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalCss = readFileSync(new URL("./global.css", import.meta.url), "utf8");

// Every stylesheet under src, so a new file (Folders.css was missed once) is scanned without editing this test.
function allStylesheets(directory: URL): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) return allStylesheets(child);
    return entry.name.endsWith(".css") ? [readFileSync(child, "utf8")] : [];
  });
}
const everyCss = allStylesheets(new URL("../", import.meta.url)).join("\n");
describe("viewport-relative TV layout", () => {
  it("routes vertical viewport sizing through the WebView-safe unit", () => {
    expect(globalCss).toContain("--viewport-unit: 1vh");
    expect(globalCss).toContain("@supports (height: 1dvh)");
    expect(globalCss).toContain("--viewport-unit: max(1vh, 1dvh)");
    expect(globalCss.indexOf("--viewport-unit: 1vh")).toBeLessThan(
      globalCss.indexOf("@supports (height: 1dvh)")
    );
    const declarations = everyCss
      .replace("--viewport-unit: 1vh", "")
      .replace("@supports (height: 1dvh)", "")
      .replace("--viewport-unit: max(1vh, 1dvh)", "");

    expect(declarations).not.toMatch(/-?\d+(?:\.\d+)?(?:d|s|l)?vh\b/);
  });

  it("routes horizontal viewport sizing through the stage-scaled --vw variable", () => {
    const declarations = everyCss.replace("--vw: 1vw", "");
    expect(globalCss).toContain("--vw: 1vw");
    expect(declarations).not.toMatch(/-?\d+(?:\.\d+)?vw\b/);
  });
});
