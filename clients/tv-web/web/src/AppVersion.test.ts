import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Playarr version label", () => {
  it("shows the injected bundle version beneath the user avatar", () => {
    const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("./styles/global.css", import.meta.url), "utf8");

    expect(app).toContain('className="app-user-version"');
    expect(app).toContain("v{__APP_VERSION__}");
    expect(css).toMatch(
      /\.app-user-version\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*2;/s
    );
    expect(css).toMatch(
      /\.app-user-version\s*\{[^}]*position:\s*absolute;[^}]*top:\s*calc\(100% \+ 4px\);/s
    );
  });
});
