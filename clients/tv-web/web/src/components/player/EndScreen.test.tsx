import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Work } from "@playarr-tv/api-client";
import { LanguageProvider } from "../../lib/i18n/LanguageProvider";
import { EndScreen } from "./EndScreen";

vi.mock("../../lib/artwork", () => ({
  CachedArtworkImage: ({ fallback }: { fallback?: unknown }) => fallback ?? null,
}));

function render(props: Partial<ComponentProps<typeof EndScreen>> = {}): string {
  return renderToStaticMarkup(
    <LanguageProvider>
      <EndScreen
        kind="ended"
        title="Pilot"
        suggestions={[]}
        onReplay={() => undefined}
        onExit={() => undefined}
        onPlayNow={() => undefined}
        onSelectSuggestion={() => undefined}
        {...props}
      />
    </LanguageProvider>
  );
}

describe("EndScreen", () => {
  it("offers Replay (primary) and Back to details on the ended card", () => {
    const markup = render();
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Replay");
    expect(markup).toContain("Back to details");
    expect(markup).toContain("data-end-screen-primary");
    expect(markup).not.toContain("Play now");
    expect(markup).not.toContain("Cancel");
  });

  it("shows the countdown with Play now, Cancel, Replay and Back for up-next", () => {
    const markup = render({
      kind: "up-next",
      next: { title: "Second", subtitle: "Show", seasonNumber: 1, episodeNumber: 2 },
    });
    expect(markup).toContain("Up next");
    expect(markup).toContain("Second");
    expect(markup).toContain("S1:E2");
    expect(markup).toContain("Playing in 10");
    for (const label of ["Play now", "Cancel", "Replay", "Back to details"]) {
      expect(markup).toContain(label);
    }
  });

  it("hides the suggestions row when there is nothing to suggest", () => {
    expect(render()).not.toContain("More like this");
  });

  it("renders suggestion tiles when available", () => {
    const works = [
      { id: "w1", kind: "movie", title: "Another", images: [] },
    ] as unknown as Work[];
    const markup = render({ suggestions: works });
    expect(markup).toContain("More like this");
    expect(markup).toContain("data-end-screen-tile");
    expect(markup).toContain("Another");
  });
});
