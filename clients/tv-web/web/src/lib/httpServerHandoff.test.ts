import { describe, expect, it } from "vitest";
import { publicHttpServerHandoffUrl } from "./httpServerHandoff";

describe("publicHttpServerHandoffUrl", () => {
  it("hands a public HTTP IP to the server-hosted Playarr client", () => {
    expect(publicHttpServerHandoffUrl("http://203.0.113.10:8080/"))
      .toBe("http://203.0.113.10:8080/playarr/login");
  });

  it.each([
    "http://192.168.1.50:8080",
    "http://streamarr.local:8080",
    "https://203.0.113.10:8080",
  ])("keeps %s on the direct browser path", (url) => {
    expect(publicHttpServerHandoffUrl(url)).toBeUndefined();
  });
});
