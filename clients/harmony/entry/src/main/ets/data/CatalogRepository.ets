/**
 * The only place any `pages/` code calls for catalogue data: browsing,
 * search, work detail, similar-titles, saved views and the Home screen's
 * continue-watching rail (brief section 4.8, "Catalog"). Every function
 * here wraps the single `PlayarrClient` instance from `AppContainer.ets`
 * (`getPlayarrClient`) -- this file never constructs its own
 * `PlayarrClient`, never imports `net/HttpTransport.ets` directly, and
 * never touches `@kit.NetworkKit`.
 *
 * Every function resolves to an `ApiResult<T>` (`net/ApiResult.ets`) and
 * never throws: `PlayarrClient` already guarantees that end to end, so
 * this file only ever re-shapes an already-decoded body (e.g. `CatalogPage`'s
 * `available_on` object into a real `Map`), it never re-implements retry or
 * error handling of its own.
 *
 * Be additive-tolerant, matching brief 4.8: every decode below is a plain
 * `JSON.parse(...) as T` (done once, inside `PlayarrClient`), so a field
 * this file does not know about yet is simply never read -- it can never
 * turn an otherwise-successful response into a failure.
 *
 * Endpoints covered, each backed by its own `core/Endpoints.ts` path
 * function so this file never hand-writes an `"/api/..."` literal:
 * - `GET /api/v1/catalog` -- `getCatalog(...)`. ALWAYS sends
 *   `available_only=true` regardless of what a caller's `BrowseQuery` asks
 *   for -- brief 4.8 is explicit this is required (the server default is
 *   `false`).
 * - `GET /api/v1/catalog/kinds` -- `getCatalogKinds()`. Nav destinations
 *   must be driven from this response, never from a hard-coded kind list.
 * - `GET /api/v1/catalog/search` -- `searchCatalog(...)`. Returns a
 *   `SearchResult`, deliberately NOT a `CatalogPage` (no `total`, no
 *   `available_on`).
 * - `GET /api/v1/catalog/{id}` -- `getWorkDetail(...)`.
 * - `GET /api/v1/catalog/{id}/similar` -- `getSimilarWorks(...)`. A 404 is
 *   the NORMAL case (no cached embedding), not an error: falls back to up
 *   to 3 genre queries against `getCatalog(...)`, merged and ranked by
 *   `core/SimilarScore.ts`.
 * - `GET /api/v1/views` / `GET /api/v1/views/{id}/resolve` --
 *   `getViews()` / `resolveView(...)`.
 * - `GET /api/v1/playback/progress` -- `getContinueWatching()`. Hydrates up
 *   to 10 `part_watched` works via `getWorkDetail(...)` each, ranked by
 *   `core/WatchProgressSort.ts`. An empty result is a legitimate outcome
 *   (restricted libraries silently drop rows server-side), never a bug.
 */

import { getPlayarrClient } from '../AppContainer';
import { ApiOk, ApiResult, isApiOk } from '../net/ApiResult';

import {
  catalogUrl,
  catalogKindsUrl,
  catalogSearchUrl,
  catalogDetailUrl,
  catalogSimilarUrl,
  viewsUrl,
  viewResolveUrl,
  playbackProgressListUrl,
} from '../core/Endpoints.ts';
import { catalogPageSize, searchLimit, similarLimit } from '../core/AppConfig.ts';
import { rankSimilarCandidates } from '../core/SimilarScore.ts';
import { selectContinueWatching } from '../core/WatchProgressSort.ts';

import {
  AvailabilityBadge,
  RemoteOnlyWork,
  Work,
} from '../core/Types/Work.ts';
import { WorkDetail } from '../core/Types/WorkDetail.ts';
import {
  BrowseQuery,
  CatalogPage,
  SearchResult,
  ViewSummary,
  WorkKind,
} from '../core/Types/Catalog.ts';
import { WatchProgress } from '../core/Types/Playback.ts';

/**
 * Up to this many `genre` queries are issued when `getSimilarWorks` falls
 * back off a 404 (brief 4.8: "up to 3 genre queries").
 */
const MAX_SIMILAR_FALLBACK_GENRE_QUERIES: number = 3;

