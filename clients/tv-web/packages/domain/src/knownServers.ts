/**
 * Remembered group of server addresses -- `docs/architecture/
 * peer-groups.md` §7.1. Supersedes the single `streamarr:apiBaseUrl`
 * localStorage key (`STORED_API_BASE_URL_KEY` in `./index`, still exported
 * from there unchanged): once a client has talked to a peer group, "which
 * server do I talk to" is a priority-ordered *list* of addresses that can
 * fail over into one another, not one URL. `getStoredApiBaseUrl`/
 * `setStoredApiBaseUrl` are deliberately left alone by this module --
 * `ApiClientProvider.tsx`'s migration/fallback logic (also §7.1/§7.3, a
 * later slice of this same phase) is what decides when to prefer a
 * `KnownServerGroup` over the legacy single key, not this file.
 *
 * This module intentionally doesn't import `@streamarr-tv/api-client`'s
 * generated `PeerAddressBundle` type (see this package's top-of-file
 * comment, and `version-check.ts`'s `CompatibilityEntryLike` /
 * `inviteUrl.ts`'s `PeerAddressBundleLike` for the same convention applied
 * elsewhere) -- `mergeKnownServerGroup` below folds a `PeerAddressBundleLike`
 * into a `KnownServerGroup` (§7.1's "self-healing" write-back from every
 * login/refresh response), and callers pass the real generated
 * `PeerAddressBundle` straight through, structurally.
 */
import type { PeerAddressBundleLike } from "./inviteUrl";

/** One remembered address within a group. */
export interface KnownServer {
  url: string;
  /**
   * The `peer_nodes` row this address belongs to (`admin_peer.rs`'s
   * `PeerAddressEntry::peer_node_id`), when known -- folded in by
   * `mergeKnownServerGroup` from a login/refresh response's
   * node-attributed `PeerAddressBundle`. Absent for a standalone
   * (ungrouped) node's address, and for anything remembered before this
   * attribution existed. `@streamarr-tv/device-auth::session.ts`'s
   * `ensureAccessToken` reads this back out to scope its cross-peer
   * refresh retry (§3.7 -- refresh tokens are never synced peer-to-peer,
   * so only an address attributed to the *same* peer that issued the
   * token is worth retrying).
   */
  peerNodeId?: string;
  /** `Date.now()` of the last time this address answered a request successfully, if ever. */
  lastSuccessAt?: number;
}

/** A remembered, priority-ordered group of server addresses for one account. */
export interface KnownServerGroup {
  /** Absent for a standalone (ungrouped) server -- mirrors `PeerAddressBundle`'s own optionality. */
  groupId?: string;
  groupName?: string;
  /** Priority-ordered. */
  servers: KnownServer[];
  /** Fast path: tried before `servers`, so a healthy reconnect skips a probe round trip entirely. */
  lastGoodUrl?: string;
}

const KNOWN_SERVER_GROUP_STORAGE_KEY = "streamarr:knownServerGroup";

function isKnownServerShape(value: unknown): value is KnownServer {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.url !== "string") return false;
  if (candidate.peerNodeId !== undefined && typeof candidate.peerNodeId !== "string") return false;
  if (candidate.lastSuccessAt !== undefined && typeof candidate.lastSuccessAt !== "number") return false;
  return true;
}

function isKnownServerGroupShape(value: unknown): value is KnownServerGroup {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.groupId !== undefined && typeof candidate.groupId !== "string") return false;
  if (candidate.groupName !== undefined && typeof candidate.groupName !== "string") return false;
  if (candidate.lastGoodUrl !== undefined && typeof candidate.lastGoodUrl !== "string") return false;
  return Array.isArray(candidate.servers) && candidate.servers.every(isKnownServerShape);
}

/** Reads the remembered server group, if any. Never throws -- a missing or malformed value just reads as "no group remembered yet". */
export function readKnownServers(): KnownServerGroup | undefined {
  if (typeof localStorage === "undefined") return undefined;
  const raw = localStorage.getItem(KNOWN_SERVER_GROUP_STORAGE_KEY);
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isKnownServerGroupShape(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Persists `group` wholesale, replacing whatever (if anything) was remembered before. */
export function rememberGroup(group: KnownServerGroup): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KNOWN_SERVER_GROUP_STORAGE_KEY, JSON.stringify(group));
}

