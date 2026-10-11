/**
 * The one Playarr API client (brief section 3.2, "net/"). Every
 * authenticated or unauthenticated JSON call in this app is expected to go
 * through an instance of `PlayarrClient` -- it is the only place that
 * knows about auth-aware request semantics:
 *
 * - Joins a server-relative path (built by a caller from
 *   `core/Endpoints.ts`) onto the currently-active server's base URL via
 *   `core/Url.ts`'s `absoluteUrl`.
 * - Builds the request-header map via `core/Headers.ts` (platform +
 *   `clientVersion` from `core/AppConfig.ts`, plus the current access
 *   token).
 * - Issues the request through `net/HttpTransport.ets` -- this file never
 *   touches `@kit.NetworkKit` itself.
 * - On a non-2xx response, decodes the body via `core/ErrorEnvelope.ts`,
 *   which itself checks `Content-Type` before ever attempting
 *   `JSON.parse` (brief section 4.2's static-SPA-fallback warning: an
 *   unmatched path can come back as `index.html`, HTTP 200,
 *   `Content-Type: text/html`).
 * - On exactly HTTP 401, asks a supplied `AccessTokenProvider` to refresh
 *   once, then replays the request once with the new token -- capped at
 *   `MAX_REFRESH_RETRY_ATTEMPTS` (2) TOTAL attempts for a single call (the
 *   original attempt, plus at most one refreshed replay; brief section 4.5,
 *   "cap 401-retries at 2", and `core/RefreshPolicy.ts`).
 * - NEVER throws, and never leaves a rejected promise for a caller to also
 *   catch -- every method resolves to an `ApiResult<T>` (`net/ApiResult.ets`).
 *
 * Deliberately does NOT import `auth/SessionManager.ets` or
 * `auth/ServerDirectory.ets`, even though the brief's own prose describes
 * `PlayarrClient` as asking `SessionManager` to refresh and asking
 * `ServerDirectory` for the base URL: those two files live in `auth/`,
 * which is a SIBLING of `net/` under `core/` in the layer diagram (brief
 * section 3), not something `net/` may depend on -- and a sibling agent is
 * building both of them in this same wave, so a concrete import here would
 * also be a circular file dependency (`SessionManager` needs
 * `PlayarrClient` to make its own authenticated calls). Instead, this
 * file defines two small function-type interfaces, below
 * (`AccessTokenProvider`, `ActiveServerProvider`), that the bootstrap
 * wiring built by a later agent in this same workflow satisfies with real
 * `SessionManager` / `ServerDirectory` instances.
 */

import { absoluteUrl } from '../core/Url.ts';
import { buildHeaders, buildJsonBodyHeaders } from '../core/Headers.ts';
import { clientVersion } from '../core/AppConfig.ts';
import { decodeErrorEnvelope } from '../core/ErrorEnvelope.ts';
import { MAX_REFRESH_RETRY_ATTEMPTS } from '../core/RefreshPolicy.ts';

import {
  sendHttpRequest,
  HttpMethod,
  HttpRequestOptions,
  HttpTransportResponse,
} from './HttpTransport';
import {
  ApiResult,
  ApiOk,
  ApiHttpFailure,
  ApiNetworkFailure,
  ApiNetworkFailureReason,
} from './ApiResult';

/**
 * Supplies the current access token and drives a refresh. A function-type
 * parameter rather than a concrete import of `auth/SessionManager.ets` --
 * see this file's header comment for why. The bootstrap wiring built by a
 * later agent in this same workflow satisfies this with a real
 * `SessionManager` instance.
 *
 * `refreshAccessToken` resolves `true` once a new access token has been
 * persisted and is available from a subsequent `getAccessToken()` call,
 * or `false` if the refresh itself failed (expired/revoked/reused refresh
 * token, no active server reachable, ...) -- in which case
 * `PlayarrClient` gives up on the retry and surfaces the original 401
 * rather than looping.
 */
export interface AccessTokenProvider {
  getAccessToken(): string | null;
  refreshAccessToken(): Promise<boolean>;
}