/**
 * Up to this many `part_watched` rows are hydrated for the Home screen's
 * continue-watching rail (brief 4.8: "hydrating up to 10 part_watched
 * works").
 */
const MAX_CONTINUE_WATCHING_ENTRIES: number = 10;

/**
 * The wire shape of `GET /api/v1/catalog` / `GET /api/v1/views/{id}/resolve`
 * exactly as `JSON.parse` produces it: `available_on` arrives as a plain
 * `{[work_id]: AvailabilityBadge[]}` object, never a real `Map` (JSON has no
 * Map literal). Kept private to this file -- `decodeCatalogPage` below is
 * the only place that ever sees this shape; every other caller only ever
 * sees the real `CatalogPage` (`available_on: Map<...>`).
 */
interface CatalogPageWire {
  items: Work[];
  total: number | null;
  available_on: Object;
  remote_only: RemoteOnlyWork[];
}

/**
 * A continue-watching row: one `WatchProgress` record plus the `Work` it
 * refers to, hydrated via `getWorkDetail`. `work` carries the display data
 * (title, genres, kind, availability) the raw `WatchProgress` row does not
 * -- artwork itself is resolved separately, by `data/ArtworkRepository.ets`,
 * keyed off `progress.work_id`.
 */
export interface ContinueWatchingEntry {
  progress: WatchProgress;
  work: Work;
}

/**
 * Converts the raw `{[work_id]: AvailabilityBadge[]}` JSON object into a
 * real `Map`, via `Object.keys(...)` plus `Reflect.get(...)` -- never a
 * `for...in` loop and never `obj[key]` bracket-literal access, both banned
 * ArkTS constructs. `Reflect.get` accepts a dynamic (non-literal) key, so it
 * is not the banned "bracket property access" shape either.
 */
function decodeAvailableOn(raw: Object): Map<string, AvailabilityBadge[]> {
  const result = new Map<string, AvailabilityBadge[]>();
  const keys = Object.keys(raw);
  for (const key of keys) {
    const value = Reflect.get(raw, key) as AvailabilityBadge[];
    result.set(key, value);
  }
  return result;
}

function decodeCatalogPage(wire: CatalogPageWire): CatalogPage {
  const page: CatalogPage = {
    items: wire.items,
    total: wire.total,
    available_on: decodeAvailableOn(wire.available_on),
    remote_only: wire.remote_only,
  };
  return page;
}

/**
 * Re-shapes an `ApiResult<CatalogPageWire>` into an `ApiResult<CatalogPage>`
 * -- a failure passes through completely unchanged (there is nothing to
 * decode), only the success case's `available_on` is ever touched.
 */
function mapCatalogPageResult(result: ApiResult<CatalogPageWire>): ApiResult<CatalogPage> {
  if (isApiOk(result)) {
    const ok: ApiOk<CatalogPage> = { kind: 'ok', status: result.status, value: decodeCatalogPage(result.value) };
    return ok;
  }
  return result;
}

function appendQueryPart(parts: string[], key: string, value: string): void {
  parts.push(key + '=' + encodeURIComponent(value));
}

function queryStringFromParts(parts: string[]): string {
  if (parts.length === 0) {
    return '';
  }
  return '?' + parts.join('&');
}

/**
 * Builds the `GET /api/v1/catalog` query string. `available_only=true` is
 * ALWAYS appended, regardless of `query.available_only` -- brief 4.8:
 * "Playarr must send `available_only=true`", the server default is `false`,
 * and this is the one place that guarantee is enforced for every caller.
 * `limit` defaults to `catalogPageSize` (50), `offset` to 0, matching the
 * server's own documented defaults.
 */
function buildBrowseQueryString(query: BrowseQuery): string {
  const parts: string[] = [];
  if (query.kind !== undefined) {
    appendQueryPart(parts, 'kind', query.kind);
  }
  appendQueryPart(parts, 'available_only', 'true');
  if (query.source_instance_id !== undefined) {
    appendQueryPart(parts, 'source_instance_id', query.source_instance_id);
  }
  if (query.genre !== undefined) {
    appendQueryPart(parts, 'genre', query.genre);
  }
  if (query.tag !== undefined) {
    appendQueryPart(parts, 'tag', query.tag);
  }
  if (query.sort !== undefined) {
    appendQueryPart(parts, 'sort', query.sort);
  }
  if (query.order !== undefined) {
    appendQueryPart(parts, 'order', query.order);
  }
  const limit = query.limit !== undefined ? query.limit : catalogPageSize;
  appendQueryPart(parts, 'limit', String(limit));
  const offset = query.offset !== undefined ? query.offset : 0;
  appendQueryPart(parts, 'offset', String(offset));
  return queryStringFromParts(parts);
}

