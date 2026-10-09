/**
 * The viewer's avatar as this device knows it: a cache of the account's server-side preference, stored like the web
 * does (`playarr.profileAvatars.v1`, keyed by server and user) so a profile shows the same avatar on every device.
 *
 * The server is the source of truth. `syncAvatar` replaces the cached entry with the account's preference, and clears
 * it when the account has none, so a stale local choice can never outlive the account's own.
 */
import type {ApiClient, ProfileAvatarPreference} from '@playarr-tv/api-client';
import {PROFILE_AVATAR_PRESETS, type ProfileAvatarPresetId} from '../components/profileAvatarPresets';

const STORAGE_KEY = 'playarr.profileAvatars.v1';
const CUSTOM_DATA_URL = /^data:image\/jpeg;base64,/i;

export type StoredProfileAvatar = {kind: 'preset'; preset: ProfileAvatarPresetId} | {kind: 'custom'; dataUrl: string};

type Listener = () => void;
const listeners = new Set<Listener>();
const memory = new Map<string, StoredProfileAvatar>();

export function subscribeProfileAvatars(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isPresetId(value: unknown): value is ProfileAvatarPresetId {
  return PROFILE_AVATAR_PRESETS.some((preset) => preset.id === value);
}

export function profileAvatarScope(apiBaseUrl: string, userId: string): string {
  return JSON.stringify([apiBaseUrl.replace(/\/$/, ''), userId]);
}

function isStored(value: unknown): value is StoredProfileAvatar {
  if (!value || typeof value !== 'object') return false;
  const entry = value as {kind?: unknown; preset?: unknown; dataUrl?: unknown};
  return (
    (entry.kind === 'preset' && isPresetId(entry.preset)) ||
    (entry.kind === 'custom' && typeof entry.dataUrl === 'string' && CUSTOM_DATA_URL.test(entry.dataUrl))
  );
}

function readAll(): Record<string, StoredProfileAvatar> {
  const all: Record<string, StoredProfileAvatar> = {};
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [scope, entry] of Object.entries(parsed)) if (isStored(entry)) all[scope] = entry;
    }
  } catch {
    // Unreadable storage: the in-memory copy below still serves this session.
  }
  for (const [scope, entry] of memory) all[scope] = entry;
  return all;
}

/** The cached preference for a user, or undefined (the caller falls back to the id-hash default). */
export function readStoredAvatar(scope: string): StoredProfileAvatar | undefined {
  return readAll()[scope];
}

function persist(all: Record<string, StoredProfileAvatar>): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // A full or missing store only costs a refetch on the next launch.
  }
}

function writeStored(scope: string, avatar: StoredProfileAvatar | undefined): void {
  const next = {...readAll()};
  if (avatar) {
    next[scope] = avatar;
    memory.set(scope, avatar);
  } else {
    delete next[scope];
    memory.delete(scope);
  }
  persist(next);
  listeners.forEach((listener) => listener());
}

export function storedAvatarFromRemote(preference: ProfileAvatarPreference | null | undefined): StoredProfileAvatar | undefined {
  if (!preference) return undefined;
  if (preference.kind === 'preset' && isPresetId(preference.value)) return {kind: 'preset', preset: preference.value};
  if (preference.kind === 'custom' && CUSTOM_DATA_URL.test(preference.value)) return {kind: 'custom', dataUrl: preference.value};
  return undefined;
}

/** Loads the account's avatar from the server into this device's cache; an account with none clears the cache. */
export async function syncAvatar(client: ApiClient, apiBaseUrl: string, userId: string): Promise<void> {
  const remote = await client.getProfileAvatar();
  writeStored(profileAvatarScope(apiBaseUrl, userId), storedAvatarFromRemote(remote.preference));
}

/** Saves a preset locally and to the account. */
export async function saveAvatarPreset(client: ApiClient, apiBaseUrl: string, userId: string, preset: ProfileAvatarPresetId): Promise<void> {
  writeStored(profileAvatarScope(apiBaseUrl, userId), {kind: 'preset', preset});
  await client.updateProfileAvatar({preference: {kind: 'preset', value: preset}});
}
