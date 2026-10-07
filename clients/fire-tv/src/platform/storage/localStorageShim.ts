/**
 * The problem this file exists to solve, precisely (design doc §4.6):
 * `@playarr-tv/device-auth`'s `TokenStore`, `getOrCreateDeviceId`, and
 * `@playarr-tv/domain`'s `getStoredApiBaseUrl`/`setStoredApiBaseUrl` (and,
 * later, `knownServers.ts`'s peer-group bookkeeping) all guard themselves
 * with `if (typeof localStorage === "undefined") return undefined;` before
 * touching it. That guard exists so those modules degrade gracefully on a
 * runtime that genuinely has no persistent storage (a legacy TV WebKit
 * engine, SSR, a unit test). Under Hermes, `localStorage` is *always*
 * undefined -- there is no such global on Vega at all -- so every one of
 * those modules would silently and permanently take their in-memory
 * fallback path. The visible symptom would be exactly the kind of bug that
 * takes weeks to notice and longer to diagnose: linking appears to work,
 * the app runs fine all session, and then a restart forgets the server and
 * the session entirely, because nothing was ever actually persisted.
 *
 * The fix is to make `globalThis.localStorage` genuinely exist before any
 * of that code runs, backed by real storage -- so this file supplies a
 * synchronous `Storage`-shaped facade over a plain in-memory `Map`, and a
 * `hydrateLocalStorage()` step that fills that Map from
 * `@amazon-devices/react-native-async-storage__async-storage` (the only
 * persistence primitive Vega actually offers) before the app's first
 * render. `Storage`'s own contract is synchronous
 * (`getItem`/`setItem`/`removeItem` all return immediately, no Promise) but
 * AsyncStorage's is not, which is exactly why hydration has to happen once,
 * up front, and why every write after that goes to the Map immediately
 * (satisfying the synchronous contract) and to AsyncStorage write-behind
 * (fire-and-forget, logged rather than thrown on failure -- AsyncStorage is
 * unencrypted, non-transactional, app-private storage with no durability
 * guarantee stronger than "best effort").
 *
 * Deliberately decoupled from any real storage package: this module never
 * imports `@amazon-devices/react-native-async-storage__async-storage`
 * itself (`storage/asyncStorage.ts`, one file over, is the only place that
 * does -- see its own comment for why the split matters). Every function
 * here takes an `AsyncStorageLike` parameter instead, so its own tests can
 * inject a trivial in-memory fake and cover every real code path with zero
 * native module, zero Vega, and zero risk of a jest.mock() double for the
 * real package quietly drifting out of sync with what production actually
 * does.
 */

/**
 * The slice of `@amazon-devices/react-native-async-storage__async-storage`'s
 * default export this module actually calls. Kept intentionally narrow
 * (four methods, not the full AsyncStorage surface) so an injected fake in
 * a test is a few lines of `Map` plumbing, not a mock of an entire package.
 */
export interface AsyncStorageLike {
  getAllKeys(): Promise<readonly string[]>;
  multiGet(keys: readonly string[]): Promise<ReadonlyArray<readonly [string, string | null]>>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Only keys under one of these prefixes are ever written back to
 * AsyncStorage; every other `localStorage` key some incidental library call
 * might set lives in the in-memory Map for the app's lifetime and nowhere
 * else. These prefixes are the ones the shared code already uses --
 * `playarr:` for the shared @playarr-tv/* packages (`playarr:session`,
 * `playarr:knownServerGroup`, `playarr:deviceId`, `playarr:apiBaseUrl`; the
 * packages used `streamarr:` before the rename, which stays allowed so an
 * old install keeps its data)
 * and `playarr.` for fire-tv's own future profile-session bookkeeping
 * (`playarr.profileSessions.v4`, `playarr.currentUserName`, matching design
 * doc §5.4's table) -- kept as an explicit allowlist rather than persisting
 * everything, so this shim can never accidentally start writing some
 * unrelated library's scratch state into a Fire TV Stick's limited flash.
 */
const PERSISTED_PREFIXES = ['streamarr:', 'playarr:', 'playarr.'] as const;

function isPersistedKey(key: string): boolean {
  return PERSISTED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

// Module-level, not a field on some instance: there is exactly one
// `localStorage` for the whole app, the same way there is exactly one real
// browser `localStorage` per origin. Mirrors the reasoning in
// `@playarr-tv/device-auth`'s `tokenStore.ts` for its own module-level
// `memoryFallback` -- see that file's comment for the multi-instance bug it
// heads off.
let store = new Map<string, string>();
let hydrated = false;

function writeBehind(asyncStorage: AsyncStorageLike, key: string, value: string | undefined): void {
  if (!isPersistedKey(key)) return;
  const write = value === undefined ? asyncStorage.removeItem(key) : asyncStorage.setItem(key, value);
  write.catch((error: unknown) => {
    // Logged, never thrown: `setItem`/`removeItem` on the Storage interface
    // are synchronous and return void, so there is no caller left to
    // propagate a rejected write-behind promise to by the time it settles.
    console.warn(`[localStorageShim] write-behind failed for "${key}"`, error);
  });
}

function buildShim(asyncStorage: AsyncStorageLike): Storage {
  return {
    get length(): number {
      return store.size;
    },
    clear(): void {
      const keys = Array.from(store.keys());
      store.clear();
      for (const key of keys) writeBehind(asyncStorage, key, undefined);
    },
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      store.delete(key);
      writeBehind(asyncStorage, key, undefined);
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
      writeBehind(asyncStorage, key, value);
    },
  };
}

/**
 * Reads every persisted key out of `asyncStorage` into the in-memory Map
 * and installs the synchronous shim on `globalThis.localStorage`. Must be
 * awaited before the first render (`src/bootstrap/hydrate.ts` is the one
 * caller that matters) -- any `@playarr-tv/device-auth` or
 * `@playarr-tv/domain` code that runs before this resolves would see an
 * empty store and behave as a fresh install even when a real session
 * exists on disk.
 *
 * Idempotent: a second call is a no-op rather than re-reading AsyncStorage
 * and clobbering whatever's been written to the Map since the first
 * hydration (a defensive double-invocation -- e.g. Fast Refresh re-running
 * App.tsx's top level -- must not resurrect a just-deleted session key).
 */
export async function hydrateLocalStorage(asyncStorage: AsyncStorageLike): Promise<void> {
  if (hydrated) return;

  const allKeys = await asyncStorage.getAllKeys();
  const persistedKeys = allKeys.filter(isPersistedKey);
  // Vega's AsyncStorage rejects multiGet([]) ("At least one key is needed"),
  // which is exactly what a first launch asks for.
  const pairs = persistedKeys.length > 0 ? await asyncStorage.multiGet(persistedKeys) : [];

  const nextStore = new Map<string, string>();
  for (const [key, value] of pairs) {
    if (value !== null) nextStore.set(key, value);
  }
  store = nextStore;

  globalThis.localStorage = buildShim(asyncStorage);
  hydrated = true;
}

/**
 * Test-only escape hatch: resets the module-level hydration flag so a
 * second test file (or a second test within one file) can call
 * `hydrateLocalStorage` again against a fresh fake and observe a clean
 * slate, without the idempotence guard above treating it as a repeat call
 * within the same app session. Never called from application code.
 */
export function resetLocalStorageShimForTests(): void {
  store = new Map<string, string>();
  hydrated = false;
}
