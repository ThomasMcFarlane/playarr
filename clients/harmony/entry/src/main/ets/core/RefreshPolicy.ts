/**
 * Access-token refresh timing and peer-failover selection.
 *
 * This file lives under `core/` and is deliberately plain TypeScript: no
 * ArkUI, no `@kit.*` / `@ohos.*` imports, no decorators. It is Linux
 * testable with `node --test` and has zero dependency on the HarmonyOS SDK.
 *
 * `auth/SessionManager.ets` owns the live token triple and calls
 * `shouldProactivelyRefresh` on a timer / before each request to decide
 * whether to rotate the access token ahead of a 401, and calls
 * `selectFailoverCandidates` when a refresh against the current server
 * fails, to find which other known peer addresses are even worth retrying
 * against. See the implementation brief section 4.5 ("Token refresh").
 *
 * CRITICAL (per the brief): refresh tokens are node-scoped and are never
 * synced peer-to-peer. A refresh retry is only ever worth attempting
 * against addresses attributed to the SAME `peer_node_id` that issued the
 * token (read from the access token's `iss` claim, see `core/Jwt.ts`).
 * Retrying a refresh against a different peer will never succeed and must
 * never be attempted.
 */

import { PeerAddress } from "./Types/Auth";

/** Refresh once this fraction of the access token's lifetime has elapsed. */
const PROACTIVE_REFRESH_FRACTION = 0.8;

/**
 * Access tokens live 15 minutes (`expires_in = 900`). Refresh proactively
 * at ~80% elapsed rather than waiting for a 401.
 */
export function shouldProactivelyRefresh(
  accessTokenIssuedAtMs: number,
  expiresInSeconds: number,
  nowMs: number
): boolean {
  const expiresInMs = expiresInSeconds * 1000;
  if (expiresInMs <= 0) {
    return true;
  }

  const elapsedMs = nowMs - accessTokenIssuedAtMs;
  const elapsedFraction = elapsedMs / expiresInMs;
  return elapsedFraction >= PROACTIVE_REFRESH_FRACTION;
}

/**
 * Cap on reactive 401-triggered refresh retries for a single request
 * (proactive refreshes, driven by `shouldProactivelyRefresh`, are not
 * counted against this cap).
 */
export const MAX_REFRESH_RETRY_ATTEMPTS = 2;

/**
 * Narrow a failover address book down to the addresses that are actually
 * safe to retry a refresh against: those attributed to the same
 * `peer_node_id` that issued the current refresh token. Refresh tokens are
 * node-scoped -- an address for any other peer is never a valid failover
 * target for this token, even if it belongs to the same group.
 */
export function selectFailoverCandidates(
  addresses: PeerAddress[],
  tokenIssuerPeerId: string
): PeerAddress[] {
  return addresses.filter((address: PeerAddress): boolean => address.peer_node_id === tokenIssuerPeerId);
}
