/**
 * Loads the Google Cast Sender SDK (Cast Application Framework) and exposes
 * the small, pure environment checks the rest of `lib/cast` is built on.
 *
 * The CAF sender script is deliberately loaded via an injected classic
 * `<script>` element rather than a static `<script>` tag in `index.html`:
 * `document.currentScript` is `null` inside an ES module, so there is no
 * "current script" a module-scoped loader could attach itself to the way a
 * plain inline `<script>` tag normally would -- injecting our own element
 * sidesteps that entirely. `window.__onGCastApiAvailable` is assigned
 * *before* the script is appended: the loader can invoke that callback as
 * soon as the script itself starts executing, so assigning it after
 * injection risks missing the call outright. See
 * https://developers.google.com/cast/docs/web_sender#load_cast_sender_library
 */

const CAST_SENDER_SCRIPT_SRC =
  "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";

/**
 * Chromecast receiver application id for the Playarr Cast custom receiver
 * (`apps/cast-receiver`), registered in the Google Cast SDK Developer
 * Console against that app's hosted URL. `VITE_CAST_RECEIVER_APP_ID` lets a
 * deployment supply the real registered id without a source edit once that
 * registration exists (see the "Host the receiver" component of this
 * feature). The fallback is an intentionally invalid placeholder --
 * `CastContext.setOptions()` below still runs, but `requestSession()` fails
 * loudly (`receiver_unavailable`-ish) instead of silently pointing at some
 * other app's receiver.
 */
export const CAST_RECEIVER_APP_ID: string =
  (import.meta.env.VITE_CAST_RECEIVER_APP_ID as string | undefined)?.trim() || "0000PLAYARR";

const DEFAULT_LOAD_TIMEOUT_MS = 10_000;

// `Window.cast` and `Window.__onGCastApiAvailable` are already declared by
// `@types/chromecast-caf-sender` itself; `Window.chrome` is declared by
// this feature's own `caf-sender-augment.d.ts` (deliberately optional,
// unlike `@types/chrome`'s own always-required declaration -- see that
// file's doc comment for why only this narrow piece of `@types/chrome` is
// pulled in at all). No local wrapper interface needed for any of them.

/**
 * Firefox and Safari (desktop and iOS) have no Cast Sender SDK at all -- the
 * SDK itself is only ever injected into pages that have both `window.chrome`
 * (Chromium's own global, absent from every non-Chromium engine) and
 * `navigator.presentation` (the Presentation API the SDK is built on). iOS
 * Chrome fails this too: it wraps Apple's required WebKit engine rather than
 * Chromium, so `navigator.presentation` is absent there as well. Checked
 * explicitly up front rather than discovered by letting the script load and
 * silently do nothing, so an unsupported browser never even issues the
 * network request for it.
 *
 * `Window.chrome` is typed as always-present -- true only on Chromium --
 * but checking its truthiness is exactly how real code must tell the two
 * apart at runtime regardless of what the ambient type claims.
 */
export function isCastCapableBrowser(win: Window, nav: Navigator): boolean {
  return Boolean(win.chrome) && "presentation" in nav;
}

/**
 * The Presentation API (which the Cast Sender SDK is built on) is
 * secure-context-only -- HTTPS, or `localhost`/loopback for local dev.
 * Checked via `Window.isSecureContext` rather than re-parsing `location`
 * ourselves: the platform's own definition already accounts for every edge
 * case (loopback addresses, `file:` origins, etc).
 */
export function isSecureCastContext(win: Window): boolean {
  return win.isSecureContext === true;
}

/** Both static preconditions the Cast Sender SDK itself imposes, combined. */
export function isCastEnvironmentSupported(win: Window, nav: Navigator): boolean {
  return isSecureCastContext(win) && isCastCapableBrowser(win, nav);
}

export class CastSdkLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CastSdkLoadError";
  }
}

/**
 * Distinguishes the two *categorical* reasons casting can never work here,
 * as opposed to an ordinary transient failure (unreachable receiver, a
 * rejected load, etc). `CastButton`/`Player.tsx` map these onto the
 * `player.cast.unavailableBrowser`/`unavailableInsecureServer` copy;
 * anything else caught along the way is shown with the generic
 * `player.cast.error` copy instead.
 */
