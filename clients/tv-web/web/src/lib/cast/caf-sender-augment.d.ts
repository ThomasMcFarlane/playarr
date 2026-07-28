/**
 * Module augmentation for gaps in `@types/chromecast-caf-sender` (and the
 * `chrome/chrome-cast` triple-slash reference it pulls in for
 * `chrome.cast.*`) that this feature actually needs. Checked against those
 * packages' shipped `.d.ts` files first -- only what's genuinely missing
 * lives here:
 *
 * - `Window.cast` and `Window.__onGCastApiAvailable` are already declared
 *   by `@types/chromecast-caf-sender` itself; not repeated here.
 * - `chrome.cast.*`/`chrome.cast.media.*` (the enums/classes) are already
 *   declared by the `chrome/chrome-cast` subpath that package's own
 *   `/// <reference types="chrome/chrome-cast" />` pulls in.
 * - `Window.chrome`, however, is declared only in `@types/chrome`'s MAIN
 *   `index.d.ts` -- a separate file from the `chrome/chrome-cast` subpath
 *   above, and not pulled in by it. This project's `tsconfig.json`
 *   deliberately lists only `"chromecast-caf-sender"` in `types` (not the
 *   full `"chrome"` package, whose thousands of lines of unrelated
 *   extension APIs -- `chrome.tabs`, `chrome.storage`, etc. -- have nothing
 *   to do with a normal web page), so `Window.chrome` is declared here
 *   instead, deliberately optional (unlike `@types/chrome`'s own
 *   always-required declaration) -- it genuinely is `undefined` on
 *   Firefox/Safari at runtime, which is exactly the truthiness check
 *   `castSdk.ts`'s `isCastCapableBrowser` relies on.
 * - `Navigator.presentation` (the Presentation API the Cast Sender SDK is
 *   built on) is genuinely absent from TypeScript's bundled DOM lib and
 *   from both `@types/chrome` and `@types/chromecast-caf-sender` -- this
 *   feature only ever needs to know whether it exists at all
 *   (`"presentation" in navigator`), never call anything on it, so an
 *   untyped optional marker is enough; it is deliberately not fleshed out
 *   into the full Presentation API shape.
 */
export {};

declare global {
  interface Window {
    chrome?: typeof chrome;
  }

  interface Navigator {
    readonly presentation?: unknown;
  }
}
