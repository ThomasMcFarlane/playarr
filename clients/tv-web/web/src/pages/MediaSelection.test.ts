import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mediaPageSources = [
  "./Home.tsx",
  "./Library.tsx",
  "./MusicDetail.tsx",
  "./Playlists.tsx",
  "./Search.tsx",
  "./WorkDetail.tsx",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

describe("media selection", () => {
  it("does not change the selected media item when the pointer only hovers", () => {
    for (const source of mediaPageSources) {
      expect(source).not.toContain("onMouseEnter");
    }
  });
});
