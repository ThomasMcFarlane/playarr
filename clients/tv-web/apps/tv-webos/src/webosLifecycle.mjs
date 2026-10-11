/**
 * Pause every active media element when webOS hides or terminates the app.
 * Pausing the HTML element is also observed by ShakaPlaybackEngine, keeping
 * the shared player's state in sync without reaching into its internals.
 *
 * @param {Pick<Document, "querySelectorAll">} root
 */
export function pauseActiveMedia(root) {
  for (const media of root.querySelectorAll("audio, video")) {
    if (media instanceof HTMLMediaElement && !media.paused) {
      media.pause();
    }
  }
}

/** @type {Readonly<Record<number, string>>} */
const MEDIA_KEY_BY_CODE = Object.freeze({
  19: "MediaPause",
  412: "MediaRewind",
  413: "MediaStop",
  415: "MediaPlay",
  417: "MediaFastForward",
});

/** @param {number} keyCode */
export function mediaKeyForWebOsCode(keyCode) {
  return MEDIA_KEY_BY_CODE[keyCode];
}

/** @param {Pick<Location, "hash" | "pathname">} location */
export function isWebOsRootLocation(location) {
  if (location.hash) {
    const route = location.hash.replace(/^#/, "").replace(/\/+$/, "") || "/";
    return route === "/";
  }
  return /(?:^|\/)index\.html$/.test(location.pathname) || location.pathname.endsWith("/");
}

/**
 * Load the operator-editable server default before the shared application
 * creates its API provider. Invalid, missing, or unreachable configuration is
 * intentionally ignored; the packaged app will then show its normal server
 * selection UI instead of booting against its package origin.
 *
 * @param {string} configUrl
 * @param {typeof fetch} [fetchImpl]
 * @param {Window & { PlayarrPackagedConfig?: { apiBaseUrl?: string } }} [appWindow]
 * @returns {Promise<{ apiBaseUrl: string } | undefined>}
 */
export async function loadWebOsRuntimeConfig(
  configUrl,
  fetchImpl = fetch,
  appWindow = window
) {
  try {
    const response = await fetchImpl(configUrl, { cache: "no-store" });
    if (!response.ok) return undefined;
    const config = await response.json();
    if (config === null || typeof config !== "object") return undefined;

    const value = Reflect.get(config, "apiBaseUrl");
    if (typeof value !== "string") return undefined;
    const parsed = new URL(value.trim());
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return undefined;
    }

    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    const packagedConfig = { apiBaseUrl: parsed.toString().replace(/\/$/, "") };
    appWindow.PlayarrPackagedConfig = packagedConfig;
    return packagedConfig;
  } catch {
    return undefined;
  }
}

/**
 * The http(s) URL a click on `target` would leave the packaged app for, or undefined.
 * In-app routes are hash or relative links, so every http(s) link points outside the app.
 *
 * @param {EventTarget | null} target
 * @returns {string | undefined}
 */
export function externalLinkUrl(target) {
  const anchor = /** @type {{ closest?: (s: string) => { href?: string } | null }} */ (target)?.closest?.("a[href]");
  const href = anchor?.href;
  return typeof href === "string" && /^https?:/i.test(href) ? href : undefined;
}

/**
 * Opens an external URL in the TV's web browser app through the webOS application manager.
 *
 * @param {string} url
 * @param {Window} appWindow
 */
