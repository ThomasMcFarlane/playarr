/**
 * The only place any `pages/` code resolves artwork BYTES (brief section
 * 4.9, "Artwork"). `Work.images[].url` must NEVER be fetched directly --
 * those are provider or `*arr`-internal locators this client cannot
 * authenticate against (an `*arr`-hosted one needs an API key the client
 * does not have). Instead, every artwork pixel a page ever shows comes from
 * one of the three bearer-gated byte endpoints below, resolved through this
 * file:
 *
 * - `GET /api/v1/artwork/work/{work_id}/{kind}` -- `fetchWorkArtwork(...)`.
 * - `GET /api/v1/artwork/album/{artist_work_id}/{album_id}/{kind}` --
 *   `fetchAlbumArtwork(...)`.
 * - `GET /api/v1/media/{media_file_id}/thumbnail?position_ms=` --
 *   `fetchMediaThumbnail(...)`, for chapter cards and on-deck episode art.
 *
 * `{kind}` is always one of the lowercase `ImageKind` values (`poster`,
 * `backdrop`, `banner`, `logo`, `thumb`) from `core/Types/Work.ts`.
 *
 * Because these endpoints require an `Authorization` header, ArkUI's
 * `Image()` component cannot load them from a URL string the way it loads
 * an ordinary resource. The pipeline here is instead:
 * 1. `net/HttpTransport.ets#sendHttpRequest` with
 *    `dataType: 'array_buffer'` and a hand-built bearer header (never
 *    `PlayarrClient`'s generic JSON path -- that path always sets
 *    `Accept: application/json` and decodes the body as text, neither of
 *    which is right for raw image bytes).
 * 2. `@kit.ImageKit`'s `image.createImageSource(arrayBuffer).createPixelMap()`.
 * 3. Cache the resulting `PixelMap` in memory, keyed by
 *    `(serverOrigin, id, kind)`, alongside the response's `ETag`.
 * 4. On a later request for the same key, send `If-None-Match`; a `304`
 *    reuses the cached `PixelMap` without decoding anything again.
 *
 * Callers only ever render whatever `PixelMap` this file resolves to (e.g.
 * `design/components/PosterCard.ets`'s `artwork` prop) -- this file never
 * imports any ArkUI component itself.
 *
 * ============================================================================
 * SECURITY INVARIANT (brief 4.9, contract-tested by `checks/contract.mjs`):
 * the bearer token is attached to a request ONLY when that request URL's
 * origin equals the currently active Playarr server's origin. Any other
 * origin -- and the "no server configured yet" state -- gets back a
 * completely empty header map from `buildArtworkRequestHeaders`, never a
 * partially-built one, and the token is never sent. See that function's own
 * doc comment.
 * ============================================================================
 */

import { image } from '@kit.ImageKit';

import { getServerDirectory, getSessionManager } from '../AppContainer';

import {
  sendHttpRequest,
  HttpRequestOptions,
  HttpTransportResponse,
} from '../net/HttpTransport';
import {
  ApiHttpFailure,
  ApiNetworkFailure,
  ApiNetworkFailureReason,
  ApiOk,
  ApiResult,
  isApiOk,
} from '../net/ApiResult';

import { absoluteUrl } from '../core/Url.ts';
import { buildHeaders } from '../core/Headers.ts';
import { clientVersion, resolveClientPlatform } from '../core/AppConfig.ts';
import { decodeErrorEnvelope } from '../core/ErrorEnvelope.ts';
import { DeviceProfile } from '../core/DeviceProfile.ts';
import { ImageKind } from '../core/Types/Work.ts';
import {
  artworkWorkUrl,
  artworkAlbumUrl,
  mediaThumbnailUrl,
} from '../core/Endpoints.ts';

import { DEVICE_PROFILE_STORAGE_KEY } from '../device/DeviceProfileService';

/** Landscape rail/library cards try these kinds, in order (brief 4.9). */
export const LANDSCAPE_ARTWORK_PRIORITY: ImageKind[] = ['backdrop', 'thumb', 'poster'];

/** Cover (2:3 poster-shaped) cards try these kinds, in order (brief 4.9). */
export const COVER_ARTWORK_PRIORITY: ImageKind[] = ['poster', 'backdrop'];

