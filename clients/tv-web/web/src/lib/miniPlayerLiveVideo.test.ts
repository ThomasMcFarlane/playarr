import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");
const surface = readFileSync(
  new URL("../components/player/PlayerSurface.tsx", import.meta.url),
  "utf8"
);

function ruleBodies(selector: string): string[] {
  const bodies: string[] = [];
  const pattern = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g");
  for (const match of css.matchAll(pattern)) bodies.push(match[2] ?? "");
  return bodies;
}

describe("in-app mini player (Picture-in-Picture fallback) shows the live video", () => {
  it("keeps the one playing <video> visible inside the minimised shell", () => {
    const bodies = ruleBodies(".player-shell-minimised .player-video");
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).not.toMatch(/display\s*:\s*none/);
      expect(body).not.toMatch(/visibility\s*:\s*hidden/);
      expect(body).not.toMatch(/opacity\s*:\s*0\s*;/);
      expect(body).toMatch(/width\s*:/);
      expect(body).toMatch(/height\s*:/);
    }
  });

  it("renders a single <video> for both the full and the minimised player (no second synced element)", () => {
    expect(surface.match(/<video\s+ref=/g)).toHaveLength(1);
  });

  it("only hides the mini card while Picture-in-Picture owns the picture", () => {
    expect(css).toMatch(/\.player-page\.is-minimised:has\(\.player-shell-pip\)\s*\{[^}]*opacity:\s*0/);
  });
});
