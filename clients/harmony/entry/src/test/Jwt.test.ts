// entry/src/test/Jwt.test.ts
//
// Pure Node unit tests for core/Jwt.ts (brief section 4.4 / 7.2).
// This file imports only plain-TypeScript core modules and node's own
// test/assert builtins -- no ArkUI, no @kit.*/@ohos.* imports, no
// decorators.
//
// The fixture tokens below are constructed BY HAND: a header segment and a
// payload segment are each JSON.stringify'd, UTF-8 encoded and then run
// through the real encodeBase64Url from core/Base64Url.ts (the same
// function decodeAccessTokenClaims's sibling decodeBase64Url is the
// inverse of), joined with "." and a base64url-encoded (but otherwise
// meaningless, since the signature is never verified here) signature
// segment -- i.e. a realistic three-segment JWT, not a mocked object.
//
// Covers:
//   - device_id and iss are extracted correctly from a realistic fixture.
//   - every other claim (sub, session_id, iat, exp) round-trips exactly.
//   - the optional impersonated_by claim is carried through when present.
//   - a wide variety of malformed tokens all return null and never throw.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { decodeAccessTokenClaims } from "../main/ets/core/Jwt";
import { encodeBase64Url } from "../main/ets/core/Base64Url";
import { AccessTokenClaims } from "../main/ets/core/Types/Auth";

interface FixturePayload {
  sub: string;
  device_id: string;
  session_id: string;
  iss: string;
  iat: number;
  exp: number;
  impersonated_by?: string;
}

const HEADER_JSON = '{"alg":"HS256","typ":"JWT"}';

const SIGNATURE_BYTES: Uint8Array = new Uint8Array([
  0x3a, 0x7f, 0x12, 0x88, 0x4c, 0x01, 0xde, 0xad, 0xbe, 0xef, 0x90, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
  0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
]);

function base64UrlEncodeText(text: string): string {
  const bytes: Uint8Array = new TextEncoder().encode(text);
  return encodeBase64Url(bytes);
}

const HEADER_SEGMENT: string = base64UrlEncodeText(HEADER_JSON);
const SIGNATURE_SEGMENT: string = encodeBase64Url(SIGNATURE_BYTES);

/** Builds a realistic three-segment JWT from a well-typed claims payload. */
function buildToken(payload: FixturePayload): string {
  const payloadSegment: string = base64UrlEncodeText(JSON.stringify(payload));
  return HEADER_SEGMENT + "." + payloadSegment + "." + SIGNATURE_SEGMENT;
}

/**
 * Builds a three-segment token from raw, possibly-malformed payload JSON
 * text -- used to exercise "valid JSON, wrong shape" cases that FixturePayload
 * cannot express (e.g. a numeric device_id).
 */
function buildTokenFromPayloadText(payloadJsonText: string): string {
  const payloadSegment: string = base64UrlEncodeText(payloadJsonText);
  return HEADER_SEGMENT + "." + payloadSegment + "." + SIGNATURE_SEGMENT;
}

/** Asserts decodeAccessTokenClaims(token) never throws and returns null. */
function assertMalformedReturnsNull(token: string): void {
  let result: AccessTokenClaims | null = null;
  assert.doesNotThrow(() => {
    result = decodeAccessTokenClaims(token);
  });
  assert.equal(result, null);
}

const FIXTURE_PAYLOAD: FixturePayload = {
  sub: "8f14e45f-ceea-467e-bbd6-7b4897ed6f1a",
  device_id: "3c1f9e2a-4b7d-4e8a-9c2f-1a2b3c4d5e6f",
  session_id: "6d4e2f1a-9b3c-4d5e-8f7a-2b1c3d4e5f6a",
  iss: "playarr",
  iat: 1753747200,
  exp: 1753748100,
};

