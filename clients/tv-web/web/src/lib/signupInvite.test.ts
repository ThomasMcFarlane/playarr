import { describe, expect, it } from "vitest";
import { parseSignupInvite } from "./signupInvite";

/** Matches this file's own `servers=` convention: base64url(JSON array of `{peer_node_id, url}` objects), no padding. */
function encodeServersParam(urls: string[]): string {
  return encodeServersParamRaw(JSON.stringify(urls.map((url, index) => ({ peer_node_id: `node-${index}`, url }))));
}

function encodeServersParamRaw(json: string): string {
  const base64 = btoa(json);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("parseSignupInvite", () => {
  it("reads a legacy singular server= as a one-element list", () => {
    expect(
      parseSignupInvite(
        "?server=https%3A%2F%2Fstreamarr.example.com%2F&invite=one-use-token"
      )
    ).toEqual({
      serverUrls: ["https://streamarr.example.com"],
      inviteToken: "one-use-token",
    });
  });

  it("allows local HTTP server addresses", () => {
    expect(parseSignupInvite("?server=http%3A%2F%2F192.168.1.20%3A8080&invite=token")).toEqual({
      serverUrls: ["http://192.168.1.20:8080"],
      inviteToken: "token",
    });
  });

  it("reads a bundled servers= into an ordered multi-address list", () => {
    const servers = encodeServersParam([
      "https://home.example.com",
      "https://east.example.com/",
      "http://192.168.1.5:8484",
    ]);
    expect(parseSignupInvite(`?servers=${servers}&invite=token`)).toEqual({
      serverUrls: [
        "https://home.example.com",
        "https://east.example.com",
        "http://192.168.1.5:8484",
      ],
      inviteToken: "token",
    });
  });

  it("prefers servers= over a legacy server= when both are present", () => {
    const servers = encodeServersParam(["https://east.example.com"]);
    expect(
      parseSignupInvite(`?server=https%3A%2F%2Fstale.example.com&servers=${servers}&invite=token`)
    ).toEqual({
      serverUrls: ["https://east.example.com"],
      inviteToken: "token",
    });
  });

  it("drops individual invalid addresses from a bundle without rejecting the whole invite", () => {
    const servers = encodeServersParam(["https://good.example.com", "javascript:alert(1)"]);
    expect(parseSignupInvite(`?servers=${servers}&invite=token`)).toEqual({
      serverUrls: ["https://good.example.com"],
      inviteToken: "token",
    });
  });

  it("rejects a servers= bundle that decodes to no valid addresses, without falling back to server=", () => {
    const servers = encodeServersParam(["javascript:alert(1)"]);
    expect(
      parseSignupInvite(`?server=https%3A%2F%2Ffallback.example.com&servers=${servers}&invite=token`)
    ).toBeNull();
  });

  it("rejects malformed servers= (bad base64url, or JSON that isn't an entry array)", () => {
    expect(parseSignupInvite("?servers=not-valid-base64url!!!&invite=token")).toBeNull();
    const notAnArray = encodeServersParamRaw(JSON.stringify({ addresses: ["https://a.example.com"] }));
    expect(parseSignupInvite(`?servers=${notAnArray}&invite=token`)).toBeNull();
  });

  it("extracts each entry's url and drops peer_node_id -- sign-up redemption doesn't need node attribution", () => {
    const servers = encodeServersParamRaw(
      JSON.stringify([
        { peer_node_id: "11111111-1111-4111-8111-111111111111", url: "https://home.example.com" },
        { peer_node_id: "22222222-2222-4222-8222-222222222222", url: "https://east.example.com" },
      ])
    );
    expect(parseSignupInvite(`?servers=${servers}&invite=token`)).toEqual({
      serverUrls: ["https://home.example.com", "https://east.example.com"],
      inviteToken: "token",
    });
  });

  it("drops entries that aren't well-formed {peer_node_id, url} objects, per-entry", () => {
    const servers = encodeServersParamRaw(
      JSON.stringify([
        { peer_node_id: "a", url: "https://good.example.com" },
        "https://bare-string.example.com",
        { peer_node_id: "b" },
        42,
        null,
      ])
    );
    expect(parseSignupInvite(`?servers=${servers}&invite=token`)).toEqual({
      serverUrls: ["https://good.example.com"],
      inviteToken: "token",
    });
  });

  it("rejects missing values and non-HTTP schemes", () => {
    expect(parseSignupInvite("?server=https%3A%2F%2Fstreamarr.example.com")).toBeNull();
    expect(parseSignupInvite("?server=javascript%3Aalert(1)&invite=token")).toBeNull();
    expect(parseSignupInvite("?invite=token")).toBeNull();
  });
});
