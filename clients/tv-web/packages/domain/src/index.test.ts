import { describe, expect, it } from "vitest";
import { normaliseApiBaseUrl } from "./index";

describe("normaliseApiBaseUrl", () => {
  it("returns a canonical absolute URL without trailing slashes", () => {
    expect(normaliseApiBaseUrl(" https://media.example.test/streamarr/// ")).toBe(
      "https://media.example.test/streamarr"
    );
  });

  it("preserves an explicit port", () => {
    expect(normaliseApiBaseUrl("http://192.0.2.10:8484/")).toBe(
      "http://192.0.2.10:8484"
    );
  });

  it.each([
    ["a relative URL", "/streamarr"],
    ["an unsupported protocol", "file:///tmp/streamarr"],
    ["embedded credentials", "https://user:secret@example.test"],
    ["a query", "https://example.test?server=one"],
    ["a fragment", "https://example.test/#login"],
  ])("rejects %s", (_description, value) => {
    expect(() => normaliseApiBaseUrl(value)).toThrow();
  });
});
