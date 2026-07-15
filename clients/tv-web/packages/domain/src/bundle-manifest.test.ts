import { describe, expect, it, vi } from "vitest";
import { fetchBuildManifest, isNewerBundleAvailable } from "./bundle-manifest";

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  return vi.fn(async (url: string) => handler(url));
}

describe("fetchBuildManifest", () => {
  it("parses a well-formed manifest", async () => {
    const fetchImpl = mockFetch(() => new Response(JSON.stringify({ bundleVersion: "1.4.0" }), { status: 200 }));
    const manifest = await fetchBuildManifest({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(manifest).toEqual({ bundleVersion: "1.4.0", apiVersion: undefined });
  });

  it("resolves to null (never throws) on a 404", async () => {
    const fetchImpl = mockFetch(() => new Response(null, { status: 404 }));
    const manifest = await fetchBuildManifest({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(manifest).toBeNull();
  });

  it("resolves to null on a network error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const manifest = await fetchBuildManifest({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(manifest).toBeNull();
  });

  it("resolves to null on a malformed body", async () => {
    const fetchImpl = mockFetch(() => new Response(JSON.stringify({ notBundleVersion: "x" }), { status: 200 }));
    const manifest = await fetchBuildManifest({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(manifest).toBeNull();
  });

  it("resolves to null when no fetch implementation is available at all", async () => {
    vi.stubGlobal("fetch", undefined);
    try {
      const manifest = await fetchBuildManifest({});
      expect(manifest).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("isNewerBundleAvailable", () => {
  it("is true when the manifest's version is strictly greater", () => {
    expect(isNewerBundleAvailable("1.0.0", { bundleVersion: "1.1.0" })).toBe(true);
  });

  it("is false when equal or older", () => {
    expect(isNewerBundleAvailable("1.1.0", { bundleVersion: "1.1.0" })).toBe(false);
    expect(isNewerBundleAvailable("1.2.0", { bundleVersion: "1.1.0" })).toBe(false);
  });
});
