import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Playarr version label", () => {
  it("shows the injected bundle version beneath the user avatar", () => {
    const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("./styles/global.css", import.meta.url), "utf8");

    expect(app).toContain('className="app-user-version"');
    expect(app).toContain("v{__APP_VERSION__}");
    expect(app).toMatch(
      /<div className="app-nav-group app-nav-group-profile app-user-identity-cluster">[\s\S]*<ProfileNavLink[\s\S]*\/>\s*<span className="app-user-version"/
    );
    expect(css).toMatch(
      /\.app-user-version\s*\{[^}]*display:\s*block;/s
    );
  });
});
