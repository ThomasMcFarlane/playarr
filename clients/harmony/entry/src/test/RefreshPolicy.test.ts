// entry/src/test/RefreshPolicy.test.ts
//
// Pure Node unit tests for core/RefreshPolicy.ts (brief section 4.5 / 7.2).
// This file imports only the plain-TypeScript core modules below and node's
// own test/assert builtins -- no ArkUI, no @kit.*/@ohos.* imports, no
// decorators.
//
// Covers:
//   - MAX_REFRESH_RETRY_ATTEMPTS caps 401-triggered refresh retries at 2.
//   - selectFailoverCandidates only ever returns addresses attributed to
//     the SAME peer_node_id that issued the current refresh token --
//     refresh tokens are node-scoped and never synced peer-to-peer.
//   - shouldProactivelyRefresh fires once ~80% of the access token's
//     expires_in has elapsed, ahead of a 401.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  MAX_REFRESH_RETRY_ATTEMPTS,
  selectFailoverCandidates,
  shouldProactivelyRefresh
} from "../main/ets/core/RefreshPolicy";
import { PeerAddress } from "../main/ets/core/Types/Auth";

function buildPeerAddress(peerNodeId: string, url: string): PeerAddress {
  const address: PeerAddress = {
    peer_node_id: peerNodeId,
    url: url
  };
  return address;
}

describe("MAX_REFRESH_RETRY_ATTEMPTS", () => {
  it("caps 401-triggered refresh retries at exactly 2", () => {
    assert.equal(MAX_REFRESH_RETRY_ATTEMPTS, 2);
  });
});

describe("selectFailoverCandidates: same-peer-only failover selection", () => {
  it("keeps only addresses attributed to the peer_node_id that issued the token", () => {
    const addresses: PeerAddress[] = [
      buildPeerAddress("peer-a", "https://a1.example"),
      buildPeerAddress("peer-b", "https://b1.example"),
      buildPeerAddress("peer-a", "https://a2.example"),
      buildPeerAddress("peer-c", "https://c1.example")
    ];
    const candidates = selectFailoverCandidates(addresses, "peer-a");
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].url, "https://a1.example");
    assert.equal(candidates[1].url, "https://a2.example");
  });

  it("returns an empty list when no address matches the issuing peer, even if others exist", () => {
    const addresses: PeerAddress[] = [
      buildPeerAddress("peer-b", "https://b1.example"),
      buildPeerAddress("peer-c", "https://c1.example")
    ];
    const candidates = selectFailoverCandidates(addresses, "peer-a");
    assert.equal(candidates.length, 0);
  });

  it("returns an empty list for an empty address book", () => {
    const candidates = selectFailoverCandidates([], "peer-a");
    assert.equal(candidates.length, 0);
  });

  it("never treats a same-group but different-peer address as a valid failover target", () => {
    // Even though peer-b is in the same group, its address is never a
    // valid retry target for a refresh token issued by peer-a: refresh
    // tokens are node-scoped, not group-scoped.
    const addresses: PeerAddress[] = [buildPeerAddress("peer-b", "https://b1.example")];
    const candidates = selectFailoverCandidates(addresses, "peer-a");
    assert.equal(candidates.length, 0);
  });
});

describe("shouldProactivelyRefresh: fires at the 80% mark", () => {
  const issuedAt = 0;
  const expiresInSeconds = 900; // Production access-token lifetime.

  it("does not refresh before 80% of the lifetime has elapsed", () => {
    const now = issuedAt + expiresInSeconds * 1000 * 0.79;
    assert.equal(shouldProactivelyRefresh(issuedAt, expiresInSeconds, now), false);
  });

  it("fires exactly at the 80% elapsed mark", () => {
    const now = issuedAt + expiresInSeconds * 1000 * 0.8;
    assert.equal(shouldProactivelyRefresh(issuedAt, expiresInSeconds, now), true);
  });

  it("keeps firing past 80% and all the way through full expiry", () => {
    const at90Percent = issuedAt + expiresInSeconds * 1000 * 0.9;
    assert.equal(shouldProactivelyRefresh(issuedAt, expiresInSeconds, at90Percent), true);

    const atFullExpiry = issuedAt + expiresInSeconds * 1000;
    assert.equal(shouldProactivelyRefresh(issuedAt, expiresInSeconds, atFullExpiry), true);

    const wellPastExpiry = issuedAt + expiresInSeconds * 1000 * 2;
    assert.equal(shouldProactivelyRefresh(issuedAt, expiresInSeconds, wellPastExpiry), true);
  });

  it("just below the 80% mark by a single millisecond still refuses to refresh", () => {
    const now = issuedAt + expiresInSeconds * 1000 * 0.8 - 1;
    assert.equal(shouldProactivelyRefresh(issuedAt, expiresInSeconds, now), false);
  });

  it("treats a non-positive expires_in as immediately due for refresh", () => {
    assert.equal(shouldProactivelyRefresh(issuedAt, 0, issuedAt), true);
  });
});
