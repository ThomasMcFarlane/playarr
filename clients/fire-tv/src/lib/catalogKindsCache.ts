/**
 * A Vega-specific port of `clients/tv-web/web/src/lib/catalogKindsCache.ts`,
 * not a verbatim reuse -- unlike `@playarr-tv/api-client/react`'s hooks
 * (plain, DOM-free TypeScript that runs unmodified on Hermes), the web
 * version's own storage lookup is written against `window.localStorage`
 * specifically, and that specific path does not carry over here even though
 * this app DOES have a working `localStorage`-shaped global by the time any
 * screen renders.
 *
 * The reason is `src/bootstrap/polyfills.ts`'s own `window` shim: it
 * installs `globalThis.window = {fetch}` (a deliberately partial object, for
 * Shaka Player's benefit) rather than declining to touch `window` at all.
 * That means the web version's `typeof window === "undefined" ?
 * undefined : window.localStorage` guard does NOT fall through the way it
 * would on a runtime with no `window` whatsoever -- `window` genuinely
 * exists here, so the ternary takes its second branch and evaluates
 * `window.localStorage`, which is `undefined` (the shim never puts anything
 * there). The genuinely-hydrated `Storage` facade this app has lives at
 * `globalThis.localStorage` instead (`src/platform/storage/
 * localStorageShim.ts`'s `hydrateLocalStorage`, awaited before first render
 * by `src/bootstrap/hydrate.ts`) -- so this port reads THAT global directly,
 * unguarded by any `window` check, rather than copying a guard whose
 * conditions no longer describe this runtime correctly.
 *
 * Everything else -- the storage key, the "only cache these five known
 * kinds" allow-list, the scope-string derivation (per profile id + sorted,
 * de-duplicated server URL set, so switching profiles or servers never leaks
 * one household member's nav-kind cache into another's), and the
 * defensive JSON parsing -- is unchanged from the web version, because none
 * of that logic is DOM-specific; it is exactly the kind of pure,
 * `Storage`-shaped logic that ports across every Playarr client without
 * needing its own screen-shaped opinion.
 *
 * What this cache is FOR: `GET /api/v1/catalog/kinds` tells the app which of
 * movie/series/site/artist/author the connected server actually has
 * anything in (so the nav rail's library group doesn't offer a "Series" tab
 * to a server with no series at all -- design doc §7's closing paragraph).
 * That's one more round trip before the nav rail can render correctly on
 * every cold start; caching the last-known answer per profile+server-set
 * lets the rail render immediately from a very likely-still-correct guess,
 * with the real network response silently correcting it a moment later
 * rather than the rail visibly flickering every single launch.
 */
import type {WorkKind} from '@playarr-tv/api-client';

const CATALOG_KINDS_STORAGE_KEY = 'playarr.catalogKinds.v1';

/**
 * The only `WorkKind` values this cache will ever persist -- kept as an
 * explicit allow-list (rather than trusting whatever is in `Storage` at that
 * key) so a future, wider `WorkKind` union, or a foreign value written by
 * some other app sharing the same AsyncStorage-backed key namespace, can
 * never resurrect as a nav-rail entry that doesn't actually correspond to a
 * kind this app understands.
 */
const WORK_KINDS: ReadonlySet<string> = new Set(['movie', 'series', 'site', 'artist', 'author']);

type StoredCatalogKinds = Record<string, WorkKind[]>;

/**
 * The hydrated Vega storage shim, or `undefined` if `hydrateLocalStorage()`
 * hasn't run yet (a defensive guard, not an expected runtime state --
 * `src/bootstrap/hydrate.ts` awaits hydration before the app's first render,
 * so every real call site sees the shim already installed; this guard only
 * matters for a stray call that somehow races that sequencing, or a test
 * that imports this module without going through `jest.setup.ts`'s own
 * polyfill chain first).
 */
function platformLocalStorage(): Storage | undefined {
  return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage;
}

function isWorkKind(value: unknown): value is WorkKind {
  return typeof value === 'string' && WORK_KINDS.has(value);
}

function readStore(storage: Storage): StoredCatalogKinds {
  try {
    const raw = storage.getItem(CATALOG_KINDS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as StoredCatalogKinds)
      : {};
  } catch {
    // Corrupt JSON under this key behaves as "nothing cached yet" -- the
    // caller falls back to a real GET /api/v1/catalog/kinds instead.
    return {};
  }
}

/**
 * Derives a stable cache key from a profile id and the server-address set
 * the profile is currently reachable through, so the same profile linked to
 * two different Streamarr deployments (or two different profiles sharing
 * one device) never read each other's cached kinds. `null` when there is no
 * signed-in profile yet -- there is nothing meaningful to scope a cache
 * entry to before that point.
 */
export function createCatalogKindsCacheScope(
  userId: string | undefined,
  serverUrls: ReadonlyArray<string>
): string | null {
  if (!userId) return null;
  return JSON.stringify([userId, [...new Set(serverUrls)].sort()]);
}

/**
 * Reads back a previously-cached kind set for `scope`, or `null` when there
 * is nothing usable cached (no scope, no storage, nothing written yet, or a
 * value that fails the `isWorkKind` allow-list check). Accepts an injectable
 * `Storage` (defaulting to the real hydrated Vega shim) purely so this
 * module's own tests can exercise every branch against a trivial in-memory
 * fake, with no dependency on `jest.setup.ts`'s AsyncStorage double or
 * `hydrateLocalStorage` having actually run.
 */
export function readCachedCatalogKinds(
  scope: string | null,
  storage: Storage | undefined = platformLocalStorage()
): ReadonlySet<WorkKind> | null {
  if (!scope || !storage) return null;
  const kinds = readStore(storage)[scope];
  if (!Array.isArray(kinds) || !kinds.every(isWorkKind)) return null;
  return new Set(kinds);
}

/**
 * Persists `kinds` under `scope`, de-duplicated and filtered through the
 * same `isWorkKind` allow-list `readCachedCatalogKinds` checks on the way
 * back out. A missing scope or storage is a silent no-op -- exactly like
 * the web version, this cache is a pure optimisation; a nav rail that can't
 * write to it still renders correctly from the next real
 * `GET /api/v1/catalog/kinds` response, just without the instant-on guess.
 */
export function writeCachedCatalogKinds(
  scope: string | null,
  kinds: Iterable<WorkKind>,
  storage: Storage | undefined = platformLocalStorage()
): void {
  if (!scope || !storage) return;
  try {
    const stored = readStore(storage);
    stored[scope] = [...new Set(kinds)].filter(isWorkKind);
    storage.setItem(CATALOG_KINDS_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Same posture as the web version: a full AsyncStorage-backed Map that
    // somehow throws on write-behind still leaves navigation working off
    // the live API response, just without the cache speeding up next time.
  }
}
