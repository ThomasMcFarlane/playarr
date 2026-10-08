import { describe, expect, it } from "vitest";
import { pickViewDefault, shouldUpgradeFallbackFocus, stageChromeBridge, type FocusCandidate } from "./viewDefaultFocus";

const c = (region: FocusCandidate["region"], explicit = false): FocusCandidate => ({ region, explicit });

describe("pickViewDefault", () => {
  it("prefers an explicit default anywhere in the page", () => {
    expect(pickViewDefault([c("back"), c("content"), c("content", true)])).toEqual({ index: 2, kind: "explicit" });
  });

  it("falls back to the first content control before Back", () => {
    expect(pickViewDefault([c("back"), c("content"), c("content")])).toEqual({ index: 1, kind: "content" });
  });

  it("uses Back on an empty page", () => {
    expect(pickViewDefault([c("back")])).toEqual({ index: 0, kind: "back" });
  });

  it("never picks the nav rail", () => {
    expect(pickViewDefault([c("nav"), c("nav", true)])).toBeNull();
    expect(pickViewDefault([])).toBeNull();
  });
});

describe("shouldUpgradeFallbackFocus", () => {
  it("moves focus from the auto-focused Back to content that appears later", () => {
    expect(shouldUpgradeFallbackFocus({ autoKind: "back", bestKind: "content", userInteracted: false })).toBe(true);
    expect(shouldUpgradeFallbackFocus({ autoKind: "back", bestKind: "explicit", userInteracted: false })).toBe(true);
  });

  it("moves from the first control to an explicit default that appears later", () => {
    expect(shouldUpgradeFallbackFocus({ autoKind: "content", bestKind: "explicit", userInteracted: false })).toBe(true);
  });

  it("never moves once the user has acted, sideways, or when focus was not auto-placed", () => {
    expect(shouldUpgradeFallbackFocus({ autoKind: "back", bestKind: "content", userInteracted: true })).toBe(false);
    expect(shouldUpgradeFallbackFocus({ autoKind: "back", bestKind: "back", userInteracted: false })).toBe(false);
    expect(shouldUpgradeFallbackFocus({ autoKind: "explicit", bestKind: "explicit", userInteracted: false })).toBe(false);
    expect(shouldUpgradeFallbackFocus({ autoKind: null, bestKind: "content", userInteracted: false })).toBe(false);
  });
});

describe("stageChromeBridge", () => {
  it("enters the theme and language controls on UP from the page and leaves on DOWN", () => {
    expect(stageChromeBridge({ direction: "up", hasControls: true, inControls: false })).toBe("controls");
    expect(stageChromeBridge({ direction: "down", hasControls: true, inControls: true })).toBe("content");
  });

  it("does nothing elsewhere", () => {
    expect(stageChromeBridge({ direction: "up", hasControls: false, inControls: false })).toBeNull();
    expect(stageChromeBridge({ direction: "up", hasControls: true, inControls: true })).toBeNull();
    expect(stageChromeBridge({ direction: "left", hasControls: true, inControls: false })).toBeNull();
    expect(stageChromeBridge({ direction: "down", hasControls: true, inControls: false })).toBeNull();
  });
});
