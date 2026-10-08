import { afterEach, describe, expect, it, vi } from "vitest";
import {
  artworkCacheLimit,
  artworkVersion,
  defaultArtworkWidth,
  trimArtwork,
} from "./artwork";
import { libraryFirstPageKey, libraryFirstPageParams } from "./libraryView";

describe("artwork sizing and versioning", () => {
  it("sizes art to the card and keeps full-screen widths explicit", () => {
    expect(defaultArtworkWidth("poster")).toBeLessThanOrEqual(400);
    expect(defaultArtworkWidth("backdrop")).toBeLessThan(1920);
  });

  it("changes the version token whenever the source URL changes, and only then", () => {
    const a = artworkVersion("https://img.example/original/a.jpg");
    expect(artworkVersion("https://img.example/original/a.jpg")).toBe(a);
    expect(artworkVersion("https://img.example/original/b.jpg")).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("artwork memory cap", () => {
  afterEach(() => vi.restoreAllMocks());

  it("allows fewer decoded images on low-memory devices", () => {
    expect(artworkCacheLimit(1)).toBeLessThan(artworkCacheLimit(2));
    expect(artworkCacheLimit(2)).toBeLessThan(artworkCacheLimit(4));
    expect(artworkCacheLimit(undefined)).toBeGreaterThan(0);
  });

  it("revokes the least recently used unused images and never one that is showing", () => {
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { revokeObjectURL: revoke }));
    const cache = new Map([
      ["a", { promise: Promise.resolve("blob:a"), url: "blob:a", refs: 0 }],
      ["b", { promise: Promise.resolve("blob:b"), url: "blob:b", refs: 1 }],
      ["c", { promise: Promise.resolve("blob:c"), url: "blob:c", refs: 0 }],
      ["d", { promise: Promise.resolve("blob:d"), refs: 0 }],
    ]);
    trimArtwork(cache, 2);
    expect(revoke.mock.calls.map((call) => call[0])).toEqual(["blob:a", "blob:c"]);
    expect([...cache.keys()]).toEqual(["b", "d"]);
  });
});

describe("library first page request", () => {
  it("is one definition for the screen and for prefetching, per sort and language filter", () => {
    const base = libraryFirstPageParams("movie", "title", "asc");
    expect(libraryFirstPageKey(base)).toBe(libraryFirstPageKey(libraryFirstPageParams("movie", "title", "asc", {})));
    expect(libraryFirstPageKey(base)).not.toBe(libraryFirstPageKey(libraryFirstPageParams("series", "title", "asc")));
    expect(libraryFirstPageKey(base)).not.toBe(libraryFirstPageKey(libraryFirstPageParams("movie", "date_added", "desc")));
    expect(libraryFirstPageKey(base)).not.toBe(
      libraryFirstPageKey(libraryFirstPageParams("movie", "title", "asc", { audio_lang: "en" }))
    );
  });
});
