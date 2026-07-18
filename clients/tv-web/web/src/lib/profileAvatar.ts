import {
  PLAYARR_CLIENT_PLATFORM,
  type PlayarrWebPlatform,
} from "./clientPlatform";
import type {
  ApiClient,
  ProfileAvatarPreference as RemoteProfileAvatarPreference,
} from "@streamarr-tv/api-client";

const PROFILE_AVATAR_STORAGE_KEY = "playarr.profileAvatars.v1";
const MAX_AVATAR_UPLOAD_BYTES = 10 * 1024 * 1024;
const AVATAR_OUTPUT_SIZE = 512;

export const PROFILE_AVATAR_CHANGED_EVENT = "playarr:profile-avatar-changed";

export const PROFILE_AVATAR_PRESETS = [
  { id: "astronaut", start: "#5267ad", end: "#222d5f" },
  { id: "cat", start: "#e37c68", end: "#9c3f66" },
  { id: "dinosaur", start: "#55a46e", end: "#237265" },
  { id: "robot", start: "#5d9caf", end: "#365383" },
  { id: "pirate", start: "#d39a48", end: "#91464c" },
  { id: "alien", start: "#8b71c5", end: "#4a477f" },
] as const;

export type ProfileAvatarPresetId = (typeof PROFILE_AVATAR_PRESETS)[number]["id"];

export type ProfileAvatarPreference =
  | { kind: "preset"; preset: ProfileAvatarPresetId }
  | { kind: "custom"; dataUrl: string };

export type ProfileAvatarSyncClient = Pick<
  ApiClient,
  "getProfileAvatar" | "updateProfileAvatar"
>;

type AvatarStorage = Pick<Storage, "getItem" | "setItem">;

interface AvatarUploadRuntime {
  platform: PlayarrWebPlatform;
  hasFile: boolean;
  hasFileReader: boolean;
  hasCanvas: boolean;
  hasImage: boolean;
}

export interface CustomAvatarSource {
  image: HTMLImageElement;
  objectUrl: string;
}

export interface CustomAvatarCrop {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

function browserStorage(): AvatarStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isPresetId(value: unknown): value is ProfileAvatarPresetId {
  return PROFILE_AVATAR_PRESETS.some((preset) => preset.id === value);
}

function isPreference(value: unknown): value is ProfileAvatarPreference {
  if (!value || typeof value !== "object") return false;
  const preference = value as Partial<ProfileAvatarPreference>;
  return (
    (preference.kind === "preset" && isPresetId(preference.preset)) ||
    (preference.kind === "custom" &&
      typeof preference.dataUrl === "string" &&
      /^data:image\/(?:jpeg|png|webp);base64,/i.test(preference.dataUrl))
  );
}

function readPreferences(storage: AvatarStorage | undefined): Record<string, ProfileAvatarPreference> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(PROFILE_AVATAR_STORAGE_KEY);
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, ProfileAvatarPreference] =>
        isPreference(entry[1])
      )
    );
  } catch {
    return {};
  }
}

export function profileAvatarScope(apiBaseUrl: string, userId: string): string {
  return JSON.stringify([apiBaseUrl.replace(/\/$/, ""), userId]);
}

export function defaultProfileAvatarPreset(userId: string): ProfileAvatarPresetId {
  let hash = 0;
  for (const character of userId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return PROFILE_AVATAR_PRESETS[hash % PROFILE_AVATAR_PRESETS.length]!.id;
}

export function readProfileAvatar(
  scope: string,
  userId: string,
  storage: AvatarStorage | undefined = browserStorage()
): ProfileAvatarPreference {
  return readPreferences(storage)[scope] ?? {
    kind: "preset",
    preset: defaultProfileAvatarPreset(userId),
  };
}

export function writeProfileAvatar(
  scope: string,
  preference: ProfileAvatarPreference,
  storage: AvatarStorage | undefined = browserStorage()
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      PROFILE_AVATAR_STORAGE_KEY,
      JSON.stringify({ ...readPreferences(storage), [scope]: preference })
    );
    if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(PROFILE_AVATAR_CHANGED_EVENT, { detail: { scope } })
      );
    }
    return true;
  } catch {
    return false;
  }
}

export function profileAvatarToRemotePreference(
  preference: ProfileAvatarPreference
): RemoteProfileAvatarPreference {
  return {
    kind: preference.kind,
    value: preference.kind === "preset" ? preference.preset : preference.dataUrl,
  };
}

export function profileAvatarFromRemotePreference(
  preference: RemoteProfileAvatarPreference
): ProfileAvatarPreference | null {
  if (preference.kind === "preset" && isPresetId(preference.value)) {
    return { kind: "preset", preset: preference.value };
  }
  if (
    preference.kind === "custom" &&
    /^data:image\/jpeg;base64,/i.test(preference.value)
  ) {
    return { kind: "custom", dataUrl: preference.value };
  }
  return null;
}

