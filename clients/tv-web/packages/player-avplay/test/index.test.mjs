import assert from "node:assert/strict";
import test from "node:test";
import { TizenAvplayEngine, webVttToSami } from "../dist/index.js";

function createAvplay() {
  let state = "NONE";
  let listener = {};
  const calls = [];
  const totalTracks = [
    { index: 0, type: "VIDEO", extra_info: "{}" },
    {
      index: 1,
      type: "AUDIO",
      extra_info: JSON.stringify({ track_lang: "en", channels: 6 }),
    },
    {
      index: 2,
      type: "TEXT",
      extra_info: JSON.stringify({ track_lang: "th" }),
    },
  ];
  const api = {
    calls,
    listener: () => listener,
    open(url) {
      calls.push(["open", url]);
      state = "IDLE";
    },
    close() {
      calls.push(["close"]);
      state = "NONE";
    },
    prepare() {
      state = "READY";
    },
    prepareAsync(success) {
      calls.push(["prepareAsync"]);
      state = "READY";
      success?.();
    },
    play() {
      calls.push(["play"]);
      state = "PLAYING";
    },
    stop() {
      calls.push(["stop"]);
      state = "IDLE";
    },
    pause() {
      calls.push(["pause"]);
      state = "PAUSED";
    },
    seekTo(ms, success) {
      calls.push(["seekTo", ms]);
      success?.();
    },
    jumpForward() {},
    jumpBackward() {},
    setDisplayRect(...args) {
      calls.push(["setDisplayRect", ...args]);
    },
    setDisplayMethod(method) {
      calls.push(["setDisplayMethod", method]);
    },
    setTimeoutForBuffering() {},
    setListener(value) {
      listener = value;
    },
    setStreamingProperty(...args) {
      calls.push(["setStreamingProperty", ...args]);
    },
    getStreamingProperty() {
      return "";
    },
    setDrm(...args) {
      calls.push(["setDrm", ...args]);
    },
    getState() {
      return state;
    },
    getDuration() {
      return 120_000;
    },
    getCurrentTime() {
      return 0;
    },
    getTotalTrackInfo() {
      return totalTracks;
    },
    getCurrentStreamInfo() {
      return [totalTracks[1]];
    },
    setSelectTrack(...args) {
      calls.push(["setSelectTrack", ...args]);
    },
    setSilentSubtitle(value) {
      calls.push(["setSilentSubtitle", value]);
    },
    setExternalSubtitlePath(path) {
      calls.push(["setExternalSubtitlePath", path]);
    },
    suspend() {
      calls.push(["suspend"]);
    },
    restore() {
      calls.push(["restore"]);
    },
  };
  return api;
}

function createEngine(avplay, options = {}) {
  return new TizenAvplayEngine({
    avplay,
    lifecycleDocument: null,
    displayElement: null,
    ...options,
  });
}

test("loads AVPlay in Samsung's required order and exposes native tracks", async () => {
  const avplay = createAvplay();
  const engine = createEngine(avplay);
  engine.setPlaybackSessionId("session id/1");

  await engine.load({ url: "https://media.example/movie.m3u8", mimeType: "application/x-mpegURL" });

  assert.deepEqual(avplay.calls.slice(0, 5), [
    ["open", "https://media.example/movie.m3u8"],
    ["setStreamingProperty", "COOKIE", "streamarr_playback_session=session%20id%2F1"],
    ["setDisplayRect", 0, 0, 1920, 1080],
    ["setDisplayMethod", "PLAYER_DISPLAY_MODE_LETTER_BOX"],
    ["prepareAsync"],
  ]);
  assert.equal(engine.getState().durationSeconds, 120);
  assert.equal(engine.getState().audioTracks[0].language, "en");
  assert.equal(engine.getState().subtitleTracks[0].language, "th");
});

test("closes an existing AVPlay instance before loading another source", async () => {
  const avplay = createAvplay();
  const engine = createEngine(avplay);
  await engine.load({ url: "https://media.example/one.mp4", mimeType: "video/mp4" });
  await engine.play();
  avplay.calls.length = 0;

  await engine.load({ url: "https://media.example/two.mp4", mimeType: "video/mp4" });

  assert.deepEqual(avplay.calls.slice(0, 3), [
    ["stop"],
    ["close"],
    ["open", "https://media.example/two.mp4"],
  ]);
  assert.equal(
    avplay.calls.some((call) => call[0] === "setStreamingProperty" && call[1] === "COOKIE"),
    false,
    "a later load must not inherit the previous one-shot playback session"
  );
});

