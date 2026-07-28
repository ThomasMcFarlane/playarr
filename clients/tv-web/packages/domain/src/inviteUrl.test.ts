import { describe, expect, it } from "vitest";
import { buildInviteUrl, type PeerAddressEntryLike } from "./inviteUrl";

/** Exact inverse of `encodeServersParam` -- what `signupInvite.ts`/`serverAddressBundle.ts` decode. */
function decodeServersParam(value: string): PeerAddressEntryLike[] {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return JSON.parse(atob(padded)) as PeerAddressEntryLike[];
}

function entry(peerNodeId: string, url: string): PeerAddressEntryLike {
  return { peer_node_id: peerNodeId, url };
}

describe("buildInviteUrl", () => {
  it("builds a servers=-bearing signup link for a single-address bundle", () => {
    const url = buildInviteUrl(
      { addresses: [entry("11111111-1111-4111-8111-111111111111", "https://playarr.example.com")] },
      "one-use-token"
    );
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://playarr.app/signup");
    expect(parsed.searchParams.get("invite")).toBe("one-use-token");
    expect(parsed.searchParams.has("server")).toBe(false);
    expect(decodeServersParam(parsed.searchParams.get("servers")!)).toEqual([
      entry("11111111-1111-4111-8111-111111111111", "https://playarr.example.com"),
    ]);
  });

  it("encodes every address in a multi-address bundle, order and node attribution preserved", () => {
    const addresses = [
      entry("11111111-1111-4111-8111-111111111111", "https://home.example.com"),
      entry("22222222-2222-4222-8222-222222222222", "https://east.example.com"),
      entry("22222222-2222-4222-8222-222222222222", "http://192.168.1.5:8484"),
    ];
    const url = buildInviteUrl({ addresses }, "token");
    const parsed = new URL(url);
    expect(decodeServersParam(parsed.searchParams.get("servers")!)).toEqual(addresses);
  });

  it("still encodes servers= (not a legacy server=) for a standalone node's one-element bundle", () => {
    const url = buildInviteUrl(
      { addresses: [entry("11111111-1111-4111-8111-111111111111", "http://localhost:8484")] },
      "token"
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.has("servers")).toBe(true);
    expect(parsed.searchParams.has("server")).toBe(false);
  });

  it("produces an unpadded base64url value with no reserved query characters", () => {
    const url = buildInviteUrl(
      {
        addresses: [
          entry("11111111-1111-4111-8111-111111111111", "https://a.example.com"),
          entry("22222222-2222-4222-8222-222222222222", "https://b.example.com"),
        ],
      },
      "token"
    );
    const servers = new URL(url).searchParams.get("servers")!;
    expect(servers).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
