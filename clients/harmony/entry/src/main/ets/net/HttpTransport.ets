/**
 * Thin wrapper over `@kit.NetworkKit`'s `http` module (brief section 3.2,
 * "net/"). This is the ONLY file in this client that touches
 * `@kit.NetworkKit` -- `PlayarrClient.ets` and every future caller (e.g. a
 * later `data/ArtworkRepository.ets` fetching bearer-gated artwork bytes)
 * reach the network exclusively through `sendHttpRequest`, below.
 *
 * Hard rules this file exists to enforce:
 *
 * - **One `http.createHttp()` instance PER REQUEST, always `destroy()`ed**,
 *   in a `try/finally` so it is released even when the request rejects or
 *   an unexpected error is thrown. Brief risk R14 is explicit that this
 *   client must NOT inherit single-flight request serialisation the way the
 *   Roku client does -- a later Home screen issues six rails' worth of
 *   concurrent fetches, and `http.createHttp()` handles are single-use, so
 *   every request gets its own instance and instances are never shared or
 *   reused across calls.
 * - **Never throws across this file's exported boundary.** Any
 *   `@kit.NetworkKit` failure (DNS failure, connection refused, TLS
 *   failure, timeout, ...) is converted into `{ status: 0, ... }` plus a
 *   `networkErrorReason` marker, in the SAME `HttpTransportResponse` shape
 *   a real HTTP response uses, so every caller has exactly one shape to
 *   branch on -- never a rejected promise to also catch.
 * - **A 60 second connect/read timeout by default.** The brief also
 *   requires a configurable LONGER override (>= 20 s) for the first HLS
 *   manifest fetch a later Player slice will make -- a live on-demand
 *   transcode's first playlist/segment request can legitimately block up
 *   to 15 s while ffmpeg writes its first output. That override is exposed
 *   here today, as `HttpRequestOptions.timeoutMs`, even though no caller
 *   passes it yet.
 * - **Both response-decoding modes** every caller needs: `'string'` for
 *   JSON bodies (`PlayarrClient`) and `'array_buffer'` for raw bytes
 *   (artwork, subtitles -- later slices).
 */

import { http } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';

/** Default connect/read timeout for an ordinary JSON request (brief
 * section 3.2 / 7.3: "a 60 s connect/read timeout"). */
export const DEFAULT_TIMEOUT_MS: number = 60000;

/**
 * Floor for the "first HLS manifest fetch" override a later Player slice
 * will pass as `HttpRequestOptions.timeoutMs` (brief: "a configurable
 * longer timeout used for the first HLS manifest fetch (>= 20 s)", and
 * separately, "a live on-demand HLS session's first playlist/segment
 * request can legitimately block for up to 15 s"). Exported as a documented
 * floor so that later caller does not have to re-derive this number from
 * prose; nothing in this client calls it yet.
 */
export const MIN_MANIFEST_FETCH_TIMEOUT_MS: number = 20000;

/** The HTTP verbs this client ever issues against the Playarr API. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * The two response-decoding modes a caller may request. A deliberate,
 * plain-string mirror of `http.HttpDataType` so that no caller of this file
 * (in particular `PlayarrClient.ets`) needs to import `@kit.NetworkKit`
 * itself just to select a mode -- this file alone maps it onto the real
 * `http.HttpDataType` enum internally.
 */
export type HttpResponseDataType = 'string' | 'array_buffer';

/**
 * Why a request never reached the "got an HTTP response" stage at all.
 * `@kit.NetworkKit`'s http module documents its error codes as
 * `2300000 + <libcurl error code>` (e.g. libcurl's `CURLE_OPERATION_TIMEDOUT`
 * = 28 -> 2300028); `classifyNetworkError`, below, maps the handful of
 * codes that matter to a caller deciding whether a retry/failover is worth
 * attempting. Everything else collapses to `'unknown'` rather than
 * guessing.
 */
export type NetworkErrorReason = 'timeout' | 'no_connection' | 'unknown';

/**
 * Everything one call to `sendHttpRequest` needs. `headers` is a plain
 * `Map<string, string>` -- this file has no idea which header names are
 * Playarr-specific (that is `core/Headers.ts`'s exclusive territory) and
 * never inspects the keys, it only carries them onto the wire.
 */
export interface HttpRequestOptions {
  method: HttpMethod;
  headers: Map<string, string>;
  body?: string;
  dataType?: HttpResponseDataType;
  timeoutMs?: number;
}

/**
 * The one return shape every call produces, success or failure -- see the
 * file header. `status === 0` marks a request that never got a real HTTP
 * response at all; `networkErrorReason` / `networkErrorMessage` are then
 * populated and `headers` is empty. Any other `status` is a genuine HTTP
 * response (2xx through 5xx) and exactly one of `bodyText` / `bodyBytes` is
 * populated, matching whichever `dataType` was requested.
 */
export interface HttpTransportResponse {
  status: number;
  headers: Map<string, string>;
  contentType: string | null;
  bodyText?: string;
  bodyBytes?: ArrayBuffer;
  networkErrorReason?: NetworkErrorReason;
  networkErrorMessage?: string;
}

/** `http.RequestMethod` has no `PATCH` member in the documented
 * `@kit.NetworkKit` surface (only
 * `OPTIONS/GET/HEAD/POST/PUT/DELETE/TRACE/CONNECT`), even though the
 * Playarr contract's player-preferences endpoint is a real `PATCH`
 * (brief section 4.7, "`GET`/`PATCH /api/v1/users/me/player-preferences`").
 * The wire value the native layer actually sends is the plain string
 * either way, so the missing enum member is worked around with an explicit
 * cast rather than silently substituting `POST` or `PUT`. */
