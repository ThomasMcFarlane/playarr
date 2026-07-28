import assert from "node:assert/strict";
import test from "node:test";
import {
  TIZEN_REMOTE_KEYS,
  applyTizenAvplayObjectBounds,
  hasTizenBackBlockingSurface,
  installTizenPlatformRuntime,
  isTizenRootLocation,
  loadPackagedConfig,
  mediaKeyForTizenCode,
  tizenDisplayRectForBounds,
} from "../src/tizen-runtime.mjs";

test("registers every non-basic Samsung media key used by Playarr", () => {
  assert.deepEqual(TIZEN_REMOTE_KEYS, [
    "MediaPlay",
    "MediaPause",
    "MediaPlayPause",
    "MediaStop",
    "MediaRewind",
    "MediaFastForward",
    "MediaTrackPrevious",
    "MediaTrackNext",
  ]);
});

test("normalizes Samsung media key codes to browser media key names", () => {
  assert.equal(mediaKeyForTizenCode(10252), "MediaPlayPause");
  assert.equal(mediaKeyForTizenCode(412), "MediaRewind");
  assert.equal(mediaKeyForTizenCode(417), "MediaFastForward");
  assert.equal(mediaKeyForTizenCode(10009), undefined);
});

test("only treats the HashRouter home route as the app root", () => {
  assert.equal(isTizenRootLocation({ hash: "#/", pathname: "/index.html" }), true);
  assert.equal(isTizenRootLocation({ hash: "#/movies", pathname: "/index.html" }), false);
  assert.equal(isTizenRootLocation({ hash: "", pathname: "/index.html" }), true);
});

