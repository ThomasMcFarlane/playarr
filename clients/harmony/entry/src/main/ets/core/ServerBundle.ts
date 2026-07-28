/**
 * Decoding for the `servers=` device-authorisation query parameter and the
 * `PeerAddressBundle` failover address book returned alongside login and
 * refresh responses.
 *
 * This file lives under `core/` and is deliberately plain TypeScript: no
 * ArkUI, no `@kit.*` / `@ohos.*` imports, no decorators. It is Linux
 * testable with `node --test` and has zero dependency on the HarmonyOS SDK.
 *
 * See the implementation brief section 4.3(a) ("Device authorisation") for
 * the `servers=` bundle shape and section 4.5 ("Token refresh") for
 * `PeerAddressBundle`.
 *
 * `verification_uri_complete` is
 * `"{abs}?user_code={user_code}&servers={b64}"`, where `{b64}` is
 * `base64url(URL_SAFE_NO_PAD)` of a JSON array of
 * `{"peer_node_id": "<uuid>", "url": "<string>"}` objects. The plain
 * `verification_uri` NEVER carries `servers=`. For a standalone node the
 * array is present but empty (`[]`) -- an empty result here is a legitimate
 * standalone-node value, not a decode failure, and a client that ignores
 * `servers=` entirely still works.
 */

import { decodeBase64Url } from "./Base64Url";
import { PeerAddress, PeerAddressBundle } from "./Types/Auth";

/**
 * Decodes a UTF-8 byte sequence into a JS string by hand, so this module has
 * no dependency on a global TextDecoder (not guaranteed to exist under the
 * ArkTS runtime). Handles the full 1-4 byte UTF-8 range, including surrogate
 * pairs for code points beyond the BMP.
 */
function decodeUtf8(bytes: Uint8Array): string {
  let result = "";
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
      throw new Error("invalid utf-8 leading byte");
    }
    index = index + 1;
    let consumed = 0;
    while (consumed < extraBytes) {
      if (index >= length) {
        throw new Error("truncated utf-8 sequence");
      }
      const nextByte = bytes[index];
      if ((nextByte & 0xc0) !== 0x80) {
        throw new Error("invalid utf-8 continuation byte");
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
 * Runtime shape guard for one `{peer_node_id, url}` entry. This exists
 * because `JSON.parse(...) as PeerAddress[]` (and the analogous cast for a
 * `PeerAddressBundleWire`) gives the value a trusted-looking static type
 * without checking anything at runtime -- an attacker- or bug-supplied body
 * can still hand back numbers, nulls, or missing fields despite the cast.
 */
function isValidPeerAddress(candidate: PeerAddress): boolean {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }
  if (typeof candidate.peer_node_id !== "string") {
    return false;
  }
  if (typeof candidate.url !== "string") {
    return false;
  }
  return true;
}

/**
 * Decodes the `servers=` query parameter carried on
 * `verification_uri_complete`: `base64url(URL_SAFE_NO_PAD)` over a JSON
 * array of `{peer_node_id, url}` objects (brief section 4.3(a)).
 *
 * Never throws. An empty string (the caller's representation of an absent
 * parameter), a value that fails base64url/UTF-8/JSON decoding, or a value
 * that decodes to something other than an array of well-formed entries, all
 * produce `[]` -- exactly like the legitimate present-but-empty array a
 * standalone node sends. Callers must not treat `[]` here as an error.
 */
export function decodeServersParam(base64url: string): PeerAddress[] {
  if (base64url.length === 0) {
    return [];
  }

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64Url(base64url);
  } catch (error) {
    return [];
  }

  let text: string;
  try {
    text = decodeUtf8(bytes);
  } catch (error) {
    return [];
  }

  let parsed: PeerAddress[];
  try {
    parsed = JSON.parse(text) as PeerAddress[];
  } catch (error) {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const result: PeerAddress[] = [];
  for (const candidate of parsed) {
    if (!isValidPeerAddress(candidate)) {
      return [];
    }
    const address: PeerAddress = { peer_node_id: candidate.peer_node_id, url: candidate.url };
    result.push(address);
  }
  return result;
}

/**
 * Raw JSON shape of `PeerAddressBundle` as it arrives on the wire (brief
 * section 4.5): `{group_id: uuid|null, group_name: string|null, addresses:
 * [{peer_node_id: uuid, url: string}]}`. Structurally identical to the
 * decoded `PeerAddressBundle` domain type from `./Types/Auth` -- kept as a
 * separate name so a value flowing in as
 * `JSON.parse(...) as PeerAddressBundleWire` reads, at the call site, as
 * "still needs validating" rather than "already trusted".
 */
export interface PeerAddressBundleWire {
  group_id: string | null;
  group_name: string | null;
  addresses: PeerAddress[];
}

/**
 * Validates and copies a raw `PeerAddressBundleWire` into a trusted
 * `PeerAddressBundle`, or returns `null` if the shape does not actually
 * match the contract despite whatever static type an upstream `as` cast
 * gave it.
 *
 * `group_id` / `group_name` are both `null` for a standalone node, and both
 * populated once the node is grouped (brief section 4.5). `addresses` is
 * copied in the server-given priority order -- this is a failover address
 * book, ordering is significant and must never be re-sorted here.
 */
export function decodePeerAddressBundle(json: PeerAddressBundleWire): PeerAddressBundle | null {
  if (typeof json !== "object" || json === null) {
    return null;
  }
  if (json.group_id !== null && typeof json.group_id !== "string") {
    return null;
  }
  if (json.group_name !== null && typeof json.group_name !== "string") {
    return null;
  }
  if (!Array.isArray(json.addresses)) {
    return null;
  }

  const addresses: PeerAddress[] = [];
  for (const candidate of json.addresses) {
    if (!isValidPeerAddress(candidate)) {
      return null;
    }
    const address: PeerAddress = { peer_node_id: candidate.peer_node_id, url: candidate.url };
    addresses.push(address);
  }

  const bundle: PeerAddressBundle = {
    group_id: json.group_id,
    group_name: json.group_name,
    addresses: addresses,
  };
  return bundle;
}
