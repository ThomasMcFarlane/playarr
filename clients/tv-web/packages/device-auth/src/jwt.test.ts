import { describe, expect, it } from "vitest";
import { decodeAccessTokenDeviceId, decodeAccessTokenIssuer, decodeAccessTokenUserId } from "./jwt";

function base64UrlEncode(json: unknown): string {
  const raw = Buffer.from(JSON.stringify(json), "utf-8").toString("base64");
  return raw.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fakeJwt(payload: unknown): string {
  const header = base64UrlEncode({ alg: "HS256", typ: "JWT" });
  const body = base64UrlEncode(payload);
  return `${header}.${body}.signature-not-checked`;
}

describe("decodeAccessTokenUserId", () => {
  it("extracts sub from a well-formed access token", () => {
    const token = fakeJwt({ sub: "00000000-0000-0000-0000-000000000009", exp: 9999999999 });
    expect(decodeAccessTokenUserId(token)).toBe("00000000-0000-0000-0000-000000000009");
  });

  it("extracts the device id needed for refresh after pairing", () => {
    expect(
      decodeAccessTokenDeviceId(
        fakeJwt({ sub: "user-1", device_id: "device-42", exp: 9999999999 })
      )
    ).toBe("device-42");
  });

  it("returns undefined for a token missing a payload segment", () => {
    expect(decodeAccessTokenUserId("only-one-segment")).toBeUndefined();
    expect(decodeAccessTokenUserId("two.segments")).toBeUndefined();
  });

  it("returns undefined when the payload isn't valid base64/JSON", () => {
    expect(decodeAccessTokenUserId("header.not-valid-base64!!!.sig")).toBeUndefined();
  });

  it("returns undefined when sub is missing or not a string", () => {
    expect(decodeAccessTokenUserId(fakeJwt({ exp: 123 }))).toBeUndefined();
    expect(decodeAccessTokenUserId(fakeJwt({ sub: 123 }))).toBeUndefined();
  });
});

describe("decodeAccessTokenIssuer", () => {
  it("extracts a standalone/HS256 node's fixed issuer string", () => {
    const token = fakeJwt({ sub: "user-1", iss: "streamarr", exp: 9999999999 });
    expect(decodeAccessTokenIssuer(token)).toBe("streamarr");
  });

  it("extracts a grouped node's peer_id issuer", () => {
    const token = fakeJwt({
      sub: "user-1",
      iss: "11111111-1111-4111-8111-111111111111",
      exp: 9999999999,
    });
    expect(decodeAccessTokenIssuer(token)).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("returns undefined when iss is missing or not a string", () => {
    expect(decodeAccessTokenIssuer(fakeJwt({ sub: "user-1" }))).toBeUndefined();
    expect(decodeAccessTokenIssuer(fakeJwt({ sub: "user-1", iss: 123 }))).toBeUndefined();
  });

  it("returns undefined for a malformed token, same as the other claim readers", () => {
    expect(decodeAccessTokenIssuer("only-one-segment")).toBeUndefined();
    expect(decodeAccessTokenIssuer("header.not-valid-base64!!!.sig")).toBeUndefined();
  });
});
