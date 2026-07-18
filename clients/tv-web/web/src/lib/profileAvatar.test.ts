import { describe, expect, it } from "vitest";
import {
  defaultProfileAvatarPreset,
  customAvatarDrawRect,
  profileAvatarScope,
  readProfileAvatar,
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

  it("offers custom upload only on web runtimes with every required image API", () => {
    const capable = {
      platform: "web" as const,
      hasFile: true,
      hasFileReader: true,
      hasCanvas: true,
      hasImage: true,
    };

    expect(supportsCustomAvatarUpload(capable)).toBe(true);
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
