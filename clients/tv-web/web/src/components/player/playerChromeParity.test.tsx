import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ComponentType, ReactNode } from "react";

// The legacy TV package sits outside this project's rootDir, so import it
// through a variable path (resolved by vitest at run time, untyped for tsc).
const uiTvPath = "../../../../packages/ui-tv/src/";
const { SpatialNavProvider } = (await import(
  /* @vite-ignore */ `${uiTvPath}SpatialNavContext`
)) as { SpatialNavProvider: ComponentType<{ children: ReactNode }> };
const { PlayerScreen, PLAYER_CLOSE_LABEL } = (await import(
  /* @vite-ignore */ `${uiTvPath}screens/PlayerScreen`
)) as {
  PlayerScreen: ComponentType<{ engine: unknown; title?: string; onExit?: () => void }>;
  PLAYER_CLOSE_LABEL: string;
};

const engine = {
  getState: () => ({
    state: "playing",
    currentTimeSeconds: 5,
    durationSeconds: 60,
    bufferedSeconds: 10,
    volume: 1,
    muted: false,
  }),
  onStateChange: () => () => undefined,
  pause: async () => undefined,
  play: async () => undefined,
  seek: async () => undefined,
};

function render(onExit?: () => void): string {
  return renderToStaticMarkup(
    <SpatialNavProvider>
      <PlayerScreen engine={engine} title="Sample" onExit={onExit} />
    </SpatialNavProvider>
  );
}

describe("legacy ui-tv PlayerScreen chrome matches the other players", () => {
  it("has an X close at the top right labelled Close player and no Back or Exit", () => {
    const markup = render(() => undefined);
    expect(PLAYER_CLOSE_LABEL).toBe("Close player");
    expect(markup).toContain('aria-label="Close player"');
    expect(markup).toContain("right:");
    expect(markup).not.toContain("&lt; Back");
    expect(markup).not.toContain(">Exit<");
    expect(markup).not.toContain("player-back");
  });

  it("omits the close button when there is nowhere to return to", () => {
    expect(render()).not.toContain("Close player");
  });
});

describe("web player chrome positions", () => {
  const css = readFileSync(new URL("../../styles/global.css", import.meta.url), "utf8");
  const block = (sel: string) =>
    new RegExp(`\\n${sel.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

  it("anchors close and minimise from the right, never the left", () => {
    for (const sel of [".player-close", ".player-minimise"]) {
      expect(block(sel)).toMatch(/right:/);
      expect(block(sel)).not.toMatch(/left:/);
    }
  });

  it("has no player-back chrome left in the stylesheet or surface", () => {
    expect(css).not.toContain("player-back");
    expect(
      readFileSync(new URL("./PlayerSurface.tsx", import.meta.url), "utf8")
    ).not.toContain("player-back");
  });
});
