export const TIZEN_REMOTE_KEYS = Object.freeze([
  "MediaPlay",
  "MediaPause",
  "MediaPlayPause",
  "MediaStop",
  "MediaRewind",
  "MediaFastForward",
  "MediaTrackPrevious",
  "MediaTrackNext",
]);

const MEDIA_KEY_BY_CODE = Object.freeze({
  19: "MediaPause",
  412: "MediaRewind",
  413: "MediaStop",
  415: "MediaPlay",
  417: "MediaFastForward",
  10232: "MediaTrackPrevious",
  10233: "MediaTrackNext",
  10252: "MediaPlayPause",
});

const BACK_BLOCKING_SURFACE_SELECTOR = [
  '[aria-modal="true"]',
  ".player-page.is-minimised",
  ".player-playlist-panel",
  ".media-context-drawer",
].join(", ");

export function mediaKeyForTizenCode(keyCode) {
  return MEDIA_KEY_BY_CODE[keyCode];
}

const TIZEN_DISPLAY_WIDTH = 1920;
const TIZEN_DISPLAY_HEIGHT = 1080;

/** Maps a CSS-pixel player surface into Samsung's fixed 1920x1080 AVPlay canvas. */
export function tizenDisplayRectForBounds(
  bounds,
  viewportWidth,
  viewportHeight
) {
  if (
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    !bounds ||
    !Number.isFinite(bounds.left) ||
    !Number.isFinite(bounds.top) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return undefined;
  }

  const scaleX = TIZEN_DISPLAY_WIDTH / viewportWidth;
  const scaleY = TIZEN_DISPLAY_HEIGHT / viewportHeight;
  const x = Math.max(0, Math.min(TIZEN_DISPLAY_WIDTH - 1, Math.round(bounds.left * scaleX)));
  const y = Math.max(0, Math.min(TIZEN_DISPLAY_HEIGHT - 1, Math.round(bounds.top * scaleY)));
  const width = Math.max(
    1,
    Math.min(TIZEN_DISPLAY_WIDTH - x, Math.round(bounds.width * scaleX))
  );
  const height = Math.max(
    1,
    Math.min(TIZEN_DISPLAY_HEIGHT - y, Math.round(bounds.height * scaleY))
  );
  return { x, y, width, height };
}

/** Keeps Samsung's AVPlay object surface aligned with the React player box. */
export function applyTizenAvplayObjectBounds(element, bounds) {
  if (
    !element?.style ||
    !bounds ||
    !Number.isFinite(bounds.left) ||
    !Number.isFinite(bounds.top) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return false;
  }
  element.style.position = "fixed";
  element.style.left = `${bounds.left}px`;
  element.style.top = `${bounds.top}px`;
  element.style.right = "auto";
  element.style.bottom = "auto";
  element.style.width = `${bounds.width}px`;
  element.style.height = `${bounds.height}px`;
  return true;
}

