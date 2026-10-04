import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./HomeCustomise.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");

describe("HomeCustomisePage reset button layout", () => {
  it("wraps Reset to default in a content-sized action row, not a bare grid child", () => {
    expect(page).toMatch(
      /<div className="tv-home-customise-actions">\s*<Button onClick=\{reset\}>/
    );
    expect(css).toMatch(
      /\.tv-home-customise-actions\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-start;/
    );
  });
});
