import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalCss = readFileSync(new URL("./global.css", import.meta.url), "utf8");
const clientsCss = readFileSync(new URL("../pages/Clients.css", import.meta.url), "utf8");
describe("viewport-relative TV layout", () => {
  it("routes vertical viewport sizing through the WebView-safe unit", () => {
    expect(globalCss).toContain("--viewport-unit: max(1vh, 1dvh)");
    const declarations = `${globalCss}\n${clientsCss}`.replace(
      "--viewport-unit: max(1vh, 1dvh)",
      ""
    );

    expect(declarations).not.toMatch(/-?\d+(?:\.\d+)?(?:d|s|l)?vh\b/);
  });
});