/**
 * Folds a login/refresh response's `PeerAddressBundle` (§7.1;
 * `LoginResponse`/`RefreshResponse` both carry it once grouped) into a
 * `KnownServerGroup`: preserves each still-listed address's
 * `lastSuccessAt`, records its `peerNodeId` attribution
 * (`admin_peer.rs::PeerAddressEntry` -- the entire reason `bundle.addresses`
 * isn't a bare `string[]`, see that type's own doc comment), and promotes
 * `respondingUrl` (the address that just answered) to `lastGoodUrl`. Builds
 * the group from scratch the first time a previously-ungrouped client's
 * server joins/founds a group -- there is nothing to preserve yet in that
 * case, `readKnownServers()` reads as `undefined` and every server starts
 * with no `lastSuccessAt`.
 *
 * Callers pass the real generated `PeerAddressBundle` straight through
 * (structurally matches `PeerAddressBundleLike`, no cast needed) -- see
 * this module's top-of-file comment for why this package doesn't import
 * that type itself.
 *
 * Formerly `web/src/lib/ApiClientProvider.tsx`'s own, node-attribution-free
 * `mergeKnownServerGroup`, relocated here now that the attribution itself
 * -- not just each entry's `url` -- is something a caller needs preserved:
 * `@streamarr-tv/device-auth::session.ts`'s `ensureAccessToken` reads
 * `peerNodeId` back out (via the `KnownServerGroup` it's handed) to scope
 * its cross-peer refresh retry to the issuing peer's own alternate
 * addresses (§3.7). This fold has to be where every self-healing write
 * lands, not reimplemented ad hoc per caller.
 */
export function mergeKnownServerGroup(bundle: PeerAddressBundleLike, respondingUrl: string): KnownServerGroup {
  const priorByUrl = new Map((readKnownServers()?.servers ?? []).map((server) => [server.url, server]));
  return {
    groupId: bundle.group_id ?? undefined,
    groupName: bundle.group_name ?? undefined,
    servers: bundle.addresses.map(({ peer_node_id, url }) => ({
      url,
      peerNodeId: peer_node_id || undefined,
      lastSuccessAt: priorByUrl.get(url)?.lastSuccessAt,
    })),
    lastGoodUrl: respondingUrl,
  };
}

/**
 * Records a successful call against `url`: bumps that address's
 * `lastSuccessAt` and promotes it to `lastGoodUrl` so it's tried first next
 * time (§7.1's fast path), without physically reordering `servers` itself.
 * A no-op when no group is remembered yet -- there is nothing to update,
 * and this function deliberately never materialises a one-server group out
 * of a bare URL; that's `rememberGroup`'s job (fed from a login/refresh
 * response's `peer_addresses`, or an invite redemption).
 */
export function rememberServerSuccess(url: string): void {
  const group = readKnownServers();
  if (!group) return;

  const now = Date.now();
  const servers = group.servers.map((server) =>
    server.url === url ? { ...server, lastSuccessAt: now } : server
  );
  rememberGroup({ ...group, servers, lastGoodUrl: url });
}

/** Explicit manual reset -- the only recovery path if a group becomes fully defunct (§7.1, §7.3). */
export function forgetGroup(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(KNOWN_SERVER_GROUP_STORAGE_KEY);
}

/**
 * Resolves to the first reachable address in `group`: `lastGoodUrl` first
 * (skipping a probe round trip on the common "still the same server"
 * path), then `servers` in priority order. Throws only once every
 * candidate address has failed its probe -- callers (§7.2's
 * `ensureAccessToken` fallback, `ApiClientProvider.tsx`'s initial
 * resolution) treat that as "fall through to asking the user again", not a
 * case this function itself has a further fallback for.
 */
export async function resolveReachableServer(
  group: KnownServerGroup,
  probe: (url: string) => Promise<boolean>
): Promise<string> {
  const candidates: string[] = [];
  if (group.lastGoodUrl) candidates.push(group.lastGoodUrl);
  for (const server of group.servers) {
    if (!candidates.includes(server.url)) candidates.push(server.url);
  }

  for (const url of candidates) {
    if (await probe(url)) return url;
  }

  throw new Error("None of this group's remembered server addresses are reachable.");
}
