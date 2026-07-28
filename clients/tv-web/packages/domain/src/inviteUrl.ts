/**
 * Multi-address invite/sign-up link builder -- `docs/architecture/
 * peer-groups.md` §6.1. Shared by both invite-link generators
 * (`web/src/pages/settings/Invite.tsx`'s friend-invite flow and
 * `admin/src/pages/Users.tsx`'s admin-issued invite flow) so the
 * `servers=` query-string encoding lives in exactly one place instead of
 * being duplicated across `web`/`admin`.
 */

/**
 * Structural mirror of `@playarr-tv/api-client`'s generated
 * `PeerAddressEntry` -- one address attributed to the `peer_nodes` row it
 * belongs to (`backend/crates/playarr-api/src/admin_peer.rs`). This
 * package's invite-link builder never needs the attribution itself --
 * sign-up redemption works at any node in the group by design, per that
 * file's own doc comment -- it only exists here so `PeerAddressBundleLike`
 * matches the real wire shape byte for byte.
 */
export interface PeerAddressEntryLike {
  peer_node_id: string;
  url: string;
}

/**
 * Structural mirror of `@playarr-tv/api-client`'s generated
 * `PeerAddressBundle` -- this package deliberately doesn't depend on the
 * generated schema (see this package's top-of-file comment, and
 * `version-check.ts`'s `CompatibilityEntryLike` for the same convention
 * applied elsewhere), so callers pass the real wire type straight through
 * without adding a package dependency here.
 *
 * `group_id`/`group_name` are only consulted by `knownServers.ts`'s
 * `mergeKnownServerGroup` (this package's other `PeerAddressBundleLike`
 * consumer, folding a login/refresh response into a `KnownServerGroup`,
 * §7.1) -- `buildInviteUrl` below only ever reads `addresses` -- but both
 * share this one structural type rather than each declaring its own
 * partial mirror of the same wire shape.
 */
export interface PeerAddressBundleLike {
  /** `null`/absent for a standalone deployment that has never founded or joined a group -- mirrors `PeerAddressBundle::group_id`'s own optionality. */
  group_id?: string | null;
  group_name?: string | null;
  /** Every active member's client-reachable addresses, each attributed to the peer node it belongs to, priority-ordered. A one-element list for a standalone (ungrouped) node. */
  addresses: readonly PeerAddressEntryLike[];
}

const SIGNUP_ORIGIN = "https://playarr.app";
const SIGNUP_PATH = "/signup";

/**
 * Builds `https://playarr.app/signup?servers=<bundle>&invite=<token>` --
 * the invite link every invite-issuing surface generates. Always encodes
 * `bundle.addresses` as the plural `servers=` param, never the legacy singular
 * `server=`, even for a standalone node's one-element bundle: one code
 * path, not a grouped/ungrouped branch, mirroring `PeerAddressBundle`'s
 * own backend invariant (`playarr-api/src/admin_peer.rs`) and
 * `oauth.rs::request_verification_uri`'s identical choice for
 * `verification_uri_complete` (§6.3). The *result* still looks identical
 * to today's single-address link for an ungrouped deployment -- only the
 * query-param encoding changed, not the QR/link UX.
 *
 * `signupInvite.ts::parseSignupInvite` is this function's decode
 * counterpart; a change to the encoding here must stay in lockstep with
 * that file and with `oauth.rs::encode_servers_param`, whose wire format
 * this matches byte for byte (see `encodeServersParam` below).
 */
export function buildInviteUrl(bundle: PeerAddressBundleLike, inviteToken: string): string {
  const url = new URL(SIGNUP_PATH, SIGNUP_ORIGIN);
  url.searchParams.set("servers", encodeServersParam(bundle.addresses));
  url.searchParams.set("invite", inviteToken);
  return url.toString();
}

/**
 * Mirrors `playarr-api/src/oauth.rs::encode_servers_param` exactly: the
 * entry list is JSON-array-of-`{peer_node_id, url}`-objects-encoded, then
 * base64url-encoded with no padding -- unpadded, so the value never
 * contains a `=` that would need percent-encoding inside a query string,
 * the same convention `playarr_auth::jwt::encode_eddsa` (backend) and
 * this repo's own `device-auth` package
 * (`serverAddressBundle.ts::decodeServersParam`, `jwt.ts`) already use for
 * the identical reason. Exact inverse of `signupInvite.ts`'s decode:
 * base64url-decode, then `JSON.parse` the resulting UTF-8 bytes as an array
 * of `{peer_node_id, url}` objects.
 */
function encodeServersParam(addresses: readonly PeerAddressEntryLike[]): string {
  const json = JSON.stringify(addresses);
  const base64 = typeof btoa === "function" ? btoa(json) : Buffer.from(json, "utf-8").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