export function isTizenRootLocation(location) {
  if (location.hash) {
    const route = location.hash.replace(/^#/, "").replace(/\/+$/, "") || "/";
    return route === "/";
  }
  return /(?:^|\/)index\.html$/.test(location.pathname) || location.pathname.endsWith("/");
}

export function hasTizenBackBlockingSurface(documentObject) {
  return Boolean(documentObject.querySelector?.(BACK_BLOCKING_SURFACE_SELECTOR));
}

export async function loadPackagedConfig({
  fetchImpl = fetch,
  configUrl = `${import.meta.env.BASE_URL}streamarr-config.json`,
  windowObject = window,
} = {}) {
  try {
    const response = await fetchImpl(configUrl, { cache: "no-store" });
    if (!response.ok) return undefined;
    const config = await response.json();
    if (!config || typeof config.apiBaseUrl !== "string") return undefined;
    const url = new URL(config.apiBaseUrl.trim());
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    url.pathname = url.pathname.replace(/\/+$/, "");
    const packagedConfig = { apiBaseUrl: url.toString().replace(/\/$/, "") };
    windowObject.PlayarrPackagedConfig = packagedConfig;
    return packagedConfig;
  } catch {
    return undefined;
  }
}

function registerRemoteKeys(tizenObject) {
  const input = tizenObject?.tvinputdevice;
  if (!input) return;
  try {
    if (typeof input.registerKeyBatch === "function") {
      input.registerKeyBatch(TIZEN_REMOTE_KEYS, undefined, (error) => {
        console.warn("Could not register all Samsung remote keys", error);
      });
      return;
    }
    for (const key of TIZEN_REMOTE_KEYS) input.registerKey?.(key);
  } catch (error) {
    console.warn("Could not register Samsung remote keys", error);
  }
}

function terminateAvplay(webapisObject) {
  const avplay = webapisObject?.avplay;
  if (!avplay) return;
  try {
    if (avplay.getState() !== "NONE") avplay.stop();
  } catch {
    // Continue to close: Samsung documents close() as valid in every state.
  }
  try {
    avplay.close();
  } catch {
    // The shared engine may already have released it during React teardown.
  }
  try {
    const appcommon = webapisObject?.appcommon;
    appcommon?.setScreenSaver(
      appcommon.AppCommonScreenSaverState.SCREEN_SAVER_ON,
      undefined,
      () => undefined
    );
  } catch {
    // Exit must never be blocked by AppCommon support differences.
  }
}

function installAvplayDisplayRectSync(windowObject, documentObject, webapisObject) {
  const MutationObserverConstructor = windowObject.MutationObserver;
  let frame;
  const sync = () => {
    frame = undefined;
    const avplay = webapisObject?.avplay;
    const displayObject = documentObject.getElementById?.("av-player");
    const playerShell = documentObject.querySelector?.(
      ".player-shell:not(.player-shell-placeholder)"
    );
    if (!playerShell) return;
    const bounds = playerShell.getBoundingClientRect();
    applyTizenAvplayObjectBounds(displayObject, bounds);
    if (!avplay) return;
    try {
      if (avplay.getState() === "NONE") return;
      const rect = tizenDisplayRectForBounds(
        bounds,
        windowObject.innerWidth,
        windowObject.innerHeight
      );
      if (rect) avplay.setDisplayRect(rect.x, rect.y, rect.width, rect.height);
    } catch {
      // The shared engine may be between close() and the next open().
    }
  };
  const schedule = () => {
    if (frame !== undefined) windowObject.cancelAnimationFrame?.(frame);
    if (windowObject.requestAnimationFrame) {
      frame = windowObject.requestAnimationFrame(sync);
    } else {
      sync();
    }
  };
  const observer = MutationObserverConstructor
    ? new MutationObserverConstructor(schedule)
    : undefined;
  observer?.observe(documentObject.body, {
    attributes: true,
    attributeFilter: ["class"],
    childList: true,
    subtree: true,
  });
  windowObject.addEventListener("resize", schedule);
  documentObject.addEventListener("fullscreenchange", schedule);
  documentObject.addEventListener("webkitfullscreenchange", schedule);
  schedule();

  return () => {
    observer?.disconnect();
    if (frame !== undefined) windowObject.cancelAnimationFrame?.(frame);
    windowObject.removeEventListener("resize", schedule);
    documentObject.removeEventListener("fullscreenchange", schedule);
    documentObject.removeEventListener("webkitfullscreenchange", schedule);
  };
}

function createExitDialog(documentObject, exitApplication, onClosed) {
  const backdrop = documentObject.createElement("div");
  backdrop.className = "playarr-tizen-exit-backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-labelledby", "playarr-tizen-exit-title");

  const dialog = documentObject.createElement("section");
  dialog.className = "playarr-tizen-exit-dialog";
  const title = documentObject.createElement("h1");
  title.id = "playarr-tizen-exit-title";
  title.textContent = "Exit Playarr?";
  const message = documentObject.createElement("p");
  message.textContent = "Choose Exit to return to Samsung Smart Hub.";
  const actions = documentObject.createElement("div");
  actions.className = "playarr-tizen-exit-actions";
  const cancel = documentObject.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Stay";
  const confirm = documentObject.createElement("button");
  confirm.type = "button";
  confirm.textContent = "Exit";
  actions.append(cancel, confirm);
  dialog.append(title, message, actions);
  backdrop.append(dialog);
  documentObject.body.append(backdrop);

  let exitSelected = false;
  const paint = () => {
    cancel.dataset.selected = String(!exitSelected);
    confirm.dataset.selected = String(exitSelected);
    (exitSelected ? confirm : cancel).focus({ preventScroll: true });
  };
  const close = () => {
    backdrop.remove();
    onClosed();
  };
  cancel.addEventListener("click", close);
  confirm.addEventListener("click", exitApplication);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  paint();
  return {
    close,
    handleKey(event) {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        exitSelected = event.key === "ArrowRight";
        paint();
        return true;
      }
      if (event.key === "Enter" || event.keyCode === 13) {
        if (exitSelected) exitApplication();
        else close();
        return true;
      }
      if (
        event.key === "Escape" ||
        event.key === "BrowserBack" ||
        event.keyCode === 10009
      ) {
        close();
        return true;
      }
      return false;
    },
  };
}

