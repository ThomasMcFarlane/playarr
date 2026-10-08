import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  humanNegotiationMessage,
  isTransientNegotiationError,
  MAX_NEGOTIATION_AUTO_RETRIES,
  reconnectDelayMs,
} from "./playbackReconnect";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("negotiation error handling", () => {
  it("treats network drops and server failures as transient, client errors as final", () => {
    expect(isTransientNegotiationError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransientNegotiationError({ status: 503 })).toBe(true);
    expect(isTransientNegotiationError({ status: 408 })).toBe(true);
    expect(isTransientNegotiationError({ status: 403 })).toBe(false);
    expect(isTransientNegotiationError({ status: 404 })).toBe(false);
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(isTransientNegotiationError(abort)).toBe(false);
  });

  it("backs off 1 s, 2 s, 4 s across three silent retries", () => {
    expect(MAX_NEGOTIATION_AUTO_RETRIES).toBe(3);
    expect([0, 1, 2].map(reconnectDelayMs)).toEqual([1000, 2000, 4000]);
  });

  it("never shows raw exception text", () => {
    const raw = new TypeError("Failed to fetch");
    expect(humanNegotiationMessage(raw, "Failed to fetch")).toBe(
      "Can't reach the server. Check your connection and try again."
    );
    expect(humanNegotiationMessage({ status: 500 }, "API request failed: 500 Internal Server Error")).toMatch(
      /server had a problem/
    );
    expect(humanNegotiationMessage({ status: 404 }, "API request failed: 404")).toMatch(/no longer available/);
    expect(humanNegotiationMessage({ status: 403 }, "You do not have permission to do this.")).toBe(
      "You do not have permission to do this."
    );
  });
});

describe("player audit rules", () => {
  const surface = read("../components/player/PlayerSurface.tsx");
  const css = read("../styles/global.css");

  it("auto-hides after 5 s and seeks 10 s", () => {
    expect(surface).toContain("const AUTO_HIDE_MS = 5000;");
    expect(surface).toContain("const SEEK_STEP_SECONDS = 10;");
  });

  it("arrow keys only reveal while the controls are hidden; j and l seek", () => {
    expect(surface).toMatch(/!wasVisible && event\.key\.startsWith\("Arrow"\)/);
    expect(surface).toContain('case "j":');
    expect(surface).toContain('case "l":');
  });

  it("the error view offers Retry and Close, not raw text", () => {
    const page = read("../pages/Player.tsx");
    expect(page).toContain('t("pages.player.close")');
    expect(page).toContain("retryNegotiation");
  });

  it("every focused player control shows the white ring, from the one shared token", () => {
    const global = css;
    const layout = read("../styles/page-layout.css");
    // The player is always dark: its scope recomputes the ring token as white in both themes.
    expect(layout).toMatch(/\.player-page,[^{]*\{\s*--focus-ring-color: #ffffff;\s*--page-focus-ring: [^;]+;/);
    for (const selector of [".player-close", ".player-minimise", ".player-btn", ".player-quality-button", ".player-playlist-item"]) {
      expect(global).not.toMatch(new RegExp(`${selector.replace(".", "\\.")}:focus-visible[^{]*\\{[^}]*(background|transform)`));
    }
  });

  it("the Info panel shows the title, episode and synopsis and closes back to its opener", () => {
    const panel = read("../components/player/PlaybackHealthPanel.tsx");
    expect(panel).toContain("about.synopsis");
    expect(surface).toContain("data-player-health-button");
    expect(surface).toContain("synopsis: activePlaylistItem?.synopsis");
  });
});
