import { describe, expect, it } from "vitest";
import { shouldKeepEngineAttached, showPreparingScreen } from "./playerMounting";

describe("player mounting during source switches", () => {
  it("shows the preparing screen only for the initial negotiation", () => {
    expect(
      showPreparingScreen({ negotiationKind: "loading", keepInlinePlayerMounted: false, sourceSwitching: false })
    ).toBe(true);
  });

  it("keeps the player mounted when a seek restarts the transcode", () => {
    expect(
      showPreparingScreen({ negotiationKind: "loading", keepInlinePlayerMounted: false, sourceSwitching: true })
    ).toBe(false);
  });

  it("keeps the inline music player mounted and never hides errors/ready", () => {
    expect(
      showPreparingScreen({ negotiationKind: "loading", keepInlinePlayerMounted: true, sourceSwitching: false })
    ).toBe(false);
    expect(
      showPreparingScreen({ negotiationKind: "ready", keepInlinePlayerMounted: false, sourceSwitching: false })
    ).toBe(false);
  });

  it("keeps the engine attached through a switch but not an initial load or error", () => {
    expect(shouldKeepEngineAttached("ready", false)).toBe(true);
    expect(shouldKeepEngineAttached("loading", true)).toBe(true);
    expect(shouldKeepEngineAttached("loading", false)).toBe(false);
    expect(shouldKeepEngineAttached("error", true)).toBe(false);
  });
});
