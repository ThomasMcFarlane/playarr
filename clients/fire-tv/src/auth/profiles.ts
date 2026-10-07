/**
 * Viewer-profile logic: fetching the profiles available to the signed-in
 * account, working out which one is "current" (the `is_current` backfill
 * this file's own design-doc file-purpose comment names), and verifying a
 * locked profile's PIN. Deliberately headless -- no React, no navigation,
 * no storage -- so `ProfilesScreen.tsx` (a later, Features-phase step per
 * design doc's build order; not part of this pass) has a plain, already-
 * tested set of functions to call rather than having to invent this logic
 * itself. Ported logic, not re-derived: `toViewerProfile`'s `isCurrent`
 * rule is byte-for-byte the same expression tv-web's `Profiles.tsx` uses
 * (`profile.is_current || profile.id === currentUserId`) -- see that
 * function's own comment for exactly why both halves of the `||` matter.
 */
import type {ApiClient} from '@playarr-tv/api-client';

/**
 * The wire shape `GET /api/v1/users/profiles` returns
 * (`AvailableProfileResponse`), restated narrowly here rather than imported
 * from `@playarr-tv/api-client`'s generated types: this file only reads
 * four fields, and a structural type keeps it decoupled from that whole
 * generated module for a test double's sake (a fake `ApiClient` in
 * `profiles.test.ts` only has to shape its response as this, not import the
 * real generated schema).
 */
export interface AvailableProfileLike {
  id: string;
  username: string;
  display_name: string;
  is_current: boolean;
  pin_locked: boolean;
}

/** The client-local, camelCase shape every screen should read instead of the raw wire response. */
export interface ViewerProfile {
  id: string;
  username: string;
  /** `display_name` if the account has set one, else `username` -- same fallback tv-web's `Profiles.tsx` uses. */
  displayName: string;
  isCurrent: boolean;
  pinLocked: boolean;
}

/**
 * Maps one wire profile to `ViewerProfile`, applying the "is_current
 * backfill" rule: `profile.is_current` is the server's own opinion of which
 * profile this session is attached to, but a Fire TV's very first
 * `listAvailableProfiles()` call after linking can race a server that
 * hasn't finished attributing the freshly-issued token to a profile row
 * yet (the RFC 8628 device grant returns an *account*-level token, not a
 * chosen profile -- there is no profile-picker step inside the pairing flow
 * itself). `currentUserId` -- decoded from the access token via
 * `@playarr-tv/device-auth`'s `decodeAccessTokenUserId`, the caller's job
 * to supply, not this function's -- is the backfill: a profile whose `id`
 * matches the signed-in user is treated as current even if the server's own
 * `is_current` flag hasn't caught up yet.
 */
export function toViewerProfile(profile: AvailableProfileLike, currentUserId?: string): ViewerProfile {
  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.display_name || profile.username,
    isCurrent: profile.is_current || profile.id === currentUserId,
    pinLocked: profile.pin_locked,
  };
}

/**
 * Fetches every profile available to the signed-in account and maps each
 * through the `is_current` backfill above. The one network call this file
 * makes; every other export here is pure.
 */
export async function listViewerProfiles(
  client: ApiClient,
  currentUserId?: string
): Promise<ViewerProfile[]> {
  const available = await client.listAvailableProfiles();
  return available.map((profile) => toViewerProfile(profile, currentUserId));
}

/** The profile a caller should treat as active, if any of `profiles` is marked current. */
export function findCurrentProfile(profiles: readonly ViewerProfile[]): ViewerProfile | undefined {
  return profiles.find((profile) => profile.isCurrent);
}

/**
 * Verifies a four-digit PIN against a locked target profile before a caller
 * switches into it -- `POST /api/v1/users/profiles/{id}/verify-pin`. Wraps
 * `ApiClient.verifyProfilePin` (already the exact right shape; no
 * transformation needed) purely so every profile-related network call in
 * this app goes through this one file, rather than `ProfilesScreen.tsx`
 * reaching into `client.verifyProfilePin` directly and this module being an
 * incomplete picture of "how Fire TV talks to the profiles API".
 */
export async function verifyProfilePin(client: ApiClient, profileId: string, pin: string): Promise<boolean> {
  const response = await client.verifyProfilePin(profileId, {pin});
  return response.verified;
}
