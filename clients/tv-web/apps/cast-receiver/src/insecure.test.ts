import { describe, expect, it } from "vitest";
import {
  INSECURE_SERVER_REMEDY,
  insecureServerFailureMessage,
  isMixedContentServer,
} from "./insecure";

describe("isMixedContentServer", () => {
  it("is true only for an http server from an https page", () => {
    expect(isMixedContentServer("http://192.0.2.10:8484", "https:")).toBe(true);
    expect(isMixedContentServer("https://server.example", "https:")).toBe(false);
    expect(isMixedContentServer("http://192.0.2.10:8484", "http:")).toBe(false);
    expect(isMixedContentServer("not a url", "https:")).toBe(false);
  });
});

describe("insecureServerFailureMessage", () => {
  it("returns the remedy for a network failure against an http server", () => {
    expect(insecureServerFailureMessage(new TypeError("Failed to fetch"), "http://192.0.2.10:8484", "https:")).toBe(
      INSECURE_SERVER_REMEDY
    );
  });

  it("names the one-step remedy", () => {
    expect(INSECURE_SERVER_REMEDY).toContain("PLAYARR_RELAY_REGISTER=true");
    expect(INSECURE_SERVER_REMEDY).toContain("https://");
  });

  it("does not blame http for a server answer or an https server", () => {
    expect(insecureServerFailureMessage(new Error("HTTP 401"), "http://192.0.2.10:8484", "https:")).toBeNull();
    expect(insecureServerFailureMessage(new TypeError("Failed to fetch"), "https://server.example", "https:")).toBeNull();
  });
});
