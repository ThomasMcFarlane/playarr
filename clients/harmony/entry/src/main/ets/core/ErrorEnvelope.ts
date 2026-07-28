/**
 * Decoding for every HTTP error-response shape the Playarr Server sends
 * (brief section 4.2, "Error envelopes"). There are three distinct shapes,
 * and decoding one with the wrong decoder is a real bug class -- this file
 * discriminates between them explicitly rather than guessing from whichever
 * fields happen to be present.
 *
 * This file lives under `core/` and is deliberately plain TypeScript: no
 * ArkUI, no `@kit.*` / `@ohos.*` imports, no decorators. It is Linux
 * testable with `node --test` and has zero dependency on the HarmonyOS SDK.
 *
 * The three shapes:
 * 1. Every non-OAuth error: `{"error": "<stable_code>", "message": "<human
 *    text>"}`. Stable codes seen so far are enumerated in `KnownErrorCode`
 *    below, but an unrecognised code must still decode successfully -- the
 *    server may grow new codes before this client is rebuilt.
 * 2. `POST /api/v1/oauth/token` failures: always HTTP 400, body
 *    `{"error": "<code>"}` -- exactly ONE field, no `message`. Codes:
 *    `authorization_pending`, `slow_down`, `expired_token`, `access_denied`,
 *    `unsupported_grant_type`.
 * 3. 426 Upgrade Required: `Content-Type: application/json`, body
 *    `{"error":"client_upgrade_required","minimum_version":"<v>"}` (plus an
 *    `Upgrade: playarr-client/<minimum_version>` response header, which is
 *    not this function's concern). The rejection path that triggers this is
 *    fully implemented server-side but currently unreachable in practice --
 *    handle it anyway.
 *
 * Static-SPA-fallback caveat: `build_router` mounts a static-SPA fallback
 * whenever web assets are present, so an unmatched `/api/...`-ish path can
 * come back as `index.html` with HTTP 200 and `Content-Type: text/html`.
 * `decodeErrorEnvelope` checks `contentType` FIRST and returns the distinct
 * `"not_json"` result for anything that is not actually JSON -- it never
 * attempts to `JSON.parse` an HTML body.
 */

/**
 * Stable `error` codes seen on the general (non-OAuth) envelope. `503`s are
 * `no_peer_available`, `no_transcode_capacity` and `poller_not_running`;
 * `client_upgrade_required` in this shape is theoretical (see the dedicated
 * 426 shape below) but is included here since the brief lists it among the
 * "stable codes seen".
 */
export type KnownErrorCode =
  | "not_found"
  | "bad_request"
  | "conflict"
  | "internal_error"
  | "unauthorized"
  | "forbidden"
  | "source_instance_unreachable"
  | "no_peer_available"
  | "no_transcode_capacity"
  | "poller_not_running"
  | "client_upgrade_required";

/**
 * The general envelope's `error` field: one of the known stable codes, or
 * any other string. An unrecognised code is never rejected -- it is kept
 * verbatim so callers can still show a message and log the exact code.
 */
export type ErrorCode = KnownErrorCode | string;

/**
 * The five outcomes `POST /api/v1/oauth/token` can report as its lone
 * `error` field (brief section 4.3(b) / `core/DeviceCodePolicy.ts`).
 */
export type OAuthErrorCode =
  | "authorization_pending"
  | "slow_down"
  | "expired_token"
  | "access_denied"
  | "unsupported_grant_type";

/** Shape 1: `{"error": "<stable_code>", "message": "<human text>"}`. */
export interface GeneralErrorEnvelope {
  kind: "general";
  status: number;
  code: ErrorCode;
  message: string;
}

/** Shape 2: `{"error": "<code>"}`, always HTTP 400, no `message` field. */
export interface OAuthTokenErrorEnvelope {
  kind: "oauth";
  status: number;
  code: OAuthErrorCode | string;
}

/** Shape 3: `{"error":"client_upgrade_required","minimum_version":"<v>"}`. */
export interface UpgradeRequiredEnvelope {
  kind: "upgrade_required";
  status: number;
  minimumVersion: string;
}

/**
 * The response was not JSON at all -- most commonly the static-SPA
 * fallback's `index.html` (HTTP 200, `Content-Type: text/html`) for an
 * unmatched path. Never the result of a failed `JSON.parse`; this is
 * decided purely from `Content-Type` before any parsing is attempted.
 */
export interface NotJsonEnvelope {
  kind: "not_json";
  status: number;
  contentType: string | null;
}

/**
 * The response claimed to be JSON but did not decode into any of the three
 * known shapes (invalid JSON, an unexpected top-level type, or an object
 * missing the fields its status code requires).
 */
export interface MalformedErrorEnvelope {
  kind: "malformed";
  status: number;
  bodyText: string;
}

/**
 * Tagged union of every outcome `decodeErrorEnvelope` can produce. Callers
 * switch on `kind` rather than probing for whichever fields happen to be
 * present.
 */
