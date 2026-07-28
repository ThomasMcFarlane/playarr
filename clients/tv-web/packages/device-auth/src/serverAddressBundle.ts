/**
 * Client-side half of `docs/architecture/peer-groups.md` §6.3: the human
 * approving a TV pairing reads the issuing peer's `PeerAddressBundle`
 * straight off the `/link` URL it opened or scanned, then fans the
 * approval call out to every address in that bundle in parallel -- it has
 * to beat an impatient human, so it cannot afford to wait out sequential
 * timeouts the way the TV side's own `requestDeviceCode` retry (trying its
 * remembered addresses one at a time) can.
 */
import { ApiClient, ApiError } from "@playarr-tv/api-client";

/**
 * Decodes the `servers=` query param value `playarr-api/src/oauth.rs`'s
 * `encode_servers_param` embeds in `verification_uri_complete` (§6.3),
 * identical to the encoding `signupInvite.ts`'s invite links use for the
 * same param (§6.1) -- exact wire format, matching the backend byte for
 * byte: base64url (`URL_SAFE_NO_PAD`, unpadded) of a JSON array of
 * `{peer_node_id, url}` objects. Only each entry's `url` is kept --
 * `peer_node_id` is dropped, since device-pairing approval works at any
 * node in the group by design (accounts/policies are synced, §3.7/Phase
 * 2), so this package never needs to know which node a given address came
 * from. Returns `undefined` for a missing/malformed base64, non-JSON, or
 * non-array payload; otherwise keeps only the entries that extract to a
 * string `url` *and* parse as an absolute HTTP(S) URL, dropping anything
 * else per-entry rather than rejecting the whole bundle for one bad address
 * -- mirrors `signupInvite.ts::parseSignupInvite`'s identical per-entry
 * leniency for the same `servers=` shape ("as long as one of them connects,
 * it's fine" is this design's guiding principle throughout, not just for
 * reachability but for parsing too), and matters here for the same reason
 * it matters there: `/link`'s query string is exactly as attacker-suppliable
 * as `/signup`'s, so each candidate is validated before it's ever handed to
 * `new ApiClient({ baseUrl: ... })`.
 */
export function decodeServersParam(value: string): string[] | undefined {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const json = typeof atob === "function" ? atob(padded) : Buffer.from(padded, "base64").toString("utf-8");
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return undefined;
    return parsed
      .map(extractUrl)
      .filter((url): url is string => url !== undefined)
      .map(canonicalizeHttpUrl)
      .filter((url): url is string => url !== undefined);
  } catch {
    return undefined;
  }
}

/** Extracts the `url` field off one `servers=` entry (`{peer_node_id, url}`); `undefined` if the entry isn't a well-formed object with a string `url`. Mirrors `web/src/lib/signupInvite.ts::decodeServersParam`'s identical extraction. */
function extractUrl(entry: unknown): string | undefined {
  if (entry === null || typeof entry !== "object") return undefined;
  const url = (entry as Record<string, unknown>).url;
  return typeof url === "string" ? url : undefined;
}

/** Validates and canonicalises one candidate address; `undefined` if it isn't an absolute HTTP(S) URL. Mirrors `signupInvite.ts::canonicalizeHttpUrl` exactly. */
function canonicalizeHttpUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

/**
 * Parses the `servers=` param straight off a device-pairing link's own
 * query string (e.g. `location.search` on `/link?user_code=...&servers=...`)
 * -- that's where a `PeerAddressBundle` lands for the approving human's
 * device, per §6.3: it doesn't need any group knowledge of its own, the
 * link itself carries it. `undefined` when the param is absent (an old
 * cached client, or a pre-upgrade peer that hasn't shipped `servers=` yet)
 * or decodes to an empty list -- both mean "no bundle" to callers, which
 * fall back to their own remembered address(es) instead.
 */
export function parseServersParam(search: string): string[] | undefined {
  const raw = new URLSearchParams(search).get("servers");
  if (!raw) return undefined;
  const urls = decodeServersParam(raw);
  return urls && urls.length > 0 ? urls : undefined;
}

export interface AuthorizeDeviceAcrossServersOptions {
  /**
   * Builds an `ApiClient` bound to one candidate address. Callers should
   * reuse their own access-token logic here (a JWT minted on one group
   * peer verifies on every peer, §3.9/§5.4's cross-node trust) rather than
   * standing up a fresh, unauthenticated client per URL.
   */
  buildClient: (url: string) => ApiClient;
}

/**
 * Picks the error to surface after every address in a fan-out failed.
 * Exactly one peer recognizes a real `user_code` and 204s; every other
 * (reachable) peer 404s harmlessly -- so if the whole batch failed, a 404
 * is the routine, expected shape of that failure and worth surfacing as
 * "check your code," whereas a same-batch network error more likely just
 * means one particular address was unreachable, not that the code itself
 * is wrong. Falls back to the last error if no 404 is present at all.
 */
function representativeFailure(errors: unknown[]): unknown {
  return errors.find((error) => error instanceof ApiError && error.status === 404) ?? errors[errors.length - 1];
}

/**
 * RFC 8628 §3.2's human-approval step (`POST /api/v1/oauth/device/authorize
 * {user_code}`), fanned out to every address in a `servers=` bundle IN
 * PARALLEL, not sequentially -- §6.3. Resolves as soon as any one address
 * accepts the approval (racing every attempt and ignoring the rest once one
 * settles) without waiting for the others to answer at all.
 * Throws only once every address has failed.
 */
export async function authorizeDeviceAcrossServers(
  urls: readonly string[],
  userCode: string,
  options: AuthorizeDeviceAcrossServersOptions
): Promise<void> {
  if (urls.length === 0) {
    throw new Error("No server address available to approve this device.");
  }

  await new Promise<void>((resolve, reject) => {
    const errors: unknown[] = new Array(urls.length);
    let failureCount = 0;

    urls.forEach((url, index) => {
      // Starting from a resolved promise also turns a synchronous client
      // construction failure into one failed race participant.
      void Promise.resolve()
        .then(() => options.buildClient(url).authorizeDevice({ user_code: userCode }))
        .then(resolve, (error: unknown) => {
          errors[index] = error;
          failureCount += 1;
          if (failureCount === urls.length) reject(representativeFailure(errors));
        });
    });
  });
}
