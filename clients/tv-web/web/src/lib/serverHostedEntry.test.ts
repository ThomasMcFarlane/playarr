import { describe, expect, it } from "vitest";
import { serverHostedEntryUrl } from "./serverHostedEntry";

describe("serverHostedEntryUrl", () => {
  it("points an https page at the http server's own /tv/ entry", () => {
    expect(serverHostedEntryUrl("http://192.0.2.10:8484", "https:", "tv-vidaa")).toBe(
      "http://192.0.2.10:8484/tv/?platform=tv-vidaa"
    );
  });

  it("assumes http when the scheme is missing, as sign-in does", () => {
    expect(serverHostedEntryUrl("192.0.2.10:8484", "https:", "web")).toBe("http://192.0.2.10:8484/tv/");
    expect(serverHostedEntryUrl(" media.example.test ", "https:", "web")).toBe("http://media.example.test/tv/");
  });

  it("drops any path, query and credentials from the entered address", () => {
    expect(serverHostedEntryUrl("http://user:pw@192.0.2.10:8484/some/path?x=1", "https:", "web")).toBe(
      "http://192.0.2.10:8484/tv/"
    );
  });

  it("can target the link page and keeps the TV's user code", () => {
    expect(serverHostedEntryUrl("http://192.0.2.10:8484", "https:", "web", "link?user_code=ABCD-2345")).toBe(
      "http://192.0.2.10:8484/tv/link?user_code=ABCD-2345"
    );
    expect(serverHostedEntryUrl("http://192.0.2.10:8484", "https:", "tv-vidaa", "/link?user_code=ABCD-2345")).toBe(
      "http://192.0.2.10:8484/tv/link?user_code=ABCD-2345&platform=tv-vidaa"
    );
  });

  it("is null when there is no mixed content", () => {
    expect(serverHostedEntryUrl("https://server.example", "https:", "tv-vidaa")).toBeNull();
    expect(serverHostedEntryUrl("http://192.0.2.10:8484", "http:", "tv-vidaa")).toBeNull();
    expect(serverHostedEntryUrl("", "https:", "tv-vidaa")).toBeNull();
    expect(serverHostedEntryUrl("ftp://x", "https:", "tv-vidaa")).toBeNull();
  });
});