/**
 * `GET /api/v1/catalog` (brief 4.8). `query.available_only` is ignored --
 * see `buildBrowseQueryString`'s doc comment -- `true` is always sent.
 */
export async function getCatalog(query: BrowseQuery): Promise<ApiResult<CatalogPage>> {
  const path = catalogUrl() + buildBrowseQueryString(query);
  const result = await getPlayarrClient().getJson<CatalogPageWire>(path);
  return mapCatalogPageResult(result);
}

/**
 * `GET /api/v1/catalog/kinds` (brief 4.8): only the kinds actually backed by
 * a configured, allowed source instance. Nav destinations must be driven
 * from this response -- never a hard-coded `WorkKind[]` list.
 */
export function getCatalogKinds(): Promise<ApiResult<WorkKind[]>> {
  return getPlayarrClient().getJson<WorkKind[]>(catalogKindsUrl());
}

/**
 * `GET /api/v1/catalog/search?q=&limit=` (brief 4.8). `limit` defaults to
 * `searchLimit` (25). Resolves to a `SearchResult` -- deliberately NOT a
 * `CatalogPage`, so there is no `total`/`available_on` to decode here.
 */
export function searchCatalog(query: string, limit?: number): Promise<ApiResult<SearchResult>> {
  const effectiveLimit = limit !== undefined ? limit : searchLimit;
  const parts: string[] = [];
  appendQueryPart(parts, 'q', query);
  appendQueryPart(parts, 'limit', String(effectiveLimit));
  const path = catalogSearchUrl() + queryStringFromParts(parts);
  return getPlayarrClient().getJson<SearchResult>(path);
}

/** `GET /api/v1/catalog/{id}` (brief 4.8). */
export function getWorkDetail(id: string): Promise<ApiResult<WorkDetail>> {
  return getPlayarrClient().getJson<WorkDetail>(catalogDetailUrl(id));
}

/**
 * `GET /api/v1/views` (brief 4.8).
 */
export function getViews(): Promise<ApiResult<ViewSummary[]>> {
  return getPlayarrClient().getJson<ViewSummary[]>(viewsUrl());
}

/**
 * `GET /api/v1/views/{id}/resolve?limit=&offset=` (brief 4.8). Resolves to
 * a real `CatalogPage`, unlike `searchCatalog`.
 */
export async function resolveView(id: string, limit?: number, offset?: number): Promise<ApiResult<CatalogPage>> {
  const parts: string[] = [];
  if (limit !== undefined) {
    appendQueryPart(parts, 'limit', String(limit));
  }
  if (offset !== undefined) {
    appendQueryPart(parts, 'offset', String(offset));
  }
  const path = viewResolveUrl(id) + queryStringFromParts(parts);
  const result = await getPlayarrClient().getJson<CatalogPageWire>(path);
  return mapCatalogPageResult(result);
}

/**
 * Merges every genre query's `items` into one de-duplicated (by `Work.id`)
 * list, excluding `target` itself. A `Map<string, Work>` is used purely as
 * an insertion-order-preserving de-dupe set keyed by id -- iteration order
 * does not matter here, `rankSimilarCandidates` re-sorts the result anyway.
 */
function mergeGenreCandidates(target: Work, pages: CatalogPage[]): Work[] {
  const merged = new Map<string, Work>();
  for (const page of pages) {
    for (const candidate of page.items) {
      if (candidate.id === target.id) {
        continue;
      }
      merged.set(candidate.id, candidate);
    }
  }
  const mergedList: Work[] = [];
  merged.forEach((work: Work): void => {
    mergedList.push(work);
  });
  return mergedList;
}

