/** This app's own bundle version, injected at build time by `vite.config.ts`'s `define` -- see `src/lib/appUpdate.ts`. */
declare const __APP_VERSION__: string;

interface Window {
  PlayarrAndroidMobile?: {
    openServerEditor(): void;
    syncSession(serialisedSession: string): void;
  };
}
