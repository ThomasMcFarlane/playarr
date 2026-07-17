import { describe, expect, it } from "vitest";
import { initialLoginServerUrl } from "./loginServerUrl";

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
