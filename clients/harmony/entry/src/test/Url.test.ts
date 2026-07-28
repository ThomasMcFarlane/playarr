// entry/src/test/Url.test.ts
//
// Pure Node unit tests for core/Url.ts (brief section 4.10 / 7.2).
// This file imports only the plain-TypeScript core module below and
// node's own test/assert builtins -- no ArkUI, no @kit.*/@ohos.* imports,
// no decorators.
//
// Covers:
//   absoluteUrl            joins a server-relative path onto a base origin
//                           with exactly one slash, and throws (never
//                           silently mis-joins) when the "path" already
//                           carries its own http:// or https:// scheme.
//   normaliseServerUrlList  maps every entry through normaliseServerUrl,
//                           drops anything unparseable, and dedupes the
//                           survivors while preserving first-seen order.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { absoluteUrl, normaliseServerUrlList } from "../main/ets/core/Url";

describe("absoluteUrl: joining a server-relative path onto a base origin", () => {
  it("joins a base with no trailing slash and a path with a leading slash", () => {
    const result: string = absoluteUrl("https://media.example.com", "/api/v1/media/abc123/stream");
    assert.equal(result, "https://media.example.com/api/v1/media/abc123/stream");
  });

  it("collapses a trailing slash on the base against a leading slash on the path", () => {
    const result: string = absoluteUrl("https://media.example.com/", "/api/v1/media/abc123/stream");
    assert.equal(result, "https://media.example.com/api/v1/media/abc123/stream");
  });

  it("still joins with exactly one slash when neither side has one", () => {
    const result: string = absoluteUrl("https://media.example.com", "api/v1/media/abc123/stream");
    assert.equal(result, "https://media.example.com/api/v1/media/abc123/stream");
  });

  it("joins a realistic renditions playlist path from the playback-negotiation contract", () => {
    const result: string = absoluteUrl(
      "https://box.playarr.local:8443",
      "/api/v1/media/renditions/9f1c1e2e-6b7d-4a6a-8f0a-2b6a1a2b3c4d/playlist.m3u8"
    );
    assert.equal(
      result,
      "https://box.playarr.local:8443/api/v1/media/renditions/9f1c1e2e-6b7d-4a6a-8f0a-2b6a1a2b3c4d/playlist.m3u8"
    );
  });

  it("throws when serverRelativePath already carries an https:// scheme", () => {
    assert.throws(() => {
      absoluteUrl("https://media.example.com", "https://evil.example.com/api/v1/media/x/stream");
    }, /expected a server-relative path but received an absolute URL/);
  });

  it("throws when serverRelativePath already carries an http:// scheme, matched case-insensitively", () => {
    assert.throws(() => {
      absoluteUrl("https://media.example.com", "HTTP://evil.example.com/api/v1/media/x/stream");
    }, /expected a server-relative path but received an absolute URL/);
  });
});

describe("normaliseServerUrlList: deduping and dropping invalid entries", () => {
  it("drops entries with no scheme, empty entries and entries with internal whitespace", () => {
    const result: string[] = normaliseServerUrlList([
      "not-a-url",
      "",
      "   ",
      "http:// has a space",
      "ftp://media.example.com",
    ]);
    assert.deepStrictEqual(result, []);
  });

  it("dedupes entries that normalise to the same value while preserving first-seen order", () => {
    const result: string[] = normaliseServerUrlList([
      "https://box.playarr.local/",
      "https://box.playarr.local",
      "http://nas.playarr.local",
      "https://box.playarr.local",
    ]);
    assert.deepStrictEqual(result, ["https://box.playarr.local", "http://nas.playarr.local"]);
  });

  it("accepts a scheme matched case-insensitively and trims surrounding whitespace", () => {
    const result: string[] = normaliseServerUrlList(["  HTTPS://Box.Playarr.Local  "]);
    assert.deepStrictEqual(result, ["HTTPS://Box.Playarr.Local"]);
  });

  it("mixes valid and invalid entries, keeping only the valid ones in first-seen order", () => {
    const result: string[] = normaliseServerUrlList([
      "garbage",
      "https://alpha.example.com",
      "",
      "https://beta.example.com/",
    ]);
    assert.deepStrictEqual(result, ["https://alpha.example.com", "https://beta.example.com"]);
  });
});
