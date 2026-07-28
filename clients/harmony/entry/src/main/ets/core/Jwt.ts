/**
 * Unverified JWT payload decoding for Playarr Server access tokens.
 *
 * No ArkUI, no @kit./@ohos. imports, no decorators -- plain TypeScript only.
 * Node-testable under `node --test` after a tsc transpile.
 */

import { AccessTokenClaims } from './Types/Auth';
import { decodeBase64Url } from './Base64Url';

interface RawTokenPayload {
  sub: string;
  device_id: string;
  session_id: string;
  iss: string;
  iat: number;
  exp: number;
  impersonated_by?: string;
}

/**
 * Decodes a UTF-8 byte sequence into a JS string by hand, so this module has
 * no dependency on a global TextDecoder (not guaranteed to exist under the
 * ArkTS runtime). Handles the full 1-4 byte UTF-8 range, including surrogate
 * pairs for code points beyond the BMP.
 */
function decodeUtf8(bytes: Uint8Array): string {
  let result = '';
  const length = bytes.length;
  let index = 0;
  while (index < length) {
    const byte0 = bytes[index];
    let codePoint = 0;
    let extraBytes = 0;
    if ((byte0 & 0x80) === 0) {
      codePoint = byte0;
      extraBytes = 0;
    } else if ((byte0 & 0xe0) === 0xc0) {
      codePoint = byte0 & 0x1f;
      extraBytes = 1;
    } else if ((byte0 & 0xf0) === 0xe0) {
      codePoint = byte0 & 0x0f;
      extraBytes = 2;
    } else if ((byte0 & 0xf8) === 0xf0) {
      codePoint = byte0 & 0x07;
      extraBytes = 3;
    } else {
      throw new Error('invalid utf-8 leading byte');
    }
    index = index + 1;
    let consumed = 0;
    while (consumed < extraBytes) {
      if (index >= length) {
        throw new Error('truncated utf-8 sequence');
      }
      const nextByte = bytes[index];
      if ((nextByte & 0xc0) !== 0x80) {
        throw new Error('invalid utf-8 continuation byte');
      }
      codePoint = (codePoint << 6) | (nextByte & 0x3f);
      index = index + 1;
      consumed = consumed + 1;
    }
    if (codePoint > 0xffff) {
      const adjusted = codePoint - 0x10000;
      const highSurrogate = 0xd800 + (adjusted >> 10);
      const lowSurrogate = 0xdc00 + (adjusted & 0x3ff);
      result = result + String.fromCharCode(highSurrogate) + String.fromCharCode(lowSurrogate);
    } else {
      result = result + String.fromCharCode(codePoint);
    }
  }
  return result;
}

/**
 * Decodes the middle (payload) segment of a JWT access token WITHOUT
 * verifying its signature, and returns the claims this client relies on.
 *
 * device_id (brief section 4.4): for the RFC 8628 device-authorisation flow,
 * device_id is minted by the server and is NEVER returned in any HTTP
 * response body. The only way a device-flow client learns its own device_id
 * is by reading the device_id claim out of the access token here. Since
 * POST /api/v1/auth/refresh REQUIRES device_id, forgetting this step makes
 * every device-paired session die silently the moment the 15-minute access
 * token expires.
 *
 * Never throws: a malformed token, the wrong number of "."-separated
 * segments, invalid base64url, invalid JSON, or a payload that is missing
 * (or mistypes) one of the required claims all simply produce a null
 * return.
 */
export function decodeAccessTokenClaims(token: string): AccessTokenClaims | null {
  try {
    const segments = token.split('.');
    if (segments.length !== 3) {
      return null;
    }
    const payloadSegment = segments[1];
    if (payloadSegment.length === 0) {
      return null;
    }
    const payloadBytes = decodeBase64Url(payloadSegment);
    const payloadText = decodeUtf8(payloadBytes);
    const parsed = JSON.parse(payloadText) as RawTokenPayload;
    if (typeof parsed.sub !== 'string') {
      return null;
    }
    if (typeof parsed.device_id !== 'string') {
      return null;
    }
    if (typeof parsed.session_id !== 'string') {
      return null;
    }
    if (typeof parsed.iss !== 'string') {
      return null;
    }
    if (typeof parsed.iat !== 'number') {
      return null;
    }
    if (typeof parsed.exp !== 'number') {
      return null;
    }
    if (typeof parsed.impersonated_by === 'string') {
      return {
        sub: parsed.sub,
        device_id: parsed.device_id,
        session_id: parsed.session_id,
        iss: parsed.iss,
        iat: parsed.iat,
        exp: parsed.exp,
        impersonated_by: parsed.impersonated_by,
      };
    }
    return {
      sub: parsed.sub,
      device_id: parsed.device_id,
      session_id: parsed.session_id,
      iss: parsed.iss,
      iat: parsed.iat,
      exp: parsed.exp,
    };
  } catch (error) {
    return null;
  }
}