test("uses the three-argument SetProperties DRM API", async () => {
  const avplay = createAvplay();
  const engine = createEngine(avplay);
  await engine.load({
    url: "https://media.example/protected.mpd",
    mimeType: "application/dash+xml",
    drm: {
      systemId: "com.microsoft.playready",
      licenseServerUrl: "https://license.example/playready",
      headers: { Authorization: "Bearer placeholder" },
    },
  });

  const call = avplay.calls.find((entry) => entry[0] === "setDrm");
  assert.equal(call[1], "PLAYREADY");
  assert.equal(call[2], "SetProperties");
  assert.deepEqual(JSON.parse(call[3]), {
    DeleteLicenseAfterUse: true,
    LicenseServer: "https://license.example/playready",
    HttpHeader: "Authorization: Bearer placeholder",
  });
});

test("materializes and selects an external subtitle track", async () => {
  const avplay = createAvplay();
  const engine = createEngine(avplay, {
    resolveExternalSubtitlePath: async (track) => `/tmp/${track.id}.smi`,
  });
  await engine.load({ url: "https://media.example/movie.mp4", mimeType: "video/mp4" });
  await engine.addExternalSubtitleTracks([
    { id: "server-track", url: "blob:test", label: "English", language: "en" },
  ]);
  await engine.selectSubtitleTrack("server-track");

  assert.deepEqual(avplay.calls.slice(-2), [
    ["setExternalSubtitlePath", "/tmp/server-track.smi"],
    ["setSilentSubtitle", false],
  ]);
  assert.equal(engine.getState().selectedSubtitleTrackId, "server-track");
});

test("converts Playarr WebVTT sidecars to local SAMI before AVPlay selection", async () => {
  const avplay = createAvplay();
  const writes = [];
  const filesystem = {
    openFile(path, mode, makeParents) {
      const write = { path, mode, makeParents, blob: undefined, closed: false };
      writes.push(write);
      return {
        writeBlob(blob) {
          write.blob = blob;
        },
        close() {
          write.closed = true;
        },
      };
    },
    toURI(path) {
      return `file:///private/${path}`;
    },
  };
  const webVtt = [
    "WEBVTT",
    "",
    "00:00:01.000 --> 00:00:02.500",
    "Hello & <i>Samsung</i>",
    "",
  ].join("\n");
  const engine = createEngine(avplay, {
    filesystem,
    fetchImpl: async () => new Response(webVtt, { status: 200 }),
  });

  await engine.load({ url: "https://media.example/movie.mp4", mimeType: "video/mp4" });
  await engine.addExternalSubtitleTracks([
    { id: "server-track", url: "blob:subtitle", label: "English", language: "en" },
  ]);
  await engine.selectSubtitleTrack("server-track");

  assert.equal(writes[0].path, "wgt-private-tmp/playarr-subtitles/server-track.smi");
  assert.equal(writes[0].blob.type, "application/x-sami");
  assert.match(await writes[0].blob.text(), /<SYNC Start=1000><P Class=ENCC>Hello &amp; Samsung/);
  assert.match(await writes[0].blob.text(), /<SYNC Start=2500><P Class=ENCC>&nbsp;/);
  assert.equal(writes[0].closed, true);
  assert.deepEqual(avplay.calls.slice(-2), [
    [
      "setExternalSubtitlePath",
      "file:///private/wgt-private-tmp/playarr-subtitles/server-track.smi",
    ],
    ["setSilentSubtitle", false],
  ]);
});

test("keeps overlapping WebVTT cues active in the generated SAMI timeline", () => {
  const sami = webVttToSami(
    [
      "WEBVTT",
      "",
      "00:01.000 --> 00:03.000",
      "First",
      "",
      "00:02.000 --> 00:04.000",
      "Second",
      "",
    ].join("\n")
  );
  assert.match(sami, /<SYNC Start=2000><P Class=ENCC>First<br>Second/);
  assert.match(sami, /<SYNC Start=3000><P Class=ENCC>Second/);
});