export function installTizenPlatformRuntime({
  windowObject = window,
  documentObject = document,
  tizenObject = globalThis.tizen,
  webapisObject = globalThis.webapis,
  createExitDialogImpl = createExitDialog,
  defer = globalThis.queueMicrotask.bind(globalThis),
} = {}) {
  documentObject.documentElement.dataset.platform = "tv-tizen";
  registerRemoteKeys(tizenObject);
  const stopDisplayRectSync = installAvplayDisplayRectSync(
    windowObject,
    documentObject,
    webapisObject
  );
  let exitDialog;

  const exitApplication = () => {
    terminateAvplay(webapisObject);
    tizenObject?.application?.getCurrentApplication?.().exit();
  };
  const handleKeyDown = (event) => {
    if (exitDialog?.handleKey(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    const isBack =
      event.key === "Escape" ||
      event.key === "BrowserBack" ||
      event.key === "GoBack" ||
      event.keyCode === 10009;
    if (isBack && isTizenRootLocation(windowObject.location)) {
      const blockingSurfaceWasOpen = hasTizenBackBlockingSurface(documentObject);
      // Prevent Samsung's platform default (which can terminate the app), but
      // do not stop propagation: React gets first chance to close a modal,
      // playlist, or minimised player. Only an otherwise-unclaimed root Back
      // opens the platform exit confirmation after event propagation finishes.
      event.preventDefault();
      defer(() => {
        if (
          blockingSurfaceWasOpen ||
          exitDialog ||
          !isTizenRootLocation(windowObject.location)
        ) {
          return;
        }
        exitDialog = createExitDialogImpl(documentObject, exitApplication, () => {
          exitDialog = undefined;
        });
      });
      return;
    }

    const normalizedKey = mediaKeyForTizenCode(event.keyCode);
    if (!normalizedKey || event.key === normalizedKey) return;
    const normalizedEvent = new KeyboardEvent("keydown", {
      key: normalizedKey,
      bubbles: true,
      cancelable: true,
      repeat: event.repeat,
    });
    windowObject.dispatchEvent(normalizedEvent);
    if (normalizedEvent.defaultPrevented) event.preventDefault();
  };
  const handlePageHide = () => terminateAvplay(webapisObject);
  windowObject.addEventListener("keydown", handleKeyDown, true);
  windowObject.addEventListener("pagehide", handlePageHide);

  return () => {
    exitDialog?.close();
    stopDisplayRectSync();
    windowObject.removeEventListener("keydown", handleKeyDown, true);
    windowObject.removeEventListener("pagehide", handlePageHide);
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  installTizenPlatformRuntime();
}