export type ErrorEnvelopeResult =
  | GeneralErrorEnvelope
  | OAuthTokenErrorEnvelope
  | UpgradeRequiredEnvelope
  | NotJsonEnvelope
  | MalformedErrorEnvelope;

/** `POST /api/v1/oauth/token` failures are always reported at this status. */
const OAUTH_TOKEN_ERROR_STATUS = 400;

/** The dedicated upgrade-required shape is always reported at this status. */
const UPGRADE_REQUIRED_STATUS = 426;

/** The fixed `error` code on the dedicated 426 upgrade-required shape. */
const CLIENT_UPGRADE_REQUIRED_CODE = "client_upgrade_required";

/**
 * Raw JSON shape covering all three envelopes at once: `message` and
 * `minimum_version` are each present on exactly one of the three shapes, so
 * both are optional here and `decodeErrorEnvelope` checks for the specific
 * combination each status/shape requires.
 */
interface ErrorEnvelopeBodyWire {
  error: string;
  message?: string;
  minimum_version?: string;
}

/**
 * True only when `contentType` actually indicates a JSON body -- a missing
 * header, `text/html` (the static-SPA fallback), or anything else is not
 * JSON. Media-type parameters (e.g. `; charset=utf-8`) and case are both
 * tolerated.
 */
function isJsonContentType(contentType: string | null): boolean {
  if (contentType === null) {
    return false;
  }
  const normalized = contentType.toLowerCase();
  const semicolonIndex = normalized.indexOf(";");
  let mediaType = normalized;
  if (semicolonIndex !== -1) {
    mediaType = normalized.slice(0, semicolonIndex);
  }
  mediaType = mediaType.trim();
  return mediaType === "application/json";
}

/**
 * Decodes one HTTP error response into a tagged `ErrorEnvelopeResult`.
 * Never throws.
 *
 * Order of decisions, fixed by the brief:
 * 1. `contentType` must actually say JSON, or the result is `"not_json"` --
 *    this guards against the static-SPA `index.html` fallback and is
 *    checked before any `JSON.parse` is attempted.
 * 2. A `status` of 426 always decodes as the dedicated upgrade-required
 *    shape (`{error: "client_upgrade_required", minimum_version}`), never
 *    as a general envelope, even though the same code string is also listed
 *    among the general envelope's known codes.
 * 3. A `status` of exactly 400 whose body has EXACTLY ONE field decodes as
 *    the OAuth-token shape (`{error}`, no `message`). A 400 general error
 *    (`{error, message}`) is a different, two-field body and falls through
 *    to the general case below.
 * 4. Otherwise, a body with both `error` and `message` as strings decodes
 *    as the general envelope.
 * 5. Anything else -- invalid JSON, a non-object top level, or an object
 *    missing the fields its status requires -- is `"malformed"`.
 */
export function decodeErrorEnvelope(status: number, contentType: string | null, bodyText: string): ErrorEnvelopeResult {
  if (!isJsonContentType(contentType)) {
    const notJson: NotJsonEnvelope = { kind: "not_json", status: status, contentType: contentType };
    return notJson;
  }

  let parsed: ErrorEnvelopeBodyWire;
  try {
    parsed = JSON.parse(bodyText) as ErrorEnvelopeBodyWire;
  } catch (error) {
    const malformed: MalformedErrorEnvelope = { kind: "malformed", status: status, bodyText: bodyText };
    return malformed;
  }

  if (typeof parsed !== "object" || parsed === null) {
    const malformed: MalformedErrorEnvelope = { kind: "malformed", status: status, bodyText: bodyText };
    return malformed;
  }

  if (status === UPGRADE_REQUIRED_STATUS) {
    if (parsed.error === CLIENT_UPGRADE_REQUIRED_CODE && typeof parsed.minimum_version === "string") {
      const upgrade: UpgradeRequiredEnvelope = {
        kind: "upgrade_required",
        status: status,
        minimumVersion: parsed.minimum_version,
      };
      return upgrade;
    }
    const malformed: MalformedErrorEnvelope = { kind: "malformed", status: status, bodyText: bodyText };
    return malformed;
  }

  const fieldCount = Object.keys(parsed).length;

  if (status === OAUTH_TOKEN_ERROR_STATUS && fieldCount === 1 && typeof parsed.error === "string") {
    const oauth: OAuthTokenErrorEnvelope = { kind: "oauth", status: status, code: parsed.error };
    return oauth;
  }

  if (typeof parsed.error === "string" && typeof parsed.message === "string") {
    const general: GeneralErrorEnvelope = {
      kind: "general",
      status: status,
      code: parsed.error,
      message: parsed.message,
    };
    return general;
  }

  const malformed: MalformedErrorEnvelope = { kind: "malformed", status: status, bodyText: bodyText };
  return malformed;
}