export function openWebOsExternalUrl(url, appWindow) {
  try {
    const Bridge = /** @type {{ PalmServiceBridge?: new () => { call: (uri: string, payload: string) => void } }} */ (appWindow)
      .PalmServiceBridge;
    if (!Bridge) return false;
    new Bridge().call(
      "luna://com.webos.applicationManager/launch",
      JSON.stringify({ id: "com.webos.app.browser", params: { target: url } })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Install the webOS remote-key and foreground/background lifecycle policy.
 *
 * `appinfo.json` deliberately leaves `handlesRelaunch` false, so webOS owns
 * returning the app to the foreground. The application only has to stop
 * playback while hidden. Both standard and prefixed visibility events are
 * registered because older webOS engines used the WebKit spelling.
 *
 * @param {Document & { webkitHidden?: boolean }} [appDocument]
 * @param {Window} [appWindow]
 * @returns {() => void} cleanup callback
 */
export function installWebOsLifecycle(
  appDocument = document,
  appWindow = window
) {
  const pauseIfHidden = () => {
    if (appDocument.hidden || appDocument.webkitHidden) {
      pauseActiveMedia(appDocument);
    }
  };
  const pauseOnPageHide = () => pauseActiveMedia(appDocument);
  /** @param {KeyboardEvent} event */
  const handleRemoteKey = (event) => {
    const mediaKey = mediaKeyForWebOsCode(event.keyCode);
    if (mediaKey && event.key !== mediaKey) {
      const KeyboardEventConstructor = /** @type {{ KeyboardEvent?: typeof KeyboardEvent }} */ (
        appWindow
      ).KeyboardEvent ?? globalThis.KeyboardEvent;
      if (KeyboardEventConstructor) {
        const normalised = new KeyboardEventConstructor("keydown", {
          bubbles: true,
          cancelable: true,
          key: mediaKey,
          code: mediaKey,
          repeat: event.repeat,
        });
        appWindow.dispatchEvent(normalised);
        if (normalised.defaultPrevented) event.preventDefault();
      }
    }

    const isBack =
      event.key === "Escape" ||
      event.key === "BrowserBack" ||
      event.key === "GoBack" ||
      event.keyCode === 461;
    if (!isBack || !isWebOsRootLocation(appWindow.location)) return;

    // The shared app and its modal/player handlers receive Back first. Only
    // hand an unclaimed root press back to webOS after propagation finishes.
    const schedule = appWindow.queueMicrotask?.bind(appWindow) ?? queueMicrotask;
    schedule(() => {
      if (event.defaultPrevented || !isWebOsRootLocation(appWindow.location)) return;
      const webOs = /** @type {{ webOS?: { platformBack?: () => void } }} */ (appWindow)
        .webOS;
      if (typeof webOs?.platformBack === "function") {
        webOs.platformBack();
      } else {
        appWindow.close?.();
      }
    });
  };

  appDocument.addEventListener("visibilitychange", pauseIfHidden);
  appDocument.addEventListener("webkitvisibilitychange", pauseIfHidden);
  appWindow.addEventListener("pagehide", pauseOnPageHide);
  appWindow.addEventListener("keydown", handleRemoteKey);
  // A packaged app has no tabs: following a target=_blank or external link would replace Playarr
  // with the page and leave no way back. Hand those URLs to the TV browser instead.
  /** @param {MouseEvent} event */
  const handleClick = (event) => {
    const url = externalLinkUrl(event.target);
    if (!url) return;
    event.preventDefault();
    openWebOsExternalUrl(url, appWindow);
  };
  const originalOpen = appWindow.open;
  /** @type {(url?: string | URL, ...rest: unknown[]) => Window | null} */
  const openExternal = (url, ...rest) => {
    const resolved = url === undefined ? "" : new URL(String(url), appWindow.location.href).href;
    if (/^https?:/i.test(resolved)) {
      openWebOsExternalUrl(resolved, appWindow);
      return null;
    }
    return originalOpen?.call(appWindow, url, .../** @type {[string?, string?]} */ (rest)) ?? null;
  };
  appWindow.open = /** @type {typeof window.open} */ (openExternal);
  appDocument.addEventListener("click", handleClick, true);

  return () => {
    appDocument.removeEventListener("click", handleClick, true);
    appWindow.open = originalOpen;
    appDocument.removeEventListener("visibilitychange", pauseIfHidden);
    appDocument.removeEventListener("webkitvisibilitychange", pauseIfHidden);
    appWindow.removeEventListener("pagehide", pauseOnPageHide);
    appWindow.removeEventListener("keydown", handleRemoteKey);
  };
}
