import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./Home.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../styles/global.css", import.meta.url), "utf8");

describe("SettingsHomePage reset button layout", () => {
  it("wraps Reset to default in a content-sized action row, not a bare grid child", () => {
    expect(page).toMatch(
      /<div className="tv-home-customise-actions">\s*<Button onClick=\{reset\}>/
    );
    expect(css).toMatch(
      /\.tv-home-customise-actions\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-start;/
    );
  });
});

describe("Customise Home lives in Settings (owner ruling 2026-10-08, Q3b)", () => {
  it("is a settings section with a deep link, and Home has no Customise button", () => {
    const surfaces = readFileSync(new URL("../../lib/productSurfaces.ts", import.meta.url), "utf8");
    expect(surfaces).toContain('to: "/settings/home"');
    const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
    expect(app).toContain('<Route path="home" element={<SettingsHomePage />} />');
    expect(app).toContain('<Route path="/customise-home" element={<Navigate to="/settings/home" replace />} />');
    const home = readFileSync(new URL("../Home.tsx", import.meta.url), "utf8");
    expect(home).not.toMatch(/customise-home|tv-home-customise"|home:customise/);
  });
});