test("materializes a downloaded browser Blob before opening it with AVPlay", async () => {
  const avplay = createAvplay();
  const writes = [];
  const filesystem = {
    openFile(path, mode, makeParents) {
      const write = { path, mode, makeParents, blob: undefined, closed: false };
      writes.push(write);
      return {
        writeBlob(blob) {
          write.blob = blob;
        },
        close() {
          write.closed = true;
        },
      };
    },
    toURI(path) {
      return `file:///private/${path}`;
    },
  };
  const engine = createEngine(avplay, {
    filesystem,
    fetchImpl: async () => new Response(new Blob(["downloaded media"]), { status: 200 }),
  });

  await engine.load({ url: "blob:https://playarr.app/download-123", mimeType: "video/mp4" });

  assert.deepEqual(avplay.calls[0], [
    "open",
    "file:///private/wgt-private-tmp/playarr-media/download-123.mp4",
  ]);
  assert.equal(writes[0].path, "wgt-private-tmp/playarr-media/download-123.mp4");
  assert.equal(writes[0].mode, "w");
  assert.equal(writes[0].makeParents, true);
  assert.equal(writes[0].blob.size, 16);
  assert.equal(writes[0].closed, true);
});

test("defers track queries that firmware rejects until playback has started", async () => {
  const avplay = createAvplay();
  const totalTracks = avplay.getTotalTrackInfo();
  let tracksReady = false;
  avplay.getTotalTrackInfo = () => {
    if (!tracksReady) throw new Error("InvalidStateError");
    return totalTracks;
  };
  avplay.getCurrentStreamInfo = () => {
    if (!tracksReady) throw new Error("InvalidStateError");
    return [totalTracks[1]];
  };
  const displayElement = { style: { visibility: "" } };
  const engine = createEngine(avplay, { displayElement });

  await engine.load({ url: "https://media.example/movie.mp4", mimeType: "video/mp4" });
  assert.equal(engine.getState().state, "ready");
  await engine.play();
  assert.equal(engine.getState().state, "playing");
  assert.equal(displayElement.style.visibility, "visible");
  assert.deepEqual(engine.getState().audioTracks, []);

  tracksReady = true;
  avplay.listener().oncurrentplaytime?.(1_000);
  assert.equal(engine.getState().audioTracks[0].language, "en");
  assert.equal(engine.getState().currentTimeSeconds, 1);
});

test("selects the initial audio track after PLAYING for multi-audio streams", async () => {
  const avplay = createAvplay();
  avplay.getTotalTrackInfo().push({
    index: 3,
    type: "AUDIO",
    extra_info: JSON.stringify({ track_lang: "th", channels: 2 }),
  });
  const engine = createEngine(avplay);

  await engine.load({ url: "https://media.example/movie.m3u8", mimeType: "application/x-mpegURL" });
  assert.equal(avplay.calls.some((call) => call[0] === "setSelectTrack"), false);
  await engine.play();

  assert.deepEqual(
    avplay.calls.find((call) => call[0] === "setSelectTrack"),
    ["setSelectTrack", "AUDIO", 1]
  );
});

test("never sends AVPlay the unsupported zero or exact-duration seek endpoints", async () => {
  const avplay = createAvplay();
  const engine = createEngine(avplay);
  await engine.load({ url: "https://media.example/movie.mp4", mimeType: "video/mp4" });

  await engine.seek(0);
  await engine.seek(120);

  assert.deepEqual(
    avplay.calls.filter((call) => call[0] === "seekTo"),
    [
      ["seekTo", 1],
      ["seekTo", 119_999],
    ]
  );
  assert.equal(engine.getState().currentTimeSeconds, 119.999);
});

test("replays an ended AVPlay source without seeking to the unsupported zero endpoint", async () => {
  const avplay = createAvplay();
  const engine = createEngine(avplay);
  await engine.load({ url: "https://media.example/movie.mp4", mimeType: "video/mp4" });
  await engine.play();
  avplay.listener().onstreamcompleted?.();
  avplay.calls.length = 0;

  await engine.play();

  assert.deepEqual(avplay.calls, [["prepareAsync"], ["play"]]);
  assert.equal(engine.getState().state, "playing");
});

test("stops playback, re-enables the screen saver, and releases AVPlay", async () => {
  const avplay = createAvplay();
  const screenSaverStates = [];
  const appcommon = {
    AppCommonScreenSaverState: {
      SCREEN_SAVER_ON: "ON",
      SCREEN_SAVER_OFF: "OFF",
    },
    setScreenSaver(state) {
      screenSaverStates.push(state);
    },
  };
  const engine = createEngine(avplay, { appcommon });
  await engine.load({ url: "https://media.example/movie.mp4", mimeType: "video/mp4" });
  await engine.play();
  await engine.pause();
  await engine.destroy();

  assert.ok(screenSaverStates.includes("OFF"));
  assert.equal(screenSaverStates.at(-1), "ON");
  assert.deepEqual(avplay.calls.slice(-2), [["stop"], ["close"]]);
});
