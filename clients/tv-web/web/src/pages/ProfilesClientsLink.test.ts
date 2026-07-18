import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./Profiles.tsx", import.meta.url), "utf8");

describe("Profiles client navigation", () => {
  it("links the profile picker to the public Clients page with TV focus metadata", () => {
    expect(source).toContain('id="profiles-clients"');
    expect(source).toContain('to="/clients"');
    expect(source).toContain('data-navigation-focus-key="profiles:clients"');
    expect(source).toContain('data-tv-edge-target-down="#profiles-clients"');
  });
});
