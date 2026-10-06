/**
 * The pure half of `ArtworkImage.tsx`'s `dataUri` strategy -- turning a
 * fetched image response's raw bytes into a `data:` URI RN's `<Image
 * source={{uri}}>` can render with no `headers` at all. This is the
 * fallback side of assumption A4 (design doc §1.3, §9.2 R10): if
 * `<Image source={{uri, headers}}>` turns out NOT to attach `headers` to
 * the underlying native image request on Vega, the credential has to move
 * from the request to the URI itself instead, which means fetching the
 * bytes in JavaScript (where `fetch` genuinely does carry an `Authorization`
 * header) and inlining them.
 *
 * Deliberately NOT built on `Blob`/`URL.createObjectURL` -- React Native's
 * `Blob` is not spec-complete and there is no `URL.createObjectURL` at all
 * (design doc §4.8's closing paragraph, the same reason `api/artworkUrl.ts`
 * exists instead of reusing `@playarr-tv/api-client`'s `Blob`-returning
 * artwork methods). Encoding is therefore done by hand: an `ArrayBuffer` of
 * raw bytes, walked in fixed-size chunks (never a single `String.fromCharCode(
 * ...hugeArray)` spread -- that blows the JS engine's maximum call-argument
 * count on anything but a tiny image) into a binary string, which `base-64`
 * (already a real dependency -- design doc §3.2, used for `atob` elsewhere
 * in this app) turns into the base64 text a `data:` URI needs.
 */
import {encode as base64Encode} from 'base-64';

/** Kept well under every JS engine's `Function.prototype.apply`/spread argument-count ceiling (which varies by engine but is comfortably above this on all of them), while still being large enough that the chunking loop below does not dominate encode time for a normal poster-sized image. */
const CHUNK_SIZE = 8192;

/** Converts raw bytes to the "binary string" `base-64`'s `encode()` expects -- one character per byte, code points 0-255 only, never interpreted as UTF-16 text. */
export function bytesToBinaryString(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + CHUNK_SIZE);
    chunks.push(String.fromCharCode(...chunk));
  }
  return chunks.join('');
}

/**
 * Builds a `data:{mimeType};base64,{...}` URI from a fetched image's raw
 * bytes. `mimeType` should come from the response's own `Content-Type`
 * header where available (`ArtworkImage.tsx`'s caller passes that through);
 * a caller with no usable content type at all should fall back to a generic
 * `image/*` type rather than guessing a specific format, since an RN
 * `<Image>` decodes purely from the byte content regardless of what the URI
 * claims, and getting the MIME type wrong here changes nothing about
 * whether decoding succeeds.
 */
export function bytesToDataUri(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${base64Encode(bytesToBinaryString(bytes))}`;
}