export type CastUnavailableReason = "unsupported-browser" | "insecure-server";

export class CastUnavailableError extends Error {
  readonly reason: CastUnavailableReason;
  constructor(reason: CastUnavailableReason, message?: string) {
    super(message ?? reason);
    this.name = "CastUnavailableError";
    this.reason = reason;
  }
}

/**
 * Maps a `chrome.cast.ErrorCode` string from a *failed `requestSession()`
 * call* onto `"unsupported-browser"` when the code itself indicates the
 * environment (not the network, not the receiver) is the problem -- belt
 * and suspenders alongside `isCastEnvironmentSupported`'s own static,
 * up-front check: that check already keeps `CastButton` hidden for
 * Firefox/Safari/iOS Chrome/an insecure context, so in practice this only
 * ever fires for the rarer case of something *else* preventing the SDK
 * from actually working despite those preconditions passing (e.g. an
 * extension blocking it). Returns `undefined` -- "not a categorical
 * environment problem" -- for every other code (receiver unreachable,
 * session error, the viewer's own cancel, etc), which callers show with
 * the generic error copy instead.
 */
export function classifyRequestSessionFailure(code: string): CastUnavailableReason | undefined {
  switch (code) {
    case "api_not_initialized":
    case "extension_not_compatible":
    case "extension_missing":
      return "unsupported-browser";
    default:
      return undefined;
  }
}

export interface LoadCastSdkOptions {
  win?: Window;
  doc?: Document;
  nav?: Navigator;
  /** Defaults to 10s -- some browsers/environments never invoke the ready callback at all. */
  timeoutMs?: number;
}

// Module-level so a second call (e.g. a remount of `CastProvider`, or React
// StrictMode's deliberate double-invoke of effects in development) reuses
// the same in-flight/settled load instead of injecting a second `<script>`
// tag and racing two `__onGCastApiAvailable` assignments against each
// other -- whichever assignment happened second would silently strand the
// first caller's promise forever.
let sharedLoadPromise: Promise<typeof cast> | undefined;

/**
 * Injects the CAF sender script and resolves once `window.
 * __onGCastApiAvailable` reports the framework is ready, rejecting on a
 * timeout, a script load failure, or an `available: false` callback.
 * Rejects immediately -- without touching `doc` at all -- when
 * `isCastEnvironmentSupported` is false for the supplied `win`/`nav`.
 */
export function loadCastSdk(options: LoadCastSdkOptions = {}): Promise<typeof cast> {
  if (sharedLoadPromise) return sharedLoadPromise;

  const win = options.win ?? window;
  const doc = options.doc ?? document;
  const nav = options.nav ?? navigator;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;

  if (!isCastEnvironmentSupported(win, nav)) {
    return Promise.reject(
      new CastSdkLoadError("This browser cannot load the Cast Sender SDK.")
    );
  }

  const promise = new Promise<typeof cast>((resolve, reject) => {
    let settled = false;

    const timer = win.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new CastSdkLoadError("Timed out waiting for the Cast Sender SDK to become available.")
      );
    }, timeoutMs);

    // Assigned BEFORE the script is appended -- see this module's top
    // comment for why the ordering matters.
    win.__onGCastApiAvailable = (available, reason) => {
      if (settled) return;
      settled = true;
      win.clearTimeout(timer);
      if (available && win.cast) {
        resolve(win.cast);
      } else {
        reject(new CastSdkLoadError(reason ?? "Cast Sender SDK reported itself unavailable."));
      }
    };

    const script = doc.createElement("script");
    script.src = CAST_SENDER_SCRIPT_SRC;
    script.async = true;
    script.onerror = () => {
      if (settled) return;
      settled = true;
      win.clearTimeout(timer);
      reject(new CastSdkLoadError("Could not load the Cast Sender SDK script."));
    };
    doc.head.appendChild(script);
  });

  sharedLoadPromise = promise;
  // A failed load must not be cached -- a transient network blip should let
  // a later retry actually try again instead of forever replaying the same
  // rejection.
  promise.catch(() => {
    if (sharedLoadPromise === promise) sharedLoadPromise = undefined;
  });

  return promise;
}

/** Test-only escape hatch to reset the module-level singleton between cases. */
export function __resetCastSdkLoadStateForTests(): void {
  sharedLoadPromise = undefined;
}
