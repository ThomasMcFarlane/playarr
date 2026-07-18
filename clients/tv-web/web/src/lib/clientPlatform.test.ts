import { describe, expect, it } from "vitest";
import { resolveClientPlatform } from "./clientPlatform";

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

describe("resolveClientPlatform", () => {
  it("selects and persists VIDAA from the installer URL", () => {
    const storage = createMemoryStorage();

    expect(
      resolveClientPlatform({
        search: "?platform=tv-vidaa",
        userAgent: "Mozilla/5.0",
        storage,
      })
    ).toBe("tv-vidaa");
    expect(
      resolveClientPlatform({ search: "", userAgent: "Mozilla/5.0", storage })
    ).toBe("tv-vidaa");
  });

  it("detects a modern VIDAA user agent", () => {
    expect(
      resolveClientPlatform({
        search: "",
        userAgent: "Mozilla/5.0 Model/VIDAA-MTK9618 VIDAA/7.0(Hisense;SmartTV)",
      })
    ).toBe("tv-vidaa");
  });

  it("detects the Android TV WebView host", () => {
    expect(
      resolveClientPlatform({
        search: "",
        userAgent: "Mozilla/5.0 PlayarrAndroidTV/0.1.2",
      })
    ).toBe("android-tv");
  });

  it("detects the Android mobile WebView host without treating it as a TV", () => {
    expect(
      resolveClientPlatform({
        search: "",
        userAgent: "Mozilla/5.0 PlayarrAndroidMobile/0.1.0",
      })
    ).toBe("android-mobile");
  });

  it("defaults to web and supports explicitly clearing the saved TV profile", () => {
    const storage = createMemoryStorage();
    storage.setItem("playarr.clientPlatform", "tv-vidaa");

    expect(
      resolveClientPlatform({ search: "?platform=web", userAgent: "", storage })
    ).toBe("web");
    expect(resolveClientPlatform({ search: "", userAgent: "", storage })).toBe(
      "web"
    );
  });
});
