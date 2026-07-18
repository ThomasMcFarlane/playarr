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
  it.each([
    "11.22.33.44",
    "11.22.33.44:8080",
    "http://11.22.33.44",
    "http://11.22.33.44:8080",
    "https://11.22.33.44",
    "https://11.22.33.44:9443",
    "//11.22.33.44:8080",
    "  11.22.33.44:8080  ",
  ])("normalises public IPv4 form %s to the relay address", (value) => {
    expect(publicIpv4RelayUrl(value)).toBe(
      "https://v4-11-22-33-44.relay.playarr.app:8484"
    );
  });

  it.each([
    "v4-203-0-113-10.relay.playarr.app",
    "http://v4-203-0-113-10.relay.playarr.app",
    "https://v4-203-0-113-10.relay.playarr.app",
  ])("normalises relay hostname form %s to HTTPS on the Streamarr port", (value) => {
    expect(publicIpv4RelayUrl(value)).toBe(
      "https://v4-203-0-113-10.relay.playarr.app:8484"
    );
  });

  it.each([
    "11.22.33.44:8080/api?q=one#result",
    "http://11.22.33.44:8080/api?q=one#result",
    "https://11.22.33.44:9443/api?q=one#result",
  ])("preserves paths, queries, and fragments for %s", (value) => {
    expect(publicIpv4RelayUrl(value)).toBe(
      "https://v4-11-22-33-44.relay.playarr.app:8484/api?q=one#result"
    );
  });

  it("normalises a root query without retaining a redundant slash", () => {
    expect(publicIpv4RelayUrl("11.22.33.44:8080?q=one#result")).toBe(
      "https://v4-11-22-33-44.relay.playarr.app:8484?q=one#result"
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