function toRequestMethod(method: HttpMethod): http.RequestMethod {
  if (method === 'GET') {
    return http.RequestMethod.GET;
  }
  if (method === 'POST') {
    return http.RequestMethod.POST;
  }
  if (method === 'PUT') {
    return http.RequestMethod.PUT;
  }
  if (method === 'DELETE') {
    return http.RequestMethod.DELETE;
  }
  return 'PATCH' as http.RequestMethod;
}

function toExpectDataType(dataType: HttpResponseDataType | undefined): http.HttpDataType {
  if (dataType === 'array_buffer') {
    return http.HttpDataType.ARRAY_BUFFER;
  }
  return http.HttpDataType.STRING;
}

/** Copies a `Map<string, string>` onto a plain `Object` for
 * `http.HttpRequestOptions.header`. Uses a `Record<string, string>`
 * (dynamic keys) since this file has no fixed set of header names to
 * declare a literal-keyed interface for -- that would require restating
 * the Playarr-specific header names this file must never contain
 * (`core/Headers.ts`'s exclusive territory). */
function toHeaderObject(headers: Map<string, string>): Object {
  const native: Record<string, string> = {};
  headers.forEach((value: string, key: string): void => {
    native[key] = value;
  });
  return native as Object;
}

/** Inverse of `toHeaderObject`: reads every own key off the response
 * header `Object` via a `Record` view and lower-cases the key on the way in,
 * so header lookups (in particular `Content-Type`) are deterministic
 * regardless of how the server or an intermediary cased them -- HTTP
 * header names are case-insensitive by spec. */
function toHeaderMap(header: Object): Map<string, string> {
  const result = new Map<string, string>();
  const record = header as Record<string, Object>;
  const keys = Object.keys(record);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const rawValue: Object = record[key];
    result.set(key.toLowerCase(), String(rawValue));
  }
  return result;
}

function findHeader(headers: Map<string, string>, lowerCaseName: string): string | null {
  const value = headers.get(lowerCaseName);
  if (value === undefined) {
    return null;
  }
  return value;
}

function buildNativeOptions(options: HttpRequestOptions, timeoutMs: number): http.HttpRequestOptions {
  const native: http.HttpRequestOptions = {
    method: toRequestMethod(options.method),
    header: toHeaderObject(options.headers),
    expectDataType: toExpectDataType(options.dataType),
    connectTimeout: timeoutMs,
    readTimeout: timeoutMs,
  };
  if (options.body !== undefined) {
    native.extraData = options.body;
  }
  return native;
}

function toTransportResponse(response: http.HttpResponse, dataType: HttpResponseDataType | undefined): HttpTransportResponse {
  const headers = toHeaderMap(response.header);
  const contentType = findHeader(headers, 'content-type');
  const status = Number(response.responseCode);

  if (dataType === 'array_buffer') {
    const bytes = response.result as ArrayBuffer;
    return { status: status, headers: headers, contentType: contentType, bodyBytes: bytes };
  }

  const text = response.result as string;
  return { status: status, headers: headers, contentType: contentType, bodyText: text };
}

/**
 * Maps a `@kit.NetworkKit` http failure onto the small `NetworkErrorReason`
 * set a caller can actually act on. See this file's `NetworkErrorReason`
 * doc comment for the `2300000 + libcurl-code` mapping this relies on:
 * `CURLE_OPERATION_TIMEDOUT` (28) -> 2300028 is a timeout;
 * `CURLE_COULDNT_RESOLVE_HOST` (6) -> 2300006 and `CURLE_COULDNT_CONNECT`
 * (7) -> 2300007 both mean the server was never reachable at all. Anything
 * else (TLS failures, malformed URLs, ...) collapses to `'unknown'` rather
 * than guessing.
 */
function classifyNetworkError(err: BusinessError): NetworkErrorReason {
  const code = err.code;
  if (code === 2300028) {
    return 'timeout';
  }
  if (code === 2300006 || code === 2300007) {
    return 'no_connection';
  }
  return 'unknown';
}

function toNetworkFailureResponse(err: BusinessError): HttpTransportResponse {
  return {
    status: 0,
    headers: new Map<string, string>(),
    contentType: null,
    networkErrorReason: classifyNetworkError(err),
    networkErrorMessage: err.message,
  };
}

/**
 * Issues one HTTP request and resolves with an `HttpTransportResponse`.
 * NEVER rejects -- every `@kit.NetworkKit` failure is caught and converted
 * into the `status: 0` network-failure shape described on
 * `HttpTransportResponse`. Creates exactly one `http.createHttp()` instance
 * for this call and always `destroy()`s it, in a `finally`, whether the
 * request succeeded, failed, or something unexpected was thrown while
 * handling it -- safe to call many times concurrently (brief risk R14),
 * since no state is ever shared between calls.
 *
 * `options.timeoutMs`, when omitted, defaults to `DEFAULT_TIMEOUT_MS`
 * (60 s) for both the connect and read timeout. Pass a larger value (see
 * `MIN_MANIFEST_FETCH_TIMEOUT_MS`) for a request that is known to block
 * longer, e.g. a later Player slice's first HLS manifest fetch.
 */
export async function sendHttpRequest(url: string, options: HttpRequestOptions): Promise<HttpTransportResponse> {
  const client = http.createHttp();
  const timeoutMs = options.timeoutMs !== undefined ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  try {
    const nativeOptions = buildNativeOptions(options, timeoutMs);
    const response = await client.request(url, nativeOptions);
    return toTransportResponse(response, options.dataType);
  } catch (err) {
    const businessError = err as BusinessError;
    return toNetworkFailureResponse(businessError);
  } finally {
    client.destroy();
  }
}
