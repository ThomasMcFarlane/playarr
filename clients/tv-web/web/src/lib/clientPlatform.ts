import type { ClientPlatform } from "@streamarr-tv/api-client";

const PLATFORM_QUERY_PARAM = "platform";
const PLATFORM_STORAGE_KEY = "playarr.clientPlatform";

export type PlayarrWebPlatform = Extract<
  ClientPlatform,
  | "web"
  | "tv-vidaa"
  | "tv-webos"
  | "tv-tizen"
  | "android-mobile"
  | "android-tv"
>;

interface PlatformRuntime {
  search: string;
  userAgent: string;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  packagedPlatform?: Extract<PlayarrWebPlatform, "tv-webos" | "tv-tizen"> | null;
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
      packagedPlatform: __PLAYARR_PLATFORM__,
    };
  } catch {
    return {
      search: window.location.search,
      userAgent: navigator.userAgent,
      packagedPlatform: __PLAYARR_PLATFORM__,
    };
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
  if (runtime.packagedPlatform) return runtime.packagedPlatform;

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
export const IS_WEBOS = PLAYARR_CLIENT_PLATFORM === "tv-webos";
export const IS_TIZEN = PLAYARR_CLIENT_PLATFORM === "tv-tizen";
export const IS_PACKAGED_TV = IS_WEBOS || IS_TIZEN;

export function shouldStartPackagedTvLink(
  isPackagedTv: boolean,
  currentUserId: string | undefined,
  savedProfileCount: number
): boolean {
  return isPackagedTv && currentUserId === undefined && savedProfileCount === 0;
}

export const IS_TV =
  IS_PACKAGED_TV ||
  PLAYARR_CLIENT_PLATFORM === "tv-vidaa" ||
  PLAYARR_CLIENT_PLATFORM === "android-tv";
