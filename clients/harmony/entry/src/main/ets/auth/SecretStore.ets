/**
 * Hardware-backed storage for Playarr's two pieces of credential material:
 * the current bearer used on every authenticated request, and the rotating
 * renewal credential used at `POST /api/v1/auth/refresh` (brief section
 * 4.5). This is the ONLY file in this project allowed to import
 * `@kit.AssetStoreKit` (brief sections 3.2 and 9 Slice 3) -- every other
 * layer that needs either value goes through the exported functions below,
 * never through `asset` directly.
 *
 * Each value lives under its own stable alias:
 *   - `playarr.access_token`  -- short-lived (15 min) bearer.
 *   - `playarr.refresh_token` -- long-lived (30 day family), ROTATED on
 *     every successful `POST /api/v1/auth/refresh` (brief section 4.5); the
 *     caller is responsible for calling `saveRefreshToken` with the new
 *     value and discarding the old one before any other request observes
 *     this store, exactly as `SessionManager.ets` documents.
 *
 * Every asset is written with:
 *   - `Tag.ACCESSIBILITY = Accessibility.DEVICE_FIRST_UNLOCKED` -- readable
 *     as soon as the device has been unlocked once after boot, which is the
 *     right tradeoff for a TV/phone media client that legitimately needs to
 *     refresh a session from a background task before the user necessarily
 *     unlocks again.
 *   - `Tag.SYNC_TYPE = SyncType.NEVER` -- neither value may ever sync to
 *     another device via the account's keystore sync. A Playarr session
 *     is bound to exactly the device that paired/logged in; silently
 *     copying it to a second device would violate `max_concurrent_sessions`
 *     and the node-scoping rule in brief section 4.5.
 *
 * Every save REPLACES the previous value for its alias -- there is never a
 * stale duplicate left behind. `asset.add` is attempted first (the common
 * case: nothing stored yet, or the previous value was already cleared);
 * `asset.query` decides ahead of time whether an update is needed instead,
 * and a same-alias add failure (lost race against a concurrent writer) also
 * falls back to `asset.update` rather than surfacing a confusing
 * "already exists" error to the caller.
 *
 * Non-secret state (server list, device id, selected profile, theme, view
 * preferences) is `auth/SettingsStore.ets`'s job, never this file's --
 * see that file's own header comment for the full split.
 */

import { asset } from '@kit.AssetStoreKit';

import { logWarn } from '../util/Log';

const LOG_TAG: string = 'SecretStore';

const ACCESS_TOKEN_ALIAS: string = 'playarr.access_token';
const REFRESH_TOKEN_ALIAS: string = 'playarr.refresh_token';

/**
 * Encodes a JS string to UTF-8 bytes by hand (full 1-4 byte range, including
 * surrogate-pair code points beyond the BMP), so this module has no
 * dependency on a global `TextEncoder` -- not guaranteed to exist under the
 * ArkTS runtime (see `core/Base64Url.ts`'s header comment for the same
 * reasoning applied to its own byte helpers).
 */
function encodeUtf8(text: string): Uint8Array {
  const codePoints: number[] = [];
  const length: number = text.length;
  let index: number = 0;
  while (index < length) {
    const codeUnit: number = text.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && index + 1 < length) {
      const nextUnit: number = text.charCodeAt(index + 1);
      if (nextUnit >= 0xdc00 && nextUnit <= 0xdfff) {
        const codePoint: number = (codeUnit - 0xd800) * 0x400 + (nextUnit - 0xdc00) + 0x10000;
        codePoints.push(codePoint);
        index = index + 2;
        continue;
      }
    }
    codePoints.push(codeUnit);
    index = index + 1;
  }

  const bytes: number[] = [];
  for (const codePoint of codePoints) {
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6));
      bytes.push(0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >> 12));
      bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
      bytes.push(0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(0xf0 | (codePoint >> 18));
      bytes.push(0x80 | ((codePoint >> 12) & 0x3f));
      bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
      bytes.push(0x80 | (codePoint & 0x3f));
    }
  }

  const result: Uint8Array = new Uint8Array(bytes.length);
  let writeIndex: number = 0;
  while (writeIndex < bytes.length) {
    result[writeIndex] = bytes[writeIndex];
    writeIndex = writeIndex + 1;
  }
  return result;
}

/**
 * Decodes UTF-8 bytes back to a JS string by hand -- the read-side mirror of
 * `encodeUtf8` above, following the exact same algorithm already proven in
 * `core/Jwt.ts` and `core/ServerBundle.ts`. Throws on malformed input; every
 * call site here wraps this in its own `try`/`catch` so a corrupted keystore
 * entry degrades to "not present" rather than crashing the caller.
 */
function decodeUtf8(bytes: Uint8Array): string {
  let result: string = '';
  const length: number = bytes.length;
  let index: number = 0;
  while (index < length) {
    const byte0: number = bytes[index];
    let codePoint: number = 0;
    let extraBytes: number = 0;
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
    let consumed: number = 0;
    while (consumed < extraBytes) {
      if (index >= length) {
        throw new Error('truncated utf-8 sequence');
      }
      const nextByte: number = bytes[index];
      if ((nextByte & 0xc0) !== 0x80) {
        throw new Error('invalid utf-8 continuation byte');
      }
      codePoint = (codePoint << 6) | (nextByte & 0x3f);
      index = index + 1;
      consumed = consumed + 1;
    }
    if (codePoint > 0xffff) {
      const adjusted: number = codePoint - 0x10000;
      const highSurrogate: number = 0xd800 + (adjusted >> 10);
      const lowSurrogate: number = 0xdc00 + (adjusted & 0x3ff);
      result = result + String.fromCharCode(highSurrogate) + String.fromCharCode(lowSurrogate);
    } else {
      result = result + String.fromCharCode(codePoint);
    }
  }
  return result;
}

