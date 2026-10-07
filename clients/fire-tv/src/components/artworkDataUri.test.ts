import {decode as base64Decode, encode as base64Encode} from 'base-64';
import {bytesToBinaryString, bytesToDataUri} from './artworkDataUri';

describe('bytesToBinaryString', () => {
  it('produces a one-char-per-byte string for a small array', () => {
    expect(bytesToBinaryString(new Uint8Array([72, 105]))).toBe('Hi');
  });

  it('returns the empty string for an empty array', () => {
    expect(bytesToBinaryString(new Uint8Array([]))).toBe('');
  });

  it('chunks correctly across a boundary far larger than one internal chunk, round-tripping through base-64 unchanged', () => {
    // 20000 bytes crosses several 8192-byte internal chunk boundaries.
    const bytes = new Uint8Array(20000);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 256;

    const binaryString = bytesToBinaryString(bytes);
    expect(binaryString).toHaveLength(20000);

    // Round-trip: encode then decode via the same `base-64` package
    // ArtworkImage.tsx uses, and confirm every byte survived the chunked
    // walk in the same order it went in.
    const roundTripped = base64Decode(base64Encode(binaryString));
    expect(roundTripped).toBe(binaryString);
  });
});

describe('bytesToDataUri', () => {
  it('builds a well-formed data: URI with the given MIME type and correctly base64-encoded bytes', () => {
    // "Hi" -> base64 "SGk=" is a well-known fixed point, independent of
    // this module's own encode call, so this assertion cannot pass by
    // both sides sharing the same bug.
    const uri = bytesToDataUri(new Uint8Array([72, 105]), 'image/jpeg');
    expect(uri).toBe('data:image/jpeg;base64,SGk=');
  });

  it('produces a decodable payload for a realistic poster-sized image', () => {
    const bytes = new Uint8Array(50000);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 7) % 256;

    const uri = bytesToDataUri(bytes, 'image/webp');
    expect(uri.startsWith('data:image/webp;base64,')).toBe(true);

    const base64Payload = uri.slice('data:image/webp;base64,'.length);
    const decoded = base64Decode(base64Payload);
    expect(decoded).toBe(bytesToBinaryString(bytes));
  });
});
