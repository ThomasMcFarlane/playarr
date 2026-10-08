/**
 * The viewer's chosen preset avatar, stored like the web does (`playarr.profileAvatars.v1`, keyed by server and user) and
 * refreshed from the account's server-side preference, so a profile shows the same avatar on every device.
 */
import type {ApiClient} from '@playarr-tv/api-client';
import {PROFILE_AVATAR_PRESETS, type ProfileAvatarPresetId} from '../components/profileAvatarPresets';

const STORAGE_KEY = 'playarr.profileAvatars.v1';

type Listener = () => void;
const listeners = new Set<Listener>();

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

export type StoredAvatar = {kind: 'preset'; preset: ProfileAvatarPresetId} | {kind: 'custom'; dataUrl: string};

function isJpegDataUrl(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\/jpeg;base64,/i.test(value);
}

function readAll(): Record<string, {kind: string; preset?: string; dataUrl?: string}> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, {kind: string; preset?: string; dataUrl?: string}>) : {};
  } catch {
    return {};
  }
}

/** The stored preset for a user, or undefined (the caller falls back to the id-hash default). */
export function readStoredAvatarPreset(scope: string): ProfileAvatarPresetId | undefined {
  const entry = readAll()[scope];
  return entry?.kind === 'preset' && isPresetId(entry.preset) ? entry.preset : undefined;
}

/** The stored avatar for a user: a preset, or the custom photo saved to the profile (shown here, chosen on another device). */
export function readStoredAvatar(scope: string): StoredAvatar | undefined {
  const entry = readAll()[scope];
  if (entry?.kind === 'preset' && isPresetId(entry.preset)) return {kind: 'preset', preset: entry.preset};
  if (entry?.kind === 'custom' && isJpegDataUrl(entry.dataUrl)) return {kind: 'custom', dataUrl: entry.dataUrl};
  return undefined;
}

function writeStored(scope: string, value: StoredAvatar): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({...readAll(), [scope]: value}));
  listeners.forEach((listener) => listener());
}

export function writeAvatarPreset(scope: string, preset: ProfileAvatarPresetId): void {
  writeStored(scope, {kind: 'preset', preset});
}

/** Loads the account's avatar from the server into this device's store. */
export async function syncAvatarPreset(client: ApiClient, apiBaseUrl: string, userId: string): Promise<void> {
  const remote = await client.getProfileAvatar();
  const preference = remote.preference;
  if (preference && preference.kind === 'preset' && isPresetId(preference.value)) {
    writeAvatarPreset(profileAvatarScope(apiBaseUrl, userId), preference.value);
  } else if (preference && preference.kind === 'custom' && isJpegDataUrl(preference.value)) {
    writeStored(profileAvatarScope(apiBaseUrl, userId), {kind: 'custom', dataUrl: preference.value});
  }
}

/** Saves a preset locally and to the account. */
export async function saveAvatarPreset(client: ApiClient, apiBaseUrl: string, userId: string, preset: ProfileAvatarPresetId): Promise<void> {
  writeAvatarPreset(profileAvatarScope(apiBaseUrl, userId), preset);
  await client.updateProfileAvatar({preference: {kind: 'preset', value: preset}});
}