/**
 * Supplies the base URL `PlayarrClient` should currently be talking to.
 * A function-type parameter rather than a concrete import of
 * `auth/ServerDirectory.ets` -- see this file's header comment for why.
 * `getActiveBaseUrl` returns `null` when no server is configured yet (e.g.
 * before pairing has ever completed), in which case every call fails fast
 * with an `ApiNetworkFailure` rather than attempting to build a request.
 */
export interface ActiveServerProvider {
  getActiveBaseUrl(): string | null;
}

/** Every JSON request this file issues asks for the `'string'`
 * `HttpResponseDataType` -- byte-level fetches (artwork, subtitles) are a
 * later `data/` repository's concern, built directly on
 * `net/HttpTransport.ets`, not this client. */
const JSON_DATA_TYPE = 'string';

export class PlayarrClient {
  private readonly serverProvider: ActiveServerProvider;
  private readonly tokenProvider: AccessTokenProvider;
  private readonly clientPlatform: string;

  constructor(serverProvider: ActiveServerProvider, tokenProvider: AccessTokenProvider, clientPlatform: string) {
    this.serverProvider = serverProvider;
    this.tokenProvider = tokenProvider;
    this.clientPlatform = clientPlatform;
  }

  /**
   * `GET` returning a decoded JSON body. `timeoutMs`, when supplied, lets
   * a caller opt into a longer-than-default timeout (see
   * `net/HttpTransport.ets`'s `MIN_MANIFEST_FETCH_TIMEOUT_MS`) instead of
   * the usual 60 s -- this is the "method or parameter path for GET
   * requests that need the special longer manifest-fetch timeout" a later
   * Player slice will use for the first HLS manifest fetch.
   */
  public getJson<T>(path: string, timeoutMs?: number): Promise<ApiResult<T>> {
    return this.sendJson<T>(path, 'GET', null, timeoutMs);
  }

  /** `POST` with a JSON-encoded body. */
  public postJson<TBody, T>(path: string, body: TBody): Promise<ApiResult<T>> {
    return this.sendJson<T>(path, 'POST', JSON.stringify(body), undefined);
  }

  /** `PUT` with a JSON-encoded body. */
  public putJson<TBody, T>(path: string, body: TBody): Promise<ApiResult<T>> {
    return this.sendJson<T>(path, 'PUT', JSON.stringify(body), undefined);
  }

  /** `PATCH` with a JSON-encoded body (e.g. `player-preferences`, brief
   * section 4.7). */
  public patchJson<TBody, T>(path: string, body: TBody): Promise<ApiResult<T>> {
    return this.sendJson<T>(path, 'PATCH', JSON.stringify(body), undefined);
  }

  /** `DELETE` with no body. */
  public deleteJson<T>(path: string): Promise<ApiResult<T>> {
    return this.sendJson<T>(path, 'DELETE', null, undefined);
  }

  /**
   * Top-level entry point for every method above. Wraps the entire attempt
   * loop in its own `try/catch` so that truly unexpected failures (a bug
   * here, `absoluteUrl` rejecting a malformed path, ...) still resolve to
   * an `ApiResult` rather than ever rejecting the returned promise --
   * this is the one place that guarantees "never throws" end to end.
   */
  private async sendJson<T>(
    path: string,
    method: HttpMethod,
    bodyText: string | null,
    timeoutMs: number | undefined
  ): Promise<ApiResult<T>> {
    try {
      return await this.attemptRequest<T>(path, method, bodyText, timeoutMs);
    } catch (err) {
      const asError = err as Error;
      return this.networkFailure<T>('unknown', asError.message);
    }
  }

