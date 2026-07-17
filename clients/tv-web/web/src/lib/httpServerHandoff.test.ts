import { describe, expect, it } from "vitest";
import {
  initialPublicHttpPageHandoffUrl,
  publicHttpServerHandoffUrl,
} from "./httpServerHandoff";

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

  it("hands a saved public HTTP server off before the app starts", () => {
    expect(
      initialPublicHttpPageHandoffUrl(
        "https://playarr.app/",
        "http://203.0.113.10:8080"
      )
    ).toBe("http://203.0.113.10:8080/playarr/login");
  });

  it("preserves a public HTTP invitation on the server-hosted client", () => {
    const pageUrl =
      "https://playarr.app/signup?server=http%3A%2F%2F203.0.113.10%3A8080&invite=one-use-token";
    expect(initialPublicHttpPageHandoffUrl(pageUrl)).toBe(
      "http://203.0.113.10:8080/playarr/signup?server=http%3A%2F%2F203.0.113.10%3A8080&invite=one-use-token"
    );
  });

  it("does not hand off from an already-HTTP page", () => {
    expect(
      initialPublicHttpPageHandoffUrl(
        "http://203.0.113.10:8080/playarr/",
        "http://203.0.113.10:8080"
      )
    ).toBeUndefined();
  });
});
