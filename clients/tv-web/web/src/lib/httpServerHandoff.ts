import { isPublicHttpIpUrl } from "./localNetworkFetch";

/**
 * An HTTPS page cannot fetch a public HTTP origin. Hand the browser to the
 * Playarr bundle co-hosted by that Streamarr server instead, where API calls
 * are same-origin and therefore are not mixed content.
 */
export function publicHttpServerHandoffUrl(serverUrl: string): string | undefined {
  if (!isPublicHttpIpUrl(serverUrl)) return undefined;
  const server = new URL(serverUrl);
  return new URL("/playarr/login", server.origin).toString();
}
