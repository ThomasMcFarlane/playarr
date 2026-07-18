import type { ClientPlatform } from "@streamarr-tv/api-client";

const PLATFORM_QUERY_PARAM = "platform";
const PLATFORM_STORAGE_KEY = "playarr.clientPlatform";

export type PlayarrWebPlatform = Extract<
  ClientPlatform,
  "web" | "tv-vidaa" | "android-mobile" | "android-tv"
>;

interface PlatformRuntime {
  search: string;
  userAgent: string;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}

function browserRuntime(): PlatformRuntime {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { search: "", userAgent: "" };
  }

  try {
    return {
      search: window.location.search,
      userAgent: navigator.userAgent,
      storage: window.localStorage,
    };
  } catch {
    return { search: window.location.search, userAgent: navigator.userAgent };
  }
}

/**
 * Resolves the hosted Playarr Web build's first-party platform identity.
 *
 * VIDAA's debug installer launches a URL rather than a packaged bundle. The
 * explicit `?platform=tv-vidaa` marker therefore selects the VIDAA profile on
 * first launch and is persisted for route reloads that no longer carry the
 * original query string. Modern VIDAA user agents are also detected directly.
 * `?platform=web` is an escape hatch that clears a stale TV selection.
 */
export function resolveClientPlatform(
  runtime: PlatformRuntime = browserRuntime()
): PlayarrWebPlatform {
  const requested = new URLSearchParams(runtime.search).get(PLATFORM_QUERY_PARAM);

  if (requested === "web") {
    runtime.storage?.removeItem(PLATFORM_STORAGE_KEY);
    return "web";
  }

  if (requested === "tv-vidaa") {
    runtime.storage?.setItem(PLATFORM_STORAGE_KEY, "tv-vidaa");
    return "tv-vidaa";
  }

  if (/\bPlayarrAndroidMobile\//i.test(runtime.userAgent)) {
    return "android-mobile";
  }

  if (/\bPlayarrAndroidTV\//i.test(runtime.userAgent)) {
    return "android-tv";
  }

  if (/\b(?:VIDAA|Hisense)\b/i.test(runtime.userAgent)) {
    runtime.storage?.setItem(PLATFORM_STORAGE_KEY, "tv-vidaa");
    return "tv-vidaa";
  }

  return runtime.storage?.getItem(PLATFORM_STORAGE_KEY) === "tv-vidaa"
    ? "tv-vidaa"
    : "web";
}

export const PLAYARR_CLIENT_PLATFORM = resolveClientPlatform();
export const IS_VIDAA = PLAYARR_CLIENT_PLATFORM === "tv-vidaa";
export const IS_TV =
  PLAYARR_CLIENT_PLATFORM === "tv-vidaa" || PLAYARR_CLIENT_PLATFORM === "android-tv";