/** The hero/detail stage tries these kinds, in order (brief 4.9). */
export const HERO_ARTWORK_PRIORITY: ImageKind[] = ['backdrop', 'poster'];

/** In-memory LRU capacity -- an arbitrary, generous bound (a handful of
 * screens' worth of rails and a detail page) rather than anything the brief
 * pins to a specific number. */
const MAX_ARTWORK_CACHE_ENTRIES: number = 64;

interface ArtworkCacheEntry {
  pixelMap: image.PixelMap;
  etag: string | null;
}

/** The cache itself, keyed by `buildCacheKey(...)`'s `(serverOrigin, id,
 * kind)` string. Module-level (not a class field): this file has exactly
 * one such cache for the whole process, the same singleton-by-module-scope
 * idiom `auth/SessionManager.ets` uses for its own in-memory state. */
const artworkCache: Map<string, ArtworkCacheEntry> = new Map<string, ArtworkCacheEntry>();

/** Tracks insertion/access order for the LRU eviction policy above --
 * `Map`'s own iteration order would work too, but a plain array kept in
 * lockstep is simpler to reason about with only `indexOf`/`splice`/`push`/
 * `shift`, all ordinary, unbanned `Array` methods. */
const artworkCacheOrder: string[] = [];

function touchCacheOrder(key: string): void {
  const existingIndex = artworkCacheOrder.indexOf(key);
  if (existingIndex !== -1) {
    artworkCacheOrder.splice(existingIndex, 1);
  }
  artworkCacheOrder.push(key);
}

interface CacheSurvivor {
  key: string;
  entry: ArtworkCacheEntry;
}

/** Removes exactly one key from `artworkCache`. Deliberately never calls
 * `Map.prototype.delete` (the ArkTS lexical lint bans the bare word
 * `delete` outright, to catch the JS `delete obj.prop` operator, and that
 * ban has no exception for `Map`'s same-named method) -- instead this
 * collects every surviving entry, `clear()`s the map, and re-populates it.
 * Cache sizes here are small (`MAX_ARTWORK_CACHE_ENTRIES`), so this O(n)
 * rebuild per eviction is cheap. */
function removeCacheKey(key: string): void {
  const survivors: CacheSurvivor[] = [];
  artworkCache.forEach((entry: ArtworkCacheEntry, mapKey: string): void => {
    if (mapKey !== key) {
      const survivor: CacheSurvivor = { key: mapKey, entry: entry };
      survivors.push(survivor);
    }
  });
  artworkCache.clear();
  for (const survivor of survivors) {
    artworkCache.set(survivor.key, survivor.entry);
  }
}

function evictLeastRecentlyUsedIfNeeded(): void {
  while (artworkCacheOrder.length > MAX_ARTWORK_CACHE_ENTRIES) {
    const oldestKey = artworkCacheOrder.shift();
    if (oldestKey === undefined) {
      break;
    }
    removeCacheKey(oldestKey);
  }
}

function putCacheEntry(key: string, entry: ArtworkCacheEntry): void {
  artworkCache.set(key, entry);
  touchCacheOrder(key);
  evictLeastRecentlyUsedIfNeeded();
}

function getCacheEntry(key: string): ArtworkCacheEntry | undefined {
  const entry = artworkCache.get(key);
  if (entry !== undefined) {
    touchCacheOrder(key);
  }
  return entry;
}

/**
 * `(serverOrigin, id, kind)` (brief 4.9), plus a `category` segment so a
 * work id, an "artistWorkId/albumId" pair and a media-file id can never
 * collide in the same cache even if their raw id strings ever coincided.
 * Reads the CURRENT active server origin on every call (never cached
 * itself) so switching servers can never serve one server's cached
 * `PixelMap` under another's key.
 */
function buildCacheKey(category: string, id: string, kind: string): string {
  const activeBaseUrl = getServerDirectory().getActiveBaseUrl();
  const origin = activeBaseUrl !== null ? originOf(activeBaseUrl) : null;
  const originKey = origin !== null ? origin : 'no-active-server';
  return originKey + '::' + category + '::' + id + '::' + kind;
}

/** Extracts `scheme://host[:port]` from an absolute URL, or `null` if
 * `url` is not a well-formed `http(s)://` URL. Used only to COMPARE two
 * origins (never to build a request), so it deliberately does not attempt
 * to validate or normalise the host/port beyond this shape. */
