import { describe, expect, it } from "vitest";
import { ARTWORK_SIZE_STORAGE_KEY, parseArtworkSize, readArtworkSize } from "./artworkSize";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("artwork size setting", () => {
  it("defaults to medium and ignores junk", () => {
    expect(readArtworkSize(memory())).toBe("medium");
    expect(readArtworkSize(memory({ [ARTWORK_SIZE_STORAGE_KEY]: "huge" }))).toBe("medium");
    expect(parseArtworkSize("large")).toBe("large");
    expect(parseArtworkSize(null)).toBeUndefined();
  });

  it("reads the saved size", () => {
    expect(readArtworkSize(memory({ [ARTWORK_SIZE_STORAGE_KEY]: "small" }))).toBe("small");
  });

  it("adopts an old per-kind Library size once", () => {
    const storage = memory({ "playarr.artworkSize.series": "large" });
    expect(readArtworkSize(storage)).toBe("large");
    expect(storage.getItem(ARTWORK_SIZE_STORAGE_KEY)).toBe("large");
    expect(readArtworkSize(storage)).toBe("large");
  });
});
