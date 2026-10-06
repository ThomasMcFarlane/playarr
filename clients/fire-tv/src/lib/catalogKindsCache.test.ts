/**
 * Mirrors `clients/tv-web/web/src/lib/catalogKindsCache.test.ts`'s three
 * cases exactly (this module's behaviour is unchanged from that version
 * apart from which global it reads -- see this module's own top comment),
 * plus one Vega-specific case: that the real `globalThis.localStorage`
 * default parameter is read lazily (at call time), not captured once at
 * import time, since `hydrateLocalStorage()` installs that global well
 * after this module has already been imported by whatever screen uses it.
 */
import {
  createCatalogKindsCacheScope,
  readCachedCatalogKinds,
  writeCachedCatalogKinds,
} from './catalogKindsCache';

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

describe('catalogue-kind navigation cache', () => {
  it("restores a profile's navigation kinds independent of server order", () => {
    const storage = createMemoryStorage();
    const writtenScope = createCatalogKindsCacheScope('user-1', [
      'https://two.example',
      'https://one.example',
    ]);
    const readScope = createCatalogKindsCacheScope('user-1', [
      'https://one.example',
      'https://two.example',
    ]);

    writeCachedCatalogKinds(writtenScope, ['movie', 'series', 'movie'] as const, storage);

    expect(Array.from(readCachedCatalogKinds(readScope, storage)!)).toEqual(['movie', 'series']);
  });

  it('does not reuse navigation kinds across profiles or server sets', () => {
    const storage = createMemoryStorage();
    const scope = createCatalogKindsCacheScope('user-1', ['https://one.example']);
    writeCachedCatalogKinds(scope, ['site'] as const, storage);

    expect(
      readCachedCatalogKinds(createCatalogKindsCacheScope('user-2', ['https://one.example']), storage)
    ).toBeNull();
    expect(
      readCachedCatalogKinds(createCatalogKindsCacheScope('user-1', ['https://two.example']), storage)
    ).toBeNull();
  });

  it('ignores corrupt cached data', () => {
    const storage = createMemoryStorage();
    const scope = createCatalogKindsCacheScope('user-1', ['https://one.example']);
    storage.setItem('playarr.catalogKinds.v1', JSON.stringify({[scope!]: ['podcast']}));

    expect(readCachedCatalogKinds(scope, storage)).toBeNull();
  });

  it('falls back to globalThis.localStorage (hydrated after this module is imported) when no storage is passed explicitly', () => {
    const fake = createMemoryStorage();
    // Simulates hydrateLocalStorage() installing the shim well after this
    // module (and its default-parameter expression) were first evaluated --
    // if platformLocalStorage() captured the global eagerly at import time
    // instead of reading it lazily inside the function body, this
    // assignment happening "too late" would make the assertions below fail.
    (globalThis as {localStorage?: Storage}).localStorage = fake;

    const scope = createCatalogKindsCacheScope('user-1', ['https://one.example']);
    writeCachedCatalogKinds(scope, ['movie', 'artist'] as const);

    expect(Array.from(readCachedCatalogKinds(scope)!).sort()).toEqual(['artist', 'movie']);

    delete (globalThis as {localStorage?: Storage}).localStorage;
  });

  it('treats a missing globalThis.localStorage as "nothing cached" rather than throwing', () => {
    delete (globalThis as {localStorage?: Storage}).localStorage;
    const scope = createCatalogKindsCacheScope('user-1', ['https://one.example']);

    expect(() => writeCachedCatalogKinds(scope, ['movie'] as const)).not.toThrow();
    expect(readCachedCatalogKinds(scope)).toBeNull();
  });
});