function originOf(url: string): string | null {
  const match = /^https?:\/\/[^/]+/i.exec(url);
  if (match === null) {
    return null;
  }
  return match[0];
}

/**
 * The current resolved `ClientPlatform` wire name, read from the
 * `DeviceProfile` `device/DeviceProfileService.ets` publishes into
 * `AppStorage` at ability creation (brief section 6.1: fixed for the
 * process lifetime). Falls back to `core/AppConfig.ts#resolveClientPlatform`
 * only in the defensive case where nothing has been published yet -- the
 * same pattern `auth/DeviceAuthService.ets#currentClientPlatform` already
 * establishes, duplicated here rather than imported since neither file
 * exports it and `AppContainer.ets` only exposes the three composed
 * singletons (`getServerDirectory`/`getSessionManager`/`getPlayarrClient`),
 * never the raw platform string.
 */
function currentClientPlatform(): string {
  const profile = AppStorage.get<DeviceProfile>(DEVICE_PROFILE_STORAGE_KEY);
  if (profile !== undefined) {
    return profile.platformWireName;
  }
  return resolveClientPlatform('phone');
}

/**
 * Builds the header map for one artwork/thumbnail request.
 *
 * SECURITY INVARIANT (brief 4.9): the bearer token must only ever be
 * attached when `requestUrl`'s origin equals the currently active server's
 * origin. When there is no active server at all, OR `requestUrl`'s origin
 * does not match the active one, this returns a completely EMPTY header
 * map -- not just an Authorization-less one -- so nothing about this
 * request (bearer included) is ever sent to a foreign host.
 */
function buildArtworkRequestHeaders(requestUrl: string, ifNoneMatch: string | null): Map<string, string> {
  const activeBaseUrl = getServerDirectory().getActiveBaseUrl();
  if (activeBaseUrl === null) {
    return new Map<string, string>();
  }

  const activeOrigin = originOf(activeBaseUrl);
  const requestOrigin = originOf(requestUrl);
  if (activeOrigin === null || requestOrigin === null || requestOrigin !== activeOrigin) {
    return new Map<string, string>();
  }

  const accessToken = getSessionManager().getAccessToken();
  const headers = buildHeaders(currentClientPlatform(), clientVersion, accessToken);
  if (ifNoneMatch !== null) {
    headers.set('If-None-Match', ifNoneMatch);
  }
  return headers;
}

/**
 * Decodes UTF-8 bytes into a `string` by hand, without `TextDecoder` --
 * its availability under the ArkTS runtime is not guaranteed, the same
 * reasoning `core/Base64Url.ts` and `auth/DeviceAuthService.ets` already
 * apply to `TextEncoder`/`TextDecoder`/`Buffer`/`URL`. Only used to turn a
 * non-2xx artwork response's body bytes back into text so
 * `core/ErrorEnvelope.ts#decodeErrorEnvelope` can decode it -- error bodies
 * are short, mostly-ASCII JSON, so a malformed trailing byte is simply
 * skipped rather than thrown, matching that decoder's own "never throws"
 * discipline.
 */
