/**
 * RFC 4648 base64url (no padding) encode/decode over Uint8Array.
 *
 * No ArkUI, no @kit./@ohos. imports, no decorators -- plain TypeScript only.
 * This must also run as plain Node-testable TypeScript with zero HarmonyOS
 * SDK, so it cannot rely on the Node global `Buffer` (not guaranteed to
 * exist under the ArkTS runtime, and reaching for it via `globalThis` is
 * disallowed anyway). The 6-bit encode/decode tables are implemented by
 * hand instead -- this is a small, well-known algorithm.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Encodes bytes as base64url text ('-' and '_' in place of '+' and '/'),
 * with no padding characters, per RFC 4648.
 */
export function encodeBase64Url(bytes: Uint8Array): string {
  let output = '';
  const length = bytes.length;
  let index = 0;
  while (index + 3 <= length) {
    const byte0 = bytes[index];
    const byte1 = bytes[index + 1];
    const byte2 = bytes[index + 2];
    output = output + ALPHABET.charAt(byte0 >> 2);
    output = output + ALPHABET.charAt(((byte0 & 0x03) << 4) | (byte1 >> 4));
    output = output + ALPHABET.charAt(((byte1 & 0x0f) << 2) | (byte2 >> 6));
    output = output + ALPHABET.charAt(byte2 & 0x3f);
    index = index + 3;
  }
  const remaining = length - index;
  if (remaining === 1) {
    const byte0 = bytes[index];
    output = output + ALPHABET.charAt(byte0 >> 2);
    output = output + ALPHABET.charAt((byte0 & 0x03) << 4);
  } else if (remaining === 2) {
    const byte0 = bytes[index];
    const byte1 = bytes[index + 1];
    output = output + ALPHABET.charAt(byte0 >> 2);
    output = output + ALPHABET.charAt(((byte0 & 0x03) << 4) | (byte1 >> 4));
    output = output + ALPHABET.charAt((byte1 & 0x0f) << 2);
  }
  return output;
}

/**
 * Decodes base64url text back into bytes, per RFC 4648. No padding is
 * required; a small number of trailing '=' characters are tolerated and
 * stripped before decoding, since some producers pad regardless.
 *
 * Throws a real Error for an invalid character or an invalid length (a
 * dangling single leftover character cannot decode to a whole byte).
 * Callers that need a never-throws contract (see Jwt.ts) must wrap calls to
 * this function in their own try/catch.
 */
export function decodeBase64Url(input: string): Uint8Array {
  let cleaned = input;
  while (cleaned.length > 0 && cleaned.charAt(cleaned.length - 1) === '=') {
    cleaned = cleaned.substring(0, cleaned.length - 1);
  }
  const length = cleaned.length;
  if (length % 4 === 1) {
    throw new Error('invalid base64url length: ' + String(length));
  }
  const outputLength = Math.floor((length * 6) / 8);
  const output = new Uint8Array(outputLength);
  let buffer = 0;
  let bitsInBuffer = 0;
  let outputIndex = 0;
  for (let index = 0; index < length; index = index + 1) {
    const char = cleaned.charAt(index);
    const value = ALPHABET.indexOf(char);
    if (value === -1) {
      throw new Error('invalid base64url character: ' + char);
    }
    buffer = (buffer << 6) | value;
    bitsInBuffer = bitsInBuffer + 6;
    if (bitsInBuffer >= 8) {
      bitsInBuffer = bitsInBuffer - 8;
      output[outputIndex] = (buffer >> bitsInBuffer) & 0xff;
      outputIndex = outputIndex + 1;
    }
  }
  return output;
}