/**
 * The brief-4.8 similar-titles fallback: up to `MAX_SIMILAR_FALLBACK_GENRE_QUERIES`
 * of `target`'s own genres, each queried separately against `getCatalog`
 * (which -- via `buildBrowseQueryString` -- still always sends
 * `available_only=true`), merged, ranked by `core/SimilarScore.ts` and
 * capped at `limit`. A single genre query that itself fails is skipped
 * rather than sinking the whole fallback -- this path only runs because the
 * primary `similar` endpoint already 404'd, so a partial result here is
 * still strictly better than none. `target.genres` being empty (so no
 * queries are ever issued) legitimately resolves to an empty list, exactly
 * like brief 4.8's other "empty is not a bug" cases.
 */
async function getSimilarByGenreFallback(target: Work, limit: number): Promise<ApiResult<Work[]>> {
  const genresToQuery = target.genres.slice(0, MAX_SIMILAR_FALLBACK_GENRE_QUERIES);
  const pages: CatalogPage[] = [];

  for (const genre of genresToQuery) {
    const query: BrowseQuery = { genre: genre, limit: limit };
    const pageResult = await getCatalog(query);
    if (isApiOk(pageResult)) {
      pages.push(pageResult.value);
    }
  }

  const merged = mergeGenreCandidates(target, pages);
  const ranked = rankSimilarCandidates(target, merged);
  const sliced = ranked.slice(0, limit);
  const ok: ApiOk<Work[]> = { kind: 'ok', status: 200, value: sliced };
  return ok;
}

/**
 * `GET /api/v1/catalog/{id}/similar?limit=` (brief 4.8). `limit` defaults to
 * `similarLimit` (20). A 404 is the NORMAL case -- no cached embedding for
 * this work -- and is never surfaced as a failure to the caller: it instead
 * triggers `getSimilarByGenreFallback`. Any other failure (network failure,
 * a non-404 HTTP failure) passes straight through unchanged.
 *
 * `target` is the `Work` being viewed (typically `WorkDetail.work` from an
 * already-fetched `getWorkDetail` call) -- this function never re-fetches
 * it, since the fallback path needs its `genres`/`kind`/`sort_title` fields
 * for scoring and the caller already has them in hand.
 */
export async function getSimilarWorks(target: Work, limit?: number): Promise<ApiResult<Work[]>> {
  const effectiveLimit = limit !== undefined ? limit : similarLimit;
  const parts: string[] = [];
  appendQueryPart(parts, 'limit', String(effectiveLimit));
  const path = catalogSimilarUrl(target.id) + queryStringFromParts(parts);

  const result = await getPlayarrClient().getJson<Work[]>(path);
  if (isApiOk(result)) {
    return result;
  }
  if (result.kind === 'http_failure' && result.status === 404) {
    return getSimilarByGenreFallback(target, effectiveLimit);
  }
  return result;
}

/**
 * The Home screen's continue-watching rail (brief 4.8 / 4.12): lists
 * `GET /api/v1/playback/progress`, selects/dedupes/caps it via
 * `core/WatchProgressSort.ts#selectContinueWatching`, then hydrates each
 * surviving row's `Work` via `getWorkDetail`. A row whose work has since
 * become inaccessible (a restricted library silently dropping it, a
 * deleted title, ...) is quietly skipped rather than failing the whole
 * rail -- an empty (or shorter) result is a legitimate policy outcome here,
 * never a bug.
 */
export async function getContinueWatching(): Promise<ApiResult<ContinueWatchingEntry[]>> {
  const progressResult = await getPlayarrClient().getJson<WatchProgress[]>(playbackProgressListUrl());
  if (!isApiOk(progressResult)) {
    return progressResult;
  }

  const selected = selectContinueWatching(progressResult.value, MAX_CONTINUE_WATCHING_ENTRIES);
  const entries: ContinueWatchingEntry[] = [];

  for (const progress of selected) {
    const detailResult = await getWorkDetail(progress.work_id);
    if (isApiOk(detailResult)) {
      const entry: ContinueWatchingEntry = { progress: progress, work: detailResult.value.work };
      entries.push(entry);
    }
  }

  const ok: ApiOk<ContinueWatchingEntry[]> = { kind: 'ok', status: progressResult.status, value: entries };
  return ok;
}