function utf8BytesToString(bytes: Uint8Array): string {
  let output = '';
  let index = 0;
  const length = bytes.length;
  while (index < length) {
    const byte0 = bytes[index];
    if (byte0 < 0x80) {
      output = output + String.fromCharCode(byte0);
      index = index + 1;
      continue;
    }
    if ((byte0 & 0xe0) === 0xc0 && index + 1 < length) {
      const byte1 = bytes[index + 1];
      output = output + String.fromCharCode(((byte0 & 0x1f) << 6) | (byte1 & 0x3f));
      index = index + 2;
      continue;
    }
    if ((byte0 & 0xf0) === 0xe0 && index + 2 < length) {
      const byte1 = bytes[index + 1];
      const byte2 = bytes[index + 2];
      output = output + String.fromCharCode(((byte0 & 0x0f) << 12) | ((byte1 & 0x3f) << 6) | (byte2 & 0x3f));
      index = index + 3;
      continue;
    }
    if ((byte0 & 0xf8) === 0xf0 && index + 3 < length) {
      const byte1 = bytes[index + 1];
      const byte2 = bytes[index + 2];
      const byte3 = bytes[index + 3];
      const codePoint = ((byte0 & 0x07) << 18) | ((byte1 & 0x3f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f);
      const adjusted = codePoint - 0x10000;
      const highSurrogate = 0xd800 + (adjusted >> 10);
      const lowSurrogate = 0xdc00 + (adjusted & 0x3ff);
      output = output + String.fromCharCode(highSurrogate) + String.fromCharCode(lowSurrogate);
      index = index + 4;
      continue;
    }
    // An unrecognised leading byte -- skip it rather than throwing. This
    // text is diagnostic only (an error envelope's `message`/`error` code),
    // never load-bearing beyond that.
    index = index + 1;
  }
  return output;
}

function networkFailure(reason: ApiNetworkFailureReason, message: string): ApiNetworkFailure {
  const failure: ApiNetworkFailure = { kind: 'network_failure', reason: reason, message: message };
  return failure;
}

function decodeArtworkHttpFailure(response: HttpTransportResponse): ApiHttpFailure {
  const bytes = response.bodyBytes;
  const bodyText = bytes !== undefined ? utf8BytesToString(new Uint8Array(bytes)) : '';
  const envelope = decodeErrorEnvelope(response.status, response.contentType, bodyText);
  const failure: ApiHttpFailure = { kind: 'http_failure', status: response.status, envelope: envelope };
  return failure;
}

/** `image.createImageSource(arrayBuffer)` -> `createPixelMap()` (brief
 * 4.9), pulled into its own function purely so the `try`/`catch` around it
 * in `decodeArtworkSuccess` stays a single, simple `await`. */
function decodePixelMapFromBytes(bytes: ArrayBuffer): Promise<image.PixelMap> {
  const imageSource: image.ImageSource = image.createImageSource(bytes);
  return imageSource.createPixelMap();
}

async function decodeArtworkSuccess(response: HttpTransportResponse, cacheKey: string): Promise<ApiResult<image.PixelMap>> {
  const bytes = response.bodyBytes;
  if (bytes === undefined) {
    return networkFailure('unknown', 'The server response had no image bytes.');
  }

  let pixelMap: image.PixelMap;
  try {
    pixelMap = await decodePixelMapFromBytes(bytes);
  } catch (err) {
    const asError = err as Error;
    return networkFailure('unknown', 'Failed to decode artwork bytes: ' + asError.message);
  }

  const etag = response.headers.get('etag') ?? null;
  const entry: ArtworkCacheEntry = { pixelMap: pixelMap, etag: etag };
  putCacheEntry(cacheKey, entry);

  const ok: ApiOk<image.PixelMap> = { kind: 'ok', status: response.status, value: pixelMap };
  return ok;
}

/**
 * The shared fetch/cache/revalidate pipeline every exported function below
 * funnels through. `path` is a server-relative path already built by a
 * caller from `core/Endpoints.ts`; `cacheKey` already encodes
 * `(serverOrigin, id, kind)` via `buildCacheKey`.
 */
async function fetchArtworkBytes(path: string, cacheKey: string): Promise<ApiResult<image.PixelMap>> {
  const baseUrl = getServerDirectory().getActiveBaseUrl();
  if (baseUrl === null) {
    return networkFailure('no_connection', 'No active Playarr server is configured.');
  }

  let url: string;
  try {
    url = absoluteUrl(baseUrl, path);
  } catch (err) {
    const asError = err as Error;
    return networkFailure('unknown', asError.message);
  }

  const cached = getCacheEntry(cacheKey);
  const headers = buildArtworkRequestHeaders(url, cached !== undefined ? cached.etag : null);
  if (headers.size === 0) {
    // buildArtworkRequestHeaders refused outright (a foreign origin, or no
    // active server) -- never issue this request at all, see that
    // function's own doc comment for why.
    return networkFailure('no_connection', 'Refusing to request artwork outside the active server origin.');
  }

  const requestOptions: HttpRequestOptions = {
    method: 'GET',
    headers: headers,
    dataType: 'array_buffer',
  };
  const response = await sendHttpRequest(url, requestOptions);

  if (response.status === 0) {
    const reason = response.networkErrorReason ?? 'unknown';
    const message = response.networkErrorMessage ?? 'The network request failed.';
    return networkFailure(reason, message);
  }

  if (response.status === 304 && cached !== undefined) {
    const ok: ApiOk<image.PixelMap> = { kind: 'ok', status: response.status, value: cached.pixelMap };
    return ok;
  }

  if (response.status >= 200 && response.status < 300) {
    return decodeArtworkSuccess(response, cacheKey);
  }

  return decodeArtworkHttpFailure(response);
}

/** `GET /api/v1/artwork/work/{work_id}/{kind}` (brief 4.9). */
export function fetchWorkArtwork(workId: string, kind: ImageKind): Promise<ApiResult<image.PixelMap>> {
  const path = artworkWorkUrl(workId, kind);
  const cacheKey = buildCacheKey('work', workId, kind);
  return fetchArtworkBytes(path, cacheKey);
}

/** `GET /api/v1/artwork/album/{artist_work_id}/{album_id}/{kind}` (brief
 * 4.9). */
export function fetchAlbumArtwork(artistWorkId: string, albumId: string, kind: ImageKind): Promise<ApiResult<image.PixelMap>> {
  const path = artworkAlbumUrl(artistWorkId, albumId, kind);
  const cacheKey = buildCacheKey('album', artistWorkId + '/' + albumId, kind);
  return fetchArtworkBytes(path, cacheKey);
}

/** `GET /api/v1/media/{media_file_id}/thumbnail?position_ms=` (brief 4.9):
 * chapter cards and on-deck episode art. */
export function fetchMediaThumbnail(mediaFileId: string, positionMs: number): Promise<ApiResult<image.PixelMap>> {
  const path = mediaThumbnailUrl(mediaFileId) + '?position_ms=' + String(positionMs);
  const cacheKey = buildCacheKey('thumbnail', mediaFileId, 'position:' + String(positionMs));
  return fetchArtworkBytes(path, cacheKey);
}

/**
 * Tries each kind in `priority`, in order, resolving to the first one that
 * is not a 404 (brief 4.9: "expose a small helper that tries a priority
 * list and returns the first kind that resolves"). A non-404 failure (a
 * network failure, a 502 upstream failure, ...) stops the search
 * immediately and is returned as-is -- masking a real failure behind the
 * next kind's unrelated 404 would be misleading. If every kind in
 * `priority` 404s, the LAST 404 is returned (so a caller can still branch
 * on `result.status === 404` to show an artwork-less placeholder).
 */
async function tryArtworkPriority(
  priority: ImageKind[],
  fetchOne: (kind: ImageKind) => Promise<ApiResult<image.PixelMap>>
): Promise<ApiResult<image.PixelMap>> {
  let lastResult: ApiResult<image.PixelMap> | null = null;

  for (const kind of priority) {
    const result = await fetchOne(kind);
    if (isApiOk(result)) {
      return result;
    }
    lastResult = result;
    const isNotFound = result.kind === 'http_failure' && result.status === 404;
    if (!isNotFound) {
      return result;
    }
  }

  if (lastResult !== null) {
    return lastResult;
  }
  // `priority` was an empty array -- nothing was ever tried.
  return networkFailure('unknown', 'No artwork kind priorities were supplied.');
}

/** `fetchWorkArtwork`, trying every kind in `priority` in order (see
 * `LANDSCAPE_ARTWORK_PRIORITY` / `COVER_ARTWORK_PRIORITY` /
 * `HERO_ARTWORK_PRIORITY`, above). */
export function fetchWorkArtworkByPriority(workId: string, priority: ImageKind[]): Promise<ApiResult<image.PixelMap>> {
  return tryArtworkPriority(priority, (kind: ImageKind): Promise<ApiResult<image.PixelMap>> => fetchWorkArtwork(workId, kind));
}

/** `fetchAlbumArtwork`, trying every kind in `priority` in order. */
export function fetchAlbumArtworkByPriority(
  artistWorkId: string,
  albumId: string,
  priority: ImageKind[]
): Promise<ApiResult<image.PixelMap>> {
  return tryArtworkPriority(priority, (kind: ImageKind): Promise<ApiResult<image.PixelMap>> =>
    fetchAlbumArtwork(artistWorkId, albumId, kind)
  );
}
