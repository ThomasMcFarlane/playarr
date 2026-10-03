import { describe, expect, it } from "vitest";
import {
  LIBRARY_CHUNK_SIZE,
  libraryChunkRanges,
  sameLibraryChunkItems,
} from "./libraryChunks";

describe("libraryChunkRanges", () => {
  it("covers the mounted prefix with fixed-size chunks and a short tail", () => {
    expect(libraryChunkRanges(50, 24)).toEqual([
      { chunk: 0, start: 0, end: 24 },
      { chunk: 1, start: 24, end: 48 },
      { chunk: 2, start: 48, end: 50 },
    ]);
  });

  it("is empty when nothing is mounted", () => {
    expect(libraryChunkRanges(0)).toEqual([]);
  });

  it("uses a chunk size divisible by every supported column count", () => {
    for (const cols of [1, 2, 3, 4, 6, 8]) expect(LIBRARY_CHUNK_SIZE % cols).toBe(0);
  });
});

describe("sameLibraryChunkItems", () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ id: i }));

  it("treats an appended catalogue page as no change for earlier chunks", () => {
    const appended = [...items, { id: 100 }, { id: 101 }];
    expect(
      sameLibraryChunkItems(
        { items, start: 24, end: 48 },
        { items: appended, start: 24, end: 48 }
      )
    ).toBe(true);
  });

  it("detects a changed work inside the chunk", () => {
    const edited = items.slice();
    edited[30] = { id: 999 };
    expect(
      sameLibraryChunkItems(
        { items, start: 24, end: 48 },
        { items: edited, start: 24, end: 48 }
      )
    ).toBe(false);
  });

  it("detects a range change", () => {
    expect(
      sameLibraryChunkItems({ items, start: 48, end: 72 }, { items, start: 48, end: 60 })
    ).toBe(false);
  });
});
