import { describe, expect, it, vi } from "vitest";
import {
  createLocalNetworkFetch,
  isPublicHttpUrl,
  targetAddressSpaceForUrl,
} from "./localNetworkFetch";

describe("targetAddressSpaceForUrl", () => {
  it.each([
    "http://192.168.1.50:8080",
    "http://10.0.0.5:8080",
    "http://172.16.0.5:8080",
    "http://playarr.local:8080",
    "http://[fd00::5]:8080",
  ])("marks %s as local", (url) => {
    expect(targetAddressSpaceForUrl(url)).toBe("local");
  });

  it.each(["http://localhost:8080", "http://127.0.0.1:8080", "http://[::1]:8080"])(
    "marks %s as loopback",
    (url) => {
      expect(targetAddressSpaceForUrl(url)).toBe("loopback");
    }
  );

  it("does not mark an HTTPS request", () => {
    expect(targetAddressSpaceForUrl("https://192.168.1.50:8080")).toBeUndefined();
  });

  it("does not mislabel a public HTTP IP as local", () => {
    expect(targetAddressSpaceForUrl("http://203.0.113.10:8080")).toBeUndefined();
    expect(isPublicHttpUrl("http://203.0.113.10:8080")).toBe(true);
  });

  it("does not mislabel a public HTTP domain as local", () => {
    expect(targetAddressSpaceForUrl("http://playarr.example.com:8080")).toBeUndefined();
    expect(isPublicHttpUrl("http://playarr.example.com:8080")).toBe(true);
  });
});

describe("createLocalNetworkFetch", () => {
  it("declares local address space when fetching an HTTP URL", async () => {
    const response = new Response(null, { status: 204 });
    const nativeFetch = vi.fn(async () => response);
    const input = new Request("http://192.168.1.50:8080/api/system/health");

    await expect(createLocalNetworkFetch(nativeFetch)(input)).resolves.toBe(response);
    expect(nativeFetch).toHaveBeenCalledWith(input, { targetAddressSpace: "local" });
  });

  it("leaves an HTTPS request unchanged", async () => {
    const response = new Response(null, { status: 204 });
    const nativeFetch = vi.fn(async () => response);
    const input = new Request("https://playarr.example.com/api/system/health");

    await expect(createLocalNetworkFetch(nativeFetch)(input)).resolves.toBe(response);
    expect(nativeFetch).toHaveBeenCalledWith(input);
  });

  it("sends a public HTTP request directly when the browser permits insecure content", async () => {
    const response = new Response(null, { status: 204 });
    const nativeFetch = vi.fn(async () => response);
    const input = new Request("http://203.0.113.10:8080/api/system/version");

    await expect(createLocalNetworkFetch(nativeFetch)(input)).resolves.toBe(response);
    expect(nativeFetch).toHaveBeenCalledWith(input);
  });
});
