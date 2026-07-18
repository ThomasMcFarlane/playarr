import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LanguageProvider } from "../../lib/i18n/LanguageProvider";
import { MiniPlayerTransport } from "./MiniPlayerTransport";

function renderTransport({
  playing = false,
  canPrevious = true,
  canNext = true,
}: {
  playing?: boolean;
  canPrevious?: boolean;
  canNext?: boolean;
} = {}) {
  return renderToStaticMarkup(
    <LanguageProvider>
      <MiniPlayerTransport
        playing={playing}
        canPrevious={canPrevious}
        canNext={canNext}
        onPrevious={() => undefined}
        onTogglePlay={() => undefined}
        onNext={() => undefined}
      />
    </LanguageProvider>
  );
}

describe("MiniPlayerTransport", () => {
  it("offers previous, play, and next controls from the minimised player", () => {
    const markup = renderTransport();

    expect(markup).toContain('aria-label="Previous item"');
    expect(markup).toContain('aria-label="Play"');
    expect(markup).toContain('aria-label="Next item"');
    expect(markup).toContain('data-navigation-focus-key="shell:mini-player-playback"');
  });

  it("shows pause while playing and disables unavailable playlist directions", () => {
    const markup = renderTransport({
      playing: true,
      canPrevious: false,
      canNext: false,
    });

    expect(markup).toContain('aria-label="Pause"');
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });
});
