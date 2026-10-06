/**
 * Playarr never blocks a user's `http://` server up front. The receiver page
 * is served over HTTPS, so a browser engine may refuse the mixed-content
 * request; whether a given Cast device does depends on its firmware and
 * cannot be known in advance. The receiver therefore always *tries* the
 * server the user chose, and only when that attempt fails on an `http://`
 * server from this `https://` page does it report `insecure_server`, with the
 * exact one-step remedy, instead of a generic failure.
 */

/** True when this page is `https:` and `baseUrl` is a plain `http:` origin. */
export function isMixedContentServer(baseUrl: string, pageProtocol: string): boolean {
  if (pageProtocol !== "https:") return false;
  try {
    return new URL(baseUrl).protocol === "http:";
  } catch {
    return false;
  }
}

/** The one-step remedy shown on the sender when an `http://` server could not be reached. */
export const INSECURE_SERVER_REMEDY =
  "This Chromecast could not reach your server over http://. One step: give your server an https:// address " +
  "(set PLAYARR_RELAY_REGISTER=true and PLAYARR_ACME_CHALLENGE=relay-dns-01 on a server with a public IPv4 address, " +
  "or put it behind a TLS reverse proxy), sign in again using that address and cast again. " +
  "Playing on this device or on another Playarr app keeps working over http://.";

/**
 * Whether `err` looks like a network-level failure (as opposed to a server
 * answer such as 401): `fetch` rejects with a `TypeError` for mixed-content,
 * DNS, CORS, TLS and offline failures alike.
 */
export function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof Error && /failed to fetch|network|load failed/i.test(err.message));
}

/**
 * Returns the remedy message when `err` is a network failure against an
 * `http://` server from this `https://` page, otherwise `null` so the caller
 * reports the ordinary error.
 */
export function insecureServerFailureMessage(
  err: unknown,
  baseUrl: string,
  pageProtocol: string
): string | null {
  return isMixedContentServer(baseUrl, pageProtocol) && isNetworkFailure(err)
    ? INSECURE_SERVER_REMEDY
    : null;
}
