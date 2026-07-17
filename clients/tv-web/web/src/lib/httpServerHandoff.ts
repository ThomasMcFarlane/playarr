import { isPublicHttpIpUrl } from "./localNetworkFetch";

const API_BASE_URL_QUERY_PARAM = "apiBaseUrl";

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

/**
 * Resolves the hand-off before React or an API client can issue a mixed-content
 * request. Invitation links retain their route and token on the server-hosted
 * client; ordinary saved/query-configured servers return to sign-in because
 * browser storage cannot cross origins.
 */
export function initialPublicHttpPageHandoffUrl(
  pageUrl: string,
  storedServerUrl?: string
): string | undefined {
  const page = new URL(pageUrl);
  if (page.protocol !== "https:") return undefined;

  const isSignup = page.pathname.endsWith("/signup");
  const inviteServerUrl = isSignup ? page.searchParams.get("server") ?? undefined : undefined;
  const serverUrl =
    inviteServerUrl ??
    storedServerUrl ??
    page.searchParams.get(API_BASE_URL_QUERY_PARAM) ??
    undefined;
  if (!serverUrl || !isPublicHttpIpUrl(serverUrl)) return undefined;

  const server = new URL(serverUrl);
  const target = new URL(isSignup ? "/playarr/signup" : "/playarr/login", server.origin);
  if (isSignup) target.search = page.search;
  return target.toString();
}
