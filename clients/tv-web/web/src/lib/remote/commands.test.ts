import { describe, expect, it, vi } from "vitest";
import {
  applyTextCommand,
  executePlaybackCommand,
  navigationKeyFor,
  parseTextArgs,
  type RemotePlayerControls,
} from "./commands";

function fakePlayer(overrides: Partial<RemotePlayerControls> = {}) {
  const calls: string[] = [];
  const player: RemotePlayerControls = {
    mediaFileId: "m1",
    snapshot: () => ({ positionMs: 60_000, durationMs: 120_000, paused: false }),
    isReady: () => true,
    play: () => calls.push("play"),
    pause: () => calls.push("pause"),
    seekToMs: (ms) => calls.push(`seek:${ms}`),
    setVolume: (v) => calls.push(`volume:${v}`),
    stop: () => calls.push("stop"),
    ...overrides,
  };
  return { player, calls };
}

describe("navigationKeyFor", () => {
  it("maps directional keys and back, leaving select/home to the host", () => {
    expect(navigationKeyFor("up")?.key).toBe("ArrowUp");
    expect(navigationKeyFor("back")?.key).toBe("Escape");
    expect(navigationKeyFor("select")).toBeNull();
    expect(navigationKeyFor("bogus")).toBeNull();
  });
});

describe("applyTextCommand", () => {
  const insert = (value: string) => ({ value, mode: "insert" as const, submit: false });
  it("inserts at the caret and replaces a selection", () => {
    expect(applyTextCommand("abcd", 2, 2, insert("XY"))).toEqual({ value: "abXYcd", caret: 4 });
    expect(applyTextCommand("abcd", 1, 3, insert("-"))).toEqual({ value: "a-d", caret: 2 });
  });
  it("replaces the whole value", () => {
    expect(applyTextCommand("old", 0, 0, { value: "new", mode: "replace", submit: false })).toEqual({
      value: "new",
      caret: 3,
    });
  });
  it("backspaces a character or the selection, never past the start", () => {
    const back = { value: "", mode: "backspace" as const, submit: false };
    expect(applyTextCommand("abc", 3, 3, back)).toEqual({ value: "ab", caret: 2 });
    expect(applyTextCommand("abc", 0, 0, back)).toEqual({ value: "abc", caret: 0 });
    expect(applyTextCommand("abc", 0, 2, back)).toEqual({ value: "c", caret: 0 });
  });
  it("clamps an out-of-range selection", () => {
    expect(applyTextCommand("ab", 9, 12, insert("c"))).toEqual({ value: "abc", caret: 3 });
  });
});

describe("parseTextArgs", () => {
  it("defaults safely", () => {
    expect(parseTextArgs({})).toEqual({ value: "", mode: "insert", submit: false });
    expect(parseTextArgs({ value: "x", mode: "bogus", submit: true })).toEqual({
      value: "x",
      mode: "insert",
      submit: true,
    });
  });
});

describe("executePlaybackCommand", () => {
  it("fails when nothing is playing", () => {
    expect(executePlaybackCommand(null, { action: "pause" }).status).toBe("failed");
  });

  it("drives play, pause, toggle and stop", () => {
    const { player, calls } = fakePlayer();
    executePlaybackCommand(player, { action: "pause" });
    executePlaybackCommand(player, { action: "play" });
    executePlaybackCommand(player, { action: "toggle" }); // snapshot says playing -> pause
    executePlaybackCommand(player, { action: "stop" });
    expect(calls).toEqual(["pause", "play", "pause", "stop"]);
  });

  it("seeks absolutely and relatively, clamped to the media", () => {
    const { player, calls } = fakePlayer();
    executePlaybackCommand(player, { action: "seek", position_ms: 5_000 });
    executePlaybackCommand(player, { action: "seek_by", delta_ms: -10_000 });
    executePlaybackCommand(player, { action: "seek_by", delta_ms: 999_999 });
    executePlaybackCommand(player, { action: "seek_by", delta_ms: -999_999 });
    expect(calls).toEqual(["seek:5000", "seek:50000", "seek:120000", "seek:0"]);
    expect(executePlaybackCommand(player, { action: "seek" }).status).toBe("failed");
  });

  it("scales volume and rejects missing arguments", () => {
    const { player, calls } = fakePlayer();
    executePlaybackCommand(player, { action: "volume", level: 50 });
    expect(calls).toEqual(["volume:0.5"]);
    expect(executePlaybackCommand(player, { action: "volume" }).status).toBe("failed");
  });

  it("reports unsupported optional controls honestly", () => {
    const { player } = fakePlayer();
    expect(executePlaybackCommand(player, { action: "next" }).status).toBe("unsupported");
    expect(executePlaybackCommand(player, { action: "set_audio", language: "en" }).status).toBe(
      "unsupported"
    );
    expect(executePlaybackCommand(player, { action: "warp" }).status).toBe("unsupported");
  });

  it("selects tracks by language when available", () => {
    const setAudioLanguage = vi.fn(() => true);
    const setSubtitleLanguage = vi.fn(() => false);
    const { player } = fakePlayer({ setAudioLanguage, setSubtitleLanguage });
    expect(executePlaybackCommand(player, { action: "set_audio", language: "fr" }).status).toBe("ok");
    expect(setAudioLanguage).toHaveBeenCalledWith("fr");
    expect(executePlaybackCommand(player, { action: "set_subtitle", language: "off" }).status).toBe(
      "failed"
    );
    expect(setSubtitleLanguage).toHaveBeenCalledWith(null);
  });
});
