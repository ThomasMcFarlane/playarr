/**
 * Discriminated result type for every `net/` (and, later, `data/`) call
 * (brief section 3.2, "net/"): `PlayarrClient` never throws across its
 * boundary -- every method resolves to exactly one of these instead of
 * ever rejecting or throwing.
 *
 * Two distinct failure shapes, matching two distinct causes:
 *
 * - `ApiHttpFailure` -- a response WAS received from the server. Its body
 *   has already been decoded by `core/ErrorEnvelope.ts`'s three-shape
 *   decoder (brief section 4.2): a general `{error,message}` envelope, the
 *   OAuth-token single-field `{error}` envelope, the dedicated 426
 *   upgrade-required envelope, a non-JSON body (the static-SPA
 *   `index.html` fallback), or a malformed body. Callers switch on
 *   `envelope.kind`, never re-parse the body themselves.
 * - `ApiNetworkFailure` -- no HTTP response was ever received at all (DNS
 *   failure, connection refused, TLS failure, timeout, an unreachable
 *   server, or an unexpected internal error while building the request).
 *   See `net/HttpTransport.ets`'s `NetworkErrorReason`, which this file's
 *   `ApiNetworkFailureReason` mirrors.
 */

import { ErrorEnvelopeResult } from '../core/ErrorEnvelope.ts';

/** A successful call: `status` is always a 2xx, `value` the decoded, typed
 * response body. */
export interface ApiOk<T> {
  kind: 'ok';
  status: number;
  value: T;
}

/**
 * Why a request never reached the "got an HTTP response" stage at all.
 * Kept as its own plain string-union type here (rather than importing
 * `net/HttpTransport.ets`'s `NetworkErrorReason`) so this file's only
 * dependency stays `core/ErrorEnvelope.ts` -- `'cancelled'` is the one
 * value with no `HttpTransport` equivalent, reserved for a future caller
 * that aborts an in-flight request rather than waiting it out.
 */
export type ApiNetworkFailureReason = 'timeout' | 'no_connection' | 'cancelled' | 'unknown';

/** No HTTP response was ever received; `message` is a short, loggable,
 * non-sensitive diagnostic string (never a URL or header carrying a
 * token -- see `util/Log.ets`'s logging discipline). */
export interface ApiNetworkFailure {
  kind: 'network_failure';
  reason: ApiNetworkFailureReason;
  message: string;
}

/** A non-2xx (or otherwise rejected) HTTP response, decoded via
 * `core/ErrorEnvelope.ts`. `status` is repeated here (as well as inside
 * `envelope`) so a caller can branch on the raw status code without
 * unwrapping the envelope union first -- e.g. rendering a `503
 * no_peer_available` differently from a `404`, per brief section 4.2. */
export interface ApiHttpFailure {
  kind: 'http_failure';
  status: number;
  envelope: ErrorEnvelopeResult;
}

/** Every way a call can fail without throwing. */
export type ApiFailure = ApiNetworkFailure | ApiHttpFailure;

/** Every `net/` (and `data/`) call returns exactly one of these -- never a
 * thrown exception, never a rejected promise a caller must also catch. */
export type ApiResult<T> = ApiOk<T> | ApiFailure;

/** Narrows an `ApiResult` to its success case for an `if`/early-return
 * style caller. Callers that need to distinguish `network_failure` from
 * `http_failure` still switch on `result.kind` themselves. */
export function isApiOk<T>(result: ApiResult<T>): result is ApiOk<T> {
  return result.kind === 'ok';
}

/** Narrows an `ApiResult` to either failure case. */
export function isApiFailure<T>(result: ApiResult<T>): result is ApiFailure {
  return result.kind !== 'ok';
}
