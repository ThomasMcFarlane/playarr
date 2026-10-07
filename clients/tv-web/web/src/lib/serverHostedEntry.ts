/**
 * An HTTPS page (the hosted launcher) cannot call an `http://` Playarr
 * Server: browsers block it as mixed content, and a TV browser such as
 * VIDAA's has no setting to allow it. The server itself serves the same web
 * client at `/tv/` (see `playarr_api::build_router_with_tv`), so opening
 * that address over the scheme the user chose has no mixed content at all.
 */
export const SERVER_HOSTED_PATH = "/tv/";

/**
 * The server-hosted entry URL for `serverUrl`, or `null` when the hosted page
 * is not HTTPS or the server is not plain `http://` (nothing to fix). An
 * address without a scheme is treated as `http://`, as in the sign-in form.
 */
export function serverHostedEntryUrl(
  serverUrl: string,
  pageProtocol: string,
  platform: string,
  /** Optional page under /tv/ with its query, e.g. `link?user_code=ABCD-2345`. */
  page = ""
): string | null {
  if (pageProtocol !== "https:") return null;
  const input = serverUrl.trim();
  if (!input) return null;
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `http://${input.replace(/^\/\//, "")}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:") return null;
    const [pagePath, pageQuery = ""] = page.replace(/^\//, "").split("?");
    const params = new URLSearchParams(pageQuery);
    if (platform === "tv-vidaa") params.set("platform", "tv-vidaa");
    const query = params.toString();
    return `http://${url.host}${SERVER_HOSTED_PATH}${pagePath}${query ? `?${query}` : ""}`;
  } catch {
    return null;
  }
}