describe("decodeAccessTokenClaims: realistic hand-built fixture", () => {
  it("extracts device_id and iss", () => {
    const token: string = buildToken(FIXTURE_PAYLOAD);
    const claims: AccessTokenClaims | null = decodeAccessTokenClaims(token);
    assert.ok(claims);
    assert.equal(claims.device_id, "3c1f9e2a-4b7d-4e8a-9c2f-1a2b3c4d5e6f");
    assert.equal(claims.iss, "playarr");
  });

  it("round-trips every required claim exactly", () => {
    const token: string = buildToken(FIXTURE_PAYLOAD);
    const claims: AccessTokenClaims | null = decodeAccessTokenClaims(token);
    assert.ok(claims);
    assert.deepStrictEqual(claims, FIXTURE_PAYLOAD);
  });

  it("carries the optional impersonated_by claim through when present, with a peer iss", () => {
    const payload: FixturePayload = {
      sub: FIXTURE_PAYLOAD.sub,
      device_id: FIXTURE_PAYLOAD.device_id,
      session_id: FIXTURE_PAYLOAD.session_id,
      iss: "8f2b1a3c-peer-node",
      iat: FIXTURE_PAYLOAD.iat,
      exp: FIXTURE_PAYLOAD.exp,
      impersonated_by: "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
    };
    const token: string = buildToken(payload);
    const claims: AccessTokenClaims | null = decodeAccessTokenClaims(token);
    assert.ok(claims);
    assert.equal(claims.impersonated_by, "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d");
    assert.equal(claims.iss, "8f2b1a3c-peer-node");
    assert.deepStrictEqual(claims, payload);
  });

  it("omits impersonated_by entirely from the result when it was absent from the payload", () => {
    const token: string = buildToken(FIXTURE_PAYLOAD);
    const claims: AccessTokenClaims | null = decodeAccessTokenClaims(token);
    assert.ok(claims);
    assert.equal(Object.prototype.hasOwnProperty.call(claims, "impersonated_by"), false);
  });
});

describe("decodeAccessTokenClaims: malformed tokens never throw, always return null", () => {
  it("returns null for too few dot-separated segments", () => {
    assertMalformedReturnsNull("onlyone.segment");
  });

  it("returns null for too many dot-separated segments", () => {
    assertMalformedReturnsNull("a.b.c.d");
  });

  it("returns null for a string with no dots at all", () => {
    assertMalformedReturnsNull("notatokenatall");
  });

  it("returns null for an empty string", () => {
    assertMalformedReturnsNull("");
  });

  it("returns null for an empty payload segment", () => {
    assertMalformedReturnsNull(HEADER_SEGMENT + ".." + SIGNATURE_SEGMENT);
  });

  it("returns null for a payload segment with invalid base64url characters", () => {
    assertMalformedReturnsNull(HEADER_SEGMENT + ".not_valid!!!." + SIGNATURE_SEGMENT);
  });

  it("returns null for a payload segment with an invalid base64url length", () => {
    // A single leftover character cannot decode to a whole byte.
    assertMalformedReturnsNull(HEADER_SEGMENT + ".a." + SIGNATURE_SEGMENT);
  });

  it("returns null when the payload decodes to bytes that are not valid UTF-8", () => {
    const invalidUtf8Bytes: Uint8Array = new Uint8Array([0x80, 0x80, 0x80]);
    const payloadSegment: string = encodeBase64Url(invalidUtf8Bytes);
    assertMalformedReturnsNull(HEADER_SEGMENT + "." + payloadSegment + "." + SIGNATURE_SEGMENT);
  });

  it("returns null when the payload is valid base64url and valid UTF-8 but not valid JSON", () => {
    assertMalformedReturnsNull(buildTokenFromPayloadText("not-json-at-all"));
  });

  it("returns null when the payload is valid JSON but not an object (a bare array)", () => {
    assertMalformedReturnsNull(buildTokenFromPayloadText("[1,2,3]"));
  });

  it("returns null when the payload object is missing device_id", () => {
    const payloadJsonText =
      '{"sub":"8f14e45f-ceea-467e-bbd6-7b4897ed6f1a","session_id":"6d4e2f1a-9b3c-4d5e-8f7a-2b1c3d4e5f6a",' +
      '"iss":"playarr","iat":1753747200,"exp":1753748100}';
    assertMalformedReturnsNull(buildTokenFromPayloadText(payloadJsonText));
  });

  it("returns null when device_id is present but not a string", () => {
    const payloadJsonText =
      '{"sub":"8f14e45f-ceea-467e-bbd6-7b4897ed6f1a","device_id":12345,' +
      '"session_id":"6d4e2f1a-9b3c-4d5e-8f7a-2b1c3d4e5f6a","iss":"playarr","iat":1753747200,"exp":1753748100}';
    assertMalformedReturnsNull(buildTokenFromPayloadText(payloadJsonText));
  });

  it("returns null when iat is present but not a number", () => {
    const payloadJsonText =
      '{"sub":"8f14e45f-ceea-467e-bbd6-7b4897ed6f1a","device_id":"3c1f9e2a-4b7d-4e8a-9c2f-1a2b3c4d5e6f",' +
      '"session_id":"6d4e2f1a-9b3c-4d5e-8f7a-2b1c3d4e5f6a","iss":"playarr","iat":"not-a-number","exp":1753748100}';
    assertMalformedReturnsNull(buildTokenFromPayloadText(payloadJsonText));
  });
});
