/**
 * RFC 4122 version-4 UUID generation.
 *
 * The one caller this exists for today is the manual/profile login path
 * (brief section 4.6): `POST /api/v1/auth/login` requires a `device_id`
 * (uuid, REQUIRED, stable per install) that this client mints once and then
 * persists (via `auth/SettingsStore.ets`) rather than regenerating on every
 * login call. The device-authorisation (RFC 8628) flow does NOT use this --
 * that flow's `device_id` is minted server-side and read back out of the
 * access token's claims (`core/Jwt.ts`).
 *
 * Prefers `@kit.CryptoArchitectureKit`'s `cryptoFramework` random generator
 * as the byte source. If that throws or is otherwise unavailable, falls
 * back to a `Math.random()`-based generator.
 *
 * NON-CRYPTOGRAPHIC FALLBACK NOTICE: the `Math.random()` path below is NOT
 * a cryptographically secure random source. That is acceptable here only
 * because the output is used exclusively as a client-generated `device_id`
 * -- an *identifier* the server records to tell devices apart, never a
 * secret, credential, or anything that must be unpredictable to an
 * adversary. Do not reuse this fallback for anything that needs real
 * randomness guarantees (tokens, keys, nonces).
 */

import { cryptoFramework } from '@kit.CryptoArchitectureKit';

const HEX_DIGITS: string = '0123456789abcdef';
const UUID_BYTE_LENGTH: number = 16;

/**
 * Attempts to source 16 random bytes from `cryptoFramework`'s random
 * generator. Returns `null` (never throws) on any failure, so `generateUuidV4`
 * can fall back cleanly.
 */
function randomBytesFromCryptoFramework(): Uint8Array | null {
  try {
    const generator: cryptoFramework.Random = cryptoFramework.createRandom();
    const blob: cryptoFramework.DataBlob = generator.generateRandomSync(UUID_BYTE_LENGTH);
    if (blob.data.length !== UUID_BYTE_LENGTH) {
      return null;
    }
    return blob.data;
  } catch (err) {
    return null;
  }
}

/**
 * Non-cryptographic fallback byte source -- see the file-header notice
 * above before reusing this for anything other than a `device_id`.
 */
function randomBytesFromMathRandom(): Uint8Array {
  const bytes: Uint8Array = new Uint8Array(UUID_BYTE_LENGTH);
  let index: number = 0;
  while (index < UUID_BYTE_LENGTH) {
    bytes[index] = Math.floor(Math.random() * 256) & 0xff;
    index = index + 1;
  }
  return bytes;
}

function byteToHex(value: number): string {
  const highNibble: number = (value >> 4) & 0x0f;
  const lowNibble: number = value & 0x0f;
  return HEX_DIGITS.charAt(highNibble) + HEX_DIGITS.charAt(lowNibble);
}

/**
 * Stamps the RFC 4122 version (4) and variant (10) bits into `bytes` (which
 * must already be 16 random bytes) and formats them as the canonical
 * "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx" UUID string, `y` in `{8,9,a,b}`.
 */
function formatUuid(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  let result: string = '';
  let index: number = 0;
  while (index < UUID_BYTE_LENGTH) {
    result = result + byteToHex(bytes[index]);
    if (index === 3 || index === 5 || index === 7 || index === 9) {
      result = result + '-';
    }
    index = index + 1;
  }
  return result;
}

/**
 * Generates a random RFC 4122 version-4 UUID string. See the file-header
 * comment for the random-source preference order and the non-cryptographic
 * fallback notice.
 */
export function generateUuidV4(): string {
  const cryptoBytes: Uint8Array | null = randomBytesFromCryptoFramework();
  const bytes: Uint8Array = cryptoBytes !== null ? cryptoBytes : randomBytesFromMathRandom();
  return formatUuid(bytes);
}
