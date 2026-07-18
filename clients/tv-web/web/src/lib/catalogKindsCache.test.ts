import { describe, expect, it } from "vitest";
import {
  createCatalogKindsCacheScope,
  readCachedCatalogKinds,
  writeCachedCatalogKinds,
} from "./catalogKindsCache";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  } as Storage;
}

describe("catalogue-kind navigation cache", () => {
  it("restores a profile's navigation kinds independent of server order", () => {
    const storage = createMemoryStorage();
    const writtenScope = createCatalogKindsCacheScope("user-1", [
      "https://two.example",
      "https://one.example",
    ]);
    const readScope = createCatalogKindsCacheScope("user-1", [
      "https://one.example",
      "https://two.example",
    ]);

    writeCachedCatalogKinds(
      writtenScope,
      ["movie", "series", "movie"] as const,
      storage
    );

    expect(Array.from(readCachedCatalogKinds(readScope, storage)!)).toEqual([
      "movie",
      "series",
    ]);
  });

  it("does not reuse navigation kinds across profiles or server sets", () => {
    const storage = createMemoryStorage();
    const scope = createCatalogKindsCacheScope("user-1", ["https://one.example"]);
    writeCachedCatalogKinds(scope, ["site"] as const, storage);

    expect(
      readCachedCatalogKinds(
        createCatalogKindsCacheScope("user-2", ["https://one.example"]),
        storage
      )
    ).toBeNull();
    expect(
      readCachedCatalogKinds(
        createCatalogKindsCacheScope("user-1", ["https://two.example"]),
        storage
      )
    ).toBeNull();
  });

  it("ignores corrupt cached data", () => {
    const storage = createMemoryStorage();
    const scope = createCatalogKindsCacheScope("user-1", ["https://one.example"]);
    storage.setItem("playarr.catalogKinds.v1", JSON.stringify({ [scope!]: ["podcast"] }));

    expect(readCachedCatalogKinds(scope, storage)).toBeNull();
  });
});
