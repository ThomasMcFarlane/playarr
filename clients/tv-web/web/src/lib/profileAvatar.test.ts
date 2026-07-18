import { describe, expect, it, vi } from "vitest";
import {
  defaultProfileAvatarPreset,
  customAvatarDrawRect,
  profileAvatarScope,
  readProfileAvatar,
  syncProfileAvatar,
  supportsCustomAvatarUpload,
  writeProfileAvatar,
} from "./profileAvatar";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  } as Storage;
}

describe("profile avatar preferences", () => {
  it("keeps preferences scoped to one server and user", () => {
    const storage = createMemoryStorage();
    const firstScope = profileAvatarScope("https://one.example/", "user-1");
    const secondScope = profileAvatarScope("https://two.example", "user-1");

    expect(writeProfileAvatar(firstScope, { kind: "preset", preset: "robot" }, storage)).toBe(
      true
    );
    expect(readProfileAvatar(firstScope, "user-1", storage)).toEqual({
      kind: "preset",
      preset: "robot",
    });
    expect(readProfileAvatar(secondScope, "user-1", storage)).toEqual({
      kind: "preset",
      preset: defaultProfileAvatarPreset("user-1"),
    });
  });

  it("ignores malformed stored values", () => {
    const storage = createMemoryStorage();
    storage.setItem("playarr.profileAvatars.v1", JSON.stringify({ broken: { kind: "preset" } }));

    expect(readProfileAvatar("broken", "user-2", storage)).toEqual({
      kind: "preset",
      preset: defaultProfileAvatarPreset("user-2"),
    });
  });

  it("uses and caches a custom photo already saved on another device", async () => {
    const storage = createMemoryStorage();
    const scope = profileAvatarScope("https://one.example", "user-1");
    writeProfileAvatar(scope, { kind: "preset", preset: "robot" }, storage);
    const dataUrl = "data:image/jpeg;base64,Y3Jvc3MtZGV2aWNl";
    const client = {
      getProfileAvatar: vi.fn(async () => ({
        preference: { kind: "custom" as const, value: dataUrl },
      })),
      updateProfileAvatar: vi.fn(),
    };

    await expect(syncProfileAvatar(client, scope, "user-1", storage)).resolves.toEqual({
      kind: "custom",
      dataUrl,
    });
    expect(readProfileAvatar(scope, "user-1", storage)).toEqual({
      kind: "custom",
      dataUrl,
    });
    expect(client.updateProfileAvatar).not.toHaveBeenCalled();
  });

  it("migrates an existing local avatar when the account has no saved preference", async () => {
    const storage = createMemoryStorage();
    const scope = profileAvatarScope("https://one.example", "user-1");
    writeProfileAvatar(scope, { kind: "preset", preset: "pirate" }, storage);
    const client = {
      getProfileAvatar: vi.fn(async () => ({ preference: null })),
      updateProfileAvatar: vi.fn(async (request) => ({ preference: request.preference })),
    };

    await expect(syncProfileAvatar(client, scope, "user-1", storage)).resolves.toEqual({
      kind: "preset",
      preset: "pirate",
    });
    expect(client.updateProfileAvatar).toHaveBeenCalledWith({
      preference: { kind: "preset", value: "pirate" },
    });
  });

  it("does not upload a generated default from a new device", async () => {
    const storage = createMemoryStorage();
    const scope = profileAvatarScope("https://one.example", "user-1");
    const client = {
      getProfileAvatar: vi.fn(async () => ({ preference: null })),
      updateProfileAvatar: vi.fn(),
    };

    await expect(syncProfileAvatar(client, scope, "user-1", storage)).resolves.toEqual({
      kind: "preset",
      preset: defaultProfileAvatarPreset("user-1"),
    });
    expect(client.updateProfileAvatar).not.toHaveBeenCalled();
  });

  it("keeps the cached avatar when account synchronisation is unavailable", async () => {
    const storage = createMemoryStorage();
    const scope = profileAvatarScope("https://one.example", "user-1");
    writeProfileAvatar(scope, { kind: "preset", preset: "cat" }, storage);
    const client = {
      getProfileAvatar: vi.fn(async () => {
        throw new Error("offline");
      }),
      updateProfileAvatar: vi.fn(),
    };

    await expect(syncProfileAvatar(client, scope, "user-1", storage)).rejects.toThrow(
      "offline"
    );
    expect(readProfileAvatar(scope, "user-1", storage)).toEqual({
      kind: "preset",
      preset: "cat",
    });
  });

  it("offers custom upload only on web runtimes with every required image API", () => {
    const capable = {
      platform: "web" as const,
      hasFile: true,
      hasFileReader: true,
      hasCanvas: true,
      hasImage: true,
    };

    expect(supportsCustomAvatarUpload(capable)).toBe(true);
    expect(supportsCustomAvatarUpload({ ...capable, platform: "android-mobile" })).toBe(true);
    expect(supportsCustomAvatarUpload({ ...capable, platform: "android-tv" })).toBe(false);
    expect(supportsCustomAvatarUpload({ ...capable, platform: "tv-vidaa" })).toBe(false);
    expect(supportsCustomAvatarUpload({ ...capable, hasCanvas: false })).toBe(false);
  });

  it("covers, zooms, and repositions a landscape upload inside the square output", () => {
    expect(
      customAvatarDrawRect(
        1200,
        800,
        { zoom: 1, offsetX: 0, offsetY: 0 },
        512
      )
    ).toEqual({ x: -128, y: 0, width: 768, height: 512 });
    expect(
      customAvatarDrawRect(
        1200,
        800,
        { zoom: 2, offsetX: 1, offsetY: -1 },
        512
      )
    ).toEqual({ x: 0, y: -512, width: 1536, height: 1024 });
  });
});
