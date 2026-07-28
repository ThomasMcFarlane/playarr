import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "@playarr-tv/api-client";
import { authorizeDeviceAcrossServers, decodeServersParam, parseServersParam } from "./serverAddressBundle";

/** Exact inverse of `playarr-api/src/oauth.rs`'s `encode_servers_param`:
 * base64url (`URL_SAFE_NO_PAD`, unpadded) of `JSON.stringify(value)`. */
function base64UrlEncode(value: unknown): string {
  const raw = Buffer.from(JSON.stringify(value), "utf-8").toString("base64");
  return raw.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Wraps each url in the `{peer_node_id, url}` shape `encode_servers_param` actually emits. */
function entries(urls: string[]): Array<{ peer_node_id: string; url: string }> {
  return urls.map((url, index) => ({ peer_node_id: `node-${index}`, url }));
}

function mockFetch(handler: (request: Request) => Response | Promise<Response>) {
  return vi.fn(async (request: Request) => handler(request));
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clientFor(url: string, handler: (request: Request) => Response | Promise<Response>): ApiClient {
  return new ApiClient({ baseUrl: url, fetchImpl: mockFetch(handler), getAccessToken: () => "token" });
}

describe("decodeServersParam", () => {
  it("decodes the exact wire format playarr-api/src/oauth.rs's encode_servers_param produces", () => {
    const encoded = base64UrlEncode(entries(["https://home.example.com", "https://east.example.com"]));
    expect(decodeServersParam(encoded)).toEqual(["https://home.example.com", "https://east.example.com"]);
  });

  it("decodes an empty bundle -- a standalone node that has never configured an address", () => {
    expect(decodeServersParam(base64UrlEncode([]))).toEqual([]);
  });

  it("returns undefined, not a throw, for malformed base64", () => {
    expect(decodeServersParam("not-valid-base64!!!")).toBeUndefined();
  });

  it("returns undefined for valid base64 whose JSON payload isn't an array at all", () => {
    expect(decodeServersParam(base64UrlEncode({ not: "an array" }))).toBeUndefined();
  });

  it("drops non-string and non-HTTP(S) urls per-entry instead of rejecting the whole bundle -- mirrors signupInvite.ts's identical leniency", () => {
    expect(decodeServersParam(base64UrlEncode(entries([])))).toEqual([]);
    expect(
      decodeServersParam(
        base64UrlEncode([
          { peer_node_id: "a", url: "https://home.example.com" },
          { peer_node_id: "b", url: "javascript:alert(1)" },
          { peer_node_id: "c", url: 42 },
          { peer_node_id: "d", url: "not a url" },
        ])
      )
    ).toEqual(["https://home.example.com"]);
  });

  it("drops entries that aren't well-formed {peer_node_id, url} objects, per-entry -- extracting url and ignoring peer_node_id along the way", () => {
    expect(
      decodeServersParam(
        base64UrlEncode([
          { peer_node_id: "11111111-1111-4111-8111-111111111111", url: "https://home.example.com" },
          "https://bare-string.example.com",
          { peer_node_id: "b" },
          42,
          null,
        ])
      )
    ).toEqual(["https://home.example.com"]);
  });
});

describe("parseServersParam", () => {
  it("extracts and decodes servers= off a device-pairing link's own query string", () => {
    const encoded = base64UrlEncode(entries(["https://home.example.com"]));
    expect(parseServersParam(`?user_code=ABCD-2345&servers=${encoded}`)).toEqual([
      "https://home.example.com",
    ]);
  });

  it("returns undefined when servers= is absent -- an old cached client or pre-upgrade peer", () => {
    expect(parseServersParam("?user_code=ABCD-2345")).toBeUndefined();
  });

  it("returns undefined when the bundle decodes to an empty list", () => {
    expect(parseServersParam(`?servers=${base64UrlEncode(entries([]))}`)).toBeUndefined();
  });
});

describe("authorizeDeviceAcrossServers", () => {
  it("resolves as soon as one address accepts, without waiting on an address that never answers", async () => {
    let deadAddressWasTried = false;
    const deadClient = clientFor("https://dead.example.com", () => {
      deadAddressWasTried = true;
      // Simulates an unreachable/hung peer: a sequential implementation
      // (await each address in turn before trying the next) would hang
      // this whole test forever on this promise; the real, parallel
      // implementation must not.
      return new Promise<Response>(() => {});
    });
    const liveClient = clientFor("https://home.example.com", () => jsonResponse(204, null));

    await authorizeDeviceAcrossServers(
      ["https://dead.example.com", "https://home.example.com"],
      "ABCD-2345",
      {
        buildClient: (url) => (url === "https://dead.example.com" ? deadClient : liveClient),
      }
    );

    // Both addresses were genuinely dispatched -- this isn't "try the first,
    // only fall back to the second on failure," it's a real race.
    expect(deadAddressWasTried).toBe(true);
  });

  it("throws a representative 404 once every address genuinely fails (an invalid/expired code)", async () => {
    const urls = ["https://a.example.com", "https://b.example.com"];
    await expect(
      authorizeDeviceAcrossServers(urls, "ABCD-2345", {
        buildClient: (url) => clientFor(url, () => jsonResponse(404, { message: "not found" })),
      })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("prefers a 404 over a same-batch network error -- a 404 means the code is genuinely wrong, a network error just means that one address was unreachable", async () => {
    const urls = ["https://unreachable.example.com", "https://reachable.example.com"];
    await expect(
      authorizeDeviceAcrossServers(urls, "ABCD-2345", {
        buildClient: (url) =>
          clientFor(url, () => {
            if (url.includes("unreachable")) throw new TypeError("Failed to fetch");
            return jsonResponse(404, { message: "not found" });
          }),
      })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("throws for an empty address list instead of silently no-op-ing", async () => {
    await expect(
      authorizeDeviceAcrossServers([], "ABCD-2345", {
        buildClient: () => clientFor("unused", () => jsonResponse(204, null)),
      })
    ).rejects.toThrow(/no server address/i);
  });
});