function runtimeBackHarness(blockingSurface) {
  const windowListeners = new Map();
  const deferred = [];
  let exitDialogs = 0;
  const windowObject = {
    location: { hash: "#/", pathname: "/index.html" },
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
    removeEventListener() {},
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    cancelAnimationFrame() {},
    dispatchEvent() {},
  };
  const documentObject = {
    documentElement: { dataset: {} },
    body: {},
    querySelector(selector) {
      return blockingSurface && selector.includes("aria-modal") ? {} : null;
    },
    getElementById() {
      return null;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const cleanup = installTizenPlatformRuntime({
    windowObject,
    documentObject,
    tizenObject: {},
    webapisObject: {},
    defer: (callback) => deferred.push(callback),
    createExitDialogImpl: () => {
      exitDialogs += 1;
      return { close() {}, handleKey: () => false };
    },
  });
  return {
    cleanup,
    deferred,
    exitDialogs: () => exitDialogs,
    dispatchBack() {
      let prevented = false;
      let stopped = false;
      const event = {
        key: "BrowserBack",
        keyCode: 10009,
        preventDefault() {
          prevented = true;
        },
        stopImmediatePropagation() {
          stopped = true;
        },
      };
      windowListeners.get("keydown")(event);
      return { prevented: () => prevented, stopped: () => stopped };
    },
  };
}

test("root Back propagates before opening Samsung's exit confirmation", () => {
  const harness = runtimeBackHarness(false);
  const event = harness.dispatchBack();
  assert.equal(event.prevented(), true, "Samsung's terminating default must be cancelled");
  assert.equal(event.stopped(), false, "React handlers must still receive Back");
  assert.equal(harness.exitDialogs(), 0);
  harness.deferred.shift()();
  assert.equal(harness.exitDialogs(), 1);
  harness.cleanup();
});

test("root Back lets an open React modal or minimised player handle it", () => {
  const harness = runtimeBackHarness(true);
  const event = harness.dispatchBack();
  assert.equal(event.stopped(), false);
  harness.deferred.shift()();
  assert.equal(harness.exitDialogs(), 0);
  harness.cleanup();
});

test("detects the React surfaces that own Back before the root route", () => {
  let selector;
  assert.equal(
    hasTizenBackBlockingSurface({
      querySelector(value) {
        selector = value;
        return {};
      },
    }),
    true
  );
  assert.match(selector, /aria-modal/);
  assert.match(selector, /player-page\.is-minimised/);
});

test("maps full and minimised player bounds into Samsung's display canvas", () => {
  assert.deepEqual(
    tizenDisplayRectForBounds(
      { left: 0, top: 0, width: 1280, height: 720 },
      1280,
      720
    ),
    { x: 0, y: 0, width: 1920, height: 1080 }
  );
  assert.deepEqual(
    tizenDisplayRectForBounds(
      { left: 64, top: 504, width: 320, height: 144 },
      1280,
      720
    ),
    { x: 96, y: 756, width: 480, height: 216 }
  );
  assert.equal(
    tizenDisplayRectForBounds(
      { left: 0, top: 0, width: 0, height: 0 },
      1280,
      720
    ),
    undefined
  );
});

test("moves the AVPlay object surface with the full or minimised React player", () => {
  const element = { style: {} };
  assert.equal(
    applyTizenAvplayObjectBounds(element, {
      left: 64.5,
      top: 504,
      width: 320,
      height: 144,
    }),
    true
  );
  assert.deepEqual(element.style, {
    position: "fixed",
    left: "64.5px",
    top: "504px",
    right: "auto",
    bottom: "auto",
    width: "320px",
    height: "144px",
  });
  assert.equal(
    applyTizenAvplayObjectBounds(element, {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    }),
    false
  );
});

test("synchronizes AVPlay coordinates and object CSS from the same player bounds", () => {
  const windowListeners = new Map();
  const displayRects = [];
  const displayObject = { style: {} };
  const playerShell = {
    getBoundingClientRect() {
      return { left: 64, top: 504, width: 320, height: 144 };
    },
  };
  const windowObject = {
    location: { hash: "#/player", pathname: "/index.html" },
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
    removeEventListener() {},
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    cancelAnimationFrame() {},
    dispatchEvent() {},
  };
  const documentObject = {
    documentElement: { dataset: {} },
    body: {},
    querySelector(selector) {
      return selector.includes("player-shell") ? playerShell : null;
    },
    getElementById(id) {
      return id === "av-player" ? displayObject : null;
    },
    addEventListener() {},
    removeEventListener() {},
  };

  const cleanup = installTizenPlatformRuntime({
    windowObject,
    documentObject,
    tizenObject: {},
    webapisObject: {
      avplay: {
        getState: () => "READY",
        setDisplayRect: (...values) => displayRects.push(values),
      },
    },
  });

  assert.equal(displayObject.style.left, "64px");
  assert.equal(displayObject.style.top, "504px");
  assert.equal(displayObject.style.width, "320px");
  assert.equal(displayObject.style.height, "144px");
  assert.deepEqual(displayRects, [[96, 756, 480, 216]]);
  cleanup();
});

test("publishes only an absolute HTTP(S) packaged API URL", async () => {
  const windowObject = {};
  const config = await loadPackagedConfig({
    configUrl: "playarr-config.json",
    windowObject,
    fetchImpl: async () =>
      new Response(JSON.stringify({ apiBaseUrl: " https://playarr.example.test/base// " }), {
        status: 200,
      }),
  });
  assert.deepEqual(config, { apiBaseUrl: "https://playarr.example.test/base" });
  assert.deepEqual(windowObject.PlayarrPackagedConfig, config);

  const unsafeWindow = {};
  assert.equal(
    await loadPackagedConfig({
      configUrl: "playarr-config.json",
      windowObject: unsafeWindow,
      fetchImpl: async () =>
        new Response(JSON.stringify({ apiBaseUrl: "javascript:alert(1)" }), { status: 200 }),
    }),
    undefined
  );
  assert.equal(unsafeWindow.PlayarrPackagedConfig, undefined);

  const credentialWindow = {};
  assert.equal(
    await loadPackagedConfig({
      configUrl: "playarr-config.json",
      windowObject: credentialWindow,
      fetchImpl: async () =>
        new Response(JSON.stringify({ apiBaseUrl: "https://user:secret@example.test" }), {
          status: 200,
        }),
    }),
    undefined
  );
  assert.equal(credentialWindow.PlayarrPackagedConfig, undefined);

  const emptyWindow = {};
  assert.equal(
    await loadPackagedConfig({
      configUrl: "playarr-config.json",
      windowObject: emptyWindow,
      fetchImpl: async () =>
        new Response(JSON.stringify({ apiBaseUrl: "" }), { status: 200 }),
    }),
    undefined
  );
  assert.equal(emptyWindow.PlayarrPackagedConfig, undefined);

  for (const apiBaseUrl of [
    "https://playarr.example.test/?token=secret",
    "https://playarr.example.test/#private",
  ]) {
    const parameterWindow = {};
    assert.equal(
      await loadPackagedConfig({
        configUrl: "playarr-config.json",
        windowObject: parameterWindow,
        fetchImpl: async () =>
          new Response(JSON.stringify({ apiBaseUrl }), { status: 200 }),
      }),
      undefined
    );
    assert.equal(parameterWindow.PlayarrPackagedConfig, undefined);
  }
});
