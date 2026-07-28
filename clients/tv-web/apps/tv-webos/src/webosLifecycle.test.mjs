import assert from "node:assert/strict";
import test from "node:test";
import {
  installWebOsLifecycle,
  isWebOsRootLocation,
  loadWebOsRuntimeConfig,
  mediaKeyForWebOsCode,
  pauseActiveMedia,
} from "./webosLifecycle.mjs";

class FakeMediaElement {
  paused = false;
  pauseCalls = 0;

  pause() {
    this.paused = true;
    this.pauseCalls += 1;
  }
}

class FakeDocument extends EventTarget {
  hidden = false;
  webkitHidden = false;

  constructor(media) {
    super();
    this.media = media;
  }

  querySelectorAll(selector) {
    assert.equal(selector, "audio, video");
    return this.media;
  }
}

class FakeKeyboardEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.key = init.key ?? "";
    this.code = init.code ?? "";
    this.keyCode = init.keyCode ?? 0;
    this.repeat = init.repeat ?? false;
  }
}

class FakeWindow extends EventTarget {
  KeyboardEvent = FakeKeyboardEvent;
  location = { hash: "#/", pathname: "/index.html" };
  platformBackCalls = 0;
  closeCalls = 0;
  webOS = {
    platformBack: () => {
      this.platformBackCalls += 1;
    },
  };

  queueMicrotask(callback) {
    queueMicrotask(callback);
  }

  close() {
    this.closeCalls += 1;
  }
}

function remoteKey({ key = "", keyCode = 0 } = {}) {
  return new FakeKeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    keyCode,
  });
}

test("pauses active media when webOS hides the app", () => {
  const media = new FakeMediaElement();
  const appDocument = new FakeDocument([media]);
  const appWindow = new EventTarget();
  const originalMediaElement = globalThis.HTMLMediaElement;
  globalThis.HTMLMediaElement = FakeMediaElement;

  try {
    const cleanup = installWebOsLifecycle(appDocument, appWindow);
    appDocument.hidden = true;
    appDocument.dispatchEvent(new Event("visibilitychange"));
    assert.equal(media.pauseCalls, 1);

    cleanup();
    media.paused = false;
    appDocument.dispatchEvent(new Event("visibilitychange"));
    assert.equal(media.pauseCalls, 1);
  } finally {
    globalThis.HTMLMediaElement = originalMediaElement;
  }
});

test("pauses active media on pagehide and leaves already-paused media alone", () => {
  const active = new FakeMediaElement();
  const paused = new FakeMediaElement();
  paused.paused = true;
  const appDocument = new FakeDocument([active, paused]);
  const appWindow = new EventTarget();
  const originalMediaElement = globalThis.HTMLMediaElement;
  globalThis.HTMLMediaElement = FakeMediaElement;

  try {
    const cleanup = installWebOsLifecycle(appDocument, appWindow);
    appWindow.dispatchEvent(new Event("pagehide"));
    assert.equal(active.pauseCalls, 1);
    assert.equal(paused.pauseCalls, 0);
    cleanup();
  } finally {
    globalThis.HTMLMediaElement = originalMediaElement;
  }
});

test("pauseActiveMedia ignores non-media matches defensively", () => {
  const originalMediaElement = globalThis.HTMLMediaElement;
  globalThis.HTMLMediaElement = FakeMediaElement;
  try {
    assert.doesNotThrow(() => pauseActiveMedia({ querySelectorAll: () => [{}] }));
  } finally {
    globalThis.HTMLMediaElement = originalMediaElement;
  }
});

test("normalises LG numeric playback keys for the shared player", () => {
  assert.equal(mediaKeyForWebOsCode(415), "MediaPlay");
  assert.equal(mediaKeyForWebOsCode(417), "MediaFastForward");
  assert.equal(mediaKeyForWebOsCode(999), undefined);

  const appDocument = new FakeDocument([]);
  const appWindow = new FakeWindow();
  const keys = [];
  const cleanup = installWebOsLifecycle(appDocument, appWindow);
  appWindow.addEventListener("keydown", (event) => {
    if (event.key.startsWith("Media")) keys.push(event.key);
  });

  appWindow.dispatchEvent(remoteKey({ keyCode: 415 }));
  appWindow.dispatchEvent(remoteKey({ keyCode: 19 }));
  assert.deepEqual(keys, ["MediaPlay", "MediaPause"]);

  cleanup();
  appWindow.dispatchEvent(remoteKey({ keyCode: 413 }));
  assert.deepEqual(keys, ["MediaPlay", "MediaPause"]);
});

test("returns only an unhandled root Back press to webOS", async () => {
  assert.equal(isWebOsRootLocation({ hash: "#/", pathname: "/index.html" }), true);
  assert.equal(isWebOsRootLocation({ hash: "#/movies", pathname: "/index.html" }), false);

  const appDocument = new FakeDocument([]);
  const appWindow = new FakeWindow();
  const cleanup = installWebOsLifecycle(appDocument, appWindow);

  appWindow.dispatchEvent(remoteKey({ keyCode: 461 }));
  await Promise.resolve();
  assert.equal(appWindow.platformBackCalls, 1);

  const claimBack = (event) => event.preventDefault();
  appWindow.addEventListener("keydown", claimBack);
  appWindow.dispatchEvent(remoteKey({ keyCode: 461 }));
  await Promise.resolve();
  assert.equal(appWindow.platformBackCalls, 1);

  appWindow.location.hash = "#/movies";
  appWindow.removeEventListener("keydown", claimBack);
  appWindow.dispatchEvent(remoteKey({ keyCode: 461 }));
  await Promise.resolve();
  assert.equal(appWindow.platformBackCalls, 1);

  cleanup();
});

test("loads a valid packaged Playarr server before application startup", async () => {
  const appWindow = {};
  const fetchImpl = async (url, init) => {
    assert.equal(url, "./playarr-config.json");
    assert.deepEqual(init, { cache: "no-store" });
    return {
      ok: true,
      json: async () => ({ apiBaseUrl: " https://playarr.example.test/base/ " }),
    };
  };

  assert.deepEqual(
    await loadWebOsRuntimeConfig("./playarr-config.json", fetchImpl, appWindow),
    { apiBaseUrl: "https://playarr.example.test/base" }
  );
  assert.deepEqual(appWindow.PlayarrPackagedConfig, {
    apiBaseUrl: "https://playarr.example.test/base",
  });
});

test("ignores invalid or credential-bearing packaged server URLs", async () => {
  for (const apiBaseUrl of [
    "file:///tmp/server",
    "https://user:secret@playarr.example.test",
    "https://playarr.example.test/?token=secret",
    "not a URL",
  ]) {
    const appWindow = {};
    const result = await loadWebOsRuntimeConfig(
      "./playarr-config.json",
      async () => ({ ok: true, json: async () => ({ apiBaseUrl }) }),
      appWindow
    );
    assert.equal(result, undefined);
    assert.equal(appWindow.PlayarrPackagedConfig, undefined);
  }
});