  /**
   * Resolves the active server, joins the path, then loops issuing the
   * request until it succeeds, exhausts the 401-refresh retry cap, or hits
   * a non-401 failure. See this file's header comment for the exact
   * retry-cap semantics.
   */
  private async attemptRequest<T>(
    path: string,
    method: HttpMethod,
    bodyText: string | null,
    timeoutMs: number | undefined
  ): Promise<ApiResult<T>> {
    const baseUrl = this.serverProvider.getActiveBaseUrl();
    if (baseUrl === null) {
      return this.networkFailure<T>('no_connection', 'No active Playarr server is configured.');
    }

    let url: string;
    try {
      url = absoluteUrl(baseUrl, path);
    } catch (err) {
      const asError = err as Error;
      return this.networkFailure<T>('unknown', asError.message);
    }

    let attempt = 0;
    while (true) {
      attempt = attempt + 1;

      const response = await this.issueOnce(url, method, bodyText, timeoutMs);

      if (response.status === 0) {
        const reason: ApiNetworkFailureReason = response.networkErrorReason ?? 'unknown';
        const message = response.networkErrorMessage ?? 'The network request failed.';
        return this.networkFailure<T>(reason, message);
      }

      if (response.status >= 200 && response.status < 300) {
        return this.decodeOk<T>(response);
      }

      if (response.status === 401 && attempt < MAX_REFRESH_RETRY_ATTEMPTS) {
        const refreshed = await this.tokenProvider.refreshAccessToken();
        if (refreshed) {
          continue;
        }
      }

      return this.decodeHttpFailure<T>(response);
    }
  }

  /** Builds the header map for one attempt (a fresh read of the current
   * access token every time, since a refreshed retry must use the new
   * token) and issues it through `net/HttpTransport.ets`. */
  private issueOnce(
    url: string,
    method: HttpMethod,
    bodyText: string | null,
    timeoutMs: number | undefined
  ): Promise<HttpTransportResponse> {
    const accessToken = this.tokenProvider.getAccessToken();
    const headers =
      bodyText === null
        ? buildHeaders(this.clientPlatform, clientVersion, accessToken)
        : buildJsonBodyHeaders(this.clientPlatform, clientVersion, accessToken);

    const requestOptions: HttpRequestOptions = {
      method: method,
      headers: headers,
      dataType: JSON_DATA_TYPE,
    };
    if (bodyText !== null) {
      requestOptions.body = bodyText;
    }
    if (timeoutMs !== undefined) {
      requestOptions.timeoutMs = timeoutMs;
    }

    return sendHttpRequest(url, requestOptions);
  }

  /** A 2xx response: the body is always JSON on every documented Playarr
   * success response (brief section 4). An empty or invalid body here is
   * treated as a network-shaped failure rather than a crash -- there is no
   * documented endpoint in this contract that returns 2xx with no body other than 204, which is success. */
  private decodeOk<T>(response: HttpTransportResponse): ApiResult<T> {
    const bodyText = response.bodyText ?? '';
    if (response.status === 204) {
      // 204 No Content (for example `DELETE /api/v1/watchlist/{title_key}`): success with no body.
      const empty: ApiOk<T> = { kind: 'ok', status: response.status, value: new Object() as T };
      return empty;
    }
    let parsed: T;
    try {
      parsed = JSON.parse(bodyText) as T;
    } catch (err) {
      return this.networkFailure<T>('unknown', 'The server response body was not valid JSON.');
    }
    const ok: ApiOk<T> = { kind: 'ok', status: response.status, value: parsed };
    return ok;
  }

  /** A non-2xx response: decode it with `core/ErrorEnvelope.ts`, which
   * handles all three envelope shapes (general, OAuth-token, 426
   * upgrade-required) plus the static-SPA-fallback and malformed cases --
   * this file never re-implements or second-guesses that decoding. */
  private decodeHttpFailure<T>(response: HttpTransportResponse): ApiResult<T> {
    const bodyText = response.bodyText ?? '';
    const envelope = decodeErrorEnvelope(response.status, response.contentType, bodyText);
    const failure: ApiHttpFailure = { kind: 'http_failure', status: response.status, envelope: envelope };
    return failure;
  }

  private networkFailure<T>(reason: ApiNetworkFailureReason, message: string): ApiResult<T> {
    const failure: ApiNetworkFailure = { kind: 'network_failure', reason: reason, message: message };
    return failure;
  }
}
