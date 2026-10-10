/**
 * Pure rules for recovering an in-flight stream after the backend restarts or
 * the connection drops briefly. The player stays mounted and shows an inline
 * "Reconnecting" state while these rules drive a bounded number of
 * re-negotiations; only once the budget is spent does the viewer see the
 * failure and the manual "Restart playback" action.
 */

/** Shaka network-category error codes: BAD_HTTP_STATUS, HTTP_ERROR, TIMEOUT. */
const NETWORK_ERROR_CODES = new Set(["1001", "1002", "1003"]);

export const MAX_RECONNECT_ATTEMPTS = 8;

export interface ReconnectEngineError {
  code: string;
  httpStatus?: number;
  requestUri?: string;
}

/**
 * True when a fatal engine error looks like the server (or the network to it)
 * went away rather than the media itself being undecodable. Only on-demand
 * session URLs are considered: those die with the backend process, and a
 * fresh negotiation resumes at the same playhead.
 */
export function isRecoverableConnectionError(
  error: ReconnectEngineError | undefined,
  options: { onDemandSession: boolean }
): boolean {
  if (!error || !options.onDemandSession) return false;
  if (error.requestUri && !error.requestUri.includes("/api/v1/media/sessions/")) return false;
  const status = error.httpStatus;
  if (status !== undefined) return status === 404 || status === 408 || status >= 500;
  return NETWORK_ERROR_CODES.has(error.code);
}

/** Exponential back-off: 1 s, 2 s, 4 s, 8 s, then 10 s steps. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(10_000, 1000 * 2 ** Math.max(0, attempt));
}

export function canReconnect(attempt: number): boolean {
  return attempt < MAX_RECONNECT_ATTEMPTS;
}

/**
 * True when `error` is not the one a reconnect was already started for. The
 * engine keeps reporting its last error until the replacement source starts to
 * load, so the same error object can still be visible when the re-negotiated
 * session becomes ready; a genuinely new failure is a new object.
 */
export function isUnhandledEngineError<T extends object>(
  error: T | undefined,
  handled: T | undefined
): boolean {
  return error !== undefined && error !== handled;
}

/**
 * Which server-side session close a change of engine state calls for. Only the
 * transition into a terminal state closes the session: a stale terminal state
 * seen again after a reconnect has negotiated a replacement must leave that
 * replacement alone.
 */
export function sessionCloseForEngineState(
  previousState: string,
  state: string
): "completed" | "error" | null {
  if (previousState === state) return null;
  if (state === "ended") return "completed";
  if (state === "error") return "error";
  return null;
}

/** Silent re-tries of a failed first negotiation (1 s, 2 s, 4 s) before the error view appears. */
export const MAX_NEGOTIATION_AUTO_RETRIES = 3;

/** True for failures worth retrying silently: the network dropped, or the server timed out or failed. */
export function isTransientNegotiationError(err: unknown): boolean {
  if (err && typeof err === "object" && "status" in err && typeof err.status === "number") {
    const status = err.status;
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }
  if (err instanceof Error) return err.name !== "AbortError";
  return false;
}

const RAW_NETWORK_MESSAGE = /failed to fetch|networkerror|network request failed|load failed|fetch failed/i;

/**
 * Human wording for a failed negotiation, replacing raw exception text such as
 * "Failed to fetch". `fallback` is the already-described API message for
 * errors that carry a useful one (permission, household, sign-in).
 */
export function humanNegotiationMessage(err: unknown, fallback: string): string {
  const status =
    err && typeof err === "object" && "status" in err && typeof err.status === "number"
      ? err.status
      : undefined;
  if (status === undefined) {
    if (err instanceof Error && RAW_NETWORK_MESSAGE.test(err.message)) {
      return "Can't reach the server. Check your connection and try again.";
    }
    return RAW_NETWORK_MESSAGE.test(fallback)
      ? "Can't reach the server. Check your connection and try again."
      : fallback;
  }
  if (status === 404) return "This title is no longer available on the server.";
  if (status === 408 || status === 429 || status >= 500) {
    return "The server had a problem starting this title. Try again in a moment.";
  }
  return /^API request failed/i.test(fallback) ? "Playback could not be started." : fallback;
}

/**
 * Media-decode failures, as opposed to network ones: Shaka's MediaSource
 * append failures (3014, 3015), the `<video>` element's own error (3016),
 * content the browser cannot play (4032), or the element's MEDIA_ERR_DECODE
 * and MEDIA_ERR_SRC_NOT_SUPPORTED on a native source.
 */
const DECODE_ERROR_CODES = new Set(["3014", "3015", "3016", "4032", "MEDIA_3", "MEDIA_4"]);

/** The server profile a decode failure falls back to: H.264 every browser and TV decodes. */
export const DECODE_FALLBACK_PROFILE = "h264-1080p-8mbps";

/**
 * True when a session that plays the source video (direct play, or HLS whose
 * video the server copied) failed to decode, so the player should ask once for
 * a forced H.264 transcode at the same position instead of showing the error.
 * A forced transcode already is the converted stream, so it never falls back.
 */
export function shouldFallBackToTranscodeAfterDecodeError(
  error: ReconnectEngineError | undefined,
  options: { forceTranscode: boolean; alreadyAttempted: boolean }
): boolean {
  if (!error || options.forceTranscode || options.alreadyAttempted) return false;
  return DECODE_ERROR_CODES.has(error.code);
}
