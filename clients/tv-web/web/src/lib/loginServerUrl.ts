const HOSTED_PLAYARR_HOSTNAME = "playarr.app";

/**
 * Do not present the hosted client itself as if it were a Streamarr server.
 * The hosted sign-in form always starts blank so a previously selected server
 * is never presented as a default. Self-hosted bundles still use their API URL.
 */
export function initialLoginServerUrl(
  apiBaseUrl: string,
  pageHostname: string
): string {
  return pageHostname === HOSTED_PLAYARR_HOSTNAME ? "" : apiBaseUrl;
}
