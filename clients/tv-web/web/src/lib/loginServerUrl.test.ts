import { describe, expect, it } from "vitest";
import { initialLoginServerUrl, publicIpv4RelayUrl } from "./loginServerUrl";

describe("initialLoginServerUrl", () => {
  it("leaves the server blank on the hosted Playarr origin", () => {
    expect(initialLoginServerUrl("https://playarr.app", "playarr.app")).toBe("");
  });

  it("does not prefill a previously selected server on hosted Playarr", () => {
    expect(initialLoginServerUrl("http://203.0.113.10:8080", "playarr.app")).toBe("");
  });

  it("preserves same-origin defaults for self-hosted clients", () => {
    expect(initialLoginServerUrl("https://media.example.com", "media.example.com")).toBe(
      "https://media.example.com"
    );
  });
});

describe("publicIpv4RelayUrl", () => {
  it("converts public IPv4 HTTP servers to direct HTTPS relay DNS names", () => {
    expect(publicIpv4RelayUrl("http://11.22.33.44:8080")).toBe(
      "https://v4-11-22-33-44.relay.playarr.app:8484"
    );
  });

  it("preserves paths, queries, and fragments", () => {
    expect(publicIpv4RelayUrl("http://11.22.33.44:8080/api?q=one#result")).toBe(
      "https://v4-11-22-33-44.relay.playarr.app:8484/api?q=one#result"
    );
  });

  it.each([
    "http://192.168.1.20:8484",
    "http://203.0.113.10:8484",
    "http://localhost:8484",
    "http://media.example.com:8484",
    "https://203.0.113.10:8484",
    "http://[2001:db8::1]:8484",
    "not a URL",
  ])("leaves unsupported address %s unchanged", (value) => {
    expect(publicIpv4RelayUrl(value)).toBe(value);
  });
});
