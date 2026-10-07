import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isPlayerBackKey,
  resolvePlayerBack,
  shouldKeepEngineAttached,
  shouldMountPlayerSurface,
} from "./playerMounting";

describe("player mounting", () => {
  it("mounts the player directly while the session is negotiated", () => {
    expect(shouldMountPlayerSurface("loading")).toBe(true);
    expect(shouldMountPlayerSurface("ready")).toBe(true);
  });

  it("still replaces the surface with the error view on failure", () => {
    expect(shouldMountPlayerSurface("error")).toBe(false);
  });

  it("keeps the engine attached from first mount through every re-negotiation", () => {
    expect(shouldKeepEngineAttached("loading")).toBe(true);
    expect(shouldKeepEngineAttached("ready")).toBe(true);
    expect(shouldKeepEngineAttached("error")).toBe(false);
  });
});

describe("player BACK sequence", () => {
  const base = { controlsVisible: true, minimised: false, inlineMusic: false, fullscreen: false };

  it("closes visible controls first", () => {
    expect(resolvePlayerBack(base)).toBe("hide-controls");
  });

  it("exits when the controls are hidden", () => {
    expect(resolvePlayerBack({ ...base, controlsVisible: false })).toBe("exit");
  });

  it("two presses exit: hide then leave", () => {
    const first = resolvePlayerBack(base);
    const second = resolvePlayerBack({ ...base, controlsVisible: first !== "hide-controls" });
    expect([first, second]).toEqual(["hide-controls", "exit"]);
  });

  it("recognises every platform BACK key", () => {
    expect(isPlayerBackKey({ key: "Escape" })).toBe(true);
    expect(isPlayerBackKey({ key: "Unidentified", keyCode: 10009 })).toBe(true);
    expect(isPlayerBackKey({ key: "Unidentified", keyCode: 461 })).toBe(true);
    expect(isPlayerBackKey({ key: "Enter", keyCode: 13 })).toBe(false);
  });

  it("does not intercept minimised, inline music or fullscreen", () => {
    expect(resolvePlayerBack({ ...base, minimised: true })).toBe("exit");
    expect(resolvePlayerBack({ ...base, inlineMusic: true })).toBe("exit");
    expect(resolvePlayerBack({ ...base, fullscreen: true })).toBe("exit");
  });
});

describe("no Preparing playback interstitial", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

  it("Player page mounts the surface in the loading state", () => {
    const page = read("../pages/Player.tsx");
    expect(page).not.toMatch(/preparing/i);
    expect(page).toContain('if (negotiation.kind === "error")');
  });

  it("legacy TV container renders the player while negotiating", () => {
    const container = read("../../../packages/ui-tv/src/screens/PlayerScreenContainer.tsx");
    expect(container).not.toMatch(/Preparing playback/i);
    expect(container).not.toContain('state.status === "loading"');
  });

  it("the translation keys are gone", () => {
    for (const lang of ["en", "ja", "th"]) {
      const file = read(`./i18n/translations/${lang}.ts`);
      expect(file).not.toContain("pages.player.preparingPlayback");
      expect(file).not.toContain("pages.player.preparingMessage");
    }
  });

  it("Escape hides open controls before exiting, and Enter on the scrubber toggles play", () => {
    const surface = read("../components/player/PlayerSurface.tsx");
    const controls = read("../components/player/PlayerControls.tsx");
    expect(surface).toContain("resolvePlayerBack");
    expect(controls).toMatch(/case "Enter":[^]*?onTogglePlay\(\);[^]*?return;/);
    expect(read("../styles/global.css")).toMatch(
      /\.player-scrim\.is-hidden \{[^}]*translateY\(100%\)/
    );
  });

  it("the scrubber keeps focus while a seek buffers", () => {
    const surface = read("../components/player/PlayerSurface.tsx");
    expect(surface).toContain("playerControlHoldsFocus(document.activeElement)");
  });
});