/**
 * Loads the account-backed avatar and refreshes this device's cache. An
 * account without a preference receives the current local choice once, which
 * migrates avatars created before server-side synchronisation was available.
 */
export async function syncProfileAvatar(
  client: ProfileAvatarSyncClient,
  scope: string,
  userId: string,
  storage: AvatarStorage | undefined = browserStorage()
): Promise<ProfileAvatarPreference> {
  const storedPreference = readPreferences(storage)[scope];
  const localPreference = storedPreference ?? {
    kind: "preset" as const,
    preset: defaultProfileAvatarPreset(userId),
  };
  const remote = await client.getProfileAvatar();
  if (remote.preference) {
    const remotePreference = profileAvatarFromRemotePreference(remote.preference);
    if (remotePreference) {
      writeProfileAvatar(scope, remotePreference, storage);
      return remotePreference;
    }
  }

  // Do not let a new device's generated default race and overwrite an avatar
  // that an older device has not migrated yet. Only explicit local choices
  // are eligible for the one-time upload.
  if (!storedPreference) return localPreference;

  const saved = await client.updateProfileAvatar({
    preference: profileAvatarToRemotePreference(localPreference),
  });
  const savedPreference = saved.preference
    ? profileAvatarFromRemotePreference(saved.preference)
    : null;
  const preference = savedPreference ?? localPreference;
  writeProfileAvatar(scope, preference, storage);
  return preference;
}

export function supportsCustomAvatarUpload(
  runtime: AvatarUploadRuntime = {
    platform: PLAYARR_CLIENT_PLATFORM,
    hasFile: typeof File !== "undefined",
    hasFileReader: typeof FileReader !== "undefined",
    hasCanvas: typeof HTMLCanvasElement !== "undefined",
    hasImage: typeof Image !== "undefined",
  }
): boolean {
  return (
    runtime.platform === "web" &&
    runtime.hasFile &&
    runtime.hasFileReader &&
    runtime.hasCanvas &&
    runtime.hasImage
  );
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image_decode_failed"));
    image.src = url;
  });
}

export async function createCustomAvatarSource(file: File): Promise<CustomAvatarSource> {
  if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type)) {
    throw new Error("unsupported_image_type");
  }
  if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
    throw new Error("image_too_large");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("image_decode_failed");
    return { image, objectUrl };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

export function releaseCustomAvatarSource(source: CustomAvatarSource): void {
  URL.revokeObjectURL(source.objectUrl);
}

export function drawCustomAvatarCrop(
  canvas: HTMLCanvasElement,
  source: CustomAvatarSource,
  crop: CustomAvatarCrop,
  size: number
): void {
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("image_processing_unavailable");
  const rect = customAvatarDrawRect(
    source.image.naturalWidth,
    source.image.naturalHeight,
    crop,
    size
  );

  context.clearRect(0, 0, size, size);
  context.drawImage(source.image, rect.x, rect.y, rect.width, rect.height);
}

export function customAvatarDrawRect(
  imageWidth: number,
  imageHeight: number,
  crop: CustomAvatarCrop,
  size: number
): { x: number; y: number; width: number; height: number } {
  const baseScale = Math.max(
    size / imageWidth,
    size / imageHeight
  );
  const zoom = Math.max(1, Math.min(3, crop.zoom));
  const drawWidth = imageWidth * baseScale * zoom;
  const drawHeight = imageHeight * baseScale * zoom;
  const maxOffsetX = Math.max(0, (drawWidth - size) / 2);
  const maxOffsetY = Math.max(0, (drawHeight - size) / 2);
  const offsetX = Math.max(-1, Math.min(1, crop.offsetX)) * maxOffsetX;
  const offsetY = Math.max(-1, Math.min(1, crop.offsetY)) * maxOffsetY;

  return {
    x: (size - drawWidth) / 2 + offsetX,
    y: (size - drawHeight) / 2 + offsetY,
    width: drawWidth,
    height: drawHeight,
  };
}

export function renderCustomAvatar(
  source: CustomAvatarSource,
  crop: CustomAvatarCrop
): string {
  const canvas = document.createElement("canvas");
  drawCustomAvatarCrop(canvas, source, crop, AVATAR_OUTPUT_SIZE);
  return canvas.toDataURL("image/jpeg", 0.86);
}

export function profileAvatarPreset(preference: ProfileAvatarPreference) {
  const presetId = preference.kind === "preset" ? preference.preset : "astronaut";
  return PROFILE_AVATAR_PRESETS.find((preset) => preset.id === presetId)!;
}