/** Builds a query `AssetMap` that matches exactly one alias. */
function aliasQuery(alias: string): asset.AssetMap {
  const query: asset.AssetMap = new Map();
  query.set(asset.Tag.ALIAS, encodeUtf8(alias));
  return query;
}

/**
 * Reads the raw secret bytes stored under `alias`, or `null` if nothing is
 * stored there (or the read fails for any other reason -- this function
 * never throws, matching every other "decode an unreliable source" helper
 * in this codebase).
 */
async function readSecretBytes(alias: string): Promise<Uint8Array | null> {
  const query: asset.AssetMap = aliasQuery(alias);
  query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);

  let results: asset.AssetMap[];
  try {
    results = await asset.query(query);
  } catch (error) {
    return null;
  }

  if (results.length === 0) {
    return null;
  }

  const first: asset.AssetMap = results[0];
  const secretValue: asset.Value | undefined = first.get(asset.Tag.SECRET);
  if (secretValue instanceof Uint8Array) {
    return secretValue;
  }
  return null;
}

/**
 * Writes `secretBytes` under `alias`, replacing any previous value so the
 * caller never observes a stale duplicate. See the file-header comment for
 * the add-then-fallback-to-update strategy.
 */
async function upsertSecret(alias: string, value: string): Promise<void> {
  const secretBytes: Uint8Array = encodeUtf8(value);
  const existing: Uint8Array | null = await readSecretBytes(alias);

  if (existing !== null) {
    const attributesToUpdate: asset.AssetMap = new Map();
    attributesToUpdate.set(asset.Tag.SECRET, secretBytes);
    await asset.update(aliasQuery(alias), attributesToUpdate);
    return;
  }

  const attributesToAdd: asset.AssetMap = new Map();
  attributesToAdd.set(asset.Tag.SECRET, secretBytes);
  attributesToAdd.set(asset.Tag.ALIAS, encodeUtf8(alias));
  attributesToAdd.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED);
  attributesToAdd.set(asset.Tag.SYNC_TYPE, asset.SyncType.NEVER);

  try {
    await asset.add(attributesToAdd);
  } catch (error) {
    // Lost a race against a concurrent writer that created this alias
    // between the existence check above and this add -- fall back to an
    // update so the caller still observes exactly one replaced value
    // instead of a thrown "already exists" error.
    logWarn(LOG_TAG, 'add() reported an existing alias after a fresh query found none; falling back to update()');
    const attributesToUpdate: asset.AssetMap = new Map();
    attributesToUpdate.set(asset.Tag.SECRET, secretBytes);
    await asset.update(aliasQuery(alias), attributesToUpdate);
  }
}

/**
 * Removes whatever is stored under `alias`, if anything. Never throws --
 * removing an absent asset (e.g. sign-out before pairing ever completed) is
 * a no-op, not an error, so `clearAllSecrets` can always run to completion.
 */
async function removeSecret(alias: string): Promise<void> {
  try {
    await asset.remove(aliasQuery(alias));
  } catch (error) {
    // Nothing was stored under this alias -- fine, that is the desired
    // end state anyway.
  }
}

/** Persists the current bearer, replacing any previous value. */
export async function saveAccessToken(token: string): Promise<void> {
  await upsertSecret(ACCESS_TOKEN_ALIAS, token);
}

/** Returns the current bearer, or `null` if none is stored. */
export async function getAccessToken(): Promise<string | null> {
  const bytes: Uint8Array | null = await readSecretBytes(ACCESS_TOKEN_ALIAS);
  if (bytes === null) {
    return null;
  }
  try {
    return decodeUtf8(bytes);
  } catch (error) {
    return null;
  }
}

/**
 * Persists the current renewal credential, replacing any previous value.
 * Callers performing a rotation (brief section 4.5) must call this with the
 * new value -- and only this -- before anything else can observe the store;
 * the old value is discarded as part of the same replace.
 */
export async function saveRefreshToken(token: string): Promise<void> {
  await upsertSecret(REFRESH_TOKEN_ALIAS, token);
}

/** Returns the current renewal credential, or `null` if none is stored. */
export async function getRefreshToken(): Promise<string | null> {
  const bytes: Uint8Array | null = await readSecretBytes(REFRESH_TOKEN_ALIAS);
  if (bytes === null) {
    return null;
  }
  try {
    return decodeUtf8(bytes);
  } catch (error) {
    return null;
  }
}

/**
 * Removes both stored values. Used on sign-out and on an unrecoverable
 * refresh failure (brief section 4.5: "clear all session material (keep
 * the server list), return to pairing"). Never throws.
 */
export async function clearAllSecrets(): Promise<void> {
  await removeSecret(ACCESS_TOKEN_ALIAS);
  await removeSecret(REFRESH_TOKEN_ALIAS);
}
