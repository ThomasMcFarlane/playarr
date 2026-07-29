import { describe, expect, it } from "vitest";
import {
  resolveClientPlatform,
  shouldStartTvLink,
} from "./clientPlatform";

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
  it.each(["tv-webos", "tv-tizen"] as const)(
    "gives the packaged %s identity precedence over browser hints",
    (packagedPlatform) => {
      expect(
        resolveClientPlatform({
          packagedPlatform,
          search: "?platform=web",
          userAgent: "Mozilla/5.0 VIDAA",
        })
      ).toBe(packagedPlatform);
    }
  );

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

  it.each([
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox One) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox Series X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  ])("detects Xbox's built-in Edge browser from its user agent", (userAgent) => {
    expect(resolveClientPlatform({ search: "", userAgent })).toBe("xbox");
  });

  it("does not persist the Xbox detection, unlike VIDAA's UA-sniff branch", () => {
    const storage = createMemoryStorage();

    expect(
      resolveClientPlatform({
        search: "",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox Series X)",
        storage,
      })
    ).toBe("xbox");
    expect(storage.getItem("playarr.clientPlatform")).toBeNull();
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

describe("shouldStartTvLink", () => {
  it("opens first-contact linking only for a fresh TV identity", () => {
    expect(shouldStartTvLink(true, undefined, 0)).toBe(true);
    expect(shouldStartTvLink(true, "viewer-id", 0)).toBe(false);
    expect(shouldStartTvLink(true, undefined, 1)).toBe(false);
    expect(shouldStartTvLink(false, undefined, 0)).toBe(false);
  });
});
