import { describe, expect, it } from "vitest";
import { compareVersions, evaluateClientVersion, type CompatibilityEntryLike } from "./version-check";

describe("compareVersions", () => {
  it("compares numerically per segment, not lexicographically", () => {
    expect(compareVersions("1.12.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1);
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
  });

  it("treats missing trailing segments as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.1", "1.2")).toBe(1);
  });

  it("never throws on a malformed version string", () => {
    expect(() => compareVersions("not-a-version", "1.0.0")).not.toThrow();
    expect(compareVersions("not-a-version", "0.0.0")).toBe(0);
  });
});

describe("evaluateClientVersion", () => {
  const compatibility: CompatibilityEntryLike[] = [
    {
      platform: "web",
      latest_version: "3.2.0",
      min_supported_version: "3.0.0",
      deprecated_below: "3.1.0",
      sunset: "2026-12-01T00:00:00Z",
    },
  ];

  it("reports unsupported when the running version is below the floor", () => {
    const result = evaluateClientVersion("2.9.0", "web", compatibility);
    expect(result.status).toBe("unsupported");
    expect(result.latestVersion).toBe("3.2.0");
  });

  it("reports deprecated when at/above the floor but below the deprecation line", () => {
    const result = evaluateClientVersion("3.0.5", "web", compatibility);
    expect(result.status).toBe("deprecated");
  });

  it("reports supported when at/above the deprecation line", () => {
    const result = evaluateClientVersion("3.1.0", "web", compatibility);
    expect(result.status).toBe("supported");
  });

  it("reports supported when the server's table has no entry for this platform", () => {
    const result = evaluateClientVersion("0.0.1", "tv-tizen", compatibility);
    expect(result.status).toBe("supported");
  });

  it("reports supported when there is no deprecated_below floor at all", () => {
    const noDeprecation: CompatibilityEntryLike[] = [
      { platform: "web", latest_version: "1.0.0", min_supported_version: "1.0.0" },
    ];
    expect(evaluateClientVersion("1.0.0", "web", noDeprecation).status).toBe("supported");
  });
});
