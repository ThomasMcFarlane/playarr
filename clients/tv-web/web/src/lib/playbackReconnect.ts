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
