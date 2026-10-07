/** This app's own bundle version, injected at build time by `vite.config.ts`'s `define` -- see `src/lib/appUpdate.ts`. */
declare const __APP_VERSION__: string;

/** Fixed platform identity for vendor-packaged builds; hosted builds inject `null`. */
declare const __PLAYARR_PLATFORM__: "tv-webos" | "tv-tizen" | null;

/** True only in `vite --mode debug-mirror` builds (local test tooling); false everywhere else. */
declare const __PLAYARR_DEBUG_MIRROR__: boolean;

interface Window {
  /** Optional server default loaded by an installed vendor package before React starts. */
  PlayarrPackagedConfig?: {
    apiBaseUrl?: string;
  };
  PlayarrAndroidMobile?: {
    openServerEditor(): void;
    syncSession(serialisedSession: string): void;
  };
}
