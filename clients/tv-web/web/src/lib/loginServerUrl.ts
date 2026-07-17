const HOSTED_PLAYARR_HOSTNAME = "playarr.app";

/**
 * Do not present the hosted client itself as if it were a Streamarr server.
 * Self-hosted bundles still use their own origin, while an explicit query or
 * previously stored server remains available on playarr.app.
 */
export function initialLoginServerUrl(
  apiBaseUrl: string,
  pageOrigin: string,
  pageHostname: string
): string {
  if (pageHostname === HOSTED_PLAYARR_HOSTNAME && apiBaseUrl === pageOrigin) {
    return "";
  }
  return apiBaseUrl;
}
