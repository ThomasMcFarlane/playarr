import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./DeviceLink.tsx", import.meta.url), "utf8");

describe("DeviceLinkPage profile-selector styling", () => {
  it("uses the shared profile layout instead of the legacy auth card", () => {
    expect(source).toContain('import { ProfileAuthLayout }');
    expect(source).toContain('<ProfileAuthLayout className="device-link-profile-page">');
    expect(source).not.toContain('className="auth-page device-link-page"');
    expect(source).not.toContain('className="auth-card device-link-card"');
    expect(source).not.toContain('className="auth-backdrop"');
  });
});
