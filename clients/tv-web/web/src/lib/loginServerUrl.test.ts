import { describe, expect, it } from "vitest";
import { initialLoginServerUrl } from "./loginServerUrl";

describe("initialLoginServerUrl", () => {
  it("leaves the server blank on the hosted Playarr origin", () => {
    expect(
      initialLoginServerUrl(
        "https://playarr.app",
        "https://playarr.app",
        "playarr.app"
      )
    ).toBe("");
  });

  it("preserves an explicit server on the hosted Playarr origin", () => {
    expect(
      initialLoginServerUrl(
        "https://streamarr.example.com",
        "https://playarr.app",
        "playarr.app"
      )
    ).toBe("https://streamarr.example.com");
  });

  it("preserves same-origin defaults for self-hosted clients", () => {
    expect(
      initialLoginServerUrl(
        "https://media.example.com",
        "https://media.example.com",
        "media.example.com"
      )
    ).toBe("https://media.example.com");
  });
});
