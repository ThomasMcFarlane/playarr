import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalCss = readFileSync(new URL("./global.css", import.meta.url), "utf8");
const clientsCss = readFileSync(new URL("../pages/Clients.css", import.meta.url), "utf8");

function ruleBlocks(css: string): string[] {
  return css.split("}").map((chunk) => `${chunk}}`);
}

function declarationsMissingTouchScrolling(css: string): string[] {
  return ruleBlocks(css)
    .filter((block) => /overflow(-x|-y)?:\s*auto;/.test(block))
    .filter((block) => !block.includes("-webkit-overflow-scrolling"))
    .map((block) => block.trim().split("\n")[0] ?? block);
}

describe("native scroll containers", () => {
  it("enable WebKit touch scrolling on every overflow: auto viewport", () => {
    expect(declarationsMissingTouchScrolling(globalCss)).toEqual([]);
    expect(declarationsMissingTouchScrolling(clientsCss)).toEqual([]);
  });

  it("keeps the sign-in and sign-up scroll root touch-scrollable", () => {
    const authScrollRule = globalCss.match(/\.profile-auth-scroll\s*\{(?<declarations>[^}]*)\}/)
      ?.groups?.declarations;

    expect(authScrollRule).toContain("overflow-y: auto");
    expect(authScrollRule).toContain("-webkit-overflow-scrolling: touch");
  });
});
